// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasterAdminDashboard } from './MasterAdminDashboard';
import { createOrganization, resetOrgEntryPassword } from '../../api';

vi.mock('../../api', () => ({
  getBackendCaps: vi.fn(async () => ({ version: 'x', commit: 'y', org_platform: true })),
  getAdminOverview: vi.fn(async () => ({
    orgs: [{ id: 'o1', name: 'Acme', subdomain: 'acme', active: true, member_count: 0, trash_count: 0, provisioned: true }],
    partial: false,
  })),
  getOrganizations: vi.fn(async () => []),
  createOrganization: vi.fn(),
  resetOrgEntryPassword: vi.fn(),
  getOrgMembers: vi.fn(async () => []),
  provisionOrgStorage: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  getOrgActivity: vi.fn(async () => []),
}));

describe('MasterAdminDashboard entry-password confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function fillCreate(name: string, sub: string, pw: string, confirm: string) {
    fireEvent.change(screen.getByPlaceholderText(/org name/i), { target: { value: name } });
    fireEvent.change(screen.getByPlaceholderText(/subdomain/i), { target: { value: sub } });
    fireEvent.change(screen.getByPlaceholderText('entry password (min 4)'), { target: { value: pw } });
    fireEvent.change(screen.getByPlaceholderText('confirm entry password'), { target: { value: confirm } });
  }

  it('blocks org creation when entry passwords mismatch', async () => {
    render(<MasterAdminDashboard onOpenOrg={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    fillCreate('Beta', 'beta', 'secret1', 'secret2');
    fireEvent.click(screen.getByRole('button', { name: /create org/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(createOrganization)).not.toHaveBeenCalled();
    // Form not cleared = submission rejected.
    expect((screen.getByPlaceholderText('entry password (min 4)') as HTMLInputElement).value).toBe('secret1');
  });

  it('creates the org when entry passwords match', async () => {
    render(<MasterAdminDashboard onOpenOrg={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    fillCreate('Beta', 'beta', 'secret1', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: /create org/i }));
    await waitFor(() => expect(vi.mocked(createOrganization)).toHaveBeenCalledWith('Beta', 'beta', 'secret1'));
  });

  it('blocks entry-password reset when confirmation mismatches', async () => {
    render(<MasterAdminDashboard onOpenOrg={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^members$/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('new entry password (min 4)')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('new entry password (min 4)'), { target: { value: 'new1' } });
    fireEvent.change(screen.getByPlaceholderText('confirm new entry password'), { target: { value: 'new2' } });
    fireEvent.click(screen.getByRole('button', { name: /reset entry password/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(resetOrgEntryPassword)).not.toHaveBeenCalled();
  });

  it('resets the entry password when confirmation matches', async () => {
    render(<MasterAdminDashboard onOpenOrg={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^members$/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('new entry password (min 4)')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('new entry password (min 4)'), { target: { value: 'newsecret' } });
    fireEvent.change(screen.getByPlaceholderText('confirm new entry password'), { target: { value: 'newsecret' } });
    fireEvent.click(screen.getByRole('button', { name: /reset entry password/i }));
    await waitFor(() => expect(vi.mocked(resetOrgEntryPassword)).toHaveBeenCalledWith('o1', 'newsecret'));
  });
});
