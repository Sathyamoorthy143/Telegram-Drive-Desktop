import { useState, useEffect } from 'react';
import { callApi } from '../services/apiBridge';

export function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        const checkNetwork = async () => {
            try {
                // Use standard browser logic + ping
                if (!navigator.onLine) {
                    setIsOnline(false);
                    return;
                }
                const available = await callApi<boolean>('cmd_is_network_available');
                setIsOnline(available);
            } catch (error) {
                setIsOnline(false);
            }
        };

        checkNetwork();
        const interval = setInterval(checkNetwork, 10000);
        
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            clearInterval(interval);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}
