import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFile, FileClipboard } from '../types';

export function useFileOperations(
    activeFolderId: number | null,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
    displayedFiles: TelegramFile[],
    clipboard: FileClipboard | null,
    setClipboard: (val: FileClipboard | null) => void
) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();

    const handleDelete = async (id: number) => {
        const item = displayedFiles.find(f => f.id === id);
        const isFolder = item?.type === 'folder';
        const title = isFolder ? "Delete Folder" : "Delete File";
        const message = isFolder 
            ? `Are you sure you want to delete the folder "${item.name}" and all its contents?`
            : "Are you sure you want to delete this file?";

        if (!await confirm({ title, message, confirmText: "Delete", variant: 'danger' })) return;
        
        try {
            if (isFolder) {
                await invoke('cmd_delete_folder', { folderId: id });
                queryClient.invalidateQueries({ queryKey: ['folders'] });
            } else {
                await invoke('cmd_delete_file', { messageId: id, folderId: activeFolderId });
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            toast.success(`${isFolder ? 'Folder' : 'File'} deleted`);
        } catch (e) {
            toast.error(`Delete failed: ${e}`);
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!await confirm({ title: "Delete Items", message: `Are you sure you want to delete ${selectedIds.length} items?`, confirmText: "Delete All", variant: 'danger' })) return;

        let success = 0;
        let fail = 0;
        for (const id of selectedIds) {
            const item = displayedFiles.find(f => f.id === id);
            try {
                if (item?.type === 'folder') {
                    await invoke('cmd_delete_folder', { folderId: id });
                } else {
                    await invoke('cmd_delete_file', { messageId: id, folderId: activeFolderId });
                }
                success++;
            } catch {
                fail++;
            }
        }
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        queryClient.invalidateQueries({ queryKey: ['folders'] });
        if (success > 0) toast.success(`Deleted ${success} items.`);
        if (fail > 0) toast.error(`Failed to delete ${fail} items.`);
    }

    const handleDownload = async (id: number, name: string) => {
        try {
            const savePath = await import('@tauri-apps/plugin-dialog').then(d => d.save({
                defaultPath: name,
            }));
            if (!savePath) return;
            toast.info(`Download started: ${name}`);
            await invoke('cmd_download_file', { messageId: id, savePath, folderId: activeFolderId });
            toast.success(`Download complete: ${name}`);
        } catch (e) {
            toast.error(`Download failed: ${e}`);
        }
    }

    const handleBulkDownload = async () => {
        if (selectedIds.length === 0) return;
        try {
            const dirPath = await import('@tauri-apps/plugin-dialog').then(d => d.open({
                directory: true, multiple: false, title: "Select Download Destination"
            }));
            if (!dirPath) return;
            let successCount = 0;
            const targetFiles = displayedFiles.filter((f) => selectedIds.includes(f.id));
            toast.info(`Starting batch download of ${targetFiles.length} files...`);

            for (const file of targetFiles) {
                const filePath = `${dirPath}/${file.name}`;
                try {
                    await invoke('cmd_download_file', { messageId: file.id, savePath: filePath, folderId: activeFolderId });
                    successCount++;
                } catch (e) { }
            }
            toast.success(`Downloaded ${successCount} files.`);
            setSelectedIds([]);
        } catch (e) {
            toast.error(`Bulk download failed: ${e}`);
        }
    }

    const handleBulkMove = async (targetFolderId: number | null, onSuccess?: () => void) => {
        if (selectedIds.length === 0) return;
        try {
            await invoke('cmd_move_files', {
                messageIds: selectedIds,
                sourceFolderId: activeFolderId,
                targetFolderId: targetFolderId
            });
            toast.success(`Moved ${selectedIds.length} files.`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setSelectedIds([]);
            if (onSuccess) onSuccess();
        } catch {
            toast.error('Failed to move files');
        }
    };

    const handleDownloadFolder = async () => {
        if (displayedFiles.length === 0) {
            toast.info("Folder is empty.");
            return;
        }
        try {
            const dirPath = await import('@tauri-apps/plugin-dialog').then(d => d.open({
                directory: true, multiple: false, title: "Download Folder To..."
            }));
            if (!dirPath) return;
            let successCount = 0;
            toast.info(`Downloading folder contents (${displayedFiles.length} files)...`);
            for (const file of displayedFiles) {
                const filePath = `${dirPath}/${file.name}`;
                try {
                    await invoke('cmd_download_file', { messageId: file.id, savePath: filePath, folderId: activeFolderId });
                    successCount++;
                } catch (e) { }
            }
            toast.success(`Folder Download Complete: ${successCount} files.`);
        } catch (e) {
            toast.error("Error: " + e);
        }
    }

    const handleRename = async (id: number, currentName: string, isFolder: boolean) => {
        if (!isFolder) {
            toast.info("Telegram does not support renaming files directly. Re-upload with a different name.");
            return;
        }
        const newName = window.prompt("Enter new folder name:", currentName);
        if (!newName || newName === currentName) return;

        try {
            await invoke('cmd_rename_folder', { folderId: id, newName });
            toast.success("Folder renamed.");
            queryClient.invalidateQueries({ queryKey: ['folders'] });
        } catch (e) {
            toast.error(`Rename failed: ${e}`);
        }
    };

    const handleCut = (ids: number[]) => {
        const selectedFiles = displayedFiles.filter(f => ids.includes(f.id));
        const messageIds = selectedFiles.filter(f => f.type !== 'folder').map(f => f.id);
        const folderIds = selectedFiles.filter(f => f.type === 'folder').map(f => f.id);
        
        setClipboard({ 
            type: 'cut', 
            messageIds, 
            folderIds,
            sourceFolderId: activeFolderId 
        });
        toast.info(`Cut ${ids.length} items to clipboard.`);
    };

    const handleCopy = (ids: number[]) => {
        const selectedFiles = displayedFiles.filter(f => ids.includes(f.id));
        const messageIds = selectedFiles.filter(f => f.type !== 'folder').map(f => f.id);
        const folderIds = selectedFiles.filter(f => f.type === 'folder').map(f => f.id);

        setClipboard({ 
            type: 'copy', 
            messageIds, 
            folderIds,
            sourceFolderId: activeFolderId 
        });
        toast.info(`Copied ${ids.length} items to clipboard.`);
    };

    const handlePaste = async (targetFolderId: number | null = activeFolderId) => {
        if (!clipboard) return;
        try {
            const command = clipboard.type === 'cut' ? 'cmd_move_files' : 'cmd_copy_files';
            await invoke(command, {
                messageIds: clipboard.messageIds || [],
                folderIds: clipboard.folderIds || [],
                sourceFolderId: clipboard.sourceFolderId,
                targetFolderId: targetFolderId
            });
            const total = (clipboard.messageIds?.length || 0) + (clipboard.folderIds?.length || 0);
            toast.success(`${clipboard.type === 'cut' ? 'Moved' : 'Copied'} ${total} items.`);
            queryClient.invalidateQueries({ queryKey: ['files', targetFolderId] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            if (clipboard.type === 'cut') setClipboard(null);
        } catch (e) {
            toast.error(`Paste failed: ${e}`);
        }
    };

    return {
        handleDelete,
        handleBulkDelete,
        handleDownload,
        handleBulkDownload,
        handleBulkMove,
        handleDownloadFolder,
        handleRename,
        handleCut,
        handleCopy,
        handlePaste,
        handleGlobalSearch: async (query: string) => {
            try {
                return await invoke<TelegramFile[]>('cmd_search_global', { query });
            } catch {
                return [];
            }
        }
    };
}

