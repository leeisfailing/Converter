export type QueueItemType = "download" | "convert" | "transcoder" | "upscale" | "enhance";
export type QueueItemStatus = "pending" | "active" | "completed" | "failed" | "cancelled";

export interface QueueItem {
  id: string;
  type: QueueItemType;
  status: QueueItemStatus;
  progress: number;
  assignedGpu?: string;
  // Download fields
  url?: string;
  formatType?: string;
  outputDir?: string;
  downloadSpeed?: number;
  downloadEta?: number;
  downloadIsLive?: boolean;
  downloadPhase?: string;
  writeSubtitles?: boolean;
  writeThumbnail?: boolean;
  useBrowserCookies?: boolean;
  // Convert fields
  inputPath?: string;
  outputPath?: string;
  outputFormat?: string;
  devMode?: boolean;
  // Transcoder fields
  transcoderMode?: "compress" | "reduce";
  transcoderQuality?: number;
  transcoderTargetBytes?: number;
  transcoderFileType?: "video" | "photo" | "audio";
  // Upscale fields
  upscaleTarget?: string;
  upscaleFileType?: "video" | "photo";
  // Enhance fields
  enhanceModel?: string;
  enhanceTileSize?: number;
  enhanceFileType?: "video" | "photo";
  // Result
  resultPath?: string;
  error?: string;
  label: string;
  createdAt: number;
}
