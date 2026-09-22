// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useEffect, useRef } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/*
 * TASK 4 AUDIT — every `requireNoOrgContext` guarded export in api.ts that is
 * reachable from Dashboard.tsx (handler → guarded call):
 *
 *   handleBulkMove      → api.moveFiles (orgErr toast)
 *   handlePaste         → api.moveFiles / api.copyFiles (orgErr toast)
 *   handleDropOnFolder  → api.moveFiles (orgErr toast)
 *   handleGlobalSearch  → api.searchFilesAdvanced (+ api.searchFiles unused) (orgMode early-return + one-time toast)
 *   bandwidth query     → api.getBandwidth (query disabled in orgMode → widget hidden, absence asserted)
 *   handleRename / handleBulkRename → api.renameFolder (orgErr toast / early-return toast)
 *   handleFolderDelete / handleDelete / handleBulkDelete → api.deleteFolder (orgErr toast)
 *   folder Properties entries (Sidebar + FileExplorer) → api.getFolderProperties (open-site toast; modal would crash on sync throw)
 *   SettingsModal open   → api.getSettings / api.saveSettings (safe: internal try/catch + save toast already surfaces e.message; no guard)
 *   trash view/query     → api.getOrgTrash / restoreOrgTrash / purgeOrgTrash in orgMode
 *     (adapted, not blocked); empty-all has no org endpoint → toast; master fns untouched
 *   bulk delete          → poolCount `ok` shortfall surfaces toast.error(`Deleted ok of n`)
 *   starred view/query   → api.getFavorites (nav blocked with toast; query disabled)
 *   recent view/query    → api.getRecent (nav blocked with toast; query disabled)
 *   handleStar / handleBulkStar → api.starFile (already surfaces e.message / early-return toast)
 *   tags entry / handleBulkTag → api.getTags / api.setTags (open-site toast — TagsModal would crash on sync throw; bulk early-return toast)
 *   handleShare         → api.createShare (already surfaces e.message via catch)
 *   VersionsModal / AllVersionsModal entries → api.getVersions / getAllVersions / restoreVersion / recordVersion (safe: internal try/catch surfaces e.message; no guard)
 *   activity log entries (Sidebar + floating + palette) → api.getActivity / clearActivity / logActivity (open-site toast — TransferLogs would crash on sync throw; fire-and-forget logActivity stays swallowed)
 *   handlePreview / downloads / uploads → api.touchRecent / api.downloadFile / uploadFileResumable (safe: org-routed or swallowed; no guard)
 *   user info / folders / camera upload / insights / duplicates / command palette → api.getUserInfo / scanFolders / getFiles (safe: unguarded or org-routed; no guard)
 */

const { mockFilesState } = vi.hoisted(() => ({ mockFilesState: { files: [] as any[] } }));

// FileExplorer measures its grid container; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

