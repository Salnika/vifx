import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { expo } from "@vifx/vite-plugin-expo";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";

export default defineConfig({
  plugins: [
    expo({
      entry: "./index.js",
      platform,
      projectRoot,
      publicEnv: {
        EXPO_PUBLIC_VIFX_PLAYGROUND: process.env.EXPO_PUBLIC_VIFX_PLAYGROUND ?? "expo",
      },
      reactNativeCompat: "web",
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    minify: false,
    outDir: `dist/vite/${platform}`,
    rollupOptions: {
      input: path.join(projectRoot, "index.js"),
      output: {
        assetFileNames: "assets/[name][extname]",
        entryFileNames: "index.bundle",
        format: "es",
      },
    },
    sourcemap: true,
  },
});
