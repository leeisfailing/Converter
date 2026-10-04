// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FileConverter from "../src/components/FileConverter";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:/Media/Tom & Jerry.mp4") }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("../src/lib/tauri-commands", () => ({
  detectFile: vi.fn(async () => ({ ok: true, file_type: "video", allowed_formats: ["mp4", "mkv"] })),
}));

afterEach(cleanup);

async function pickMp4() {
  fireEvent.click(screen.getByText("Click or drag a file here"));
  fireEvent.click(await screen.findByRole("button", { name: "MP4" }));
  return screen.findByRole("button", { name: /Add to Queue/ });
}

it("queues a conversion for a filename that is legal on Windows and POSIX", async () => {
  const onAdd = vi.fn(async () => {});
  render(<FileConverter onAdd={onAdd} disabled={false} />);
  fireEvent.click(await pickMp4());
  await waitFor(() =>
    expect(onAdd).toHaveBeenCalledWith(
      "C:/Media/Tom & Jerry.mp4",
      "C:/Media/Tom & Jerry_converted.mp4",
      "mp4",
      false,
    )
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the file and reports the failure when the queue rejects the job", async () => {
  const onAdd = vi
    .fn()
    .mockRejectedValueOnce(new Error("Invalid path: empty"))
    .mockResolvedValueOnce(undefined);
  render(<FileConverter onAdd={onAdd} disabled={false} />);
  const addButton = await pickMp4();
  fireEvent.click(addButton);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Invalid path: empty");
  expect(screen.getByText("Tom & Jerry.mp4")).toBeTruthy();

  // A retry reuses the reserved output name instead of gaining a `_2` suffix.
  fireEvent.click(addButton);
  await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
  expect(onAdd.mock.calls[1][1]).toBe("C:/Media/Tom & Jerry_converted.mp4");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
