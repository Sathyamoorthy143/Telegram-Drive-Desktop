// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrgPicker } from './OrgPicker';

const orgs = [
  { id: 'o1', name: 'Acme', subdomain: 'acme', active: true, has_entry_password: true },
  { id: 'o2', name: 'Idle', subdomain: 'idle', active: false, has_entry_password: true },
];

const getMyOrgs = vi.fn<() => Promise<{ orgs: typeof orgs }>>();
const unlockMaster = vi.fn<(password: string) => Promise<{ ok: boolean }>>();
const unlockOrganization = vi.fn<(id: string, password: string) => Promise<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>>();

vi.mock('../../api', () => ({
  getMyOrgs: () => getMyOrgs(),
  unlockMaster: (password: string) => unlockMaster(password),
  unlockOrganization: (id: string, password: string) => unlockOrganization(id, password),
}));

describe('OrgPicker', () => {
  beforeEach(() => {
    getMyOrgs.mockReset();
    unlockMaster.mockReset();
    unlockOrganization.mockReset();
    getMyOrgs.mockResolvedValue({ orgs });
    unlockMaster.mockResolvedValue({ ok: true });
    unlockOrganization.mockResolvedValue({ ok: true, org: { id: 'o1', name: 'Acme', subdomain: 'acme' } });
  });

  it('renders Master Admin plus returned orgs', async () => {
    render(<OrgPicker onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    expect(screen.getByText('Master Admin')).toBeTruthy();
    expect(screen.getByText('Personal drive')).toBeTruthy();
    expect(screen.getByText('Idle')).toBeTruthy();
  });

  it('opens master password modal and unlocks on success', async () => {
    const onUnlockMaster = vi.fn();
    render(<OrgPicker onUnlockMaster={onUnlockMaster} onUnlockOrg={() => {}} />);
    await waitFor(() => expect(screen.getByText('Master Admin')).toBeTruthy());
    fireEvent.click(screen.getByText('Master Admin'));
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(unlockMaster).toHaveBeenCalledWith('secret'));
    expect(onUnlockMaster).toHaveBeenCalled();
  });

  it('stays on picker with error when master unlock fails', async () => {
    unlockMaster.mockRejectedValue({ status: 401, message: 'Wrong password' });
    const onUnlockMaster = vi.fn();
    render(<OrgPicker onUnlockMaster={onUnlockMaster} onUnlockOrg={() => {}} />);
    await waitFor(() => expect(screen.getByText('Master Admin')).toBeTruthy());
    fireEvent.click(screen.getByText('Master Admin'));
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeTruthy());
    expect(onUnlockMaster).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a workspace')).toBeTruthy();
  });

  it('unlocks an org on success', async () => {
    const onUnlockOrg = vi.fn();
    render(<OrgPicker onUnlockMaster={() => {}} onUnlockOrg={onUnlockOrg} />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    fireEvent.click(screen.getByText('Acme'));
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'orgpw' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(unlockOrganization).toHaveBeenCalledWith('o1', 'orgpw'));
    expect(onUnlockOrg).toHaveBeenCalled();
  });

  it('disables inactive org cards', async () => {
    render(<OrgPicker onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    await waitFor(() => expect(screen.getByText('Idle')).toBeTruthy());
    const idle = screen.getByText('Idle').closest('button') as HTMLButtonElement;
    expect(idle.disabled).toBe(true);
  });
});
