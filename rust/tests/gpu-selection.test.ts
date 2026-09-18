import { expect, it } from "vitest";
import { gpuSelection, gpuStatus } from "../src/lib/gpu-selection";
const base = { downloadDir: "", outputDir: "", useGpu: true, autoDetectGpu: true, selectedGpu: "h264_amf", preferredEncoder: "" };
const recommended = { available: true, vendor: "NVIDIA", encoder: "h264_nvenc" };
it("shows the manual GPU even when NVIDIA is recommended", () => {
  const settings = { ...base, autoDetectGpu: false };
  expect(gpuStatus(settings, recommended)).toContain("AMD (h264_amf)");
  expect(gpuSelection(settings)).toEqual({ useGpu: true, selectedGpu: "h264_amf", preferredEncoder: "" });
});
it("clears stale manual selection in automatic mode", () => {
  expect(gpuStatus(base, recommended)).toContain("NVIDIA (h264_nvenc)");
  expect(gpuSelection(base).selectedGpu).toBe("");
});
it("CPU mode clears hardware preferences and reports CPU", () => {
  const settings = { ...base, autoDetectGpu: false, useGpu: false, preferredEncoder: "h264_nvenc" };
  expect(gpuStatus(settings, recommended)).toBe("Video encoding: CPU only");
  expect(gpuSelection(settings)).toEqual({ useGpu: false, selectedGpu: "", preferredEncoder: "" });
});
it("normalizes legacy software encoder selection", () => {
  expect(gpuSelection({ ...base, autoDetectGpu: false, selectedGpu: "libx264" }).useGpu).toBe(false);
});

it("never sends the parallel mode name to an encoder", () => {
  expect(gpuSelection({ ...base, autoDetectGpu: false, selectedGpu: "parallel" })).toEqual({ useGpu: true, selectedGpu: "", preferredEncoder: "" });
});
