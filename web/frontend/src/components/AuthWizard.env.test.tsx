// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthWizard } from './AuthWizard';
import { getBackendCaps, requestCode } from '../api';

vi.mock('../api', () => ({
  getBackendCaps: vi.fn(),
  requestCode: vi.fn(),
  getStore: vi.fn(async () => ({ get: async () => null, set: async () => {}, save: async () => {} })),
  signIn: vi.fn(),
  checkPassword: vi.fn(),
}));

vi.mock('./three/Scene3D', () => ({ Scene3D: () => null }));

const mockedCaps = vi.mocked(getBackendCaps);
const mockedRequestCode = vi.mocked(requestCode);

function renderWizard() {
  render(
    <ThemeProvider>
      <AuthWizard onLogin={() => {}} />
    </ThemeProvider>,
  );
}

describe('AuthWizard env creds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps all-true: hides credential inputs and sends env sentinels', async () => {
    mockedCaps.mockResolvedValue({ version: 'x', commit: 'y', tg_env: { api_id: true, api_hash: true, phone: true } });
    mockedRequestCode.mockResolvedValue('code_sent');
    renderWizard();

    // Setup step skipped straight to phone with static notice
    expect(await screen.findByText('Using the phone number configured on the server.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('12345678')).toBeNull();
    expect(screen.queryByPlaceholderText('abcdef123456...')).toBeNull();
    expect(screen.queryByPlaceholderText('+1 234 567 8900')).toBeNull();

    const sendBtn = screen.getByRole('button', { name: /continue/i });
    expect(sendBtn).toBeTruthy();
    fireEvent.click(sendBtn);

    await waitFor(() => expect(mockedRequestCode).toHaveBeenCalledWith('', 0, ''));
  });

  it('caps all-false/absent: renders all inputs (existing behavior)', async () => {
    mockedCaps.mockResolvedValue({ version: 'x', commit: 'y' });
    renderWizard();

    expect(await screen.findByPlaceholderText('12345678')).toBeTruthy();
    expect(screen.getByPlaceholderText('abcdef123456...')).toBeTruthy();
    // Fill setup and advance to phone step
    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345' } });
    fireEvent.change(screen.getByPlaceholderText('abcdef123456...'), { target: { value: 'hashvalue' } });
    fireEvent.click(screen.getByRole('button', { name: /configure/i }));

    expect(await screen.findByPlaceholderText('+1 234 567 8900')).toBeTruthy();
  });
});
