// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
 *   trash view/query     → api.getTrash / api.restoreTrash / api.emptyTrash / api.purgeTrash (nav blocked with toast; queries disabled; handler catches via orgErr)
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
      if (opts?.enabled === false) return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
      if (opts?.queryKey?.[0] === 'files') return { data: mockFilesState.files, isLoading: false, error: null };
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

  it('blocks trash / starred / recent navigation with a toast', async () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Trash'));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/not available in organization/i),
    ));
    vi.clearAllMocks();
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
