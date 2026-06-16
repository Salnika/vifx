import type { Plugin } from "vite";

/**
 * Plugin 2 of 3 — a **custom `transform`** plugin.
 *
 * The app source contains the literal placeholder token `__VIFX_BUILD_STAMP__`.
 * This plugin's `transform` hook rewrites every occurrence of that token to a
 * unique replacement value as each module passes through the pipeline. Finding
 * the *replacement* (and not the original token) in the built bundle proves the
 * transform ran.
 *
 * This is the same shape as `@rollup/plugin-replace`, banner/footer injectors,
 * or any source-rewriting Babel-replacement plugin — except it runs inside
 * vifx's Vite/Rolldown pipeline, after vifx's own plugins.
 */

const TOKEN = "__VIFX_BUILD_STAMP__";

// Unique replacement value the transform injects in place of the token.
export const BUILD_STAMP_VALUE = "vifx-build-stamp-7b91e4a0";

export function buildStampPlugin(): Plugin {
  return {
    name: "example:build-stamp",
    transform(code, id) {
      // Only touch the app's own source modules, never node_modules / virtual ids.
      if (id.includes("node_modules") || id.startsWith("\0")) {
        return null;
      }
      if (!code.includes(TOKEN)) {
        return null;
      }
      return {
        code: code.split(TOKEN).join(BUILD_STAMP_VALUE),
        // `map: null` tells Rollup we are not providing a precise source map for
        // this rewrite. A real `@rollup/plugin-replace`-style plugin would emit
        // one via magic-string; for this example the token swap is a single
        // literal and the bundle is the proof, so a precise map is not needed.
        map: null,
      };
    },
  };
}
