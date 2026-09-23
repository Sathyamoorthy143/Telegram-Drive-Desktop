// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrgMembersPanel } from './OrgMembersPanel';
import { OrgActivityPanel } from './OrgActivityPanel';
import { OrgSettingsPanel } from './OrgSettingsPanel';
import { createOrgMember } from '../../api';

vi.mock('../../api', () => ({
  getOrgMembers: vi.fn(async () => [{ id: 'm1', username: 'alice', role: 'viewer' }]),
  getOrgGrants: vi.fn(async () => []),
  createOrgMember: vi.fn(),
  deleteOrgMember: vi.fn(),
  setOrgGrant: vi.fn(),
  deleteOrgGrant: vi.fn(),
  getOrgActivity: vi.fn(async () => [{ id: 'a1', action: 'file.upload', target_type: 'file', target_id: 'f1', created_at: '2026-01-01' }]),
  getOrgStorageStatus: vi.fn(async () => ({ provisioned: true, main_channel_id: 1, backup_channel_id: 2 })),
  getOrgSettings: vi.fn(async () => ({ notification_mode: 'all', lock_interval_ms: 300000 })),
  updateOrgSettings: vi.fn(),
}));

describe('OrgMembersPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists members with role badges', async () => {
    render(<OrgMembersPanel orgId="o1" role="admin" sessionMemberId="m9" folders={[]} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    expect(screen.getAllByText('viewer').length).toBeGreaterThan(0);
  });

  it('blocks creation when password confirmation mismatches', async () => {
    render(<OrgMembersPanel orgId="o1" role="admin" sessionMemberId="m9" folders={[]} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByPlaceholderText('password (min 4)'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByPlaceholderText('confirm password'), { target: { value: 'secret2' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    // Let the submit cycle flush, then prove nothing was sent and the form
    // was not cleared (real sonner Toaster isn't mounted here, so the toast
    // itself can't be asserted).
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(createOrgMember)).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText('username') as HTMLInputElement).value).toBe('bob');
  });

  it('creates the member when confirmation matches', async () => {
    render(<OrgMembersPanel orgId="o1" role="admin" sessionMemberId="m9" folders={[]} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByPlaceholderText('password (min 4)'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByPlaceholderText('confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(vi.mocked(createOrgMember)).toHaveBeenCalledWith('o1', 'bob', 'secret1', 'viewer'));
  });
});

describe('OrgActivityPanel', () => {
  it('renders audit rows', async () => {
    render(<OrgActivityPanel orgId="o1" />);
    await waitFor(() => expect(screen.getByText('file.upload')).toBeTruthy());
  });
});

describe('OrgSettingsPanel', () => {
  it('shows provisioned status', async () => {
    render(<OrgSettingsPanel orgId="o1" role="admin" />);
    await waitFor(() => expect(screen.getByText((_, el) => el?.textContent === 'Status: provisioned')).toBeTruthy());
  });
});
