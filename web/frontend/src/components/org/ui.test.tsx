// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Building2 } from 'lucide-react';
import { OrgShell, PageHeader, Banner, OrgCard, OrgModal, AuthCard, EmptyState, TabBar } from './ui';

describe('org ui shell', () => {
  it('OrgShell renders children in a centered column', () => {
    render(<OrgShell><span>hello-shell</span></OrgShell>);
    expect(screen.getByText('hello-shell')).toBeTruthy();
  });

  it('PageHeader back button calls onBack', () => {
    const onBack = vi.fn();
    render(<PageHeader icon={<Building2 />} title="T" onBack={onBack} />);
    fireEvent.click(screen.getByTitle('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('Banner warning renders children', () => {
    render(<Banner variant="warning">watch out</Banner>);
    expect(screen.getByText('watch out')).toBeTruthy();
  });

  it('TabBar calls onChange with the tab id', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[{ id: 'files', label: 'Files', icon: Building2 }]} active="files" onChange={onChange} />);
    fireEvent.click(screen.getByText('Files'));
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('AuthCard submits', () => {
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(<AuthCard title="Unlock" submitLabel="Submit" busy={false} error={null} onSubmit={onSubmit}><input aria-label="pw" /></AuthCard>);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
