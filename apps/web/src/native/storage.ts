import { isTauri } from '../hooks/usePlatform';
import { invoke } from '@tauri-apps/api/core';

// Tauri secure storage
async function tauriStore(key: string, value: string): Promise<void> {
    await invoke('secure_store', { key, value });
}

async function tauriGet(key: string): Promise<string | null> {
    return invoke('secure_get', { key });
}

async function tauriDelete(key: string): Promise<void> {
    await invoke('secure_delete', { key });
}

// Web storage 
// In a real implementation this should be encrypted, but for parity with previous implementation
// we will stick to localStorage for now.
function webStore(key: string, value: string): void {
    localStorage.setItem(key, value);
}

function webGet(key: string): string | null {
    return localStorage.getItem(key);
}

function webDelete(key: string): void {
    localStorage.removeItem(key);
}

// Unified API
export const secureStorage = {
    async set(key: string, value: string): Promise<void> {
        if (isTauri()) {
            await tauriStore(key, value);
        } else {
            webStore(key, value);
        }
    },

    async get(key: string): Promise<string | null> {
        if (isTauri()) {
            return tauriGet(key);
        }
        return webGet(key);
    },

    async delete(key: string): Promise<void> {
        if (isTauri()) {
            await tauriDelete(key);
        } else {
            webDelete(key);
        }
    }
};
