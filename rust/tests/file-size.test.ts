import { expect, it } from "vitest";
import { formatFileSize } from "../src/lib/file-size";

it.each([
  [500, "500 B"], [1500, "1.5 KB"], [10_000, "10 KB"],
  [1_500_000, "1.5 MB"], [1_500_000_000, "1.5 GB"],
])("shows decimal size budgets consistently (%s)", (bytes, expected) => {
  expect(formatFileSize(bytes)).toBe(expected);
});

it("does not present an invalid budget as a file size", () => {
  expect(formatFileSize(Number.NaN)).toBe("invalid size");
});
