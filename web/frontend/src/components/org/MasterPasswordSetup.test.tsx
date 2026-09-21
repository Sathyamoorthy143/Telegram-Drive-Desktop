// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasterPasswordSetup } from './MasterPasswordSetup';

const setMasterPassword = vi.fn<(password: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));

vi.mock('../../api', () => ({
  setMasterPassword: (password: string) => setMasterPassword(password),
}));

describe('MasterPasswordSetup', () => {
  beforeEach(() => {
    setMasterPassword.mockClear();
    setMasterPassword.mockResolvedValue({ ok: true });
  });

  it('submits matching passwords then calls onReady', async () => {
    const onReady = vi.fn();
    render(<MasterPasswordSetup onReady={onReady} />);
    const inputs = screen.getAllByDisplayValue('');
    fireEvent.change(inputs[0], { target: { value: 'secret' } });
    fireEvent.change(inputs[1], { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(setMasterPassword).toHaveBeenCalledWith('secret'));
    expect(onReady).toHaveBeenCalled();
  });

  it('does not call API when passwords mismatch', async () => {
    const onReady = vi.fn();
    render(<MasterPasswordSetup onReady={onReady} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'secret' } });
    fireEvent.change(inputs[1], { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeTruthy());
    expect(setMasterPassword).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not call API when password is shorter than 4', async () => {
    const onReady = vi.fn();
    render(<MasterPasswordSetup onReady={onReady} />);
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'abc' } });
    fireEvent.change(inputs[1], { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/at least 4/i)).toBeTruthy());
    expect(setMasterPassword).not.toHaveBeenCalled();
  });
});
