// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Settings from '../src/components/Settings';
import { detectGpu, detectGpusNative, getSettings, saveSettings } from '../src/lib/tauri-commands';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../src/lib/tauri-commands', () => ({
  getSettings: vi.fn(), detectGpu: vi.fn(), detectGpusNative: vi.fn(), saveSettings: vi.fn(), resetSettings: vi.fn(),
  getDefaultDownloadDir: vi.fn(), getDefaultOutputDir: vi.fn(),
}));
const initial = { downloadDir: 'C:/Downloads', outputDir: 'C:/Output', useGpu: true, preferredEncoder: '', autoDetectGpu: true, selectedGpu: '' };
beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(initial);
  vi.mocked(detectGpu).mockResolvedValue({ ok: true, available: true, encoder: 'h264_nvenc', vendor: 'NVIDIA', name: 'Test GPU', hwaccel: 'cuda', message: '', allEncoders: [{ id: 'h264_nvenc', vendor: 'NVIDIA', label: 'NVIDIA H.264' }, { id: 'libx264', vendor: 'CPU', label: 'CPU' }] });
  vi.mocked(detectGpusNative).mockResolvedValue([]);
  vi.mocked(saveSettings).mockImplementation(async (settings) => settings);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const selectGpu = () => screen.findByRole('combobox', { name: 'GPU for video tasks' }) as Promise<HTMLSelectElement>;

it('selects and saves a manual GPU with hardware encoding enabled', async () => {
  const changed = vi.fn();
  render(<Settings disabled={false} onSettingsChanged={changed} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  await waitFor(() => expect(select.disabled).toBe(false));
  expect(select.value).toBe('auto');
  fireEvent.change(select, { target: { value: 'h264_nvenc' } });
  const manual = { ...initial, autoDetectGpu: false, selectedGpu: 'h264_nvenc' };
  expect(changed).toHaveBeenLastCalledWith(manual);
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(manual));
});

it('clears the manual override when switching back to automatic', async () => {
  vi.mocked(getSettings).mockResolvedValue({ ...initial, autoDetectGpu: false, selectedGpu: 'h264_nvenc' });
  const changed = vi.fn();
  render(<Settings disabled={false} onSettingsChanged={changed} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  expect(select.value).toBe('h264_nvenc');
  fireEvent.change(select, { target: { value: 'auto' } });
  expect(changed).toHaveBeenLastCalledWith(initial);
});

it('locks all edits while saving', async () => {
  let resolve!: (settings: typeof initial) => void;
  vi.mocked(saveSettings).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  expect(select.disabled).toBe(true);
  for (const field of screen.getAllByRole('textbox')) expect((field as HTMLInputElement).disabled).toBe(true);
  resolve(initial);
  await waitFor(() => expect(select.disabled).toBe(false));
});

it('allows explicit CPU selection if detection fails', async () => {
  vi.mocked(detectGpu).mockRejectedValue(new Error('No GPU'));
  const changed = vi.fn();
  render(<Settings disabled={false} onSettingsChanged={changed} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value: 'cpu' } });
  expect(changed).toHaveBeenLastCalledWith({ ...initial, useGpu: false, autoDetectGpu: false });
  expect(screen.getByText('GPU detection failed')).toBeTruthy();
});

it('shows a saved unavailable encoder without silently selecting another', async () => {
  vi.mocked(getSettings).mockResolvedValue({ ...initial, autoDetectGpu: false, selectedGpu: 'h264_amf' });
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  expect(select.value).toBe('h264_amf');
  expect(screen.getByRole('option', { name: 'h264_amf (unavailable)' })).toBeTruthy();
});

it('offers and saves parallel mode only with two working GPU vendors', async () => {
  vi.mocked(detectGpu).mockResolvedValue({ ok: true, available: true, encoder: 'h264_nvenc', vendor: 'NVIDIA', name: 'Test GPU', hwaccel: 'cuda', message: '', allEncoders: [
    { id: 'h264_nvenc', vendor: 'NVIDIA', label: 'NVIDIA' }, { id: 'h264_amf', vendor: 'AMD', label: 'AMD' }
  ] });
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const select = await selectGpu();
  await waitFor(() => expect(select.disabled).toBe(false));
  expect((screen.getByRole('option', { name: 'Both GPUs (parallel tasks)' }) as HTMLOptionElement).disabled).toBe(false);
  fireEvent.change(select, { target: { value: 'parallel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ ...initial, autoDetectGpu: false, selectedGpu: 'parallel' }));
});

it('disables parallel mode when only one GPU is detected', async () => {
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  await selectGpu();
  expect((screen.getByRole('option', { name: 'Both GPUs (parallel tasks)' }) as HTMLOptionElement).disabled).toBe(true);
});
