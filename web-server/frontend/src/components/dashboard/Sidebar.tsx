import { useState, useEffect } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut, Settings, ChevronRight, ChevronDown, Edit2, Scissors, Copy, Trash2, Info, Clipboard } from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { BandwidthWidget } from './BandwidthWidget';
import { TelegramFolder, BandwidthStats, UserInfo } from '../../types';
import { buildFolderTree, FolderNode } from '../../utils/treeUtils';

interface SidebarProps {
    folders: TelegramFolder[];
    activeFolderId: number | null;
    userInfo: UserInfo | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onRename: (id: number, name: string) => void;
    onCut: (id: number) => void;
    onCopy: (id: number) => void;
    onPaste: (targetFolderId: number | null) => void;
    canPaste: boolean;
    onProperties: (id: number | null) => void;
    onCreate: (name: string, parentId?: number) => Promise<void>;
    onSettings: () => void;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: () => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
}

function RecursiveTree({ 
    nodes, activeId, setActiveId, onDrop, onDelete, onRename, onCut, onCopy, onPaste, canPaste, onProperties, onCreate, depth = 0 
}: { 
    nodes: FolderNode[], 
    activeId: number | null, 
    setActiveId: (id: number | null) => void,
    onDrop: (e: React.DragEvent, folderId: number | null) => void,
    onDelete: (id: number, name: string) => void,
    onRename: (id: number, name: string) => void,
    onCut: (id: number) => void,
    onCopy: (id: number) => void,
    onPaste: (targetFolderId: number | null) => void,
    canPaste: boolean,
    onProperties: (id: number) => void,
    onCreate: (name: string, parentId?: number) => Promise<void>,
    depth?: number 
}) {
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const [showSubInput, setShowSubInput] = useState<number | null>(null);
    const [subName, setSubName] = useState("");
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, folderId: number, folderName: string } | null>(null);

    const toggle = (id: number) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const submitSub = async (parentId: number) => {
        if (!subName.trim()) return;
        await onCreate(subName, parentId);
        setSubName("");
        setShowSubInput(null);
        setExpanded(prev => ({ ...prev, [parentId]: true }));
    };

    const handleContextMenu = (e: React.MouseEvent, folderId: number, folderName: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, folderId, folderName });
    };

    // Close context menu on Escape key
    useEffect(() => {
        if (!contextMenu) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setContextMenu(null); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [contextMenu]);

    return (
        <div className="space-y-0.5">
            {nodes.map(node => (
                <div key={node.id}>
                    <div className="group flex items-center pr-2">
                        {node.children.length > 0 ? (
                            <button 
                                onClick={() => toggle(node.id)}
                                className="p-1 hover:bg-white/5 rounded text-telegram-subtext transition-colors"
                            >
                                {expanded[node.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                        ) : (
                            <div className="w-5" />
                        )}
                        <div className="flex-1 min-w-0">
                            <SidebarItem
                                icon={Folder}
                                label={node.name}
                                active={activeId === node.id}
                                onClick={() => setActiveId(node.id)}
                                onDrop={(e: React.DragEvent) => onDrop(e, node.id)}
                                onContextMenu={(e) => handleContextMenu(e, node.id, node.name)}
                                folderId={node.id}
                            />
                        </div>
                        <button 
                            onClick={() => setShowSubInput(node.id)}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded text-telegram-subtext hover:text-telegram-primary transition-all"
                            title="Create subfolder"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    
                    {showSubInput === node.id && (
                        <div className="ml-6 mt-1 pr-2">
                            <input
                                autoFocus
                                type="text"
                                className="w-full bg-white/5 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                                placeholder="Subfolder name..."
                                value={subName}
                                onChange={e => setSubName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && submitSub(node.id)}
                                onBlur={() => !subName && setShowSubInput(null)}
                            />
                        </div>
                    )}

                    {node.children.length > 0 && expanded[node.id] && (
                        <div className="ml-3 border-l border-telegram-border/30 pl-1">
                            <RecursiveTree 
                                nodes={node.children} 
                                activeId={activeId} 
                                setActiveId={setActiveId}
                                onDrop={onDrop}
                                onDelete={onDelete}
                                onRename={onRename}
                                onCut={onCut}
                                onCopy={onCopy}
                                onPaste={onPaste}
                                canPaste={canPaste}
                                onProperties={onProperties}
                                onCreate={onCreate}
                                depth={depth + 1}
                            />
                        </div>
                    )}
                </div>
            ))}

            {contextMenu && (
                <div 
                    className="fixed z-50 min-w-[160px] bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-lg shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-0.5"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button onClick={() => { onRename(contextMenu.folderId, contextMenu.folderName); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                        <Edit2 className="w-4 h-4 text-purple-400" /> Rename
                    </button>
                    <button onClick={() => { onCut(contextMenu.folderId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                        <Scissors className="w-4 h-4 text-orange-400" /> Cut
                    </button>
                    <button onClick={() => { onCopy(contextMenu.folderId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                        <Copy className="w-4 h-4 text-blue-400" /> Copy
                    </button>
                    <button onClick={() => { onProperties(contextMenu.folderId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                        <Info className="w-4 h-4 text-blue-300" /> Properties
                    </button>
                    {canPaste && (
                        <button onClick={() => { onPaste(contextMenu.folderId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                            <Clipboard className="w-4 h-4 text-green-400" /> Paste
                        </button>
                    )}
                    <div className="h-px bg-telegram-border my-1" />
                    <button onClick={() => { onDelete(contextMenu.folderId, contextMenu.folderName); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded transition-colors text-left w-full">
                        <Trash2 className="w-4 h-4" /> Delete
                    </button>
                    {/* Backdrop to close menu */}
                    <div className="fixed inset-0 -z-10" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
                </div>
            )}
        </div>
    );
}

export function Sidebar({
    folders, activeFolderId, setActiveFolderId, onDrop, onDelete, onRename, onCut, onCopy, onPaste, canPaste, onProperties, onCreate,
    isSyncing, isConnected, onSync, onLogout, onSettings, bandwidth, userInfo
}: SidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [rootContextMenu, setRootContextMenu] = useState<{ x: number, y: number } | null>(null);

    const folderTree = buildFolderTree(folders);

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            await onCreate(newFolderName);
            setNewFolderName("");
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    }

    const handleRootContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setRootContextMenu({ x: e.clientX, y: e.clientY });
    };

    // Close root context menu on Escape key
    useEffect(() => {
        if (!rootContextMenu) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setRootContextMenu(null); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [rootContextMenu]);

    return (
        <aside className="w-64 bg-telegram-surface border-r border-telegram-border flex flex-col overflow-x-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center gap-3">
                <div className="relative">
                    {userInfo ? (
                        <div className="w-10 h-10 rounded-full bg-telegram-primary/20 flex items-center justify-center text-telegram-primary font-bold border border-telegram-primary/30">
                            {userInfo.first_name.charAt(0).toUpperCase()}
                        </div>
                    ) : (
                        <img src="/logo.svg" className="w-10 h-10 drop-shadow-lg" alt="Logo" />
                    )}
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-telegram-surface ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm text-telegram-text truncate">
                        {userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}` : 'Telegram Drive'}
                    </span>
                    <span className="text-[10px] text-telegram-subtext truncate">
                        {userInfo?.username ? `@${userInfo.username}` : (isConnected ? 'Online' : 'Offline')}
                    </span>
                </div>
            </div>

            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto min-h-0">
                <SidebarItem
                    icon={HardDrive}
                    label="Saved Messages"
                    active={activeFolderId === null}
                    onClick={() => setActiveFolderId(null)}
                    onDrop={(e: React.DragEvent) => onDrop(e, null)}
                    onContextMenu={handleRootContextMenu}
                    folderId={null}
                />

                {rootContextMenu && (
                    <div 
                        className="fixed z-50 min-w-[160px] bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-lg shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-0.5"
                        style={{ left: rootContextMenu.x, top: rootContextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {canPaste && (
                            <button onClick={() => { onPaste(null); setRootContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                                <Clipboard className="w-4 h-4 text-green-400" /> Paste
                            </button>
                        )}
                        <button onClick={() => { onProperties(null); setRootContextMenu(null); }} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                            <Info className="w-4 h-4 text-blue-300" /> Properties
                        </button>
                        <div className="fixed inset-0 -z-10" onClick={() => setRootContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRootContextMenu(null); }} />
                    </div>
                )}
                
                <RecursiveTree 
                    nodes={folderTree} 
                    activeId={activeFolderId} 
                    setActiveId={setActiveFolderId}
                    onDrop={onDrop}
                    onDelete={onDelete}
                    onRename={onRename}
                    onCut={onCut}
                    onCopy={onCopy}
                    onPaste={onPaste}
                    canPaste={canPaste}
                    onProperties={onProperties}
                    onCreate={onCreate}
                />
            </nav>

            {/* Sticky Create Folder section — always visible above the footer */}
            <div className="px-2 pb-2 border-b border-telegram-border">
                {showNewFolderInput ? (
                    <div className="px-3 py-2">
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            placeholder="Folder Name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCreate()}
                            onBlur={() => !newFolderName && setShowNewFolderInput(false)}
                        />
                    </div>
                ) : (
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text transition-colors border border-dashed border-telegram-border"
                    >
                        <Plus className="w-4 h-4" />
                        Create Folder
                    </button>
                )}
            </div>

            <div className="p-4 border-t border-telegram-border">
                <div className="flex items-center gap-2 text-telegram-subtext text-xs">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className="truncate">{isConnected ? 'Connected to Telegram' : 'Disconnected'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                    <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={`flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Scan for existing folders"
                    >
                        <RefreshCw className={`w-3 h-3 flex-shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span className="truncate">{isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                    <button
                        onClick={onSettings}
                        className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-telegram-text hover:bg-white/10 rounded-lg transition-colors border border-telegram-border"
                        title="App Settings"
                    >
                        <Settings className="w-3 h-3 flex-shrink-0 text-telegram-subtext" />
                        <span className="truncate">Settings</span>
                    </button>
                    <button
                        onClick={onLogout}
                        className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Sign Out"
                    >
                        <LogOut className="w-3 h-3 flex-shrink-0" />
                        <span>Logout</span>
                    </button>
                </div>

                {bandwidth && <BandwidthWidget bandwidth={bandwidth} />}
            </div>

        </aside>
    )
}
