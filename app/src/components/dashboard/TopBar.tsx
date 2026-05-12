import { 
    HardDrive, LayoutGrid, Sun, Moon, ChevronDown, 
    SlidersHorizontal, PanelRightClose, PanelRightOpen, FilePlus, 
    FolderPlus, ArrowUpDown, Check, List, Grid2X2, LayoutList, Search,
    Clipboard
} from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { ViewSettings, SortField, GroupBy } from '../../types';

interface TopBarProps {
    selectedIds: number[];
    onShowMoveModal: () => void;
    onBulkDownload: () => void;
    onBulkDelete: () => void;
    onManualUpload: () => void;
    onFolderUpload: () => void;
    onCreateFolder: () => void;
    onPaste: () => void;
    canPaste: boolean;
    viewSettings: ViewSettings;
    onUpdateViewSettings: (settings: Partial<ViewSettings>) => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
}

export function TopBar({
    selectedIds, onShowMoveModal, onBulkDownload, onBulkDelete,
    onManualUpload, onFolderUpload, onCreateFolder, onPaste, canPaste, 
    viewSettings, onUpdateViewSettings, searchTerm, onSearchChange
}: TopBarProps) {
    const { theme, toggleTheme } = useTheme();
    const [activeDropdown, setActiveDropdown] = useState<'new' | 'sort' | 'view' | null>(null);

    const toggleDropdown = (name: 'new' | 'sort' | 'view') => {
        setActiveDropdown(activeDropdown === name ? null : name);
    };

    return (
        <header className="h-12 border-b border-telegram-border flex items-center px-4 justify-between bg-telegram-surface/95 backdrop-blur-md sticky top-0 z-30 select-none" onClick={() => setActiveDropdown(null)}>
            <div className="flex items-center gap-1 overflow-hidden">
                {/* New Menu */}
                <div className="relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('new'); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeDropdown === 'new' ? 'bg-telegram-hover text-telegram-primary' : 'hover:bg-telegram-hover text-telegram-text'}`}
                    >
                        <FilePlus className="w-4 h-4 text-telegram-primary" />
                        <span>New</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'new' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'new' && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-telegram-surface border border-telegram-border rounded-lg shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                            <button onClick={() => { onCreateFolder(); setActiveDropdown(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                                <FolderPlus className="w-4 h-4 text-telegram-primary" /> Create Folder
                            </button>
                            <div className="h-px bg-telegram-border my-1"></div>
                            <button onClick={() => { onManualUpload(); setActiveDropdown(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                                <FilePlus className="w-4 h-4 text-blue-400" /> Upload File
                            </button>
                            <button onClick={() => { onFolderUpload(); setActiveDropdown(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                                <HardDrive className="w-4 h-4 text-yellow-500" /> Upload Folder
                            </button>
                        </div>
                    )}
                </div>

                <div className="w-px h-6 bg-telegram-border mx-1"></div>

                {/* Selection Actions */}
                <div className="flex items-center gap-1">
                    {canPaste && (
                        <button onClick={onPaste} className="p-2 hover:bg-telegram-hover rounded-md text-green-500 transition" title="Paste">
                            <Clipboard className="w-4 h-4" />
                        </button>
                    )}
                    
                    {selectedIds.length > 0 && (
                        <>
                            <button onClick={onBulkDownload} className="p-2 hover:bg-telegram-hover rounded-md text-telegram-text transition" title="Download Selected">
                                <HardDrive className="w-4 h-4" />
                            </button>
                            <button onClick={onShowMoveModal} className="p-2 hover:bg-telegram-hover rounded-md text-telegram-text transition" title="Move Selected">
                                <SlidersHorizontal className="w-4 h-4" />
                            </button>
                            <button onClick={onBulkDelete} className="p-2 hover:bg-telegram-hover rounded-md text-red-400 transition" title="Delete Selected">
                                <Check className="w-4 h-4 rotate-45" />
                            </button>
                        </>
                    )}
                </div>

                <div className="w-px h-6 bg-telegram-border mx-1"></div>

                {/* Sort Menu */}
                <div className="relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('sort'); }}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-telegram-hover rounded-md text-sm font-medium transition-colors"
                    >
                        <ArrowUpDown className="w-4 h-4" />
                        <span>Sort</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'sort' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'sort' && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-telegram-surface border border-telegram-border rounded-lg shadow-2xl p-1 z-50">
                            {(['name', 'date', 'type', 'size'] as SortField[]).map(field => (
                                <button 
                                    key={field}
                                    onClick={() => onUpdateViewSettings({ sortField: field })}
                                    className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors capitalize"
                                >
                                    {field}
                                    {viewSettings.sortField === field && <Check className="w-3 h-3 text-telegram-primary" />}
                                </button>
                            ))}
                            <div className="h-px bg-telegram-border my-1"></div>
                            <button 
                                onClick={() => onUpdateViewSettings({ sortDirection: 'asc' })}
                                className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors"
                            >
                                Ascending
                                {viewSettings.sortDirection === 'asc' && <Check className="w-3 h-3 text-telegram-primary" />}
                            </button>
                            <button 
                                onClick={() => onUpdateViewSettings({ sortDirection: 'desc' })}
                                className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors"
                            >
                                Descending
                                {viewSettings.sortDirection === 'desc' && <Check className="w-3 h-3 text-telegram-primary" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* View Menu */}
                <div className="relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('view'); }}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-telegram-hover rounded-md text-sm font-medium transition-colors"
                    >
                        <LayoutList className="w-4 h-4" />
                        <span>View</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'view' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'view' && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-telegram-surface border border-telegram-border rounded-lg shadow-2xl p-1 z-50">
                            <button onClick={() => onUpdateViewSettings({ viewMode: 'list' })} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors">
                                <List className="w-4 h-4" /> Details
                                {viewSettings.viewMode === 'list' && <Check className="w-3 h-3 ml-auto text-telegram-primary" />}
                            </button>
                            <button onClick={() => onUpdateViewSettings({ viewMode: 'grid' })} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors">
                                <Grid2X2 className="w-4 h-4" /> Tiles
                                {viewSettings.viewMode === 'grid' && <Check className="w-3 h-3 ml-auto text-telegram-primary" />}
                            </button>
                            <div className="h-px bg-telegram-border my-1"></div>
                            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-telegram-subtext font-bold">Group by</div>
                            {(['none', 'type', 'date'] as GroupBy[]).map(group => (
                                <button 
                                    key={group}
                                    onClick={() => onUpdateViewSettings({ groupBy: group })}
                                    className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors capitalize"
                                >
                                    {group}
                                    {viewSettings.groupBy === group && <Check className="w-3 h-3 text-telegram-primary" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative group flex items-center">
                    <Search className="w-4 h-4 absolute left-3 text-telegram-subtext group-focus-within:text-telegram-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search current folder..."
                        className="bg-telegram-hover/50 border border-telegram-border rounded-full pl-9 pr-4 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext focus:outline-none focus:border-telegram-primary/50 focus:bg-telegram-surface transition-all w-48 focus:w-64"
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>

                <div className="w-px h-6 bg-telegram-border mx-1"></div>

                <button 
                    onClick={() => onUpdateViewSettings({ showPreviewPane: !viewSettings.showPreviewPane })}
                    className={`p-2 rounded-md transition-colors ${viewSettings.showPreviewPane ? 'bg-telegram-primary/20 text-telegram-primary' : 'hover:bg-telegram-hover text-telegram-subtext'}`}
                    title="Toggle Preview Pane"
                >
                    {viewSettings.showPreviewPane ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
                </button>

                <button onClick={toggleTheme} className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext transition">
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
            </div>
        </header>
    );
}
