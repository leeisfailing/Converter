import { invoke } from "@tauri-apps/api/core";
import { normalizePastedUrl } from "./pasted-url";

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
  const trimmed = normalizePastedUrl(url.replace(/[\r\n]/g, ""));
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
    "tiktok", "tiktok_no_watermark",
    // Video output formats
    "mp4", "mkv", "webm", "avi", "mov", "flv", "wmv", "m4v", "mpg", "mpeg",
    "3gp", "mts", "vob", "gif",
    // Audio output formats
    "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus",
    // Photo output formats
    "jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif", "avif", "heic", "heif",
    // Download-specific video quality formats
    "mp4_2160", "mp4_1440", "mp4_1080", "mp4_720", "mp4_480", "mp4_360", "mp4_240",
    "webm_2160", "webm_1440", "webm_1080", "webm_720", "webm_480", "webm_360", "webm_240",
    "mkv_2160", "mkv_1440", "mkv_1080", "mkv_720", "mkv_480", "mkv_360", "mkv_240",
    // Download-specific audio quality formats
    "mp3_320", "mp3_256", "mp3_192", "mp3_128", "mp3_64",
    "aac_320", "aac_256", "aac_192", "aac_128", "aac_64",
    "ogg_320", "ogg_256", "ogg_192", "ogg_128", "ogg_64",
    // Download fallback formats
    "bestvideo+bestaudio/best", "best", "worst", "original",
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
  available?: boolean;
  filesize?: number | null;
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
  id: string;
  input: string;
  output: string;
  format: string;
  dev_mode: boolean;
  use_gpu: boolean;
  preferred_encoder?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const safeFormat = sanitizeFormat(params.format);
  console.log(`[cmd] startConvert: id=${params.id}, input="${safeInput}", output="${safeOutput}", format=${safeFormat.toUpperCase()}, devMode=${params.dev_mode}, useGpu=${params.use_gpu}`);
  try {
    await invoke("start_convert", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      format: safeFormat,
      devMode: params.dev_mode,
      useGpu: params.use_gpu,
      preferredEncoder: params.preferred_encoder ?? "",
    });
    console.log(`[cmd] startConvert => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startConvert failed:`, err);
    throw err;
  }
}

export async function startDownload(params: {
  id: string;
  url: string;
  format_type: string;
  output_dir: string;
  write_subtitles?: boolean;
  write_thumbnail?: boolean;
  use_browser_cookies?: boolean;
}): Promise<void> {
  const safeUrl = sanitizeUrl(params.url);
  const safeFormat = sanitizeFormat(params.format_type);
  const safeDir = sanitizePath(params.output_dir);
  console.log(`[cmd] startDownload: id=${params.id}, url="${safeUrl.substring(0, 50)}", format=${safeFormat}, subs=${!!params.write_subtitles}, thumb=${!!params.write_thumbnail}, cookies=${!!params.use_browser_cookies}`);
  try {
    await invoke("start_download", {
      id: params.id,
      url: safeUrl,
      formatType: safeFormat,
      outputDir: safeDir,
      writeSubtitles: params.write_subtitles ?? false,
      writeThumbnail: params.write_thumbnail ?? false,
      useBrowserCookies: params.use_browser_cookies ?? false,
    });
    console.log(`[cmd] startDownload => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startDownload failed:`, err);
    throw err;
  }
}

export async function startTranscoder(params: {
  id: string;
  input: string;
  output: string;
  quality: number;
  target_bytes?: number | null;
  file_type: "video" | "photo" | "audio";
  use_gpu: boolean;
  preferred_encoder?: string;
  selected_gpu?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const quality = Math.max(1, Math.min(100, Math.round(params.quality)));
  const targetBytes = params.target_bytes ?? null;
  if (targetBytes !== null && (!Number.isSafeInteger(targetBytes) || targetBytes < 1 || targetBytes > 10_000_000_000)) {
    throw new Error("Target size must be greater than zero and at most 10 GB");
  }
  console.log(`[cmd] startTranscoder: id=${params.id}, "${safeInput.split(/[\\/]/).pop()}", quality=${quality}, type=${params.file_type}, useGpu=${params.use_gpu}, selectedGpu="${params.selected_gpu || ""}"`);
  try {
    await invoke("start_transcoder", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      quality,
      targetBytes,
      fileType: params.file_type,
      useGpu: params.use_gpu,
      preferredEncoder: params.preferred_encoder ?? "",
      selectedGpu: params.selected_gpu ?? "",
    });
    console.log(`[cmd] startTranscoder => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startTranscoder failed:`, err);
    throw err;
  }
}

