// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import URLDownloader from '../src/components/URLDownloader';
import { detectUrl, sanitizeFormat, startDownload } from '../src/lib/tauri-commands';
import { isTikTokUrl } from '../src/lib/tiktok';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/lib/tauri-commands', async (original) => ({
  ...await original<typeof import('../src/lib/tauri-commands')>(), detectUrl: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const info = { ok: true, title: 'Example', duration: '0:20', thumbnail: '',
  webpage_url: 'https://www.tiktok.com/@example/video/123', is_live: false, format_type: 'video',
  formats: [{ label: 'Download', value: 'tiktok', desc: '', qualities: [] }] };

it.each([['Download', 'tiktok'], ['No Watermark Download', 'tiktok_no_watermark']])(
  'auto-detects short links and queues %s', async (label, mode) => {
    vi.mocked(detectUrl).mockResolvedValue(info);
    const add = vi.fn();
    render(<URLDownloader disabled={false} onAdd={add} />);
    fireEvent.change(screen.getByLabelText('Video or file URL'), { target: { value: 'https://vm.tiktok.com/short/' } });
    const button = await screen.findByRole('button', { name: label, exact: true });
    expect(screen.queryByText('Pick format')).toBeNull();
    expect(screen.queryByText('Options')).toBeNull();
    fireEvent.click(button);
    expect(add).toHaveBeenCalledWith(info.webpage_url, mode, expect.any(Object));
    expect(sanitizeFormat(mode)).toBe(mode);
    await startDownload({ id: 'test', url: info.webpage_url, format_type: mode, output_dir: 'C:/Downloads' });
    expect(invoke).toHaveBeenCalledWith('start_download', expect.objectContaining({ formatType: mode }));
    await waitFor(() => expect((screen.getByLabelText('Video or file URL') as HTMLInputElement).value).toBe(''));
  });

it('keeps generic format controls for other sites', async () => {
  vi.mocked(detectUrl).mockResolvedValue({ ...info, webpage_url: 'https://example.com/video',
    formats: [{ label: 'MP4', value: 'mp4', desc: 'Video' }] });
  render(<URLDownloader disabled={false} onAdd={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Video or file URL'), { target: { value: 'https://example.com/video' } });
  fireEvent.click(screen.getByRole('button', { name: /Search/ }));
  expect(await screen.findByText('Pick format')).toBeTruthy();
  expect(screen.queryByText('No Watermark Download')).toBeNull();
});

it('rejects lookalike domains', () => {
  expect(isTikTokUrl('https://vt.tiktok.com/short')).toBe(true);
  expect(isTikTokUrl('https://tiktok.com.evil.test')).toBe(false);
  expect(isTikTokUrl('https://tiktok.com@evil.test')).toBe(false);
});

it('automatically detects a pasted Markdown TikTok link using its destination', async () => {
  const url = 'https://www.tiktok.com/@ee.black9/video/7685223520632147220?_r=1&_t=abc';
  vi.mocked(detectUrl).mockResolvedValue({ ...info, webpage_url: url });
  render(<URLDownloader disabled={false} onAdd={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Video or file URL'), { target: { value: `[TikTok](${url})?` } });
  await screen.findByRole('button', { name: 'No Watermark Download' });
  expect(detectUrl).toHaveBeenCalledWith(url);
  expect((screen.getByLabelText('Video or file URL') as HTMLInputElement).value).toBe(url);
});

it('prevents duplicate queueing and keeps the video when queueing fails', async () => {
  vi.mocked(detectUrl).mockResolvedValue(info);
  let reject!: (error: Error) => void;
  const add = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  render(<URLDownloader disabled={false} onAdd={add} />);
  fireEvent.change(screen.getByLabelText('Video or file URL'), { target: { value: info.webpage_url } });
  const download = await screen.findByRole('button', { name: 'No Watermark Download' });
  fireEvent.click(download);
  fireEvent.click(download);
  expect(add).toHaveBeenCalledTimes(1);
  expect((download as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('Queue unavailable')));
  expect(screen.getByRole('alert').textContent).toContain('Queue unavailable');
  expect((screen.getByLabelText('Video or file URL') as HTMLInputElement).value).toBe(info.webpage_url);
  expect((download as HTMLButtonElement).disabled).toBe(false);
});

it('disables unavailable versions and shows the available file size', async () => {
  vi.mocked(detectUrl).mockResolvedValue({ ...info, formats: [
    { label: 'Download', value: 'tiktok', desc: '', available: false },
    { label: 'No Watermark Download', value: 'tiktok_no_watermark', desc: '', available: true, filesize: 2500000 },
  ] });
  render(<URLDownloader disabled={false} onAdd={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Video or file URL'), { target: { value: info.webpage_url } });
  expect((await screen.findByRole('button', { name: 'Download', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('~2.5 MB')).toBeTruthy();
});
