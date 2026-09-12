import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { version } from "../../package.json";

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
}

const STORAGE_KEY = "converter-update-installed";

let state: UpdateState = {
  status: "idle", currentVersion: version, version: null, notes: null,
  downloadedBytes: 0, totalBytes: null, error: null, failedAction: null,
  downloaded: loadInstalledFlag(),
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
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveInstalledFlag(value: boolean) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value) localStorage.setItem(STORAGE_KEY, "true");
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
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
  const message = error instanceof Error ? error.message : String(error);
  let friendly = message;
  if (message.includes("timeout") || message.includes("timed out")) {
    friendly = "The update check timed out. Please check your internet connection and try again.";
  } else if (message.includes("fetch") || message.includes("network") || message.includes("ENOTFOUND")) {
    friendly = "Could not reach the update server. Please check your internet connection.";
  } else if (message.includes("404") || message.includes("Not Found")) {
    friendly = "No update manifest found. The release may still be publishing.";
  }
  setState({ status: "error", failedAction: action, error: friendly });
}

async function releaseUpdate() {
  const previous = pendingUpdate;
  pendingUpdate = null;
  if (previous) await previous.close().catch(() => {});
}

export async function loadAppVersion() {
  if (!isTauri()) return;
  try {
    setState({ currentVersion: await getVersion() });
  } catch {}
}

export async function checkForUpdate() {
  if (isUpdateBusy(state.status) || state.downloaded) return;
  if (state.status === "up_to_date") return;
  setState({
    status: "checking", version: null, notes: null, error: null,
    failedAction: null, downloadedBytes: 0, totalBytes: null,
  });
  await releaseUpdate();
  try {
    if (!isTauri()) throw new Error("Open the desktop app to check for updates. Updates are unavailable in browser previews.");
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

function isWindows(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
}

export async function downloadAndInstallUpdate() {
  if (!pendingUpdate || state.downloaded || isUpdateBusy(state.status)) return;
  setState({ status: "downloading", error: null, failedAction: null, downloadedBytes: 0, totalBytes: null });
  downloadAccumulated = 0;
  try {
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started": {
          const total = event.data.contentLength || null;
          downloadAccumulated = 0;
          setState({ downloadedBytes: 0, totalBytes: total });
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
        case "Finished":
          setState({ status: "installing", downloadedBytes: state.totalBytes ?? 0 });
          break;
      }
    }, { timeout: 600_000 });
    setState({ downloaded: true });
    saveInstalledFlag(true);
  } catch (error) {
    fail("install", error);
    return;
  }
  await releaseUpdate();
  if (isWindows()) {
    setState({ status: "idle" });
  } else {
    await restartAfterUpdate();
  }
}
