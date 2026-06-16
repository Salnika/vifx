import type { Plugin } from "vite";

/**
 * Plugin 1 of 3 — a classic **virtual module** plugin (`resolveId` + `load`).
 *
 * The app imports `virtual:vifx-example`, a module that exists only in memory:
 * there is no file on disk. `resolveId` claims the specifier (returning the
 * conventional `\0`-prefixed id so other plugins leave it alone), and `load`
 * synthesizes its source. The synthesized source exports a unique sentinel
 * string, so finding that sentinel in the built native bundle proves the plugin
 * ran end-to-end through vifx's Rolldown pipeline.
 *
 * This is the same shape as `@rollup/plugin-virtual`, vite's `virtual:` modules,
 * or `unplugin`-based plugins.
 */

const VIRTUAL_ID = "virtual:vifx-example";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

// Unique enough to grep for unambiguously in the minified bundle.
export const VIRTUAL_SENTINEL = "VIFX_VIRTUAL_MODULE_SENTINEL_8f3a2c1d";

export function virtualModulePlugin(): Plugin {
  return {
    name: "example:virtual-module",
    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export const virtualGreeting = ${JSON.stringify(VIRTUAL_SENTINEL)};\n`;
      }
      return null;
    },
  };
}
