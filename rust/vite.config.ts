import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/src-tauri/**",
        "**/*.dll",
        "**/*.exe",
        "**/*.pdb",
      ],
    },
  },
  // Signing secrets also use TAURI_; only expose the CLI's public build metadata.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari16",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    cssCodeSplit: true,
  },
});
