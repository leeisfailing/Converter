import type { AppSettings } from "./tauri-commands";

export function gpuSelection(settings: AppSettings) {
  if (settings.autoDetectGpu || settings.selectedGpu === "parallel") return { useGpu: true, selectedGpu: "", preferredEncoder: "" };
  const encoder = settings.selectedGpu || settings.preferredEncoder;
  if (!settings.useGpu || encoder === "libx264") return { useGpu: false, selectedGpu: "", preferredEncoder: "" };
  return { useGpu: true, selectedGpu: encoder, preferredEncoder: "" };
}

export function gpuStatus(settings: AppSettings, recommended: { available: boolean; encoder: string; vendor: string } | null) {
  if (!settings.autoDetectGpu && settings.selectedGpu === "parallel") return "Video GPUs: Both GPUs — parallel tasks";
  const selection = gpuSelection(settings);
  if (!selection.useGpu) return "Video encoding: CPU only";
  if (selection.selectedGpu) {
    const encoder = selection.selectedGpu;
    const vendor = encoder.endsWith("_amf") ? "AMD" : encoder.endsWith("_nvenc") ? "NVIDIA" : encoder.endsWith("_qsv") ? "Intel" : "Selected GPU";
    return `Video GPU: ${vendor} (${encoder}) — Manual`;
  }
  if (recommended?.available) return `Video GPU: ${recommended.vendor} (${recommended.encoder}) — Automatic`;
  return recommended ? "Video GPU: No working automatic encoder" : "Video GPU: Detecting recommendation…";
}

// One H.264 encoder per detected vendor; codec variants share the same GPU.
export function parallelGpuEncoders(encoders: { id: string }[]) {
  return ["h264_nvenc", "h264_amf", "h264_qsv"].filter(id => encoders.some(encoder => encoder.id === id));
}

export function isParallelVideoTask(item: import("./queue-types").QueueItem) {
  if (item.type === "transcoder") return item.transcoderFileType === "video";
  if (item.type === "upscale") return item.upscaleFileType === "video";
  if (item.type === "convert") return ["mp4", "mkv", "avi", "mov", "flv", "m4v", "3gp", "mts"].includes(item.outputFormat || "");
  return false;
}
