/** Use the same decimal units as the Transcoder's byte-budget calculation. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "invalid size";
  const [divisor, unit] = bytes >= 1_000_000_000 ? [1_000_000_000, "GB"]
    : bytes >= 1_000_000 ? [1_000_000, "MB"]
    : bytes >= 1_000 ? [1_000, "KB"] : [1, "B"];
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(bytes / divisor)} ${unit}`;
}
