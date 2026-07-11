export type QueueItemType = "download" | "convert";
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
  // Result
  resultPath?: string;
  error?: string;
  label: string;
  createdAt: number;
}
