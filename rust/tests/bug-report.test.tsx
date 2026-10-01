// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import BugReport from "../src/components/BugReport";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

function fillReport() {
  render(<BugReport onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Unreadable selector" } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "The units are blank." } });
  fireEvent.click(screen.getByRole("button", { name: "Save Report" }));
}

it("saves a real text report before showing success", async () => {
  vi.mocked(save).mockResolvedValueOnce("/tmp/report.txt");
  vi.mocked(writeFile).mockResolvedValueOnce(undefined);
  fillReport();
  expect(await screen.findByText("Bug Report Saved")).toBeTruthy();
  const [path, bytes] = vi.mocked(writeFile).mock.calls[0];
  expect(path).toBe("/tmp/report.txt");
  expect(new TextDecoder().decode(bytes as Uint8Array)).toContain("Unreadable selector");
  expect(screen.queryByText(/has been received/)).toBeNull();
});

it("keeps the form when saving is cancelled", async () => {
  vi.mocked(save).mockResolvedValueOnce(null);
  fillReport();
  await waitFor(() => expect((screen.getByRole("button", { name: "Save Report" }) as HTMLButtonElement).disabled).toBe(false));
  expect(writeFile).not.toHaveBeenCalled();
  expect(screen.queryByText("Bug Report Saved")).toBeNull();
});

it("shows a write failure without claiming success", async () => {
  vi.mocked(save).mockResolvedValueOnce("/tmp/report.txt");
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("permission denied"));
  fillReport();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Bug Report Saved")).toBeNull();
});
