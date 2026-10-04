// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import QueueManager from "../src/components/QueueManager";
import type { QueueItem } from "../src/lib/queue-types";

afterEach(cleanup);

function item(id: string, status: QueueItem["status"], progress = 0): QueueItem {
  return { id, type: "convert", label: `Job ${id}`, status, progress, createdAt: 0 };
}

function renderQueue(items: QueueItem[], onClearCompleted = vi.fn()) {
  return render(
    <QueueManager
      items={items}
      onRemove={vi.fn()}
      onCancel={vi.fn()}
      onClearCompleted={onClearCompleted}
    />
  );
}

it("shows how many jobs are processing out of the whole queue", () => {
  renderQueue([item("one", "active", 42), item("two", "pending"), item("three", "pending")]);
  expect(screen.getByText("Processing 1 of 3")).toBeTruthy();
  expect(screen.queryByText("2 pending")).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear done" })).toBeNull();
});

it("shows the pending count and clears finished jobs", () => {
  const onClearCompleted = vi.fn();
  renderQueue([item("one", "pending"), item("two", "pending"), item("three", "completed")], onClearCompleted);
  expect(screen.queryByText(/Processing/)).toBeNull();
  expect(screen.getByText("2 pending")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear done" }));
  expect(onClearCompleted).toHaveBeenCalledOnce();
});

it("renders nothing while the queue is empty", () => {
  const view = renderQueue([]);
  expect(view.container.textContent).toBe("");
});

it("exposes the active job's progress to assistive technology", () => {
  renderQueue([item("one", "active", 42.6)]);
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-label")).toBe("Job one progress");
  expect(bar.getAttribute("aria-valuenow")).toBe("43");
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("100");
});
