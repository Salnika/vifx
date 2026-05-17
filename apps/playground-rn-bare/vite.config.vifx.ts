import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { reactNative } from "@vifx/vite-plugin-react-native";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";

export default defineConfig({
  plugins: [
    reactNative({
      entry: "./index.js",
      platform,
      projectRoot,
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
