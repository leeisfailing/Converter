// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copyText } from "../src/lib/clipboard";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it("uses the asynchronous clipboard when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
  expect(await copyText("log output")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("log output");
});

it.each([true, false])("reports fallback success accurately (%s) and restores focus", async (result) => {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText: vi.fn().mockRejectedValue(new Error("denied")) } as unknown as Clipboard);
  const command = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, "execCommand", { configurable: true, value: command });
  const button = document.createElement("button");
  document.body.appendChild(button);
  button.focus();
  expect(await copyText("log output")).toBe(result);
  expect(command).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(button);
});
