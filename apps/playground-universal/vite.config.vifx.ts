import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { expo } from "@vifx/vite-plugin-expo";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// VIFX_PLATFORM=web resolves react-native -> react-native-web (resolvePlatform
// "web", message.web.ts) and drops the EXPO_OS define, while still inlining the
// SAME EXPO_PUBLIC_* env as both import.meta.env.<k> and process.env.<k>. With
// VIFX_PLATFORM=ios it resolves the native files (message.ios.ts) and adds
// EXPO_OS. The define/env table comes from a single resolveDefines source for
// both sides.
const isWeb = process.env.VIFX_PLATFORM === "web";
const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";

export default defineConfig({
  plugins: [
    expo({
      entry: "./index.js",
      platform,
      projectRoot,
      reactNativeCompat: "web",
      resolvePlatform: isWeb ? "web" : platform,
      publicEnv: {
        EXPO_PUBLIC_VIFX_DEMO: process.env.EXPO_PUBLIC_VIFX_DEMO ?? "hello",
      },
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    minify: false,
    outDir: `dist/vite/${isWeb ? "web" : platform}`,
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
