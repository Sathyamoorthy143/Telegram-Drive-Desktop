import { invoke } from '@tauri-apps/api/core';

const isTauri = !!(window as any).__TAURI_INTERNALS__;

export interface IStore {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    save(): Promise<void>;
}

export async function callApi<T>(command: string, args: any = {}): Promise<T> {
    if (isTauri) {
        return invoke<T>(command, args);
    } else {
        // Map Tauri commands to Web API endpoints
        const endpoint = command.replace('cmd_', '').replace(/_/g, '/');
        const response = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'API Error');
        }

        return response.json();
    }
}

export const getStore = async (): Promise<IStore> => {
    if (isTauri) {
        const { Store } = await import('@tauri-apps/plugin-store');
        return (await Store.load('config.json')) as unknown as IStore;
    } else {
        // Mock Store using localStorage
        return {
            get: async <T>(key: string): Promise<T | null> => {
                const val = localStorage.getItem(key);
                return val ? JSON.parse(val) : null;
            },
            set: async (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
            delete: async (key: string) => localStorage.removeItem(key),
            save: async () => {},
        };
    }
};
