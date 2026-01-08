import { GnsApi, EmailApi, User, EmailThread, EmailMessage, EmailFolder } from '@gns/api-core';
import messaging from '../messaging';

// Helper to get session safely
const getBrowserSession = () => {
    try {
        const s = localStorage.getItem('gns_browser_session');
        return s ? JSON.parse(s) : null;
    } catch {
        return null;
    }
};

const webEmailApi: EmailApi = {
    getThreads: async (options = {}) => {
        const { folder = 'inbox', limit = 50 } = options;
        if (folder === 'inbox') {
            const res = await messaging.fetchInbox({ limit });
            if (res.success) {
                return {
                    threads: res.messages,
                    stats: { unreadCount: 0 }
                };
            }
            throw new Error(res.error || 'Failed to fetch inbox');
        }
        return { threads: [], stats: { unreadCount: 0 } };
    },

    getThread: async (threadId: string) => {
        // In our simple model, we just fetch the conversation with that person
        const res = await messaging.fetchConversation(threadId);
        if (res.success) {
            // Mock thread object
            const thread: EmailThread = {
                id: threadId,
                subject: 'Conversation',
                lastMessage: res.messages[res.messages.length - 1],
                participants: [],
                unreadCount: 0,
                updatedAt: new Date(),
                snippet: '',
                isRead: true,
                labels: [],
                messages: res.messages
            };
            return { thread, messages: res.messages };
        }
        throw new Error('Thread not found');
    },

    send: async (data) => {
        let recipientKey = data.to[0]; // Simple 1:1 for now
        const content = data.body || '';
        const subject = data.subject || '';

        if (recipientKey.startsWith('@')) {
            const res = await messaging.resolveRecipient(recipientKey);
            if (res.success) recipientKey = res.publicKey;
            else throw new Error(res.error);
        }

        // Send message
        const res = await messaging.sendMessage(recipientKey, content, null, data.replyToId);
        if (res.success) {
            return { messageId: res.messageId || 'pending-' + Date.now() };
        }
        throw new Error(res.error || 'Failed to send');
    },

    markRead: async (threadId: string) => {
        // No-op for now
    },

    toggleStar: async (threadId: string) => {
        return { isStarred: false };
    },

    deleteThread: async (threadId: string) => { },

    getMyAddress: async () => {
        const s = getBrowserSession();
        return { address: s?.publicKey || '', handle: s?.handle || '' };
    },

    requestDecryption: async () => { }
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
        on: (event, callback) => {
            return () => { };
        },
        once: (event, callback) => { }
    }
};
