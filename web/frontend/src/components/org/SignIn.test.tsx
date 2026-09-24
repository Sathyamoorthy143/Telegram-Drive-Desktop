// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';

const resolveOrg = vi.fn<(name: string) => Promise<{ org_id: string; display_name: string }>>();
const unlockMaster = vi.fn<(password: string) => Promise<{ ok: boolean }>>();
const unlockOrganization = vi.fn<(id: string, password: string) => Promise<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>>();

// Three.js / WebGL components cannot run in jsdom — mock them out so tests
// only exercise the SignIn business logic.
vi.mock('../three/Scene3D', () => ({ Scene3D: () => null }));
vi.mock('../three/CloudHero3D', () => ({ CloudHero3D: () => null }));
vi.mock('../three/TiltCard', () => ({ TiltCard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./SignInDiagnostic', () => ({ SignInDiagnostic: () => null }));

vi.mock('../../api', () => ({
  resolveOrg: (name: string) => resolveOrg(name),
  unlockMaster: (password: string) => unlockMaster(password),
  unlockOrganization: (id: string, password: string) => unlockOrganization(id, password),
  getOrgContext: () => null,
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

  it('shows the generic error for unknown names and the reason for wrong passwords', async () => {
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
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeTruthy());
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

  it('shows the subdomain hint when several orgs share the name', async () => {
    resolveOrg.mockRejectedValue({
      status: 409,
      message: 'Multiple organizations share this name — sign in with the subdomain instead (acme, acme-2)',
    });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/sign in with the subdomain instead/i)).toBeTruthy());
    expect(unlockOrganization).not.toHaveBeenCalled();
  });

  it('names wrong-password vs not-owner instead of the generic error', async () => {
    unlockOrganization.mockRejectedValue({ status: 401, message: 'Wrong password' });
    const { unmount } = render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'acme-2' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeTruthy());
    expect(screen.queryByText('Invalid name or password.')).toBeNull();
    unmount();

    unlockOrganization.mockRejectedValue({ status: 403, message: 'Not the owner of this organization' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'acme-2' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Not the owner of this organization')).toBeTruthy());
  });

  it('surfaces any non-generic error message instead of the generic error', async () => {
    unlockOrganization.mockRejectedValue({ status: 500, message: 'Connection refused' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Connection refused')).toBeTruthy());
    expect(screen.queryByText('Invalid name or password.')).toBeNull();
  });

  it('does not treat a 401 with "wrong password" as telegram lost', async () => {
    unlockOrganization.mockRejectedValue({ status: 401, message: 'Wrong password' });
    const onTelegramLost = vi.fn();
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} onTelegramLost={onTelegramLost} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'acme-2' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeTruthy());
    expect(onTelegramLost).not.toHaveBeenCalled();
  });

  it('does not treat a 403 "not owner" as telegram lost', async () => {
    unlockOrganization.mockRejectedValue({ status: 403, message: 'Not the owner of this organization' });
    const onTelegramLost = vi.fn();
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} onTelegramLost={onTelegramLost} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'acme-2' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Not the owner of this organization')).toBeTruthy());
    expect(onTelegramLost).not.toHaveBeenCalled();
  });
});
