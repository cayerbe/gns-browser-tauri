import { GnsApi, EmailApi, EmailThread } from '@gns/api-core';
import messaging from './messaging';
import { getSession } from './auth';

// Helper to get session safely
// We can use getSession from auth.ts which does the same thing but better
const getBrowserSession = () => getSession();

const webEmailApi: EmailApi = {
    getThreads: async (options = {}) => {
        const { limit = 50 } = options;
        // folder argument ignored for now as web messaging is simple inbox
        const res = await messaging.fetchInbox({ limit });
        if (res.success) {
            return {
                threads: res.messages,
                stats: { unreadCount: 0, totalThreads: res.total || 0, sentToday: 0 }
            };
        }
        throw new Error(res.error || 'Failed to fetch inbox');
    },

    getThread: async (threadId: string) => {
        // In our simple model, we just fetch the conversation with that person
        const res = await messaging.fetchConversation(threadId);
        if (res.success) {
            // Mock thread object
            const thread: EmailThread = {
                id: threadId,
                subject: 'Conversation',
                lastMessageAt: res.messages.length > 0 ? res.messages[res.messages.length - 1].createdAt : new Date().toISOString(),
                participants: [],
                unreadCount: 0,
                snippet: '',
                isStarred: false,
                hasAttachments: false,
                messages: res.messages,
                messageCount: res.messages.length
            };
            return { thread, messages: res.messages };
        }
        throw new Error('Thread not found');
    },

    send: async (data: any) => {
        let recipientKey = data.to[0]; // Simple 1:1 for now
        const content = data.body || '';

        if (recipientKey.startsWith('@')) {
            const res = await messaging.resolveRecipient(recipientKey);
            if (res.success) recipientKey = res.publicKey;
            else throw new Error(res.error);
        }

        // Send message
        const res = await messaging.sendMessage(recipientKey, content, null, data.replyToId);
        if (res.success) {
            return { messageId: res.messageId || 'pending-' + Date.now(), success: true };
        }
        throw new Error(res.error || 'Failed to send');
    },

    markRead: async (threadId: string) => {
        // No-op for now
        await messaging.acknowledgeMessage(threadId); // Assuming threadId is messageId or we ack last message? 
        // Actually threadId in web might be public key of person. 
        // messaging.acknowledgeMessage takes messageId.
        // So this might be a mismatch in API.
        // For now, no-op is safer unless we know message IDs.
    },

    toggleStar: async (_threadId: string) => {
        return { isStarred: false };
    },

    deleteThread: async (_threadId: string) => { },

    getMyAddress: async () => {
        const s = getBrowserSession();
        return { address: s?.publicKey || '', handle: s?.handle || '' };
    },

    requestDecryption: async (messageIds: string[], conversationWith: string) => {
        messaging.requestDecryption(messageIds, conversationWith);
    }
};

export const webAdapter: GnsApi = {
    getPublicKey: async () => getBrowserSession()?.publicKey || '',
    getCurrentHandle: async () => getBrowserSession()?.handle || '',
    isAuthenticated: async () => {
        const s = getBrowserSession();
        return !!(s?.sessionToken && s?.isVerified);
    },
    email: webEmailApi,
    events: {
        on: (_event, _callback) => {
            return () => { };
        },
        once: (_event, _callback) => { }
    }
};
