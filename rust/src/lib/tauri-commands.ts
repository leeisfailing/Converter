import { invoke } from "@tauri-apps/api/core";

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
  return invoke<DetectFileResponse>("detect_file", { path, devMode });
}

export async function detectUrl(url: string): Promise<DetectUrlResponse> {
  return invoke<DetectUrlResponse>("detect_url", { url });
}

export async function startConvert(params: {
  input: string;
  output: string;
  format: string;
  dev_mode: boolean;
}): Promise<void> {
  return invoke("start_convert", {
    input: params.input,
    output: params.output,
    format: params.format,
    devMode: params.dev_mode,
  });
}

export async function startDownload(params: {
  url: string;
  format_type: string;
  output_dir: string;
}): Promise<void> {
  return invoke("start_download", {
    url: params.url,
    formatType: params.format_type,
    outputDir: params.output_dir,
  });
}

export async function cancelOperation(): Promise<void> {
  return invoke("cancel_operation");
}

// ===== BLUR COMMANDS =====

export async function detectVideoInfo(path: string): Promise<VideoInfoResponse> {
  return invoke<VideoInfoResponse>("detect_video_info", { path });
}

export async function startBlur(params: {
  input: string;
  output: string;
  settings: Record<string, unknown>;
}): Promise<void> {
  return invoke("start_blur", {
    input: params.input,
    output: params.output,
    settingsJson: params.settings,
  });
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
  return invoke<WeightPreviewResponse>("get_weight_preview", {
    blurWeighting: params.blur_weighting,
    blurAmount: params.blur_amount,
    videoFps: params.video_fps,
    outputFps: params.output_fps,
    gaussianStdDev: params.gaussian_std_dev,
    gaussianMean: params.gaussian_mean,
    gaussianBound: params.gaussian_bound,
  });
}

export async function getEncodePresets(gpuType: string): Promise<PresetListResponse> {
  return invoke<PresetListResponse>("get_encode_presets", { gpuType });
}

export async function getQualityConfig(codec: string): Promise<QualityConfigResponse> {
  return invoke<QualityConfigResponse>("get_quality_config", { codec });
}

export async function detectGpu(): Promise<GpuInfoResponse> {
  return invoke<GpuInfoResponse>("detect_gpu");
}

// ===== MEDIA INFO =====

export async function getMediaDuration(path: string): Promise<number> {
  return invoke<number>("get_media_duration", { path });
}

// ===== COMPRESSION =====

export async function compressFile(params: {
  input: string;
  output: string;
  target_size_bytes: number;
}): Promise<void> {
  return invoke("compress_file", {
    input: params.input,
    output: params.output,
    targetSizeBytes: params.target_size_bytes,
  });
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
  settings: Record<string, unknown> | null;
  error: string | null;
}

export async function saveBlurConfig(
  name: string,
  description: string,
  settings: Record<string, unknown>
): Promise<void> {
  return invoke("save_blur_config", { name, description, settingsJson: settings });
}

export async function loadBlurConfig(name: string): Promise<ConfigLoadResponse> {
  return invoke<ConfigLoadResponse>("load_blur_config", { name });
}

export async function listBlurConfigs(): Promise<ConfigListResponse> {
  return invoke<ConfigListResponse>("list_blur_configs");
}

export async function deleteBlurConfig(name: string): Promise<void> {
  return invoke("delete_blur_config", { name });
}
