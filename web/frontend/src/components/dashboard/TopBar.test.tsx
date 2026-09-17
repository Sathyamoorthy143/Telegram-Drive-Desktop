// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from './TopBar';
import { ThemeProvider } from '../../context/ThemeContext';
import { LockProvider } from '../../context/LockContext';
import type { ViewSettings } from '../../types';

const viewSettings: ViewSettings = {
  viewMode: 'list',
  groupBy: 'none',
  showPreviewPane: false,
  sortField: 'name',
  sortDirection: 'asc',
};

const baseProps = {
  selectedIds: [],
  onShowMoveModal: vi.fn(),
  onBulkDownload: vi.fn(),
  onBulkDelete: vi.fn(),
  onManualUpload: vi.fn(),
  onFolderUpload: vi.fn(),
  onCreateFolder: vi.fn(),
  onPaste: vi.fn(),
  onCut: vi.fn(),
  onCopy: vi.fn(),
  canPaste: false,
  viewSettings,
  onUpdateViewSettings: vi.fn(),
  searchTerm: '',
  onSearchChange: vi.fn(),
};

function renderBar(extra: object = {}) {
  return render(
    <ThemeProvider>
      <LockProvider>
        <TopBar {...baseProps} {...extra} />
      </LockProvider>
    </ThemeProvider>,
  );
}

describe('TopBar alerts bell', () => {
  it('shows the bell without a badge when count is zero', () => {
    renderBar({ alertCount: 0, onOpenAlerts: vi.fn() });
    expect(screen.getByTitle('Org alerts')).toBeTruthy();
    expect(screen.queryByText('3')).toBeNull();
  });

  it('shows the count badge when alerts are pending', () => {
    renderBar({ alertCount: 3, onOpenAlerts: vi.fn() });
    expect(screen.getByTitle('3 new alerts')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('hides the bell entirely when no handler is wired', () => {
    const { container } = renderBar({ alertCount: 5 });
    expect(container.querySelector('button[title*="alert"]')).toBeNull();
  });
});
