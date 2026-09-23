// @vitest-environment jsdom
// Regression: Upload selected must never stall silently — a hanging folder
// scan still starts the transfer, and an unexpected start-up throw surfaces
// an error toast instead of freezing staged rows with zero feedback.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

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
      if (opts?.queryKey?.[0] === 'files') return { data: [], isLoading: false, error: null };
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn(), prefetchQuery: vi.fn(), setQueryData: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() },
}));

vi.mock('../../api', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    getOrgContext: () => 'o1',
    getOrgToken: () => null,
    getUserInfo: vi.fn(async () => null),
    scanFolders: vi.fn(async () => []),
    createFolder: vi.fn(async () => ({ id: 9 })),
    uploadFile: vi.fn(async () => 'ok'),
    uploadFileChunked: vi.fn(async () => 'ok'),
    listResumableUploadSessions: () => [],
    logActivity: vi.fn(async () => true),
  };
});

vi.mock('../../orgUpload', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    // Sabotage folder resolution: flat-file tests never call this (no
    // dirs), the folder-upload test hits it and must surface a toast.
    childFolderKey: () => { throw new Error('index boom'); },
  };
});

import { toast } from 'sonner';
import * as api from '../../api';
import { Dashboard } from './Dashboard';
import { LockProvider } from '../../context/LockContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ThemeProvider } from '../../context/ThemeContext';

const ORG_MODE_MASTER_BYPASS: any = {
  org: { id: 'o1', name: 'Acme', subdomain: 'acme' },
  session: null,
};

function renderOrgDashboard() {
  return render(
    <ThemeProvider>
      <LockProvider>
        <ConfirmProvider>
          <Dashboard onLogout={vi.fn()} orgMode={ORG_MODE_MASTER_BYPASS} />
        </ConfirmProvider>
      </LockProvider>
    </ThemeProvider>
  );
}

/** Click the EmptyState "Upload Files" entry and deliver `files` to its input. */
async function stageFiles(files: File[]) {
  const createdInputs: HTMLInputElement[] = [];
  const origCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: any, opts: any) => {
    const el = origCreate(tag, opts);
    if (tag === 'input') createdInputs.push(el as HTMLInputElement);
    return el;
  }) as any);
  fireEvent.click(await screen.findByText('Upload Files'));
  expect(createdInputs.length).toBeGreaterThan(0);
  const input = createdInputs[createdInputs.length - 1];
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  (input.onchange as any)?.({ target: input });
  spy.mockRestore();
}

beforeEach(() => { vi.clearAllMocks(); });

describe('org upload start-up resilience', () => {
  it('clicking Upload selected fires the transfer', async () => {
    renderOrgDashboard();
    await stageFiles([new File(['hello'], 'hi.txt', { type: 'text/plain' })]);
    fireEvent.click(await screen.findByText(/Upload selected \(1\)/));
    await waitFor(() => expect(vi.mocked(api.uploadFile)).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('starts the transfer even when the folder scan hangs', async () => {
    vi.mocked(api.scanFolders).mockImplementation(() => new Promise<any[]>(() => {}));
    renderOrgDashboard();
    await stageFiles([new File(['hello'], 'hi.txt', { type: 'text/plain' })]);
    fireEvent.click(await screen.findByText(/Upload selected \(1\)/));
    // The 15s start-up timeout must give up waiting and start anyway.
    await waitFor(() => expect(vi.mocked(api.uploadFile)).toHaveBeenCalled(), { timeout: 25000 });
  }, 30000);

  it('toasts instead of freezing when start-up throws unexpectedly', async () => {
    // Folder upload with dirs reaches the sabotaged childFolderKey above,
    // which throws outside every best-effort try/catch.
    // (The hang test above leaves scanFolders hanging — restore it here or
    // the 15s start-up timeout trips the 15s test budget.)
    vi.mocked(api.scanFolders).mockImplementation(async () => []);
    renderOrgDashboard();
    const file = new File(['hello'], 'hi.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'docs/hi.txt' });
    // Folder entry point uses webkitRelativePath for dirs.
    const createdInputs: HTMLInputElement[] = [];
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: any, opts: any) => {
      const el = origCreate(tag, opts);
      if (tag === 'input') createdInputs.push(el as HTMLInputElement);
      return el;
    }) as any);
    fireEvent.click(await screen.findByText('Upload Folder'));
    const input = createdInputs[createdInputs.length - 1];
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    (input.onchange as any)?.({ target: input });
    createSpy.mockRestore();
    fireEvent.click(await screen.findByText(/Upload selected \(1\)/));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringMatching(/could not start/i),
    ), { timeout: 5000 });
    expect(vi.mocked(api.uploadFile)).not.toHaveBeenCalled();
  }, 15000);
});
