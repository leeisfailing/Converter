import { invoke } from "@tauri-apps/api/core";

// Backslashes are Windows path separators, including in the default download folder.
const DANGEROUS_PATH_CHARS = /[<>"'`;|&$(){}]/;
// Ampersands separate query parameters in shared video links.
const DANGEROUS_URL_CHARS = /[<>"';|$\\]/;
const NULL_BYTE = /\x00/;
const CONTROL_CHARS = /[\x01-\x1f]/;

export function sanitizePath(p: string): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("Invalid path: empty");
  if (NULL_BYTE.test(p)) throw new Error("Invalid path: contains null byte");
  if (DANGEROUS_PATH_CHARS.test(p)) throw new Error("Invalid path: contains illegal characters");
  if (p.includes("..")) throw new Error("Invalid path: path traversal detected");
  return p.replace(/[\r\n]/g, "");
}

export function sanitizeUrl(url: string): string {
  if (typeof url !== "string" || !url.trim()) throw new Error("Invalid URL: empty");
  if (NULL_BYTE.test(url)) throw new Error("Invalid URL: contains null byte");
  if (DANGEROUS_URL_CHARS.test(url)) throw new Error("Invalid URL: contains illegal characters");
  const trimmed = url.replace(/[\r\n]/g, "").trim();
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid URL: only http and https protocols allowed");
    }
    return parsed.href;
  } catch (e) {
    if (e instanceof Error && e.message.includes("protocol")) throw e;
    throw new Error("Invalid URL: malformed");
  }
}

export function sanitizeString(s: string, maxLength: number = 256): string {
  if (typeof s !== "string") throw new Error("Invalid input: expected string");
  if (NULL_BYTE.test(s)) throw new Error("Invalid input: contains null byte");
  if (CONTROL_CHARS.test(s)) throw new Error("Invalid input: contains control characters");
  return s.substring(0, maxLength).replace(/[\r\n]/g, "");
}

export function sanitizeFormat(fmt: string): string {
  const ALLOWED = [
    "mp4", "mkv", "webm", "avi", "mov", "flv", "ogg", "opus",
    "mp3", "wav", "flac", "aac", "m4a", "jpg", "jpeg", "png",
    "webp", "bmp", "tiff", "tif", "gif", "avif", "heic", "heif",
    "bestvideo+bestaudio/best", "best", "worst",
    "mp4_1080", "mp4_720", "mp4_480", "mp4_360",
    "mp3_320", "mp3_256", "mp3_192", "mp3_128", "mp3_64",
    "original",
  ];
  const cleaned = sanitizeString(fmt, 64);
  if (!ALLOWED.includes(cleaned.toLowerCase())) throw new Error(`Invalid format: ${cleaned}`);
  return cleaned;
}

export interface DetectFileResponse {
  ok: boolean;
  file_type: string;
  allowed_formats: string[];
}

export interface UrlFormatQuality {
  label: string;
  value: string;
}

export interface UrlFormat {
  label: string;
  value: string;
  desc: string;
  qualities?: UrlFormatQuality[];
}

export interface DetectUrlResponse {
  ok: boolean;
  title: string;
  duration: string;
  thumbnail: string;
  webpage_url: string;
  is_live: boolean;
  formats: UrlFormat[];
  format_type: string;
}

export interface FinishedEvent {
  ok: boolean;
  message: string;
  file_path: string;
}

export async function detectFile(path: string, devMode: boolean): Promise<DetectFileResponse> {
  const safePath = sanitizePath(path);
  console.log(`[cmd] detectFile("${safePath.split(/[\\/]/).pop()}", devMode=${devMode})`);
  try {
    const res = await invoke<DetectFileResponse>("detect_file", { path: safePath, devMode });
    console.log(`[cmd] detectFile => ok=${res.ok}, type=${res.file_type}, formats=[${res.allowed_formats.join(", ")}]`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectFile failed:`, err);
    throw err;
  }
}

export async function detectUrl(url: string): Promise<DetectUrlResponse> {
  const safeUrl = sanitizeUrl(url);
  console.log(`[cmd] detectUrl("${safeUrl.substring(0, 60)}")`);
  try {
    const res = await invoke<DetectUrlResponse>("detect_url", { url: safeUrl });
    console.log(`[cmd] detectUrl => ok=${res.ok}, title="${res.title}"`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectUrl failed:`, err);
    throw err;
  }
}

