import {
    HardDrive, Sun, Moon, ChevronDown,
    FolderInput, PanelRightClose, PanelRightOpen, FilePlus,
    FolderPlus, ArrowUpDown, Check, List, Grid2X2, Search,
    Clipboard, Scissors, Copy, Camera, Star, Tag, Pencil, ListTree
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import { ViewSettings, SortField, GroupBy } from '../../types';

export interface SearchFilters { file_type: string; min_size_mb: string; max_size_mb: string; }
interface TopBarProps {
    selectedIds: number[];
    onShowMoveModal: () => void;
    onBulkDownload: () => void;
    onBulkDelete: () => void;
    onBulkStar?: (starred: boolean) => void;
    onBulkTag?: () => void;
    onBulkRename?: () => void;
    onManualUpload: () => void;
    onFolderUpload: () => void;
    onCameraUpload?: () => void;
    onCreateFolder: () => void;
    onPaste: () => void;
    onCut: (ids: number[]) => void;
    onCopy: (ids: number[]) => void;
    canPaste: boolean;
    viewSettings: ViewSettings;
    onUpdateViewSettings: (settings: Partial<ViewSettings>) => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    searchFilters?: SearchFilters;
    onSearchFiltersChange?: (f: SearchFilters) => void;
}

export function TopBar({
    selectedIds, onShowMoveModal, onBulkDownload, onBulkDelete, onBulkStar, onBulkTag, onBulkRename,
    onManualUpload, onFolderUpload, onCameraUpload, onCreateFolder, onPaste, onCut, onCopy, canPaste,
    viewSettings, onUpdateViewSettings, searchTerm, onSearchChange, searchFilters, onSearchFiltersChange
}: TopBarProps) {
    const { theme, toggleTheme } = useTheme();
    const [activeDropdown, setActiveDropdown] = useState<'new' | 'sort' | 'view' | null>(null);
    // Anchor rect of the button that opened the menu. Menus are portalled to
    // document.body with fixed positioning because the topbar's horizontal
    // scroll container (overflow-x-auto) clips absolutely-positioned children,
    // which made the New/Sort/View menus invisible when opened.
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

    const closeMenus = () => { setActiveDropdown(null); setAnchorRect(null); };

    const openDropdown = (name: 'new' | 'sort' | 'view', e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        if (activeDropdown === name) { closeMenus(); return; }
        setActiveDropdown(name);
        setAnchorRect(e.currentTarget.getBoundingClientRect());
    };

    // Dismiss portalled menus on scroll/resize so they never float detached.
    useEffect(() => {
        if (!activeDropdown) return;
        window.addEventListener('scroll', closeMenus, true);
        window.addEventListener('resize', closeMenus);
        return () => {
            window.removeEventListener('scroll', closeMenus, true);
            window.removeEventListener('resize', closeMenus);
        };
    }, [activeDropdown]);

    const renderMenu = (body: React.ReactNode, menuWidth = 192) => {
        if (!anchorRect) return null;
        const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - menuWidth - 8));
        return createPortal(
            <>
                <div className="fixed inset-0 z-40" onClick={closeMenus} />
                <div
                    className="fixed z-50 bg-telegram-surface border border-telegram-border rounded-lg shadow-2xl p-1"
                    style={{ top: anchorRect.bottom + 6, left, width: menuWidth }}
                >
                    {body}
                </div>
            </>,
            document.body
        );
    };
    const closeAnd = (fn: () => void) => () => { fn(); closeMenus(); };

    const showActions = canPaste || selectedIds.length > 0;

    return (
        <header className="h-12 border-b border-telegram-border flex items-center px-4 justify-between bg-telegram-surface/95 backdrop-blur-md sticky top-0 z-30 select-none" onClick={closeMenus}>
            <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
                {/* New Menu */}
                <div className="shrink-0">
                    <button
                        onClick={(e) => openDropdown('new', e)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeDropdown === 'new' ? 'bg-telegram-hover text-telegram-primary' : 'hover:bg-telegram-hover text-telegram-text'}`}
                    >
                        <FilePlus className="w-4 h-4 text-telegram-primary" />
                        <span>New</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'new' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'new' && renderMenu(<>
                        <button onClick={closeAnd(onCreateFolder)} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <FolderPlus className="w-4 h-4 text-telegram-primary" /> Create Folder
                        </button>
                        <div className="h-px bg-telegram-border my-1"></div>
                        <button onClick={closeAnd(onManualUpload)} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <FilePlus className="w-4 h-4 text-blue-400" /> Upload File
                        </button>
                        <button onClick={closeAnd(onFolderUpload)} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <HardDrive className="w-4 h-4 text-yellow-500" /> Upload Folder
                        </button>
                        {onCameraUpload && (
                            <button onClick={closeAnd(onCameraUpload)} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                                <Camera className="w-4 h-4 text-green-400" /> Camera Upload
                            </button>
                        )}
                    </>)}
                </div>

                {showActions && <div className="w-px h-6 bg-telegram-border mx-1 shrink-0"></div>}

                {/* Action Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                    {canPaste && (
                        <button onClick={onPaste} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-green-500 transition text-sm font-medium" title="Paste">
                            <Clipboard className="w-4 h-4" />
                            <span>Paste</span>
                        </button>
                    )}

                    {selectedIds.length > 0 && (
                        <>
                            <button onClick={() => onCopy(selectedIds)} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-blue-400 transition text-sm" title="Copy Selected">
                                <Copy className="w-4 h-4" />
                                <span>Copy</span>
                            </button>
                            <button onClick={() => onCut(selectedIds)} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-orange-400 transition text-sm" title="Cut Selected">
                                <Scissors className="w-4 h-4" />
                                <span>Cut</span>
                            </button>
                            <button onClick={onBulkDownload} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-telegram-text transition text-sm" title="Download Selected">
                                <HardDrive className="w-4 h-4" />
                                <span>Download</span>
                            </button>
                            <button onClick={onShowMoveModal} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-telegram-text transition text-sm" title="Move Selected">
                                <FolderInput className="w-4 h-4" />
                                <span>Move</span>
                            </button>
                            {onBulkStar && (
                                <button onClick={() => onBulkStar(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-yellow-400 transition text-sm" title="Star Selected">
                                    <Star className="w-4 h-4" />
                                    <span>Star</span>
                                </button>
                            )}
                            {onBulkTag && (
                                <button onClick={onBulkTag} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-purple-400 transition text-sm" title="Tag Selected">
                                    <Tag className="w-4 h-4" />
                                    <span>Tag</span>
                                </button>
                            )}
                            {onBulkRename && (
                                <button onClick={onBulkRename} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-telegram-text transition text-sm" title="Rename Selected Folders">
                                    <Pencil className="w-4 h-4" />
                                    <span>Rename</span>
                                </button>
                            )}
                            <button onClick={onBulkDelete} className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-telegram-hover rounded-md text-red-400 transition text-sm" title="Delete Selected">
                                <Check className="w-4 h-4 rotate-45" />
                                <span>Delete</span>
                            </button>
                        </>
                    )}
                </div>

                {showActions && <div className="w-px h-6 bg-telegram-border mx-1 shrink-0"></div>}

                {/* Sort Menu */}
                <div className="shrink-0">
                    <button
                        onClick={(e) => openDropdown('sort', e)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeDropdown === 'sort' ? 'bg-telegram-hover text-telegram-primary' : 'hover:bg-telegram-hover text-telegram-text'}`}
                    >
                        <ArrowUpDown className="w-4 h-4" />
                        <span className="capitalize">{viewSettings.sortField}</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'sort' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'sort' && renderMenu(<>
                        {(['name', 'date', 'type', 'size'] as SortField[]).map(field => (
                            <button
                                key={field}
                                onClick={closeAnd(() => onUpdateViewSettings({ sortField: field }))}
                                className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors capitalize text-telegram-text"
                            >
                                {field}
                                {viewSettings.sortField === field && <Check className="w-3 h-3 text-telegram-primary" />}
                            </button>
                        ))}
                        <div className="h-px bg-telegram-border my-1"></div>
                        <button
                            onClick={closeAnd(() => onUpdateViewSettings({ sortDirection: 'asc' }))}
                            className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text"
                        >
                            Ascending
                            {viewSettings.sortDirection === 'asc' && <Check className="w-3 h-3 text-telegram-primary" />}
                        </button>
                        <button
                            onClick={closeAnd(() => onUpdateViewSettings({ sortDirection: 'desc' }))}
                            className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text"
                        >
                            Descending
                            {viewSettings.sortDirection === 'desc' && <Check className="w-3 h-3 text-telegram-primary" />}
                        </button>
                    </>)}
                </div>

                {/* View Menu */}
                <div className="shrink-0">
                    <button
                        onClick={(e) => openDropdown('view', e)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeDropdown === 'view' ? 'bg-telegram-hover text-telegram-primary' : 'hover:bg-telegram-hover text-telegram-text'}`}
                    >
                        {viewSettings.viewMode === 'grid' ? <Grid2X2 className="w-4 h-4" /> : viewSettings.viewMode === 'tree' ? <ListTree className="w-4 h-4" /> : <List className="w-4 h-4" />}
                        <span>{viewSettings.viewMode === 'grid' ? 'Tiles' : viewSettings.viewMode === 'tree' ? 'Tree' : 'Details'}</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'view' ? 'rotate-180' : ''}`} />
                    </button>
                    {activeDropdown === 'view' && renderMenu(<>
                        <button onClick={closeAnd(() => onUpdateViewSettings({ viewMode: 'list' }))} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <List className="w-4 h-4" /> Details
                            {viewSettings.viewMode === 'list' && <Check className="w-3 h-3 ml-auto text-telegram-primary" />}
                        </button>
                        <button onClick={closeAnd(() => onUpdateViewSettings({ viewMode: 'grid' }))} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <Grid2X2 className="w-4 h-4" /> Tiles
                            {viewSettings.viewMode === 'grid' && <Check className="w-3 h-3 ml-auto text-telegram-primary" />}
                        </button>
                        <button onClick={closeAnd(() => onUpdateViewSettings({ viewMode: 'tree' }))} className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors text-telegram-text">
                            <ListTree className="w-4 h-4" /> Tree
                            {viewSettings.viewMode === 'tree' && <Check className="w-3 h-3 ml-auto text-telegram-primary" />}
                        </button>
                        <div className="h-px bg-telegram-border my-1"></div>
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-telegram-subtext font-bold">Group by</div>
                        {(['none', 'type', 'date'] as GroupBy[]).map(group => (
                            <button
                                key={group}
                                onClick={closeAnd(() => onUpdateViewSettings({ groupBy: group }))}
                                className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-telegram-hover rounded-md transition-colors capitalize text-telegram-text"
                            >
                                {group}
                                {viewSettings.groupBy === group && <Check className="w-3 h-3 text-telegram-primary" />}
                            </button>
                        ))}
                    </>)}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative group flex items-center">
                    <Search className="w-4 h-4 absolute left-3 text-telegram-subtext group-focus-within:text-telegram-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search (type:pdf size>10MB)..."
                        className="bg-telegram-hover/50 border border-telegram-border rounded-full pl-9 pr-4 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext focus:outline-none focus:border-telegram-primary/50 focus:bg-telegram-surface transition-all w-32 sm:w-48 sm:focus:w-64"
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                    {onSearchFiltersChange && (
                        <div className="absolute top-full right-0 mt-1 w-56 bg-telegram-surface border border-telegram-border rounded-xl shadow-2xl p-3 z-50 hidden group-focus-within:block hover:block">
                            <p className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold mb-2">Filters</p>
                            <label className="text-[10px] text-telegram-subtext">Type</label>
                            <select value={searchFilters?.file_type || ''} onChange={e=>onSearchFiltersChange({...searchFilters!, file_type: e.target.value, min_size_mb: searchFilters?.min_size_mb||'', max_size_mb: searchFilters?.max_size_mb||''})} className="w-full mb-2 bg-black/20 border border-telegram-border rounded-lg px-2 py-1.5 text-xs text-telegram-text">
                                <option value="">All</option>
                                <option value="pdf">PDF</option>
                                <option value="image">Images</option>
                                <option value="video">Video</option>
                                <option value="audio">Audio</option>
                                <option value="doc">Docs</option>
                                <option value="archive">Archives</option>
                            </select>
                            <div className="flex gap-2">
                                <div className="flex-1"><label className="text-[10px] text-telegram-subtext">Min MB</label>
                                <input value={searchFilters?.min_size_mb||''} onChange={e=>onSearchFiltersChange({...searchFilters!, file_type: searchFilters?.file_type||'', min_size_mb: e.target.value, max_size_mb: searchFilters?.max_size_mb||''})} placeholder="0" className="w-full bg-black/20 border border-telegram-border rounded-lg px-2 py-1.5 text-xs text-telegram-text" /></div>
                                <div className="flex-1"><label className="text-[10px] text-telegram-subtext">Max MB</label>
                                <input value={searchFilters?.max_size_mb||''} onChange={e=>onSearchFiltersChange({...searchFilters!, file_type: searchFilters?.file_type||'', min_size_mb: e.target.value, max_size_mb: searchFilters?.max_size_mb||''})} placeholder="500" className="w-full bg-black/20 border border-telegram-border rounded-lg px-2 py-1.5 text-xs text-telegram-text" /></div>
                            </div>
                        </div>
                    )}
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
