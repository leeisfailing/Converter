// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ReleaseNotes from "../src/components/ReleaseNotes";

afterEach(cleanup);

it("renders release headings, grouped lists, emphasis, and code without Markdown markers", () => {
  const view = render(<ReleaseNotes notes={'## Improvements\n\n- **Cleaner** update panel\n- Supports `AppImage`\n\n### Setup\n1. Download\n2. Restart\n\n```sh\nchmod +x Converter.AppImage\n```'} />);
  expect(screen.getByRole("heading", { name: "Improvements", level: 4 })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Setup", level: 5 })).toBeTruthy();
  expect(screen.getAllByRole("list")).toHaveLength(2);
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(view.container.querySelector("strong")?.textContent).toBe("Cleaner");
  expect(view.container.querySelector("pre code")?.textContent).toBe("chmod +x Converter.AppImage");
  expect(view.container.textContent).not.toContain("##");
  expect(view.container.textContent).not.toContain("```");
});

it("displays safe web references readably without navigating the desktop webview", () => {
  const view = render(<ReleaseNotes notes={'[Downloads](https://example.com/releases) and [Guide](http://example.com/guide)'} />);
  expect(screen.getByText("(https://example.com/releases)")).toBeTruthy();
  expect(screen.getByText("(http://example.com/guide)")).toBeTruthy();
  expect(view.container.textContent).toContain("Downloads");
  expect(view.container.textContent).not.toContain("[Downloads]");
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps HTML and executable or credential-bearing link destinations inert", () => {
  const view = render(<ReleaseNotes notes={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Unsafe](javascript:alert) [Data](data:text/html,test) [File](file:///etc/passwd) [Credentials](https://user:pass@example.com/)'} />);
  expect(view.container.querySelector("script, img, iframe")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(view.container.textContent).toContain("<script>alert(1)</script>");
  expect(view.container.textContent).toContain("javascript:alert");
});

it("handles Windows line endings and unfinished code fences as ordinary code", () => {
  const view = render(<ReleaseNotes notes={'## Fixed\r\n\r\nA paragraph.\r\nContinued here.\r\n\r\n```\r\n<script>escaped</script>'} />);
  expect(screen.getByText("A paragraph. Continued here.")).toBeTruthy();
  expect(view.container.querySelector("pre code")?.textContent).toBe("<script>escaped</script>");
  expect(view.container.querySelector("script")).toBeNull();
});

it("bounds oversized external notes and explains when content is truncated", () => {
  const view = render(<ReleaseNotes notes={`## Improvements\n\n${"x".repeat(40_000)}\nEND_OF_NOTES`} />);
  expect(screen.getByRole("heading", { name: "Improvements" })).toBeTruthy();
  expect(screen.getByText(/Showing the first part of these release notes/)).toBeTruthy();
  expect(view.container.textContent).not.toContain("END_OF_NOTES");
  expect(view.container.textContent!.length).toBeLessThan(33_000);
});

it("bounds long lists by line count while preserving readable list semantics", () => {
  const notes = Array.from({ length: 600 }, (_, index) => `- Item ${index}`).join("\n");
  render(<ReleaseNotes notes={notes} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(500);
  expect(screen.getByText(/Showing the first part of these release notes/)).toBeTruthy();
  expect(screen.queryByText("Item 500")).toBeNull();
});

it.each(["[".repeat(32_000), "[label](destination".repeat(1_000)])("keeps malformed repeated link delimiters inert", (notes) => {
  const view = render(<ReleaseNotes notes={notes} />);
  expect(view.container.textContent).toBe(notes);
  expect(screen.queryByRole("link")).toBeNull();
  expect(view.container.querySelector(".release-reference")).toBeNull();
});