export async function startConvert(params: {
  input: string;
  output: string;
  format: string;
  dev_mode: boolean;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const safeFormat = sanitizeFormat(params.format);
  console.log(`[cmd] startConvert("${safeInput.split(/[\\/]/).pop()}" => ${safeFormat.toUpperCase()}, devMode=${params.dev_mode})`);
  try {
    await invoke("start_convert", {
      input: safeInput,
      output: safeOutput,
      format: safeFormat,
      devMode: params.dev_mode,
    });
    console.log(`[cmd] startConvert => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startConvert failed:`, err);
    throw err;
  }
}

export async function startDownload(params: {
  url: string;
  format_type: string;
  output_dir: string;
}): Promise<void> {
  const safeUrl = sanitizeUrl(params.url);
  const safeFormat = sanitizeFormat(params.format_type);
  const safeDir = sanitizePath(params.output_dir);
  console.log(`[cmd] startDownload("${safeUrl.substring(0, 50)}", format=${safeFormat})`);
  try {
    await invoke("start_download", {
      url: safeUrl,
      formatType: safeFormat,
      outputDir: safeDir,
    });
    console.log(`[cmd] startDownload => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startDownload failed:`, err);
    throw err;
  }
}

export async function startReduce(params: {
  input: string;
  output: string;
  quality: number;
  target_bytes?: number | null;
  max_width: number | null;
  file_type: "video" | "photo" | "audio";
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const quality = Math.max(1, Math.min(100, Math.round(params.quality)));
  const targetBytes = params.target_bytes ?? null;
  if (targetBytes !== null && (!Number.isSafeInteger(targetBytes) || targetBytes < 1 || targetBytes > 10_000_000_000)) {
    throw new Error("Target size must be greater than zero and at most 10 GB");
  }
  console.log(`[cmd] startReduce("${safeInput.split(/[\\/]/).pop()}", quality=${quality}, type=${params.file_type})`);
  try {
    await invoke("start_reduce", {
      input: safeInput,
      output: safeOutput,
      quality,
      targetBytes,
      maxWidth: params.max_width,
      fileType: params.file_type,
    });
    console.log(`[cmd] startReduce => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startReduce failed:`, err);
    throw err;
  }
}

export async function cancelOperation(): Promise<void> {
  console.log(`[cmd] cancelOperation()`);
  try {
    await invoke("cancel_operation");
    console.log(`[cmd] cancelOperation => done`);
  } catch (err) {
    console.error(`[cmd] cancelOperation failed:`, err);
    throw err;
  }
}

// ===== APP SETTINGS =====

export interface AppSettings {
  downloadDir: string;
  outputDir: string;
}

export async function getSettings(): Promise<AppSettings> {
  console.log(`[cmd] getSettings()`);
  try {
    const res = await invoke<AppSettings>("get_settings");
    console.log(`[cmd] getSettings => downloadDir="${res.downloadDir}", outputDir="${res.outputDir}"`);
    return res;
  } catch (err) {
    console.error(`[cmd] getSettings failed:`, err);
    throw err;
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const safeDownloadDir = settings.downloadDir ? sanitizePath(settings.downloadDir) : settings.downloadDir;
  const safeOutputDir = settings.outputDir ? sanitizePath(settings.outputDir) : settings.outputDir;
  console.log(`[cmd] saveSettings()`);
  try {
    const res = await invoke<AppSettings>("save_settings", {
      downloadDir: safeDownloadDir,
      outputDir: safeOutputDir,
    });
    console.log(`[cmd] saveSettings => ok`);
    return res;
  } catch (err) {
    console.error(`[cmd] saveSettings failed:`, err);
    throw err;
  }
}

export async function resetSettings(): Promise<AppSettings> {
  console.log(`[cmd] resetSettings()`);
  try {
    const res = await invoke<AppSettings>("reset_settings");
    console.log(`[cmd] resetSettings => ok`);
    return res;
  } catch (err) {
    console.error(`[cmd] resetSettings failed:`, err);
    throw err;
  }
}

export async function getDefaultDownloadDir(): Promise<string> {
  try {
    return await invoke<string>("get_default_download_dir");
  } catch (err) {
    console.error(`[cmd] getDefaultDownloadDir failed:`, err);
    throw err;
  }
}

export async function getDefaultOutputDir(): Promise<string> {
  try {
    return await invoke<string>("get_default_output_dir");
  } catch (err) {
    console.error(`[cmd] getDefaultOutputDir failed:`, err);
    throw err;
  }
}
