import type { BlurSettings } from "../components/BlurSettings";

export type QueueItemType = "download" | "convert" | "blur" | "compress";
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
  // Convert fields
  inputPath?: string;
  outputPath?: string;
  outputFormat?: string;
  devMode?: boolean;
  // Compress fields
  targetSizeBytes?: number;
  // Blur fields
  blurSettings?: BlurSettings;
  // Result
  resultPath?: string;
  error?: string;
  label: string;
  createdAt: number;
}
