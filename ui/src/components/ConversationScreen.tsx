/**
 * Conversation Screen - Chat view
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Send, MoreVertical } from 'lucide-react';
import { getMessages, sendMessage, Message as MessageType } from '../lib/tauri';
import { format } from 'date-fns';
import clsx from 'clsx';

interface LocationState {
  recipientPublicKey?: string;
  recipientHandle?: string;
  recipientEncryptionKey?: string;
}

export function ConversationScreen() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get recipient info from navigation state
  const recipientPublicKey = state?.recipientPublicKey;
  const recipientHandle = state?.recipientHandle;

  useEffect(() => {
    if (threadId) {
      loadMessages();
    }
  }, [threadId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    if (!threadId) return;
    try {
      setLoading(true);
      const msgs = await getMessages({ threadId });
      setMessages(msgs.reverse());
    } catch (e) {
      console.error('Failed to load messages:', e);
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;
    
    // Must have either handle or public key
    if (!recipientHandle && !recipientPublicKey) {
      console.error('No recipient info available');
      return;
    }

    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      // Optimistic update
      const optimisticMessage: MessageType = {
        id: `temp-${Date.now()}`,
        thread_id: threadId || '',
        from_public_key: 'self',
        payload_type: 'text/plain',
        payload: { text },
        timestamp: Date.now(),
        is_outgoing: true,
        status: 'sending',
      };
      setMessages((prev) => [...prev, optimisticMessage]);

      // Send with correct recipient info
      await sendMessage({
        recipientHandle: recipientHandle,
        recipientPublicKey: recipientPublicKey,
        payloadType: 'text/plain',
        payload: { text },
        threadId,
      });

      // Update status
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticMessage.id ? { ...m, status: 'sent' } : m
        )
      );
    } catch (e) {
      console.error('Failed to send message:', e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id.startsWith('temp-') ? { ...m, status: 'failed' } : m
        )
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayName = recipientHandle 
    ? `@${recipientHandle}` 
    : recipientPublicKey?.slice(0, 12) + '...' || 'Unknown';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 bg-slate-900/95 backdrop-blur-lg border-b border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/messages')}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate">{displayName}</h1>
            {recipientPublicKey && (
              <p className="text-slate-500 text-xs truncate">
                {recipientPublicKey.slice(0, 16)}...
              </p>
            )}
          </div>

          <button className="p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p>No messages yet</p>
            <p className="text-sm mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="input flex-1"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            className="p-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageType }) {
  const isOutgoing = message.is_outgoing;
  const text = typeof message.payload === 'object' && message.payload.text 
    ? message.payload.text 
    : JSON.stringify(message.payload);
  
  const time = format(new Date(message.timestamp), 'HH:mm');
  const isFailed = message.status === 'failed';
  const isSending = message.status === 'sending';

  return (
    <div className={clsx('flex', isOutgoing ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[75%] rounded-2xl px-4 py-2',
          isOutgoing
            ? 'bg-blue-600 rounded-br-md'
            : 'bg-slate-800 rounded-bl-md'
        )}
      >
        <p className="break-words">{text}</p>
        <div className={clsx(
          'text-xs mt-1 flex items-center justify-end gap-1',
          isOutgoing ? 'text-blue-200' : 'text-slate-500'
        )}>
          <span>{time}</span>
          {isSending && <span>⏳</span>}
          {isFailed && <span className="text-red-400">×</span>}
        </div>
      </div>
    </div>
  );
}
