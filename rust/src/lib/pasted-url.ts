/** Unwrap a single Markdown link without changing the destination or query. */
export function normalizePastedUrl(value: string): string {
  const trimmed = value.trim();
  const markdown = trimmed.match(/^\[[^\]\r\n]*\]\((https?:\/\/[^\s]+)\)[?.!,]*$/i);
  return markdown ? markdown[1] : trimmed;
}
