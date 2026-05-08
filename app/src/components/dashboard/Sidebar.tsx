import { useState } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut, Settings, ChevronRight, ChevronDown } from 'lucide-react';
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
    onCreate: (name: string, parentId?: number) => Promise<void>;
    onSettings: () => void;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: () => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
}

function RecursiveTree({ 
    nodes, activeId, setActiveId, onDrop, onDelete, onCreate, depth = 0 
}: { 
    nodes: FolderNode[], 
    activeId: number | null, 
    setActiveId: (id: number | null) => void,
    onDrop: (e: React.DragEvent, folderId: number | null) => void,
    onDelete: (id: number, name: string) => void,
    onCreate: (name: string, parentId?: number) => Promise<void>,
    depth?: number 
}) {
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const [showSubInput, setShowSubInput] = useState<number | null>(null);
    const [subName, setSubName] = useState("");

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
                        <div className="flex-1">
                            <SidebarItem
                                icon={Folder}
                                label={node.name}
                                active={activeId === node.id}
                                onClick={() => setActiveId(node.id)}
                                onDrop={(e: React.DragEvent) => onDrop(e, node.id)}
                                onDelete={() => onDelete(node.id, node.name)}
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
                        <div className="ml-8 mt-1 pr-2">
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
                        <div className="ml-4 border-l border-telegram-border/50 pl-1">
                            <RecursiveTree 
                                nodes={node.children} 
                                activeId={activeId} 
                                setActiveId={setActiveId}
                                onDrop={onDrop}
                                onDelete={onDelete}
                                onCreate={onCreate}
                                depth={depth + 1}
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

export function Sidebar({
    folders, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate,
    isSyncing, isConnected, onSync, onLogout, onSettings, bandwidth, userInfo
}: SidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");

    const folderTree = buildFolderTree(folders);

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            // New folders created from sidebar are root level by default
            // Unless we add a way to specify parent
            await onCreate(newFolderName);
            setNewFolderName("");
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    }

    return (
        <aside className="w-64 bg-telegram-surface border-r border-telegram-border flex flex-col" onClick={e => e.stopPropagation()}>
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

            {/* Scrollable folder list */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto min-h-0">
                <SidebarItem
                    icon={HardDrive}
                    label="Saved Messages"
                    active={activeFolderId === null}
                    onClick={() => setActiveFolderId(null)}
                    onDrop={(e: React.DragEvent) => onDrop(e, null)}
                    folderId={null}
                />
                
                <RecursiveTree 
                    nodes={folderTree} 
                    activeId={activeFolderId} 
                    setActiveId={setActiveFolderId}
                    onDrop={onDrop}
                    onDelete={onDelete}
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
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span>{isConnected ? 'Connected to Telegram' : 'Disconnected from Telegram'}</span>
                </div>

                <div className="flex gap-2 mt-4">
                    <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Scan for existing folders"
                    >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </button>
                    <button
                        onClick={onSettings}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-telegram-text hover:bg-white/10 rounded-lg transition-colors border border-telegram-border"
                        title="App Settings"
                    >
                        <Settings className="w-3 h-3 text-telegram-subtext" />
                        Settings
                    </button>
                    <button
                        onClick={onLogout}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Sign Out"
                    >
                        <LogOut className="w-3 h-3" />
                        Logout
                    </button>
                </div>

                {bandwidth && <BandwidthWidget bandwidth={bandwidth} />}
            </div>

        </aside>
    )
}
