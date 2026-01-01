//! Network Module - API Client and WebSocket Relay
//!
//! Handles all network communication with the GNS backend.

use gns_crypto_core::{Breadcrumb, GnsEnvelope};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ==================== API Client ====================

/// GNS API Client
pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    /// Create a new API client
    pub fn new(base_url: &str) -> Result<Self, NetworkError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| NetworkError::ClientError(e.to_string()))?;

        Ok(Self {
            client,
            base_url: base_url.to_string(),
        })
    }

    /// Resolve a handle to identity info
    pub async fn resolve_handle(&self, handle: &str) -> Result<Option<IdentityInfo>, NetworkError> {
        let clean_handle = handle.trim_start_matches('@').to_lowercase();
        let url = format!("{}/handles/{}", self.base_url, clean_handle);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(NetworkError::ApiError(format!(
                "API returned status: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        Ok(Some(IdentityInfo {
            public_key: data["data"]["public_key"].as_str().unwrap_or_default().to_string(),
            encryption_key: data["data"]["encryption_key"].as_str().unwrap_or_default().to_string(),
            handle: data["data"]["handle"].as_str().map(|s| s.to_string()),
            avatar_url: data["data"]["avatar_url"].as_str().map(|s| s.to_string()),
            display_name: data["data"]["display_name"].as_str().map(|s| s.to_string()),
            is_verified: data["data"]["is_verified"].as_bool().unwrap_or(false),
        }))
    }

    /// Get handle for a public key
    pub async fn get_handle_for_key(&self, public_key: &str) -> Result<Option<String>, NetworkError> {
        let url = format!("{}/identities/{}", self.base_url, public_key);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(NetworkError::ApiError(format!(
                "API returned status: {}",
                response.status()
            )));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        Ok(data["data"]["handle"].as_str().map(|s| s.to_string()))
    }

    /// Check if a handle is available
    pub async fn check_handle_available(&self, handle: &str) -> Result<bool, NetworkError> {
        let clean_handle = handle.trim_start_matches('@').to_lowercase();
        let url = format!("{}/aliases?check={}", self.base_url, clean_handle);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        Ok(data["available"].as_bool().unwrap_or(false))
    }

    /// Claim a handle
    pub async fn claim_handle(
        &self,
        handle: &str,
        public_key: &str,
        encryption_key: &str,
        signature: &str,
        breadcrumbs: Vec<Breadcrumb>,
    ) -> Result<ClaimResponse, NetworkError> {
        let clean_handle = handle.trim_start_matches('@').to_lowercase();
        let url = format!("{}/aliases/{}/claim", self.base_url, clean_handle);

        let request = ClaimRequest {
            handle: clean_handle,
            public_key: public_key.to_string(),
            encryption_key: encryption_key.to_string(),
            signature: signature.to_string(),
            breadcrumbs,
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        let data: ClaimResponse = response
            .json()
            .await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        Ok(data)
    }

    /// Send an envelope via HTTP (fallback when WebSocket unavailable)
    pub async fn send_envelope(&self, envelope: &GnsEnvelope) -> Result<(), NetworkError> {
        let url = format!("{}/messages", self.base_url);

        let response = self
            .client
            .post(&url)
            .json(envelope)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(NetworkError::ApiError(format!(
                "Failed to send envelope: {}",
                error_text
            )));
        }

        Ok(())
    }

    /// Fetch pending messages
    pub async fn fetch_pending_messages(&self, public_key: &str) -> Result<Vec<GnsEnvelope>, NetworkError> {
        let url = format!("{}/messages/pending/{}", self.base_url, public_key);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        if !response.status().is_success() {
            return Ok(Vec::new());
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        let envelopes: Vec<GnsEnvelope> = serde_json::from_value(data["messages"].clone())
            .unwrap_or_default();

        Ok(envelopes)
    }
}

// ==================== WebSocket Relay ====================

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// WebSocket relay connection
pub struct RelayConnection {
    url: String,
    state: Arc<RwLock<ConnectionState>>,
    last_message_time: Arc<RwLock<Option<i64>>>,
    reconnect_attempts: Arc<RwLock<u32>>,
    sender: Arc<RwLock<Option<mpsc::Sender<String>>>>,
}

impl RelayConnection {
    /// Create a new relay connection
    pub fn new(url: &str) -> Result<Self, NetworkError> {
        // Convert https:// to wss:// if needed
        let ws_url = if url.starts_with("https://") {
            url.replace("https://", "wss://") + "/ws"
        } else if url.starts_with("wss://") {
            if url.ends_with("/ws") {
                url.to_string()
            } else {
                format!("{}/ws", url)
            }
        } else {
            url.to_string()
        };

        Ok(Self {
            url: ws_url,
            state: Arc::new(RwLock::new(ConnectionState::Disconnected)),
            last_message_time: Arc::new(RwLock::new(None)),
            reconnect_attempts: Arc::new(RwLock::new(0)),
            sender: Arc::new(RwLock::new(None)),
        })
    }

    /// Get the relay URL
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Check if connected
    pub async fn is_connected(&self) -> bool {
        *self.state.read().await == ConnectionState::Connected
    }

    /// Get connection state
    pub async fn get_state(&self) -> ConnectionState {
        *self.state.read().await
    }

    /// Get last message time
    pub async fn last_message_time(&self) -> Option<i64> {
        *self.last_message_time.read().await
    }

    /// Get reconnect attempts
    pub async fn reconnect_attempts(&self) -> u32 {
        *self.reconnect_attempts.read().await
    }

