// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FileReducer from '../src/components/FileReducer';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'C:/Media/input.mov') }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('../src/lib/tauri-commands', () => ({ detectFile: vi.fn(async () => ({ ok: true, file_type: 'video' })) }));
afterEach(cleanup);

it.each([['KB', 1500], ['MB', 1_500_000], ['GB', 1_500_000_000]])('queues a decimal target in %s', async (unit, bytes) => {
  const add = vi.fn();
  render(<FileReducer disabled={false} onAdd={add} />);
  fireEvent.click(screen.getByText('Click or drag a file here'));
  fireEvent.click(await screen.findByRole('button', { name: 'Target size' }));
  fireEvent.change(screen.getByLabelText('Maximum file size'), { target: { value: '1.5' } });
  fireEvent.change(screen.getByLabelText('Size unit'), { target: { value: unit } });
  fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
  expect(add).toHaveBeenCalledWith('C:/Media/input.mov', 'C:/Media/input_reduced.mp4', 50, null, 'video', bytes);
});

it('blocks empty, zero and excessive targets but keeps quality mode available', async () => {
  render(<FileReducer disabled={false} onAdd={vi.fn()} />);
  fireEvent.click(screen.getByText('Click or drag a file here'));
  fireEvent.click(await screen.findByRole('button', { name: 'Target size' }));
  for (const value of ['', '0', '-1', '10001']) {
    fireEvent.change(screen.getByLabelText('Maximum file size'), { target: { value } });
    expect((screen.getByRole('button', { name: /Add to Queue/ }) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Quality', exact: true }));
  expect((screen.getByRole('button', { name: /Add to Queue/ }) as HTMLButtonElement).disabled).toBe(false);
});
