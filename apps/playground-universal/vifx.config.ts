import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineVifxConfig } from "@vifx/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// One config, one env, two targets (native + web). Both share the define/env
// table from resolveDefines: every EXPO_PUBLIC_* var is inlined as both
// import.meta.env.<k> and process.env.<k> on both sides.
export default defineVifxConfig({
  projectRoot,
  projectType: "expo",
  expo: true,
  reactNative: true,
  platforms: ["ios", "android"],
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
  vite: {
    mode: "expo",
    targets: [
      {
        platform: "ios",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vifx/ios",
        reactNativeCompat: "web",
      },
      {
        platform: "android",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vifx/android",
        reactNativeCompat: "web",
      },
    ],
  },
});
