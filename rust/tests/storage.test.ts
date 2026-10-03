// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersLightScheme, readStorage, removeStorage, writeStorage } from "../src/lib/storage";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("guarded storage reads", () => {
  it("returns null when reading localStorage is denied", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("access denied");
      },
    });
    expect(readStorage("app_theme")).toBeNull();
  });

  it("reads, writes and removes values while storage works", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    writeStorage("app_theme", "light");
    expect(readStorage("app_theme")).toBe("light");
    removeStorage("app_theme");
    expect(readStorage("app_theme")).toBeNull();
  });

  it("swallows write and remove failures instead of throwing", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("access denied");
      },
    });
    expect(() => writeStorage("app_theme", "light")).not.toThrow();
    expect(() => removeStorage("app_theme")).not.toThrow();
  });
});

describe("guarded theme preference", () => {
  it("follows prefers-color-scheme when matchMedia works", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }) as MediaQueryList,
    });
    expect(prefersLightScheme()).toBe(true);
  });

  it("falls back to dark when matchMedia throws", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => {
        throw new Error("unsupported");
      },
    });
    expect(prefersLightScheme()).toBe(false);
  });

  it("falls back to dark when matchMedia is missing", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    expect(prefersLightScheme()).toBe(false);
  });
});
