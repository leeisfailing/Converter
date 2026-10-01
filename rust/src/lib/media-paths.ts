/** Split only the filename extension, preserving dotted directories on either OS. */
export function splitMediaPath(path: string): { base: string; extension: string } {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > separator + 1;
  return {
    base: hasExtension ? path.slice(0, dot) : path,
    extension: hasExtension ? path.slice(dot).toLowerCase() : "",
  };
}

export function transcodeExtension(
  path: string,
  fileType: "video" | "photo" | "audio",
  mode: "compress" | "reduce",
): string {
  if (fileType === "video") return ".mp4";
  if (fileType === "audio") return ".mp3";
  const { extension } = splitMediaPath(path);
  return mode === "compress" && [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
    ? extension : ".webp";
}
