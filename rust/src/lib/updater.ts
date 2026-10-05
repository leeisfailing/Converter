import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { version } from "../../package.json";
import { readStorage, removeStorage, writeStorage } from "./storage";
import { getUpdateDistribution, type UpdateDistribution } from "./tauri-commands";

export type UpdateStatus =
  | "idle" | "checking" | "update_available" | "up_to_date"
  | "downloading" | "installing" | "restarting" | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  failedAction: "check" | "install" | "restart" | null;
  downloaded: boolean;
  distribution: UpdateDistribution | null;
}

const STORAGE_KEY = "converter-update-installed";

let state: UpdateState = {
  status: "idle", currentVersion: version, version: null, notes: null,
  downloadedBytes: 0, totalBytes: null, error: null, failedAction: null,
  downloaded: loadInstalledFlag(), distribution: null,
};
let pendingUpdate: Update | null = null;
let downloadAccumulated = 0;
const listeners = new Set<() => void>();
const progressListeners = new Set<(event: DownloadProgressEvent) => void>();

export interface DownloadProgressEvent {
  phase: "download" | "install";
  downloadedBytes: number;
  totalBytes: number | null;
}

function loadInstalledFlag(): boolean {
  // The marker belongs to the app version that installed the update. A new
  // version must be able to check again after the application restarts.
  return readStorage(STORAGE_KEY) === version;
}

function saveInstalledFlag(value: boolean) {
  if (value) writeStorage(STORAGE_KEY, state.currentVersion);
  else removeStorage(STORAGE_KEY);
}

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getUpdaterState() { return state; }

export function subscribeToUpdater(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function subscribeToDownloadProgress(listener: (event: DownloadProgressEvent) => void) {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

export function useUpdater() {
  return useSyncExternalStore(subscribeToUpdater, getUpdaterState, getUpdaterState);
}

export function useAppVersion() {
  return useSyncExternalStore(subscribeToUpdater, () => state.currentVersion, () => state.currentVersion);
}

export function isUpdateBusy(status: UpdateStatus) {
  return ["checking", "downloading", "installing", "restarting"].includes(status);
}

function fail(action: UpdateState["failedAction"], error: unknown) {
  console.error(`[updater] ${action} failed:`, error);
  const message = error instanceof Error ? error.message : String(error);
  let friendly = message;
  if (message.includes("404") || message.includes("Not Found")) {
    friendly = action === "check"
      ? "No update manifest found on this update channel. The release may be missing or still publishing."
      : "The update download is no longer available. Check for updates again or download a release from GitHub.";
  } else if (message.includes("timeout") || message.includes("timed out")) {
    friendly = "The update check timed out. Please check your internet connection and try again.";
  } else if (message.includes("fetch") || message.includes("network") || message.includes("ENOTFOUND")) {
    friendly = "Could not reach the update server. Please check your internet connection.";
  }
  setState({ status: "error", failedAction: action, error: friendly });
}

async function releaseUpdate() {
  const previous = pendingUpdate;
  pendingUpdate = null;
  if (previous) await previous.close().catch((error: unknown) => console.error("[updater] Could not release update resource:", error));
}

export async function loadAppVersion() {
  if (!isTauri()) return;
  try {
    setState({ currentVersion: await getVersion() });
  } catch (error) {
    console.error("[updater] Could not read application version:", error);
  }
}

export async function checkForUpdate() {
  if (isUpdateBusy(state.status) || state.downloaded) return;
  setState({
    status: "checking", version: null, notes: null, error: null,
    failedAction: null, downloadedBytes: 0, totalBytes: null,
  });
  await releaseUpdate();
  try {
    if (!isTauri()) throw new Error("Open the desktop app to check for updates. Updates are unavailable in browser previews.");
    const distribution = await getUpdateDistribution();
    setState({ distribution });
    if (distribution === "unsupported") throw new Error("Automatic updates require the Linux AppImage or Windows installer. Download a supported package from GitHub Releases.");
    pendingUpdate = await check({ timeout: 15_000 });
    setState(pendingUpdate ? {
      status: "update_available", currentVersion: pendingUpdate.currentVersion,
      version: pendingUpdate.version, notes: pendingUpdate.body ?? null,
    } : { status: "up_to_date" });
  } catch (error) {
    fail("check", error);
  }
}

export async function restartAfterUpdate() {
  if (!state.downloaded || isUpdateBusy(state.status)) return;
  setState({ status: "restarting", error: null, failedAction: null });
  try {
    await relaunch();
  } catch (error) {
    fail("restart", error);
  }
}

export async function downloadAndInstallUpdate() {
  if (!pendingUpdate || state.downloaded || isUpdateBusy(state.status)) return;
  if (state.distribution !== "windows_installer" && state.distribution !== "linux_appimage") {
    fail("install", new Error("This package does not support automatic installation."));
    return;
  }
  setState({ status: "downloading", error: null, failedAction: null, downloadedBytes: 0, totalBytes: null });
  downloadAccumulated = 0;
  try {
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started": {
          const total = event.data.contentLength || null;
          downloadAccumulated = 0;
          setState({ downloadedBytes: 0, totalBytes: total });
          progressListeners.forEach((l) => l({ phase: "download", downloadedBytes: 0, totalBytes: total }));
          break;
        }
        case "Progress": {
          downloadAccumulated += event.data.chunkLength;
          const current = downloadAccumulated;
          const total = state.totalBytes;
          setState({ downloadedBytes: current });
          progressListeners.forEach((l) => l({ phase: "download", downloadedBytes: current, totalBytes: total }));
          break;
        }
        case "Finished": {
          const total = state.totalBytes;
          const done = total ?? downloadAccumulated;
          setState({ status: "installing", downloadedBytes: done });
          progressListeners.forEach((l) => l({ phase: "install", downloadedBytes: done, totalBytes: total }));
          break;
        }
      }
    }, { timeout: 600_000 });
    setState({ downloaded: true, status: "idle" });
    saveInstalledFlag(true);
  } catch (error) {
    fail("install", error);
    return;
  }
  await releaseUpdate();
  if (state.distribution === "windows_installer") {
    setState({ status: "idle" });
  } else {
    await restartAfterUpdate();
  }
}