// FileExplorer virtualizes grid rows (zero measured height in jsdom renders
// nothing) — render every row so file/folder rows are interactable.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: any) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 100 })),
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    useQuery: (opts: any) => {
      // Hooks run unconditionally on every call (Rules of Hooks): the trash
      // query flips from disabled to enabled when Trash is clicked, so
      // conditional useState/useEffect would reorder hooks mid-mount.
      const [asyncData, setAsyncData] = useState<any[] | undefined>(undefined);
      const isTrash = opts?.queryKey?.[0] === 'trash' && typeof opts?.queryFn === 'function';
      const trashEnabled = isTrash && opts?.enabled !== false;
      const queryFnRef = useRef(opts?.queryFn);
      queryFnRef.current = opts?.queryFn;
      useEffect(() => {
        if (!trashEnabled) return;
        let live = true;
        queryFnRef.current().then((d: any) => { if (live) setAsyncData(d); }).catch(() => { if (live) setAsyncData([]); });
        return () => { live = false; };
      }, [trashEnabled]);
      if (opts?.enabled === false) return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
      if (opts?.queryKey?.[0] === 'files') return { data: mockFilesState.files, isLoading: false, error: null };
      // Trash executes its real queryFn so org-mode routing (getOrgTrash +
      // row mapping) is exercised; other keys keep the static stub.
      if (isTrash) return { data: asyncData, isLoading: asyncData === undefined, error: null, refetch: vi.fn() };
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn(), prefetchQuery: vi.fn(), setQueryData: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('../../api', async (importOriginal) => {
  const mod: any = await importOriginal();
  const orgErr = (f: string) => `${f} is not available in organization context`;
  const boom = (f: string) => vi.fn(async () => { throw new Error(orgErr(f)); });
  return {
    ...mod,
    getOrgContext: () => null,
    getOrgToken: () => null,
    getUserInfo: vi.fn(async () => null),
    scanFolders: vi.fn(async () => [{ id: 7, name: 'Proj', parent_id: null }]),
    getTrash: boom('Master trash (use org trash instead)'),
    restoreTrash: boom('Master trash (use org trash instead)'),
    emptyTrash: boom('Master trash (use org trash instead)'),
    purgeTrash: boom('Master trash (use org trash instead)'),
    getOrgTrash: vi.fn(async () => []),
    restoreOrgTrash: vi.fn(async () => true),
    purgeOrgTrash: vi.fn(async () => true),
    deleteFile: vi.fn(async () => true),
    getFavorites: boom('Favorites'),
    getRecent: boom('Recent'),
    getBandwidth: boom('Bandwidth stats'),
    moveFiles: boom('Move'),
    copyFiles: boom('Copy'),
    searchFiles: boom('Search'),
    searchFilesAdvanced: boom('Search'),
    renameFolder: boom('Rename folder'),
    deleteFolder: boom('Delete folder'),
    getFolderProperties: (id: number) => { throw new Error(orgErr('Folder properties')); },
    getSettings: () => { throw new Error(orgErr('Master settings')); },
    saveSettings: () => { throw new Error(orgErr('Master settings')); },
    starFile: boom('Star'),
    getTags: (id: number) => { throw new Error(orgErr('Tags')); },
    setTags: boom('Tags'),
    createShare: boom('Share links'),
    getVersions: boom('Versions'),
    getAllVersions: boom('Versions'),
    restoreVersion: boom('Versions'),
    recordVersion: boom('Versions'),
    getActivity: () => { throw new Error(orgErr('Activity log')); },
    clearActivity: boom('Activity log'),
    logActivity: vi.fn(async () => true),
    touchRecent: vi.fn(async () => true),
  };
});

import { toast } from 'sonner';
import * as api from '../../api';
import { Dashboard } from './Dashboard';
import { LockProvider } from '../../context/LockContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ThemeProvider } from '../../context/ThemeContext';

const ORG_MODE: any = {
  org: { id: 'o1', name: 'Acme', subdomain: 'acme' },
  session: { username: 'alice', role: 'admin', member_id: 'm1' },
};

const FILE_ROW: any = {
  id: 1, message_id: 1, name: 'report.pdf', size: 1234, sizeStr: '1.2 KB',
  type: 'file', icon_type: 'file', folder_id: null,
};

function renderDashboard(orgMode: any = ORG_MODE) {
  return render(
    <ThemeProvider>
      <LockProvider>
        <ConfirmProvider>
          <Dashboard onLogout={vi.fn()} orgMode={orgMode} />
        </ConfirmProvider>
      </LockProvider>
    </ThemeProvider>
  );
}

function explorer() {
  const main = document.querySelector('main');
  if (!main) throw new Error('main not rendered');
  return within(main as HTMLElement);
}

async function openContextMenuAction(fileName: string, action: string) {
  fireEvent.contextMenu(await explorer().findByText(fileName));
  fireEvent.click(await screen.findByText(action));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFilesState.files = [];
});

