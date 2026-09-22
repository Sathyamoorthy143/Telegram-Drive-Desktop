// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileCard } from './FileCard';

vi.mock('../../api', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    getOrgContext: () => 'o1',
    // Mocked at this boundary because the real helper calls the module-local
    // fetchOrgThumbnail directly (module-namespace mocks can't intercept
    // intra-module calls); fetchOrgThumbnail itself is covered by its own tests.
    getOrgThumbnailUrl: vi.fn(async () => 'blob:orgthumb'),
  };
});
import * as api from '../../api';

const FILE: any = { id: 5, name: 'a.jpg', size: 100, sizeStr: '100 B', type: 'file', folder_id: null };

describe('FileCard org thumbnails', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:orgthumb');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the org thumbnail with token auth instead of the master URL', async () => {
    render(<FileCard file={FILE} onDelete={vi.fn()} onDownload={vi.fn()} isSelected={false} activeFolderId={null} />);
    const img = await screen.findByAltText('a.jpg');
    expect(img.getAttribute('src')).toBe('blob:orgthumb');
    expect(vi.mocked(api.getOrgThumbnailUrl)).toHaveBeenCalledWith('o1', undefined, 5);
  });
});
