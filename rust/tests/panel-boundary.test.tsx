// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelBoundary } from "../src/App";

function Boom(): never {
  throw new Error("chunk failed to load");
}

function Panel({ label }: { label: string }) {
  return <p>{label}</p>;
}

beforeEach(() => {
  // React logs caught render errors through console.error.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("tool panel error boundary", () => {
  it("contains a failed panel instead of taking over the shell", () => {
    render(
      <PanelBoundary area="convert">
        <Boom />
      </PanelBoundary>
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This tool could not be loaded");
    expect(alert.textContent).toContain("chunk failed to load");
    expect(screen.getByRole("button", { name: "Reload Converter" })).toBeTruthy();
  });

  it("re-arms when the user switches tools", () => {
    const view = render(
      <PanelBoundary area="convert">
        <Boom />
      </PanelBoundary>
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    view.rerender(
      <PanelBoundary area="download">
        <Panel label="download panel" />
      </PanelBoundary>
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("download panel")).toBeTruthy();
  });

  it("renders children while they are healthy", () => {
    render(
      <PanelBoundary area="upscale">
        <Panel label="upscale panel" />
      </PanelBoundary>
    );
    expect(screen.getByText("upscale panel")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
