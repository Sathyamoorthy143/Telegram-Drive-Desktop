// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './ConfirmContext';

function Trigger() {
  const { confirm } = useConfirm();
  const [result, setResult] = useState('pending');
  return (
    <>
      <button
        onClick={() =>
          confirm({ title: 'Conflict', message: 'Same names', confirmText: 'Upload anyway', cancelText: 'Skip those' }).then(
            (v) => setResult(v ? 'yes' : 'no'),
          )
        }
      >
        ask
      </button>
      <span data-testid="result">{result}</span>
    </>
  );
}

function renderTrigger() {
  render(
    <ConfirmProvider>
      <Trigger />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText('ask'));
}

describe('ConfirmContext', () => {
  it('resolves true when the confirm button is clicked', async () => {
    renderTrigger();
    fireEvent.click(await screen.findByText('Upload anyway'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('yes'));
  });

  it('resolves false when the cancel button is clicked', async () => {
    renderTrigger();
    fireEvent.click(await screen.findByText('Skip those'));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('no'));
  });
});
