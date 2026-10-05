import { expect, it } from "vitest";
import { splitMediaPath, transcodeExtension } from "../src/lib/media-paths";

it.each([
  ["/home/user/Media.v2/clip", "/home/user/Media.v2/clip", ""],
  ["C:\\Media.v2\\clip.MOV", "C:\\Media.v2\\clip", ".mov"],
  ["/tmp/.hidden", "/tmp/.hidden", ""],
  ["/tmp/.hidden.mp4", "/tmp/.hidden", ".mp4"],
])("preserves the filename and directory of %s", (path, base, extension) => {
  expect(splitMediaPath(path)).toEqual({ base, extension });
});

it.each(["compress", "reduce"] as const)("uses encodable containers in %s mode", (mode) => {
  expect(transcodeExtension("clip.webm", "video", mode)).toBe(".mp4");
  expect(transcodeExtension("music.wav", "audio", mode)).toBe(".mp3");
  expect(transcodeExtension("photo.heic", "photo", mode)).toBe(".webp");
});

it("preserves supported photo formats only for quality compression", () => {
  expect(transcodeExtension("photo.PNG", "photo", "compress")).toBe(".png");
  expect(transcodeExtension("photo.png", "photo", "reduce")).toBe(".webp");
});
