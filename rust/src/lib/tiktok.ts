import { normalizePastedUrl } from "./pasted-url";

export function isTikTokUrl(value: string): boolean {
  try {
    const url = new URL(normalizePastedUrl(value));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return ["http:", "https:"].includes(url.protocol)
      && (host === "tiktok.com" || host.endsWith(".tiktok.com"));
  } catch {
    return false;
  }
}
