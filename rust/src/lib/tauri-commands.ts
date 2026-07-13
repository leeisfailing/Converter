import { invoke } from "@tauri-apps/api/core";
import type { BlurSettings } from "../components/BlurSettings";

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
  console.log(`[cmd] detectFile("${path.split(/[\\/]/).pop()}", devMode=${devMode})`);
  try {
    const res = await invoke<DetectFileResponse>("detect_file", { path, devMode });
    console.log(`[cmd] detectFile => ok=${res.ok}, type=${res.file_type}, formats=[${res.allowed_formats.join(", ")}]`);
    return res;
  } catch (err) {
    console.error(`[cmd] detectFile failed:`, err);
    throw err;
  }
}

export async function detectUrl(url: string): Promise<DetectUrlResponse> {
  console.log(`[cmd] detectUrl("${url.substring(0, 60)}")`);
  try {
    const res = await invoke<DetectUrlResponse>("detect_url", { url });
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
  console.log(`[cmd] startConvert("${params.input.split(/[\\/]/).pop()}" => ${params.format.toUpperCase()}, devMode=${params.dev_mode})`);
  try {
    await invoke("start_convert", {
      input: params.input,
      output: params.output,
      format: params.format,
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
  console.log(`[cmd] startDownload("${params.url.substring(0, 50)}", format=${params.format_type})`);
  try {
    await invoke("start_download", {
      url: params.url,
      formatType: params.format_type,
      outputDir: params.output_dir,
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
  console.log(`[cmd] detectVideoInfo("${path.split(/[\\/]/).pop()}")`);
  try {
    const res = await invoke<VideoInfoResponse>("detect_video_info", { path });
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
  console.log(`[cmd] startBlur("${params.input.split(/[\\/]/).pop()}")`);
  try {
    await invoke("start_blur", {
      input: params.input,
      output: params.output,
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
  try {
    const res = await invoke<WeightPreviewResponse>("get_weight_preview", {
      blurWeighting: params.blur_weighting,
      blurAmount: params.blur_amount,
      videoFps: params.video_fps,
      outputFps: params.output_fps,
      gaussianStdDev: params.gaussian_std_dev,
      gaussianMean: params.gaussian_mean,
      gaussianBound: params.gaussian_bound,
    });
    return res;
  } catch (err) {
    console.error(`[cmd] getWeightPreview failed:`, err);
    throw err;
  }
}

export async function getEncodePresets(gpuType: string): Promise<PresetListResponse> {
  try {
    return await invoke<PresetListResponse>("get_encode_presets", { gpuType });
  } catch (err) {
    console.error(`[cmd] getEncodePresets failed:`, err);
    throw err;
  }
}

export async function getQualityConfig(codec: string): Promise<QualityConfigResponse> {
  try {
    return await invoke<QualityConfigResponse>("get_quality_config", { codec });
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
  try {
    return await invoke<number>("get_media_duration", { path });
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
  const sizeMB = (params.target_size_bytes / 1048576).toFixed(1);
  console.log(`[cmd] compressFile("${params.input.split(/[\\/]/).pop()}", target=${sizeMB}MB)`);
  try {
    await invoke("compress_file", {
      input: params.input,
      output: params.output,
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
  try {
    await invoke("save_blur_config", { name, description, settingsJson: settings });
  } catch (err) {
    console.error(`[cmd] saveBlurConfig failed:`, err);
    throw err;
  }
}

export async function loadBlurConfig(name: string): Promise<ConfigLoadResponse> {
  try {
    return await invoke<ConfigLoadResponse>("load_blur_config", { name });
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
  try {
    await invoke("delete_blur_config", { name });
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
  console.log(`[cmd] saveSettings()`);
  try {
    const res = await invoke<AppSettings>("save_settings", {
      downloadDir: settings.downloadDir,
      outputDir: settings.outputDir,
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
