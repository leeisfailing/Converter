// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FileTranscoder from '../src/components/FileTranscoder';
import { open } from '@tauri-apps/plugin-dialog';
import { detectFile } from '../src/lib/tauri-commands';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'C:/Media/input.mov') }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('../src/lib/tauri-commands', () => ({ detectFile: vi.fn(async () => ({ ok: true, file_type: 'video' })) }));
afterEach(cleanup);

it.each([['KB', 1500], ['MB', 1_500_000], ['GB', 1_500_000_000]])('queues a decimal target in %s', async (unit, bytes) => {
  const add = vi.fn();
  render(<FileTranscoder disabled={false} onAdd={add} />);
  fireEvent.click(screen.getByText('Click or drag a file here'));
  fireEvent.click(await screen.findByRole('button', { name: /Reduce/ }));
  fireEvent.change(screen.getByLabelText('Target file size'), { target: { value: '1.5' } });
  fireEvent.change(screen.getByLabelText('Size unit'), { target: { value: unit } });
  expect((screen.getByRole('combobox', { name: 'Size unit' }) as HTMLSelectElement).value).toBe(unit);
  expect(screen.getByRole('button', { name: /Add to Queue/ }).textContent).not.toContain('\\u2014');
  fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
  expect(add).toHaveBeenCalledWith('C:/Media/input.mov', 'C:/Media/input_reduced.mp4', 50, 'video', bytes, 'reduce');
});

it.each([
  ['/home/lee/Media.v2/voice.wav', 'audio', '/home/lee/Media.v2/voice_reduced.mp3'],
  ['/home/lee/Media.v2/photo.PNG', 'photo', '/home/lee/Media.v2/photo_reduced.webp'],
  ['/home/lee/Media.v2/clip', 'video', '/home/lee/Media.v2/clip_reduced.mp4'],
])('queues backend-compatible reduction output for %s', async (input, type, output) => {
  vi.mocked(open).mockResolvedValueOnce(input);
  vi.mocked(detectFile).mockResolvedValueOnce({ ok: true, file_type: type } as Awaited<ReturnType<typeof detectFile>>);
  const add = vi.fn();
  render(<FileTranscoder disabled={false} onAdd={add} />);
  fireEvent.click(screen.getByText('Click or drag a file here'));
  fireEvent.click(await screen.findByRole('button', { name: /Reduce/ }));
  fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
  expect(add).toHaveBeenCalledWith(input, output, 50, type, 10_000_000, 'reduce');
});

it('blocks empty, zero and excessive targets but keeps quality mode available', async () => {
  render(<FileTranscoder disabled={false} onAdd={vi.fn()} />);
  fireEvent.click(screen.getByText('Click or drag a file here'));
  fireEvent.click(await screen.findByRole('button', { name: /Reduce/ }));
  for (const value of ['', '0', '-1', '10001']) {
    fireEvent.change(screen.getByLabelText('Target file size'), { target: { value } });
    expect((screen.getByRole('button', { name: /Add to Queue/ }) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.click(screen.getByRole('button', { name: /Compress/ }));
  expect((screen.getByRole('button', { name: /Add to Queue/ }) as HTMLButtonElement).disabled).toBe(false);
});
