import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { expo } from "@vifx/vite-plugin-expo";
import { buildStampPlugin } from "./plugins/build-stamp.ts";
import { virtualModulePlugin } from "./plugins/virtual-module.ts";
import { yamlPlugin } from "./plugins/yaml.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";

// vifx auto-loads this file through @vifx/vite-config-bridge and APPENDS the
// user plugins below AFTER its own plugins (so vifx keeps resolveId priority for
// .ios/.native/asset resolution). That is what lets ordinary Vite/Rollup
// plugins transform a React Native bundle.
//
// We deliberately declare ONLY `plugins` here. vifx owns `build`,
// `resolve.conditions`, `define`, etc. and re-imposes them after the merge, so
// putting a `build` block here would just earn a "reserved key ignored" warning.
// Keeping the config plugins-only is what makes a `vifx build` /
// `vifx export:embed` run produce zero VIFX_USER_VITE_CONFIG_CONFLICT warnings.
//
// The `expo()` plugin is listed first; the bridge dedupes it (it strips plugins
// whose name starts with `vifx`) so it is never double-registered when vifx
// loads this file during `vifx build` / `vifx export:embed`. It also documents
// the platform/entry the user plugins below run against.
export default defineConfig({
  plugins: [
    expo({
      entry: "./index.js",
      platform,
      projectRoot,
      reactNativeCompat: "web",
    }),
    // --- user plugins: these are the point of this example ---
    virtualModulePlugin(),
    buildStampPlugin(),
    yamlPlugin(),
  ],
});