export async function startUpscale(params: {
  id: string;
  input: string;
  output: string;
  target: string;
  file_type: "video" | "photo";
  use_gpu: boolean;
  preferred_encoder?: string;
  selected_gpu?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  if (!["2k", "4k", "8k", "16k"].includes(params.target)) {
    throw new Error("Invalid upscale target");
  }
  console.log(`[cmd] startUpscale: id=${params.id}, "${safeInput.split(/[\\/]/).pop()}", target=${params.target.toUpperCase()}, useGpu=${params.use_gpu}, selectedGpu="${params.selected_gpu || ""}"`);
  try {
    await invoke("start_upscale", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      target: params.target,
      fileType: params.file_type,
      useGpu: params.use_gpu,
      preferredEncoder: params.preferred_encoder ?? "",
      selectedGpu: params.selected_gpu ?? "",
    });
    console.log(`[cmd] startUpscale => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startUpscale failed:`, err);
    throw err;
  }
}

export async function startEnhance(params: {
  id: string;
  input: string;
  output: string;
  file_type: "video" | "photo";
  model: string;
  tile_size: number;
  use_gpu: boolean;
  selected_gpu?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const validModels = ["realesrgan-x4plus", "realesrgan-x2plus", "realesr-general-x4v3"];
  if (!validModels.includes(params.model)) {
    throw new Error("Invalid enhancement model");
  }
  if (!["video", "photo"].includes(params.file_type)) {
    throw new Error("Invalid file_type");
  }
  if (params.tile_size < 64 || params.tile_size > 512) {
    throw new Error("tile_size must be between 64 and 512");
  }
  console.log(`[cmd] startEnhance: id=${params.id}, "${safeInput.split(/[\\/]/).pop()}", model=${params.model}, type=${params.file_type}, useGpu=${params.use_gpu}, selectedGpu=${params.selected_gpu || "auto"}`);
  try {
    await invoke("start_enhance", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      fileType: params.file_type,
      model: params.model,
      tileSize: params.tile_size,
      useGpu: params.use_gpu,
      selectedGpu: params.selected_gpu || "",
    });
    console.log(`[cmd] startEnhance => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startEnhance failed:`, err);
    throw err;
  }
}

export async function cancelOperation(): Promise<void> {
  console.log(`[cmd] cancelOperation()`);
  try {
    await invoke("cancel_operation");
    await invoke("cancel_cpp_operation");
    console.log(`[cmd] cancelOperation => done`);
  } catch (err) {
    console.error(`[cmd] cancelOperation failed:`, err);
    throw err;
  }
}

export async function cancelOperationById(id: string): Promise<void> {
  console.log(`[cmd] cancelOperationById(${id})`);
  try {
    await invoke("cancel_operation_by_id", { id });
    console.log(`[cmd] cancelOperationById => done`);
  } catch (err) {
    console.error(`[cmd] cancelOperationById failed:`, err);
    throw err;
  }
}

// ===== APP SETTINGS =====

export interface AppSettings {
  downloadDir: string;
  outputDir: string;
  useGpu: boolean;
  preferredEncoder: string;
  autoDetectGpu: boolean;
  selectedGpu: string;
}

export interface GpuInfo {
  ok: boolean;
  available: boolean;
  allEncoders: { id: string; vendor: string; label: string }[];
  encoder: string | null;
  vendor: string | null;
  hwaccel: string | null;
  name: string | null;
  message: string;
}

