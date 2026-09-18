#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = join(import.meta.dirname, "..");
const SRC_TAURI = join(ROOT, "src-tauri");
const RELEASE = join(SRC_TAURI, "target", "release");
const DIST = join(ROOT, "dist", "portable");
const ENGINE_SRC = join(ROOT, "..", "PyEngine");
const ENGINE_DST = join(DIST, "PyEngine");

console.log("Creating portable build...\n");

if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

cpSync(join(RELEASE, "converter.exe"), join(DIST, "converter.exe"));
console.log("  converter.exe");

for (const name of ["ffmpeg", "ffprobe"]) {
  const suffixed = join(RELEASE, `${name}-x86_64-pc-windows-msvc.exe`);
  const plain = join(RELEASE, `${name}.exe`);
  const src = existsSync(plain) ? plain : suffixed;
  if (existsSync(src)) {
    const dstName = `${name}.exe`;
    cpSync(src, join(DIST, dstName));
    console.log(`  ${dstName}`);
  } else {
    console.warn(`  WARNING: ${name} sidecar not found`);
  }
}

for (const item of ["__init__.py", "__main__.py"]) {
  const src = join(ENGINE_SRC, item);
  if (existsSync(src)) cpSync(src, join(ENGINE_DST, item));
}
for (const dir of ["core", "handlers", "workers", "formats"]) {
  const src = join(ENGINE_SRC, dir);
  if (existsSync(src)) cpSync(src, join(ENGINE_DST, dir), { recursive: true });
}
console.log("  PyEngine scripts");

const pythonSrc = join(SRC_TAURI, "bin", "python");
const pythonDst = join(ENGINE_DST, "bin", "python");
if (existsSync(pythonSrc)) {
  cpSync(pythonSrc, pythonDst, { recursive: true });
  console.log("  Python runtime");
}

const pluginsSrc = join(SRC_TAURI, "bin", "plugins");
if (existsSync(pluginsSrc)) {
  cpSync(pluginsSrc, join(ENGINE_DST, "bin", "plugins"), { recursive: true });
  console.log("  VapourSynth plugins");
}

const zipPath = join(ROOT, "dist", "Converter-portable.zip");
try {
  if (existsSync(zipPath)) rmSync(zipPath);
  execSync(
    `tar -a -cf "${zipPath}" -C "${DIST}" .`,
    { stdio: "inherit" },
  );
  console.log(`\nPortable build: ${zipPath}`);
} catch {
  console.log(`\nPortable build directory: ${DIST}`);
  console.log("(zip creation skipped - zip the folder manually)");
}
