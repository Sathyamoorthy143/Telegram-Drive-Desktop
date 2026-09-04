import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { QueueItem as UploadItem } from '../types';
import { IStore as Store } from '../services/apiBridge';

const logTransfer = (name: string, type: 'upload' | 'download', size: number, status: 'success' | 'error', error?: string) => {
    try {
        const saved = localStorage.getItem('transfer_logs');
        const logs = saved ? JSON.parse(saved) : [];
        const newLog = {
            id: Math.random().toString(36).substr(2, 9),
            name,
            type,
            size,
            status,
            timestamp: Date.now(),
            error
        };
        logs.push(newLog);
        localStorage.setItem('transfer_logs', JSON.stringify(logs.slice(-1000)));
    } catch (e) {
        console.error("Failed to save log:", e);
    }
};

export function useFileUpload(store: Store | null, currentFolderId: number | null) {
    const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const cancelledRef = useRef<Set<string>>(new Set());

    // Load saved queue
    useEffect(() => {
        if (!store || initialized) return;
        store.get<UploadItem[]>('uploadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                const pending = saved.filter(i => i.status === 'pending');
                if (pending.length > 0) {
                    setUploadQueue(pending);
                    toast.info(`Restored ${pending.length} pending uploads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized]);

    // Save queue when it changes
    useEffect(() => {
        if (!store || !initialized) return;
        const pending = uploadQueue.filter(i => i.status === 'pending');
        store.set('uploadQueue', pending).then(() => store.save());
    }, [store, uploadQueue, initialized]);

    // Queue Processor
    useEffect(() => {
        if (processing) return;
        const nextItem = uploadQueue.find(i => i.status === 'pending');
        if (nextItem) {
            processItem(nextItem);
        }
    }, [uploadQueue, processing]);

    const processItem = async (item: UploadItem) => {
        setProcessing(true);
        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'uploading', progress: 0 } : i));

        try {
            // Web Upload Simulation
            await new Promise(resolve => setTimeout(resolve, 1000));
            toast.info(`Web upload simulated for ${item.path}`);

            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));
                logTransfer(item.path, 'upload', item.size, 'success');
            }
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: String(e) } : i));
                logTransfer(item.path, 'upload', item.size, 'error', String(e));
                toast.error(`Upload failed: ${item.path}`);
            } else {
                cancelledRef.current.delete(item.id);
            }
        } finally {
            setProcessing(false);
        }
    };

    const handleUploadSelect = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e: any) => {
            const files = e.target.files;
            if (!files) return;

            const newItems: UploadItem[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                newItems.push({
                    id: Math.random().toString(36).substr(2, 9),
                    path: file.name,
                    size: file.size,
                    folderId: currentFolderId,
                    status: 'pending'
                });
            }
            setUploadQueue(prev => [...prev, ...newItems]);
        };
        input.click();
    };

    const handleFolderUploadSelect = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        (input as any).directory = true;
        input.onchange = (e: any) => {
            const files = e.target.files;
            if (!files) return;

            const newItems: UploadItem[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                newItems.push({
                    id: Math.random().toString(36).substr(2, 9),
                    path: file.webkitRelativePath || file.name,
                    size: file.size,
                    folderId: currentFolderId,
                    status: 'pending'
                });
            }
            setUploadQueue(prev => [...prev, ...newItems]);
        };
        input.click();
    };

    const clearFinished = () => {
        setUploadQueue(q => q.filter(i => i.status !== 'success'));
    };

    const cancelAll = () => {
        setUploadQueue(q => {
            const uploading = q.find(i => i.status === 'uploading');
            if (uploading) cancelledRef.current.add(uploading.id);
            return q
                .filter(i => i.status !== 'pending')
                .map(i => i.status === 'uploading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All uploads cancelled');
    };

    return {
        uploadQueue,
        handleUploadSelect,
        handleFolderUploadSelect,
        clearFinished,
        cancelAll
    };
}
