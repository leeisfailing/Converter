// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import QueueManager from "../src/components/QueueManager";
import type { QueueItem } from "../src/lib/queue-types";

afterEach(cleanup);

function item(id: string, status: QueueItem["status"], progress = 0): QueueItem {
  return { id, type: "convert", label: `Job ${id}`, status, progress, createdAt: 0 };
}

function renderQueue(items: QueueItem[], onClearCompleted = vi.fn(), options: Partial<ComponentProps<typeof QueueManager>> = {}) {
  return render(
    <QueueManager
      items={items}
      onRemove={vi.fn()}
      onCancel={vi.fn()}
      onClearCompleted={onClearCompleted}
      paused={false}
      onPauseToggle={vi.fn()}
      onRetry={vi.fn()}
      onRetryFailed={vi.fn()}
      {...options}
    />
  );
}

it("shows how many jobs are processing out of the whole queue", () => {
  renderQueue([item("one", "active", 42), item("two", "pending"), item("three", "pending")]);
  expect(screen.getByText("Processing 1 of 3")).toBeTruthy();
  expect(screen.queryByText("2 pending")).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear finished" })).toBeNull();
});

it("shows the pending count and clears finished jobs", () => {
  const onClearCompleted = vi.fn();
  renderQueue([item("one", "pending"), item("two", "pending"), item("three", "completed")], onClearCompleted);
  expect(screen.queryByText(/Processing/)).toBeNull();
  expect(screen.getByText("2 pending")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear finished" }));
  expect(onClearCompleted).toHaveBeenCalledOnce();
});

it("guides users while the queue is empty without offering job actions", () => {
  renderQueue([]);
  expect(screen.getByRole("heading", { name: "Ready when you are" })).toBeTruthy();
  expect(screen.getByText(/Add a link or a file to get started/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("exposes the active job's progress to assistive technology", () => {
  renderQueue([item("one", "active", 42.6)]);
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-label")).toBe("Job one progress");
  expect(bar.getAttribute("aria-valuenow")).toBe("43");
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("100");
});

it("pauses and resumes queue admission with an accessible pressed state", () => {
  const onPauseToggle = vi.fn();
  const view = renderQueue([item("one", "pending")], vi.fn(), { onPauseToggle });
  const pause = screen.getByRole("button", { name: "Pause queue" });
  expect(pause.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(pause);
  expect(onPauseToggle).toHaveBeenCalledOnce();
  view.rerender(<QueueManager items={[item("one", "pending")]} onRemove={vi.fn()} onCancel={vi.fn()} onClearCompleted={vi.fn()} paused onPauseToggle={onPauseToggle} onRetry={vi.fn()} onRetryFailed={vi.fn()} />);
  const resume = screen.getByRole("button", { name: "Resume queue" });
  expect(resume.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/Running tasks finish normally/)).toBeTruthy();
  fireEvent.click(resume);
  expect(onPauseToggle).toHaveBeenCalledTimes(2);
});

it("shows accurate finished counts and offers individual and bulk retries", () => {
  const onRetry = vi.fn();
  const onRetryFailed = vi.fn();
  renderQueue([item("done", "completed"), item("failed", "failed"), item("cancelled", "cancelled")], vi.fn(), { onRetry, onRetryFailed });
  expect(screen.getByText("1 completed")).toBeTruthy();
  expect(screen.getByText("1 failed")).toBeTruthy();
  expect(screen.getByText("1 cancelled")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry Job failed" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry Job cancelled" }));
  expect(onRetry.mock.calls).toEqual([["failed"], ["cancelled"]]);
  fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
  expect(onRetryFailed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Retry Job done" })).toBeNull();
});

it("retains a resume control when a paused queue is cleared", () => {
  renderQueue([], vi.fn(), { paused: true });
  expect(screen.getByRole("button", { name: "Resume queue" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ready when you are" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry failed" })).toBeNull();
});
