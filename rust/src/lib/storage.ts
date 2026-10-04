/**
 * Ambient browser access that must never throw. The app reads `localStorage`
 * and `matchMedia` while it boots, before its ErrorBoundary can mount, so a
 * blocked storage API or a missing `matchMedia` has to fall back to a default
 * instead of white-screening the window.
 */

export function readStorage(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): the value simply will not persist.
  }
}

export function removeStorage(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Same as writeStorage: nothing to do when storage is unavailable.
  }
}

/** `prefers-color-scheme: light`, or false when matchMedia is unavailable. */
export function prefersLightScheme(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : false;
  } catch {
    return false;
  }
}
