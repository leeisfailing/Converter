export type QueueItemType = "download" | "convert" | "reduce" | "upscale";
export type QueueItemStatus = "pending" | "active" | "completed" | "failed" | "cancelled";

export interface QueueItem {
  id: string;
  type: QueueItemType;
  status: QueueItemStatus;
  progress: number;
  // Download fields
  url?: string;
  formatType?: string;
  outputDir?: string;
  downloadSpeed?: number;
  downloadEta?: number;
  downloadIsLive?: boolean;
  writeSubtitles?: boolean;
  writeThumbnail?: boolean;
  useBrowserCookies?: boolean;
  // Convert fields
  inputPath?: string;
  outputPath?: string;
  outputFormat?: string;
  devMode?: boolean;
  // Reduce fields
  reduceQuality?: number;
  reduceTargetBytes?: number;
  reduceMaxWidth?: number;
  reduceFileType?: "video" | "photo" | "audio";
  // Upscale fields
  upscaleTarget?: string;
  upscaleFileType?: "video" | "photo";
  // Result
  resultPath?: string;
  error?: string;
  label: string;
  createdAt: number;
}
