import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineVifxConfig } from "@vifx/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineVifxConfig({
  projectRoot,
  projectType: "react-native",
  reactNative: true,
  platforms: ["ios", "android"],
  vite: {
    mode: "react-native",
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