describe('Dashboard org mode', () => {
  it('shows org header and admin entries for admins', () => {
    renderDashboard();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('hides admin entries for viewers', () => {
    renderDashboard({ org: { id: 'o1', name: 'Acme', subdomain: 'acme' }, session: { username: 'bob', role: 'viewer', member_id: 'm2' } });
    expect(screen.queryByText('Members')).toBeNull();
  });
});

describe('Dashboard org mode unavailable-feature guards', () => {
  it('toasts instead of crashing when share has no org backend', async () => {
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    await openContextMenuAction('report.pdf', 'Share Link');
    const input = await screen.findByPlaceholderText('Link password (optional)');
    fireEvent.change(input, { target: { value: 'pw123' } });
    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('toasts when starring with no org backend', async () => {
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    await openContextMenuAction('report.pdf', 'Star');
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('blocks the tags modal with a toast (modal would crash on sync throw)', async () => {
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    await openContextMenuAction('report.pdf', 'Tags');
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
    expect(screen.queryByPlaceholderText('Add tag...')).toBeNull();
  });

  it('blocks folder properties with a toast (modal would crash on sync throw)', async () => {
    renderDashboard();
    const folder = await explorer().findByText('Proj');
    fireEvent.contextMenu(folder);
    fireEvent.click(await screen.findByText('Properties'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('blocks the master activity log with a toast (log view would crash on sync throw)', async () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Activity Log'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('opens the org trash view instead of blocking it', async () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    expect(vi.mocked(api.getOrgTrash)).toHaveBeenCalledWith('o1');
    await waitFor(() => expect(screen.getByText('Trash is empty')).toBeTruthy());
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('loads org trash rows mapped to the trash view shape', async () => {
    vi.mocked(api.getOrgTrash).mockResolvedValueOnce([
      { message_id: 11, folder_id: 5, name: 'old-doc.pdf', size: 2048, deleted_at: '2026-09-01T00:00:00Z' },
    ] as any);
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    await waitFor(() => expect(screen.getByText('old-doc.pdf')).toBeTruthy());
    // Mapped shape the JSX needs: sizeStr via formatBytes + deleted date line.
    expect(screen.getByText(/2 KB/)).toBeTruthy();
  });

  it('restore calls the org variant, not master restoreTrash', async () => {
    vi.mocked(api.getOrgTrash).mockResolvedValueOnce([
      { message_id: 11, folder_id: 5, name: 'old-doc.pdf', size: 2048, deleted_at: '2026-09-01T00:00:00Z' },
    ] as any);
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    fireEvent.click(await screen.findByText('Restore'));
    await waitFor(() => expect(vi.mocked(api.restoreOrgTrash)).toHaveBeenCalledWith('o1', 11, 5));
    expect(vi.mocked(api.restoreTrash)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Restored');
  });

  it('purge calls the org variant, not master purgeTrash', async () => {
    (window as any).confirm = vi.fn(() => true);
    vi.mocked(api.getOrgTrash).mockResolvedValueOnce([
      { message_id: 11, folder_id: 5, name: 'old-doc.pdf', size: 2048, deleted_at: '2026-09-01T00:00:00Z' },
    ] as any);
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    fireEvent.click(await screen.findByText('Delete forever'));
    await waitFor(() => expect(vi.mocked(api.purgeOrgTrash)).toHaveBeenCalledWith('o1', 11, 5));
    expect(vi.mocked(api.purgeTrash)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Permanently deleted');
  });

  it('empty-all toasts (no emptyOrgTrash endpoint exists)', async () => {
    vi.mocked(api.getOrgTrash).mockResolvedValueOnce([
      { message_id: 11, folder_id: 5, name: 'old-doc.pdf', size: 2048, deleted_at: '2026-09-01T00:00:00Z' },
    ] as any);
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    fireEvent.click(await screen.findByText('Empty Trash'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
    expect(vi.mocked(api.emptyTrash)).not.toHaveBeenCalled();
  });

  it('bulk delete reports the honest count on partial failure', async () => {
    // report.pdf deletes fine (mocked deleteFile); the Proj folder throw
    // (deleteFolder boom) must surface as `Deleted 1 of 2`, not a success.
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    fireEvent.click(await explorer().findByText('report.pdf'));
    const folder = await explorer().findByText('Proj');
    fireEvent.click(folder, { ctrlKey: true });
    fireEvent.click(screen.getByTitle('Delete Selected'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Deleted 1 of 2 items'));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalledWith(expect.stringMatching(/^Deleted/));
  });

  it('blocks starred / recent navigation with a toast', async () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Starred'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
    vi.clearAllMocks();
    fireEvent.click(screen.getByText('Recent'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('toasts when searching with no org backend', async () => {
    renderDashboard();
    const input = screen.getByPlaceholderText('Search (type:pdf size>10MB)...');
    fireEvent.change(input, { target: { value: 'report' } });
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ), { timeout: 3000 });
  });

  it('toasts when renaming a folder with no org backend', async () => {
    renderDashboard();
    const folder = await explorer().findByText('Proj');
    fireEvent.contextMenu(folder);
    fireEvent.click(await screen.findByText('Rename'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('toasts when deleting a folder with no org backend', async () => {
    renderDashboard();
    const folder = await explorer().findByText('Proj');
    fireEvent.contextMenu(folder);
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('toasts when pasting with no org backend', async () => {
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    await openContextMenuAction('report.pdf', 'Cut');
    fireEvent.click(await screen.findByText('Paste'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('toasts when moving via the move-to-folder modal with no org backend', async () => {
    mockFilesState.files = [FILE_ROW];
    renderDashboard();
    await openContextMenuAction('report.pdf', 'Move to Folder');
    // 'Proj' also renders in the sidebar tree + explorer grid — pick the
    // modal's full-width folder button.
    const modalBtn = screen.getAllByText('Proj')
      .map((e) => e.closest('button'))
      .find((b) => b && b.className.includes('w-full'));
    expect(modalBtn).toBeTruthy();
    fireEvent.click(modalBtn!);
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
  });

  it('hides the bandwidth widget with no org backend', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    expect(screen.queryByText('Used Today:')).toBeNull();
  });
});

describe('Dashboard single-file download', () => {
  const IMG_ROW: any = {
    id: 11, message_id: 11, name: 'a.jpg', size: 100, sizeStr: '100 B',
    type: 'file', icon_type: 'file', folder_id: null,
  };

  beforeEach(() => {
    localStorage.setItem('viewSettings', JSON.stringify({
      viewMode: 'list', groupBy: 'none', showPreviewPane: false,
      sortField: 'name', sortDirection: 'asc',
    }));
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('/download')) {
        return { ok: true, status: 200, blob: async () => new Blob(['x']) };
      }
      return { ok: false, status: 500, text: async () => 'unexpected' };
    }));
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads the clicked file itself, not the selection', async () => {
    mockFilesState.files = [IMG_ROW];
    // Master mode, nothing selected: the old wiring downloaded selectedIds
    // (empty) and silently did nothing.
    renderDashboard(null);
    const nameEl = await explorer().findByText('a.jpg');
    const row = nameEl.closest('div.group') || nameEl.closest('div[class*="grid"]') || nameEl.parentElement!;
    fireEvent.click(within(row as HTMLElement).getByTitle('Download'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/0/11/download'),
      expect.anything(),
    ));
  });
});
