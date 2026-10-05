// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UpdateState } from "../src/lib/updater";
import UpdatePanel from "../src/components/UpdatePanel";

const mocks = vi.hoisted(() => ({ check: vi.fn(), install: vi.fn(), restart: vi.fn(), state: {} as UpdateState }));
vi.mock("../src/lib/updater", () => ({
  useUpdater: () => mocks.state,
  isUpdateBusy: (status: string) => ["checking", "downloading", "installing", "restarting"].includes(status),
  checkForUpdate: mocks.check,
  downloadAndInstallUpdate: mocks.install,
  restartAfterUpdate: mocks.restart,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { status: "idle", currentVersion: "4.0.8", version: null, notes: null, downloadedBytes: 0, totalBytes: null, error: null, failedAction: null, downloaded: false, distribution: "windows_installer" };
});
afterEach(cleanup);

it("offers restart after the webview reloads with an installed update marker", () => {
  mocks.state.downloaded = true;
  render(<UpdatePanel hasPendingWork={false} />);
  expect(screen.getByText("Update installed. Restart Converter to finish.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Check for Updates" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Restart Converter" }));
  expect(mocks.restart).toHaveBeenCalledOnce();
});

it("keeps installation disabled until media jobs finish", () => {
  mocks.state.distribution = "linux_appimage";
  mocks.state.status = "update_available";
  mocks.state.version = "4.0.9";
  render(<UpdatePanel hasPendingWork />);
  const install = screen.getByRole("button", { name: "Install & Restart" }) as HTMLButtonElement;
  expect(install.disabled).toBe(true);
  fireEvent.click(install);
  expect(mocks.install).not.toHaveBeenCalled();
});
