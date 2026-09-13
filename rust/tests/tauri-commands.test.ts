import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { sanitizePath, sanitizeUrl, startDownload } from "../src/lib/tauri-commands";

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
