import { invoke } from "@tauri-apps/api/core";
import type { BlurSettings } from "../components/BlurSettings";

const DANGEROUS_PATH_CHARS = /[<>"'`;|&$(){}\\]/;
const DANGEROUS_URL_CHARS = /[<>"';|&$\\]/;
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
    "best_4k", "best_1080", "mp4_4k", "mp4_1080", "original",
    "compress",
  ];
  const cleaned = sanitizeString(fmt, 64);
  if (!ALLOWED.includes(cleaned.toLowerCase())) throw new Error(`Invalid format: ${cleaned}`);
  return cleaned;
}

export function sanitizeCodec(codec: string): string {
  const cleaned = sanitizeString(codec, 64);
  if (!/^[a-z0-9_.\-]+$/i.test(cleaned)) throw new Error("Invalid codec name");
  return cleaned;
}

export function sanitizeConfigName(name: string): string {
  const cleaned = sanitizeString(name, 128);
  if (!/^[a-zA-Z0-9_\- ]+$/.test(cleaned)) throw new Error("Config name contains invalid characters");
  return cleaned;
}

export interface DetectFileResponse {
  ok: boolean;
  file_type: string;
  allowed_formats: string[];
}

export interface UrlFormat {
  label: string;
  value: string;
  desc: string;
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

export interface VideoInfoResponse {
  ok: boolean;
  has_video_stream: boolean;
  fps_num: number;
  fps_den: number;
  duration: number;
  color_range: string | null;
  pix_fmt: string | null;
  color_space: string | null;
  color_transfer: string | null;
  color_primaries: string | null;
  sample_rate: number | null;
}

export interface WeightPreviewResponse {
  ok: boolean;
  weights: number[];
  labels: string[];
  error: string | null;
}

export interface PresetInfo {
  name: string;
  codec: string;
}

export interface PresetListResponse {
  ok: boolean;
  presets: PresetInfo[];
}

export interface QualityConfigResponse {
  ok: boolean;
  min_quality: number;
  max_quality: number;
  quality_label: string;
}

export interface GpuInfoResponse {
  ok: boolean;
  gpu_type: string;
  has_hardware_encoder: boolean;
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

// ===== BLUR COMMANDS =====

export async function detectVideoInfo(path: string): Promise<VideoInfoResponse> {
  const safePath = sanitizePath(path);
  console.log(`[cmd] detectVideoInfo("${safePath.split(/[\\/]/).pop()}")`);
  try {
    const res = await invoke<VideoInfoResponse>("detect_video_info", { path: safePath });
    console.log(`[cmd] detectVideoInfo => ok=${res.ok}, fps=${res.fps_num}/${res.fps_den}, duration=${res.duration}s`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectVideoInfo failed:`, err);
    throw err;
  }
}

export async function startBlur(params: {
  input: string;
  output: string;
  settings: BlurSettings;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  console.log(`[cmd] startBlur("${safeInput.split(/[\\/]/).pop()}")`);
  try {
    await invoke("start_blur", {
      input: safeInput,
      output: safeOutput,
      settingsJson: params.settings,
    });
    console.log(`[cmd] startBlur => sent to engine`);
  } catch (err) {
    console.error(`[cmd] startBlur failed:`, err);
    throw err;
  }
}

export async function getWeightPreview(params: {
  blur_weighting: string;
  blur_amount: number;
  video_fps: number;
  output_fps: number;
  gaussian_std_dev: number;
  gaussian_mean: number;
  gaussian_bound: string;
}): Promise<WeightPreviewResponse> {
  const safeWeighting = sanitizeString(params.blur_weighting, 64);
  const safeBound = sanitizeString(params.gaussian_bound, 64);
  try {
    const res = await invoke<WeightPreviewResponse>("get_weight_preview", {
      blurWeighting: safeWeighting,
      blurAmount: params.blur_amount,
      videoFps: params.video_fps,
      outputFps: params.output_fps,
      gaussianStdDev: params.gaussian_std_dev,
      gaussianMean: params.gaussian_mean,
      gaussianBound: safeBound,
    });
    return res;
  } catch (err) {
    console.error(`[cmd] getWeightPreview failed:`, err);
    throw err;
  }
}

export async function getEncodePresets(gpuType: string): Promise<PresetListResponse> {
  const safeGpu = sanitizeString(gpuType, 64);
  try {
    return await invoke<PresetListResponse>("get_encode_presets", { gpuType: safeGpu });
  } catch (err) {
    console.error(`[cmd] getEncodePresets failed:`, err);
    throw err;
  }
}

export async function getQualityConfig(codec: string): Promise<QualityConfigResponse> {
  const safeCodec = sanitizeCodec(codec);
  try {
    return await invoke<QualityConfigResponse>("get_quality_config", { codec: safeCodec });
  } catch (err) {
    console.error(`[cmd] getQualityConfig failed:`, err);
    throw err;
  }
}

export async function detectGpu(): Promise<GpuInfoResponse> {
  console.log(`[cmd] detectGpu()`);
  try {
    const res = await invoke<GpuInfoResponse>("detect_gpu");
    console.log(`[cmd] detectGpu => type=${res.gpu_type}, hw_encoder=${res.has_hardware_encoder}`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectGpu failed:`, err);
    throw err;
  }
}

// ===== MEDIA INFO =====

export async function getMediaDuration(path: string): Promise<number> {
  const safePath = sanitizePath(path);
  try {
    return await invoke<number>("get_media_duration", { path: safePath });
  } catch (err) {
    console.error(`[cmd] getMediaDuration failed:`, err);
    throw err;
  }
}

// ===== COMPRESSION =====

export async function compressFile(params: {
  input: string;
  output: string;
  target_size_bytes: number;
}): Promise<void> {
  const safeInput = sanitizePath(params.input);
  const safeOutput = sanitizePath(params.output);
  const sizeMB = (params.target_size_bytes / 1048576).toFixed(1);
  console.log(`[cmd] compressFile("${safeInput.split(/[\\/]/).pop()}", target=${sizeMB}MB)`);
  try {
    await invoke("compress_file", {
      input: safeInput,
      output: safeOutput,
      targetSizeBytes: params.target_size_bytes,
    });
    console.log(`[cmd] compressFile => sent to engine`);
  } catch (err) {
    console.error(`[cmd] compressFile failed:`, err);
    throw err;
  }
}

// ===== CONFIG COMMANDS =====

export interface ConfigInfo {
  name: string;
  description: string;
  is_preset: boolean;
}

export interface ConfigListResponse {
  ok: boolean;
  configs: ConfigInfo[];
}

export interface ConfigLoadResponse {
  ok: boolean;
  settings: BlurSettings | null;
  error: string | null;
}

export async function saveBlurConfig(
  name: string,
  description: string,
  settings: BlurSettings
): Promise<void> {
  const safeName = sanitizeConfigName(name);
  const safeDesc = sanitizeString(description, 512);
  try {
    await invoke("save_blur_config", { name: safeName, description: safeDesc, settingsJson: settings });
  } catch (err) {
    console.error(`[cmd] saveBlurConfig failed:`, err);
    throw err;
  }
}

export async function loadBlurConfig(name: string): Promise<ConfigLoadResponse> {
  const safeName = sanitizeConfigName(name);
  try {
    return await invoke<ConfigLoadResponse>("load_blur_config", { name: safeName });
  } catch (err) {
    console.error(`[cmd] loadBlurConfig failed:`, err);
    throw err;
  }
}

export async function listBlurConfigs(): Promise<ConfigListResponse> {
  try {
    return await invoke<ConfigListResponse>("list_blur_configs");
  } catch (err) {
    console.error(`[cmd] listBlurConfigs failed:`, err);
    throw err;
  }
}

export async function deleteBlurConfig(name: string): Promise<void> {
  const safeName = sanitizeConfigName(name);
  try {
    await invoke("delete_blur_config", { name: safeName });
  } catch (err) {
    console.error(`[cmd] deleteBlurConfig failed:`, err);
    throw err;
  }
}

// ===== APP SETTINGS =====

export interface AppSettings {
  downloadDir: string;
  outputDir: string;
  autoSave: boolean;
  overwriteExisting: boolean;
}

export async function getSettings(): Promise<AppSettings> {
  console.log(`[cmd] getSettings()`);
  try {
    const res = await invoke<AppSettings>("get_settings");
    console.log(`[cmd] getSettings => downloadDir="${res.downloadDir}", outputDir="${res.outputDir}", autoSave=${res.autoSave}`);
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
      autoSave: settings.autoSave,
      overwriteExisting: settings.overwriteExisting,
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