export async function getSettings(): Promise<AppSettings> {
  console.log(`[cmd] getSettings()`);
  try {
    const res = await invoke<AppSettings>("get_settings");
    console.log(`[cmd] getSettings => downloadDir="${res.downloadDir}", outputDir="${res.outputDir}", useGpu=${res.useGpu}, autoDetectGpu=${res.autoDetectGpu}, selectedGpu="${res.selectedGpu}", preferredEncoder="${res.preferredEncoder}"`);
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
      useGpu: settings.useGpu,
      preferredEncoder: settings.preferredEncoder,
      autoDetectGpu: settings.autoDetectGpu,
      selectedGpu: settings.selectedGpu,
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

// ===== CACHE =====

export interface CacheStats {
  gpuHits: number;
  gpuMisses: number;
  gpuEntries: number;
}

export interface PersistentCacheStats {
  totalEntries: number;
  fileHits: number;
  fileMisses: number;
  encoderHits: number;
  encoderMisses: number;
}

export async function getPersistentCacheStats(): Promise<PersistentCacheStats> {
  try {
    return await invoke<PersistentCacheStats>("get_persistent_cache_stats");
  } catch {
    return { totalEntries: 0, fileHits: 0, fileMisses: 0, encoderHits: 0, encoderMisses: 0 };
  }
}

export async function clearPersistentCache(): Promise<void> {
  await invoke("clear_persistent_cache");
}

export async function getCacheStats(): Promise<CacheStats> {
  try {
    return await invoke<CacheStats>("get_cache_stats");
  } catch (err) {
    console.error(`[cmd] getCacheStats failed:`, err);
    throw err;
  }
}

export async function clearCache(): Promise<void> {
  try {
    await invoke("clear_cache");
  } catch (err) {
    console.error(`[cmd] clearCache failed:`, err);
    throw err;
  }
}

export async function detectGpu(): Promise<GpuInfo> {
  console.log(`[cmd] detectGpu()`);
  try {
    const res = await invoke<GpuInfo>("detect_gpu");
    console.log(`[cmd] detectGpu => available=${res.available}, encoder=${res.encoder}, name=${res.name}`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectGpu failed:`, err);
    throw err;
  }
}

// ===== NATIVE RUST MEDIA ENGINE =====

export interface ProbeInfo {
  width: number | null;
  height: number | null;
  duration: number | null;
  vcodec: string | null;
  acodec: string | null;
  formatName: string | null;
  bitrate: number | null;
}

export interface GpuCapability {
  encoder: string;
  vendor: string;
  hwaccel: string;
  label: string;
  works: boolean;
}

export async function probeFile(input: string): Promise<ProbeInfo> {
  const safeInput = sanitizePath(input);
  console.log(`[cmd] probeFile("${safeInput.split(/[\\/]/).pop()}")`);
  try {
    const res = await invoke<ProbeInfo>("probe_file", { input: safeInput });
    console.log(`[cmd] probeFile => ${res.width}x${res.height}, vcodec=${res.vcodec}, acodec=${res.acodec}`);
    return res;
  } catch (err) {
    console.error(`[cmd] probeFile failed:`, err);
    throw err;
  }
}

let gpuDetection: Promise<GpuCapability[]> | null = null;

export function detectGpusNative(): Promise<GpuCapability[]> {
  if (!gpuDetection) {
    gpuDetection = runGpuDetection().finally(() => { gpuDetection = null; });
  }
  return gpuDetection;
}

async function runGpuDetection(): Promise<GpuCapability[]> {
  console.log(`[cmd] detectGpusNative()`);
  try {
    const res = await invoke<GpuCapability[]>("detect_gpus_native");
    console.log(`[cmd] detectGpusNative => ${res.length} encoders found`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectGpusNative failed:`, err);
    throw err;
  }
}

// ===== CONCURRENCY =====

export interface ConcurrencySnapshot {
  download: number;
  convert: number;
  transcoder: number;
  upscale: number;
  activeDownload: number;
  activeConvert: number;
  activeTranscoder: number;
  activeUpscale: number;
}

export async function getConcurrency(): Promise<ConcurrencySnapshot> {
  console.log(`[cmd] getConcurrency()`);
  try {
    const res = await invoke<ConcurrencySnapshot>("get_concurrency");
    console.log(`[cmd] getConcurrency => download=${res.download}, convert=${res.convert}, transcoder=${res.transcoder}, upscale=${res.upscale}`);
    return res;
  } catch (err) {
    console.error(`[cmd] getConcurrency failed:`, err);
    throw err;
  }
}

export interface UpscaleCapability {
  canUpscale: boolean;
  target: string;
  requiredRamGb: number;
  availableRamGb: number;
  message: string;
}

export async function checkUpscale(target: string): Promise<UpscaleCapability> {
  console.log(`[cmd] checkUpscale(target=${target})`);
  try {
    const res = await invoke<UpscaleCapability>("check_upscale", { target });
    console.log(`[cmd] checkUpscale => canUpscale=${res.canUpscale}, message=${res.message}`);
    return res;
  } catch (err) {
    console.error(`[cmd] checkUpscale failed:`, err);
    throw err;
  }
}

export async function startConvertNative(params: {
  id: string;
  input: string;
  output: string;
  format: string;
  dev_mode: boolean;
  use_gpu: boolean;
  preferred_encoder?: string;
  selected_gpu?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const safeFormat = sanitizeFormat(params.format);
  console.log(`[cmd] startConvertNative: id=${params.id}, input="${safeInput}", output="${safeOutput}", format=${safeFormat.toUpperCase()}, useGpu=${params.use_gpu}, selectedGpu="${params.selected_gpu || ""}"`);
  try {
    await invoke("start_convert_native", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      format: safeFormat,
      devMode: params.dev_mode,
      useGpu: params.use_gpu,
      preferredEncoder: params.preferred_encoder ?? "",
      selectedGpu: params.selected_gpu ?? "",
    });
  } catch (err) {
    console.error(`[cmd] startConvertNative failed:`, err);
    throw err;
  }
}

export async function startTranscoderNative(params: {
  id: string;
  input: string;
  output: string;
  quality: number;
  target_bytes?: number | null;
  file_type: "video" | "photo" | "audio";
  use_gpu: boolean;
  preferred_encoder?: string;
  selected_gpu?: string;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const quality = Math.max(1, Math.min(100, Math.round(params.quality)));
  console.log(`[cmd] startTranscoderNative: id=${params.id}, "${safeInput.split(/[\\/]/).pop()}", quality=${quality}, type=${params.file_type}, useGpu=${params.use_gpu}, selectedGpu="${params.selected_gpu || ""}"`);
  try {
    await invoke("start_transcoder_native", {
      id: params.id,
      input: safeInput,
      output: safeOutput,
      quality,
      targetBytes: params.target_bytes ?? null,
      fileType: params.file_type,
      useGpu: params.use_gpu,
      preferredEncoder: params.preferred_encoder ?? "",
      selectedGpu: params.selected_gpu ?? "",
    });
  } catch (err) {
    console.error(`[cmd] startTranscoderNative failed:`, err);
    throw err;
  }
}
