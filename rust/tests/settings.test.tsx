// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Settings from '../src/components/Settings';
import { detectGpu, getSettings, saveSettings } from '../src/lib/tauri-commands';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../src/lib/tauri-commands', () => ({
  getSettings: vi.fn(), detectGpu: vi.fn(), saveSettings: vi.fn(), resetSettings: vi.fn(),
  getDefaultDownloadDir: vi.fn(), getDefaultOutputDir: vi.fn(),
}));
const initial = { downloadDir: 'C:/Downloads', outputDir: 'C:/Output', useGpu: true, preferredEncoder: '' };
beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(initial);
  vi.mocked(detectGpu).mockResolvedValue({ ok: true, available: true, encoder: 'h264_nvenc', vendor: 'NVIDIA', name: 'Test GPU', hwaccel: 'cuda', message: '', allEncoders: [{ id: 'h264_nvenc', vendor: 'NVIDIA', label: 'NVIDIA H.264' }, { id: 'libx264', vendor: 'CPU', label: 'CPU' }] });
  vi.mocked(saveSettings).mockImplementation(async (settings) => settings);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('loads the saved GPU preference, toggles it and saves it', async () => {
  const changed = vi.fn();
  render(<Settings disabled={false} onSettingsChanged={changed} onOpenAbout={vi.fn()} />);
  const toggle = await screen.findByRole('switch', { name: 'Automatic GPU selection' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ ...initial, useGpu: false }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ ...initial, useGpu: false }));
});

it('locks all edits while saving to avoid losing changes', async () => {
  let resolve!: (settings: typeof initial) => void;
  vi.mocked(saveSettings).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const toggle = await screen.findByRole('switch', { name: 'Automatic GPU selection' });
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  for (const field of screen.getAllByRole('textbox')) expect((field as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  resolve(initial);
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
});

it('allows CPU selection if detection fails', async () => {
  vi.mocked(detectGpu).mockRejectedValue(new Error('No GPU'));
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const toggle = await screen.findByRole('switch', { name: 'Automatic GPU selection' });
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(toggle);
  expect((screen.getByRole('combobox', { name: 'Video encoder' }) as HTMLSelectElement).value).toBe('libx264');
  expect(screen.getByText('GPU detection failed')).toBeTruthy();
});

it('saves a manual encoder and retains it when switching back to automatic', async () => {
  render(<Settings disabled={false} onSettingsChanged={vi.fn()} onOpenAbout={vi.fn()} />);
  const toggle = await screen.findByRole('switch', { name: 'Automatic GPU selection' });
  fireEvent.click(toggle);
  fireEvent.change(screen.getByRole('combobox', { name: 'Video encoder' }), { target: { value: 'libx264' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(saveSettings).toHaveBeenLastCalledWith({ ...initial, useGpu: false, preferredEncoder: 'libx264' }));
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(toggle);
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(toggle);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('libx264');
});
