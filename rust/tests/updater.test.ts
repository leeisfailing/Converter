import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn(), isTauri: vi.fn(), getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));

let originalUA: string;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.getVersion.mockResolvedValue("3.0.0");
  originalUA = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", configurable: true });
});

afterEach(() => {
  Object.defineProperty(navigator, "userAgent", { value: originalUA, configurable: true });
});

function update() {
  return { currentVersion: "3.0.0", version: "3.1.0", body: "Release notes", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn() };
}

describe("updater lifecycle", () => {
  it("checks once for concurrent requests and reports no update", async () => {
    let complete!: (result: null) => void;
    mocks.check.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const store = await import("../src/lib/updater");
    const first = store.checkForUpdate();
    await store.checkForUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    complete(null);
    await first;
    expect(store.getUpdaterState().status).toBe("up_to_date");
  });

  it("returns early on up_to_date without re-checking", async () => {
    mocks.check.mockResolvedValue(null);
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    expect(store.getUpdaterState().status).toBe("up_to_date");
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await store.checkForUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(store.getUpdaterState().status).toBe("up_to_date");
  });

  it("keeps the checked update and progress across subscriptions", async () => {
    const available = update();
    mocks.check.mockResolvedValue(available);
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    const listener = vi.fn();
    const unsubscribe = store.subscribeToUpdater(listener);
    unsubscribe();
    expect(store.getUpdaterState()).toMatchObject({ status: "update_available", version: "3.1.0", notes: "Release notes" });
    available.downloadAndInstall.mockImplementation(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 40 } });
      progress({ event: "Progress", data: { chunkLength: 60 } });
      expect(store.getUpdaterState()).toMatchObject({ downloadedBytes: 100, totalBytes: 100 });
      progress({ event: "Finished" });
      expect(store.getUpdaterState().status).toBe("installing");
    });
    await store.downloadAndInstallUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(available.close).toHaveBeenCalledOnce();
    expect(store.getUpdaterState().downloaded).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("sets downloaded to true after successful install", async () => {
    const available = update();
    mocks.check.mockResolvedValue(available);
    available.downloadAndInstall.mockImplementation(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: {} });
      progress({ event: "Finished" });
    });
    const store = await import("../src/lib/updater");
    expect(store.getUpdaterState().downloaded).toBe(false);
    await store.checkForUpdate();
    expect(store.getUpdaterState().downloaded).toBe(false);
    await store.downloadAndInstallUpdate();
    expect(store.getUpdaterState().downloaded).toBe(true);
  });

  it("never restarts after a verification failure and allows installation retry", async () => {
    const available = update();
    mocks.check.mockResolvedValue(available);
    available.downloadAndInstall.mockImplementationOnce(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: {} });
      progress({ event: "Finished" });
      throw new Error("Invalid signature");
    }).mockImplementationOnce(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: {} });
      progress({ event: "Finished" });
    });
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    await store.downloadAndInstallUpdate();
    expect(store.getUpdaterState()).toMatchObject({ status: "error", failedAction: "install", error: "Invalid signature", totalBytes: null });
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(store.getUpdaterState().downloaded).toBe(false);
    await store.downloadAndInstallUpdate();
    expect(store.getUpdaterState().downloaded).toBe(true);
    expect(store.getUpdaterState().status).toBe("installing");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("prevents restart and re-download after a successful install", async () => {
    const available = update();
    mocks.check.mockResolvedValue(available);
    available.downloadAndInstall.mockImplementation(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: {} });
      progress({ event: "Finished" });
    });
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    await store.downloadAndInstallUpdate();
    expect(store.getUpdaterState()).toMatchObject({ downloaded: true });
    expect(store.getUpdaterState().status).toBe("installing");
    await store.restartAfterUpdate();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    await store.checkForUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await store.downloadAndInstallUpdate();
    expect(available.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("releases the old update before rechecking and reports server errors accurately", async () => {
    const available = update();
    mocks.check.mockResolvedValueOnce(available).mockRejectedValueOnce("404: release manifest missing");
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    await store.checkForUpdate();
    expect(available.close).toHaveBeenCalledOnce();
    expect(store.getUpdaterState()).toMatchObject({ status: "error", failedAction: "check", version: null });
    expect(store.getUpdaterState().error).toContain("No update manifest found");
  });

  it("explains browser previews without invoking native updater APIs", async () => {
    mocks.isTauri.mockReturnValue(false);
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    expect(store.getUpdaterState().error).toContain("desktop app");
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("sets idle instead of restarting on Windows after install", async () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", configurable: true });
    const available = update();
    mocks.check.mockResolvedValue(available);
    available.downloadAndInstall.mockImplementation(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: {} });
      progress({ event: "Finished" });
    });
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    await store.downloadAndInstallUpdate();
    expect(store.getUpdaterState().status).toBe("idle");
    expect(store.getUpdaterState().downloaded).toBe(true);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("exports subscribeToDownloadProgress", async () => {
    const store = await import("../src/lib/updater");
    expect(typeof store.subscribeToDownloadProgress).toBe("function");
    const unsubscribe = store.subscribeToDownloadProgress(vi.fn());
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("checkForUpdate can be called multiple times without side effects", async () => {
    mocks.check.mockResolvedValue(null);
    const store = await import("../src/lib/updater");
    await store.checkForUpdate();
    expect(store.getUpdaterState().status).toBe("up_to_date");
    await store.checkForUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
});
