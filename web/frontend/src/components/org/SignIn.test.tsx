// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';

const resolveOrg = vi.fn<(name: string) => Promise<{ org_id: string; display_name: string }>>();
const unlockMaster = vi.fn<(password: string) => Promise<{ ok: boolean }>>();
const unlockOrganization = vi.fn<(id: string, password: string) => Promise<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>>();

vi.mock('../../api', () => ({
  resolveOrg: (name: string) => resolveOrg(name),
  unlockMaster: (password: string) => unlockMaster(password),
  unlockOrganization: (id: string, password: string) => unlockOrganization(id, password),
}));

describe('SignIn', () => {
  beforeEach(() => {
    resolveOrg.mockReset();
    unlockMaster.mockReset();
    unlockOrganization.mockReset();
    resolveOrg.mockResolvedValue({ org_id: 'o1', display_name: 'Acme' });
    unlockMaster.mockResolvedValue({ ok: true });
    unlockOrganization.mockResolvedValue({ ok: true, org: { id: 'o1', name: 'Acme', subdomain: 'acme' } });
  });

  it('renders one name field, one password field, no org list', () => {
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    expect(screen.getByPlaceholderText(/organisation name/i)).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeTruthy();
    expect(screen.queryByText('Master Admin')).toBeNull();
  });

  it('routes the reserved word to master unlock', async () => {
    const onUnlockMaster = vi.fn();
    render(<SignIn onUnlockMaster={onUnlockMaster} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'master' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(unlockMaster).toHaveBeenCalledWith('secret'));
    expect(resolveOrg).not.toHaveBeenCalled();
    expect(onUnlockMaster).toHaveBeenCalled();
  });

  it('resolves an org name then unlocks it', async () => {
    const onUnlockOrg = vi.fn();
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={onUnlockOrg} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(resolveOrg).toHaveBeenCalledWith('Acme'));
    await waitFor(() => expect(unlockOrganization).toHaveBeenCalledWith('o1', 'secret'));
    expect(onUnlockOrg).toHaveBeenCalledWith({ id: 'o1', name: 'Acme', subdomain: 'acme' });
  });

  it('shows the generic error for unknown names and wrong passwords', async () => {
    resolveOrg.mockRejectedValue({ status: 404, message: 'Not found' });
    const { unmount } = render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'nope' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Invalid name or password.')).toBeTruthy());
    unmount();

    resolveOrg.mockResolvedValue({ org_id: 'o1', display_name: 'Acme' });
    unlockOrganization.mockRejectedValue({ status: 401, message: 'Wrong password' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Invalid name or password.')).toBeTruthy());
  });

  it('shows the throttle message on 429', async () => {
    unlockMaster.mockRejectedValue({ status: 429, message: 'Too many attempts' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'MASTER' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy());
  });

  it('surfaces operational 409s verbatim instead of the generic error', async () => {
    unlockOrganization.mockRejectedValue({ status: 409, message: 'Set an entry password in Organizations first' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Set an entry password in Organizations first')).toBeTruthy());
    expect(screen.queryByText('Invalid name or password.')).toBeNull();
  });

  it('names a deactivated org instead of blaming the password', async () => {
    unlockOrganization.mockRejectedValue({ status: 403, message: 'Organization is inactive' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/this organization is inactive/i)).toBeTruthy());
    expect(screen.queryByText('Invalid name or password.')).toBeNull();
  });
});
