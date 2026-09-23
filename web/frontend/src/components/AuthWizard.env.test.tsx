// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { AuthWizard } from './AuthWizard';
import { getBackendCaps, requestCode, withTimeout } from '../api';

vi.mock('../api', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    getBackendCaps: vi.fn(),
    requestCode: vi.fn(),
    getStore: vi.fn(async () => ({ get: async () => null, set: async () => {}, save: async () => {} })),
    signIn: vi.fn(),
    checkPassword: vi.fn(),
    // Controllable: pass-through by default; tests override per case.
    withTimeout: vi.fn((p: Promise<any>) => p),
  };
});

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
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

    // Code step carries the delivery hint (app chats first, SMS only fallback)
    expect(await screen.findByPlaceholderText('1 2 3 4 5')).toBeTruthy();
    expect(screen.getByText(/only sends an SMS when you have no active session/i)).toBeTruthy();
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

  it('hanging code request fails loud instead of spinning forever', async () => {
    mockedCaps.mockResolvedValue({ version: 'x', commit: 'y', tg_env: { api_id: true, api_hash: true, phone: true } });
    mockedRequestCode.mockImplementation(() => new Promise(() => {}));
    // Simulate the 70s withTimeout firing (duration itself is covered by
    // api.timeout.test.ts — here only the sentinel → loud error wiring).
    vi.mocked(withTimeout).mockImplementationOnce(async () => 'timeout');
    renderWizard();

    await screen.findByText('Using the phone number configured on the server.');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/took too long to send the code/i)).toBeTruthy();
  });

  it('flood errors tell the user to stop retrying', async () => {
    mockedCaps.mockResolvedValue({ version: 'x', commit: 'y', tg_env: { api_id: true, api_hash: true, phone: true } });
    // No parseable FLOOD_WAIT_<secs> suffix → error path (the suffix shows
    // the dedicated countdown screen instead).
    mockedRequestCode.mockRejectedValue(new Error('Telegram flood wait: try again later'));
    renderWizard();

    await screen.findByText('Using the phone number configured on the server.');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/each attempt extends Telegram's wait/i)).toBeTruthy());
  });
});
