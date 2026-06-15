import { VifxError } from "@vifx/errors";
import type {
  VifxBundleMode,
  VifxBundlePlatform,
  VifxModuleFormat,
  VifxPlatform,
} from "@vifx/types";

export interface VifxResolveBundleModeOptions {
  mode?: VifxBundleMode;
}

export interface VifxResolveDefinesOptions {
  mode: VifxBundleMode;
  platform: VifxBundlePlatform;
  resolvePlatform: VifxPlatform;
  /**
   * Public env vars to inline (e.g. `EXPO_PUBLIC_*`). Reserved for the
   * native+web workstream; {@link resolveDefines} ignores them today, so the
   * define table is unchanged when they are absent.
   */
  publicEnv?: Record<string, string>;
  publicEnvPrefix?: string;
}

/**
 * Define keys vifx imposes on every build, mirroring {@link resolveDefines}.
 * Exposed so the plugin workstream can detect (and warn about) a user Vite
 * config that would override them. Read-only contract; not consumed here.
 */
export const VIFX_IMPOSED_DEFINE_KEYS = [
  "__DEV__",
  "global",
  "process.env.NODE_ENV",
  "process.env.EXPO_OS",
] as const;

/**
 * `resolve.*` keys vifx imposes (platform `conditions` + `dedupe`). Exposed so
 * the plugin workstream can guard against a user config that would break
 * `.ios`/`.native` resolution. Read-only contract; not consumed here.
 */
export const VIFX_IMPOSED_RESOLVE_KEYS = ["conditions", "dedupe"] as const;

export interface VifxResolveOutputOptionsOptions {
  mode: VifxBundleMode;
  moduleFormat: VifxModuleFormat;
  platform: VifxPlatform;
}

export interface VifxResolvedOutputOptions {
  entryFileNames?: string;
  format: "es" | "iife";
  inlineDynamicImports?: boolean;
  name?: string;
}

/**
 * Resolves the effective bundle mode for a build. Development stays the
 * default so existing dev-server and test flows keep their semantics.
 */
export function resolveBundleMode(options: VifxResolveBundleModeOptions): VifxBundleMode {
  return options.mode ?? "development";
}

/**
 * Resolves the compile-time define table for a bundle.
 *
 * `__DEV__` and `process.env.NODE_ENV` follow the bundle mode, never the
 * platform: native bundles previously hard-coded `__DEV__` to true and web
 * bundles to false, which made production native builds impossible. As a
 * deliberate consequence, the web runtime preview (a dev-only browser surface
 * with no production build path) now follows the resolved mode too, so it
 * defaults to `__DEV__: true` / `NODE_ENV: "development"` instead of the old
 * hard-coded production flavor.
 * `process.env.EXPO_OS` is only injected for native resolution so the web
 * define table keeps its existing shape (web detects the platform through
 * `Platform.OS`, and never carried an `EXPO_OS` define).
 */
export function resolveDefines(options: VifxResolveDefinesOptions): Record<string, string> {
  const defines: Record<string, string> = {
    __DEV__: String(options.mode !== "production"),
    global: "globalThis",
    "process.env.NODE_ENV": JSON.stringify(options.mode),
  };

  if (options.resolvePlatform !== "web") {
    defines["process.env.EXPO_OS"] = JSON.stringify(options.platform);
  }

  return defines;
}

/**
 * Resolves the Rollup output options for a bundle target.
 *
 * Native bundles are emitted as a single IIFE script: Hermes and JSC evaluate
 * `index.bundle` in a script (non-module) context, so ESM `import`/`export`
 * statements and `import.meta` must never reach the emitted bundle. Web
 * bundles stay ESM because the browser runtime loads them with `import()`.
 *
 * Only the "hoisted" module format is implemented here. The "metro" module
 * format (Metro-graph compatible serialization) is a separate unit of work
 * and intentionally rejects with a stable error code until it lands.
 */
export function resolveOutputOptions(
  options: VifxResolveOutputOptionsOptions,
): VifxResolvedOutputOptions {
  if (options.platform === "web") {
    return {
      format: "es",
    };
  }

  if (options.moduleFormat === "metro") {
    throw new VifxError({
      code: "VIFX_MODULE_FORMAT_UNSUPPORTED",
      message: 'The "metro" module format is not implemented yet.',
      hint: 'Use moduleFormat: "hoisted" (the default) until Metro-graph serialization ships.',
      docsPath: "/reference/config#vite-targets",
    });
  }

  return {
    entryFileNames: "index.bundle",
    format: "iife",
    inlineDynamicImports: true,
    name: "__vifx",
  };
}

/**
 * Resolves the Vite `build.minify` setting for a bundle mode. Production
 * bundles are minified with the Oxc minifier built into this Vite/Rolldown
 * toolchain, which also composes the minified source map natively.
 */
export function resolveBuildMinify(mode: VifxBundleMode): "oxc" | false {
  return mode === "production" ? "oxc" : false;
}
