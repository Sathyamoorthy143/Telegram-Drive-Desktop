// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

const baseProps = {
  folders: [], activeFolderId: null, userInfo: null,
  setActiveFolderId: vi.fn(), onDrop: vi.fn(), onDelete: vi.fn(),
  onRename: vi.fn(), onCut: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(),
  canPaste: false, onProperties: vi.fn(), onCreate: vi.fn(async () => {}),
  onSettings: vi.fn(), isSyncing: false, isConnected: true,
  onSync: vi.fn(), onRefresh: vi.fn(), onLogout: vi.fn(),
  bandwidth: null, onActivityLog: vi.fn(), onAllVersions: vi.fn(),
};

describe('Sidebar org mode', () => {
  it('shows org header and admin entries, selecting one calls back', () => {
    const onSelect = vi.fn();
    render(<Sidebar {...baseProps}
      orgHeader={{ name: 'Acme', detail: 'acme · alice (admin)' }}
      adminViews={[{ id: 'members', label: 'Members' }, { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' }]}
      activeAdminView={null}
      onSelectAdminView={onSelect} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    fireEvent.click(screen.getByText('Members'));
    expect(onSelect).toHaveBeenCalledWith('members');
  });

  it('renders no admin entries without adminViews', () => {
    render(<Sidebar {...baseProps} orgHeader={{ name: 'Acme', detail: 'acme' }} />);
    expect(screen.queryByText('Members')).toBeNull();
  });
});
