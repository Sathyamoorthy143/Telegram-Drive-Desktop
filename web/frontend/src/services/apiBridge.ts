export interface IStore {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    save(): Promise<void>;
}

export async function callApi<T>(command: string, args: any = {}): Promise<T> {
    // Map commands to Web API endpoints
    let endpoint = command.replace('cmd_', '');
    if (endpoint.startsWith('auth_')) {
        endpoint = 'auth/' + endpoint.replace('auth_', '').replace(/_/g, '-');
    } else {
        endpoint = endpoint.replace(/_/g, '-');
    }
    
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

export const getStore = async (): Promise<IStore> => {
    // Pure Web Store using localStorage
    return {
        get: async <T>(key: string): Promise<T | null> => {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : null;
        },
        set: async (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
        delete: async (key: string) => localStorage.removeItem(key),
        save: async () => {},
    };
};
