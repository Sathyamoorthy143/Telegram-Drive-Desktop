// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OrgAdminDashboard } from './OrgAdminDashboard';

vi.mock('../../api', () => ({
  CHUNK_SIZE: 1024 * 1024,
  CHUNKED_UPLOAD_THRESHOLD: 8 * 1024 * 1024,
  getOrgFiles: vi.fn(async () => []),
  scanOrgFolders: vi.fn(async () => []),
  getOrgTrash: vi.fn(async () => []),
  getOrgMembers: vi.fn(async () => []),
  getOrgActivity: vi.fn(async () => []),
  getOrgStorageStatus: vi.fn(async () => ({ provisioned: true })),
  getOrgSettings: vi.fn(async () => ({})),
  updateOrgSettings: vi.fn(),
  downloadOrgFileBlob: vi.fn(),
  orgLogout: vi.fn(async () => true),
  orgMe: vi.fn(async () => ({ org_id: 'org-1', member_id: 'm1', username: 'v', role: 'viewer' })),
  isOrgAuthError: vi.fn(() => false),
  setOrgToken: vi.fn(),
  setOrgId: vi.fn(),
}));

const org = { id: 'org-1', name: 'Acme', subdomain: 'acme' };
const noop = () => {};

describe('OrgAdminDashboard role tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides Members/Settings tabs from viewers', async () => {
    render(
      <OrgAdminDashboard
        org={org}
        session={{ username: 'v', role: 'viewer', member_id: 'm1' }}
        onLogout={noop}
      />,
    );
    await waitFor(() => expect(screen.getAllByText('Files').length).toBeGreaterThan(0));
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.getByText('Trash')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();
  });

  it('shows all tabs to owners (incl. master bypass)', async () => {
    render(<OrgAdminDashboard org={org} session={null} onLogout={noop} />);
    await waitFor(() => expect(screen.getByText('Members')).toBeTruthy());
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getAllByText('Files').length).toBeGreaterThan(0);
  });

  it('shows upload actions to editors but not viewers', async () => {
    const { unmount } = render(
      <OrgAdminDashboard
        org={org}
        session={{ username: 'e', role: 'editor', member_id: 'm2' }}
        onLogout={noop}
      />,
    );
    await waitFor(() => expect(screen.getByText('Upload Files')).toBeTruthy());
    unmount();
    render(
      <OrgAdminDashboard
        org={org}
        session={{ username: 'v', role: 'viewer', member_id: 'm1' }}
        onLogout={noop}
      />,
    );
    await waitFor(() => expect(screen.getByText('No files yet.')).toBeTruthy());
    expect(screen.queryByText('Upload Files')).toBeNull();
  });
});