    /// Connect to the relay
    pub async fn connect(&self, public_key: &str) -> Result<(), NetworkError> {
        // Update state
        *self.state.write().await = ConnectionState::Connecting;
        
        tracing::info!("Connecting to relay: {}", self.url);

        // Build URL with auth params
        let url_with_auth = format!("{}?pk={}", self.url, public_key);

        // Connect to WebSocket
        let (ws_stream, _) = connect_async(&url_with_auth)
            .await
            .map_err(|e| {
                tracing::error!("WebSocket connection failed: {}", e);
                NetworkError::ConnectionError(e.to_string())
            })?;

        tracing::info!("WebSocket connected to {}", self.url);

        let (mut write, mut read) = ws_stream.split();

        // Create channel for sending messages
        let (tx, mut rx) = mpsc::channel::<String>(100);
        *self.sender.write().await = Some(tx);

        // Update state
        *self.state.write().await = ConnectionState::Connected;
        *self.reconnect_attempts.write().await = 0;

        // Clone for tasks
        let state = self.state.clone();
        let last_message_time = self.last_message_time.clone();

        // Spawn read task
        let read_state = state.clone();
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        tracing::debug!("Received WebSocket message: {}", text);
                        *last_message_time.write().await = Some(chrono::Utc::now().timestamp());
                        // TODO: Parse and handle incoming messages
                    }
                    Ok(Message::Ping(data)) => {
                        tracing::trace!("Received ping");
                        // Pong is handled automatically by tungstenite
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("WebSocket closed by server");
                        *read_state.write().await = ConnectionState::Disconnected;
                        break;
                    }
                    Err(e) => {
                        tracing::error!("WebSocket error: {}", e);
                        *read_state.write().await = ConnectionState::Disconnected;
                        break;
                    }
                    _ => {}
                }
            }
        });

        // Spawn write task
        let write_state = state.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(Message::Text(msg)).await.is_err() {
                    tracing::error!("Failed to send WebSocket message");
                    *write_state.write().await = ConnectionState::Disconnected;
                    break;
                }
            }
        });

        Ok(())
    }

    /// Disconnect from the relay
    pub async fn disconnect(&self) -> Result<(), NetworkError> {
        tracing::info!("Disconnecting from relay");
        *self.state.write().await = ConnectionState::Disconnected;
        *self.sender.write().await = None;
        Ok(())
    }

    /// Reconnect to the relay
    pub async fn reconnect(&self, public_key: &str) -> Result<(), NetworkError> {
        *self.reconnect_attempts.write().await += 1;
        *self.state.write().await = ConnectionState::Reconnecting;
        
        self.disconnect().await?;
        
        // Exponential backoff
        let attempts = *self.reconnect_attempts.read().await;
        let delay = std::cmp::min(1000 * 2u64.pow(attempts), 30000);
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        
        self.connect(public_key).await
    }

    /// Send an envelope via the relay
    pub async fn send_envelope(&self, envelope: &GnsEnvelope) -> Result<(), NetworkError> {
        let sender = self.sender.read().await;
        
        if let Some(tx) = sender.as_ref() {
            let json = serde_json::to_string(envelope)
                .map_err(|e| NetworkError::ParseError(e.to_string()))?;
            
            tx.send(json)
                .await
                .map_err(|_| NetworkError::NotConnected)?;
            
            Ok(())
        } else {
            Err(NetworkError::NotConnected)
        }
    }

    /// Send a raw JSON message
    pub async fn send_raw(&self, message: &str) -> Result<(), NetworkError> {
        let sender = self.sender.read().await;
        
        if let Some(tx) = sender.as_ref() {
            tx.send(message.to_string())
                .await
                .map_err(|_| NetworkError::NotConnected)?;
            
            Ok(())
        } else {
            Err(NetworkError::NotConnected)
        }
    }
}

// ==================== Types ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityInfo {
    pub public_key: String,
    pub encryption_key: String,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub is_verified: bool,
}

#[derive(Debug, Serialize)]
struct ClaimRequest {
    handle: String,
    public_key: String,
    encryption_key: String,
    signature: String,
    breadcrumbs: Vec<Breadcrumb>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimResponse {
    pub success: bool,
    pub transaction_id: Option<String>,
    pub error: Option<String>,
}

// ==================== Errors ====================

#[derive(Debug, thiserror::Error)]
pub enum NetworkError {
    #[error("Client error: {0}")]
    ClientError(String),

    #[error("Request error: {0}")]
    RequestError(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Not connected to relay")]
    NotConnected,
}

impl ApiClient {
    /// Get identity info by public key
    pub async fn get_identity(&self, public_key: &str) -> Result<Option<IdentityInfo>, NetworkError> {
        let url = format!("{}/identities/{}", self.base_url, public_key);

        let response = self.client.get(&url).send().await
            .map_err(|e| NetworkError::RequestError(e.to_string()))?;

        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(NetworkError::ApiError(format!("API returned status: {}", response.status())));
        }

        let data: serde_json::Value = response.json().await
            .map_err(|e| NetworkError::ParseError(e.to_string()))?;

        Ok(Some(IdentityInfo {
            public_key: data["data"]["public_key"].as_str().unwrap_or(public_key).to_string(),
            encryption_key: data["data"]["encryption_key"].as_str().unwrap_or_default().to_string(),
            handle: data["data"]["handle"].as_str().map(|s| s.to_string()),
            avatar_url: data["data"]["avatar_url"].as_str().map(|s| s.to_string()),
            display_name: data["data"]["display_name"].as_str().map(|s| s.to_string()),
            is_verified: data["data"]["is_verified"].as_bool().unwrap_or(false),
        }))
    }
}
