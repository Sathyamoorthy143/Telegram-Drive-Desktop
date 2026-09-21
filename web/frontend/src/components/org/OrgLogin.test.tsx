// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrgLogin } from './OrgLogin';

const orgLogin = vi.fn<(id: string, u: string, p: string) => Promise<{ org_id: string; token: string; username: string; role: string; member_id: string }>>();

vi.mock('../../api', () => ({
  orgLogin: (id: string, u: string, p: string) => orgLogin(id, u, p),
  setOrgToken: vi.fn(),
  setOrgId: vi.fn(),
}));

describe('OrgLogin', () => {
  it('renders org name and sign-in form', () => {
    render(<OrgLogin orgId="o1" orgName="Acme" onLogin={() => {}} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('shows friendly error on bad credentials', async () => {
    orgLogin.mockRejectedValue(new Error('Invalid username or password'));
    render(<OrgLogin orgId="o1" orgName="Acme" onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. alice'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/wrong username or password/i)).toBeTruthy());
  });
});
