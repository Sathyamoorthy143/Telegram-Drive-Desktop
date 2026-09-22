// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod: any = await importOriginal();
  return { ...mod, useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: vi.fn(), prefetchQuery: vi.fn(), setQueryData: vi.fn() }) };
});

import { Dashboard } from './Dashboard';
import { LockProvider } from '../../context/LockContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ThemeProvider } from '../../context/ThemeContext';

function renderDashboard(orgMode: any) {
  return render(
    <ThemeProvider>
      <LockProvider>
        <ConfirmProvider>
          <Dashboard onLogout={vi.fn()} orgMode={orgMode} />
        </ConfirmProvider>
      </LockProvider>
    </ThemeProvider>
  );
}

describe('Dashboard org mode', () => {
  it('shows org header and admin entries for admins', () => {
    renderDashboard({ org: { id: 'o1', name: 'Acme', subdomain: 'acme' }, session: { username: 'alice', role: 'admin', member_id: 'm1' } });
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('hides admin entries for viewers', () => {
    renderDashboard({ org: { id: 'o1', name: 'Acme', subdomain: 'acme' }, session: { username: 'bob', role: 'viewer', member_id: 'm2' } });
    expect(screen.queryByText('Members')).toBeNull();
  });
});
