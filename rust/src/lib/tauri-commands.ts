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
