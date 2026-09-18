// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UpdatePrompt from "../src/components/UpdatePrompt";

const state = vi.hoisted(() => ({ status: "update_available", version: "3.1.0" }));
vi.mock("../src/lib/updater", () => ({ useUpdater: () => state }));

beforeEach(() => { localStorage.clear(); state.version = "3.1.0"; });
afterEach(cleanup);

it.each(["Later", "Dismiss update notification"])("dismisses immediately through %s and shows a later release", async (button) => {
  const view = render(<UpdatePrompt onOpenAbout={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() => expect(screen.queryByText("Update available")).toBeNull());
  expect(localStorage.getItem("converter-update-dismissed")).toBe("3.1.0");
  state.version = "3.2.0";
  view.rerender(<UpdatePrompt onOpenAbout={vi.fn()} />);
  expect(screen.getByText("Update available")).toBeTruthy();
});

it("keeps the dismissed release hidden after remount", () => {
  localStorage.setItem("converter-update-dismissed", "3.1.0");
  render(<UpdatePrompt onOpenAbout={vi.fn()} />);
  expect(screen.queryByText("Update available")).toBeNull();
});
