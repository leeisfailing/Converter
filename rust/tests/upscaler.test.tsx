// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Upscaler from '../src/components/Upscaler';
import { detectFile } from '../src/lib/tauri-commands';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'C:/Media/input.webm') }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('../src/lib/tauri-commands', () => ({
  detectFile: vi.fn(async () => ({ ok: true, file_type: 'video' })),
  checkUpscale: vi.fn(async () => ({ canUpscale: true, target: '4k', requiredRamGb: 4, availableRamGb: 16, message: '' })),
}));
afterEach(cleanup);

it('queues video upscales into an MP4 container compatible with GPU encoding', async () => {
  const add = vi.fn();
  render(<Upscaler disabled={false} onAdd={add} />);
  fireEvent.click(screen.getByText('Click or drag a video/image here'));
  fireEvent.click(await screen.findByRole('button', { name: /Add to Queue/ }));
  await waitFor(() => expect(add).toHaveBeenCalledWith('C:/Media/input.webm', 'C:/Media/input_4K.mp4', '4k', 'video'));
});

it('rejects audio before it reaches the upscale queue', async () => {
  vi.mocked(detectFile).mockResolvedValueOnce({ ok: true, file_type: 'audio' } as Awaited<ReturnType<typeof detectFile>>);
  render(<Upscaler disabled={false} onAdd={vi.fn()} />);
  fireEvent.click(screen.getByText('Click or drag a video/image here'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Add to Queue/ })).toBeNull();
});
