import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sanitizePath, sanitizeUrl, startDownload, startConvert, startReduce, saveSettings } from "../src/lib/tauri-commands";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("download path validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    String.raw`C:\Users\Lee\Documents\Converter by Lee\Downloads`,
    String.raw`\\server\share\Downloads`,
    "C:/Users/Lee/Documents/Converter by Lee/Downloads",
  ])("passes the destination unchanged to the download command: %s", async (outputDir) => {
    await startDownload({
      url: "https://www.youtube.com/watch?v=9tGvNx4tXKo",
      format_type: "bestvideo+bestaudio/best",
      output_dir: outputDir,
    });
    expect(invoke).toHaveBeenCalledWith("start_download", {
      url: "https://www.youtube.com/watch?v=9tGvNx4tXKo",
      formatType: "bestvideo+bestaudio/best",
      outputDir,
      writeSubtitles: false,
      writeThumbnail: false,
      useBrowserCookies: false,
    });
  });

  it.each([
    "",
    "   ",
    "C:\\Downloads\u0000",
    String.raw`C:\Downloads\..\private`,
    "C:/Downloads/../private",
    String.raw`C:\Downloads\bad|name`,
  ])("still rejects invalid paths: %s", (path) => {
    expect(() => sanitizePath(path)).toThrow("Invalid path:");
  });
});

describe("shared social links", () => {
  it.each([
    'https://www.tiktok.com/@example/video/123?_r=1&_t=abc',
    'https://www.instagram.com/reel/EXAMPLE/?igsh=abc&utm_source=share',
    'https://x.com/example/status/123?s=20&t=abc',
    'https://www.youtube.com/watch?v=9tGvNx4tXKo&t=10',
  ])('preserves query parameters: %s', (url) => {
    expect(sanitizeUrl(url)).toBe(url);
  });
});

it('passes the manual encoder through settings and media commands', async () => {
  vi.mocked(invoke).mockResolvedValue({});
  const preferredEncoder = 'hevc_nvenc';
  await saveSettings({ downloadDir: 'C:/Downloads', outputDir: 'C:/Output', useGpu: false, preferredEncoder });
  expect(invoke).toHaveBeenLastCalledWith('save_settings', { downloadDir: 'C:/Downloads', outputDir: 'C:/Output', useGpu: false, preferredEncoder });
  await startConvert({ input: 'C:/input.mp4', output: 'C:/output.mp4', format: 'mp4', dev_mode: false, use_gpu: false, preferred_encoder: preferredEncoder });
  expect(invoke).toHaveBeenLastCalledWith('start_convert', expect.objectContaining({ useGpu: false, preferredEncoder }));
  await startReduce({ input: 'C:/input.mp4', output: 'C:/output.mp4', quality: 50, file_type: 'video', max_width: null, target_bytes: null, use_gpu: false, preferred_encoder: preferredEncoder });
  expect(invoke).toHaveBeenLastCalledWith('start_reduce', expect.objectContaining({ useGpu: false, preferredEncoder }));
});
