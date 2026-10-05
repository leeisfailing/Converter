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

it("shows the available version and formatted notes with installation as the first action", () => {
  mocks.state.status = "update_available";
  mocks.state.version = "4.0.10";
  mocks.state.notes = "## Improvements\n- **Cleaner** update panel\n- Readable release notes";
  render(<UpdatePanel hasPendingWork={false} />);
  expect(screen.getByText("Converter 4.0.10")).toBeTruthy();
  expect(screen.getByText("What's new in v4.0.10").closest("details")?.open).toBe(true);
  expect(screen.getByRole("heading", { name: "Improvements" })).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  const buttons = screen.getAllByRole("button");
  expect(buttons[0].textContent).toContain("Install & Restart");
  fireEvent.click(buttons[0]);
  expect(mocks.install).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));
  expect(mocks.check).toHaveBeenCalledOnce();
});

it("shows installation failures and retries without hiding the error", () => {
  mocks.state.status = "error";
  mocks.state.failedAction = "install";
  mocks.state.version = "4.0.10";
  mocks.state.error = "Signature verification failed";
  render(<UpdatePanel hasPendingWork={false} />);
  expect(screen.getByRole("alert").textContent).toContain("Signature verification failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry Update" }));
  expect(mocks.install).toHaveBeenCalledOnce();
});

it("offers a guarded restart retry after a restart error without reinstalling", () => {
  mocks.state.status = "error";
  mocks.state.failedAction = "restart";
  mocks.state.downloaded = true;
  mocks.state.error = "Automatic restart failed";
  const view = render(<UpdatePanel hasPendingWork />);
  expect(screen.getByRole("alert").textContent).toContain("Automatic restart failed");
  expect((screen.getByRole("button", { name: "Restart Converter" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry Update" })).toBeNull();
  view.rerender(<UpdatePanel hasPendingWork={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Restart Converter" }));
  expect(mocks.restart).toHaveBeenCalledOnce();
  expect(mocks.install).not.toHaveBeenCalled();
});

it.each([1000, null])("exposes determinate or indeterminate download progress (%s)", (totalBytes) => {
  mocks.state.status = "downloading";
  mocks.state.downloadedBytes = 250;
  mocks.state.totalBytes = totalBytes;
  render(<UpdatePanel hasPendingWork={false} />);
  const progress = screen.getByRole("progressbar", { name: "Update download" });
  expect(progress.getAttribute("value")).toBe(totalBytes ? "25" : null);
  expect((screen.getByRole("button", { name: "Check for Updates" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Install & Restart" })).toBeNull();
});

it("falls back to the installed version and a plain notes label when the target is unknown", () => {
  mocks.state.notes = "Helpful release information";
  const view = render(<UpdatePanel hasPendingWork={false} />);
  expect(screen.getByText("Converter 4.0.8")).toBeTruthy();
  expect(screen.getByText("What's new")).toBeTruthy();
  expect(view.container.textContent).not.toContain("null");
  expect(view.container.textContent).not.toContain("undefined");
});
