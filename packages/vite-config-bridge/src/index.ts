import { access } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import type { VifxDiagnosticData, VifxPlatform } from "@vifx/types";
import {
  type ConfigEnv,
  type InlineConfig,
  loadConfigFromFile,
  mergeConfig,
  type Plugin,
  type UserConfig,
} from "vite";

/**
 * `@vifx/vite-config-bridge` — load & merge a user's `vite.config.vifx.ts` into
 * every vifx build/dev call-site.
 *
 * vifx generates `vite.config.vifx.ts` (via `vifx vite init`) but historically
 * never loaded it. This package is the bridge: it loads that file with Vite's
 * own `loadConfigFromFile`, merges the *user-owned* slices into the vifx inline
 * config, and re-imposes the keys vifx must own for `.ios`/`.native`/asset
 * resolution and Fast Refresh serialization to stay correct.
 *
 * Two invariants make this the single biggest structural differentiator vs
 * Metro AND keep it safe:
 *   1. vifx plugins run *physically first* (the `resolveId` order between two
 *      `enforce: "pre"` plugins is NOT guaranteed by the Vite/Rolldown
 *      contract), so a user plugin can never silently shadow `.ios`/`.native`.
 *   2. RESERVED keys are *re-overwritten* after `mergeConfig` — `mergeConfig`
 *      concatenates arrays and deep-merges objects, so `resolve.conditions`,
 *      `resolve.dedupe`, `define`, and (on the metro path) the entire
 *      `build.rollupOptions.output` would otherwise be polluted by user values.
 */

/** File names `vifx vite init` may emit, in resolution priority order. */
export const VIFX_VITE_CONFIG_FILE_NAMES = [
  "vite.config.vifx.ts",
  "vite.config.vifx.mts",
  "vite.config.vifx.js",
  "vite.config.vifx.mjs",
] as const;

/** Plugins whose `name` starts with this prefix are vifx's own. */
const VIFX_PLUGIN_NAME_PREFIX = "vifx";

/**
 * `resolve.*` sub-keys vifx must own on every build. A user override here would
 * break platform-extension (`.ios`/`.native`) resolution or pull in a second
 * copy of React/React Native, so they are re-imposed after the merge.
 */
const RESERVED_RESOLVE_KEYS = ["conditions", "dedupe"] as const;

/**
 * `resolve.alias` entries that vifx must own: a user aliasing these would
 * reroute the entire React Native runtime (e.g. to react-native-web) or the
 * asset registry, breaking the native bundle. Unlike `resolve.conditions`,
 * `alias` is otherwise a legitimate user key, so only these specific entries are
 * stripped (the rest of the user's alias map survives). Vite resolves
 * `resolve.alias` through its own pre-enforced alias plugin, which can win the
 * race against vifx's `resolveId`, so a warning alone is not enough — the
 * colliding entries are physically removed.
 */
const VIFX_OWNED_ALIAS_KEYS = [
  "react-native",
  "react-native/Libraries/Image/AssetRegistry",
] as const;

/**
 * The vifx-owned `define` keys. The native+web workstream owns their *values*;
 * this package only guards their *non-overridability*. Mirrors
 * `@vifx/vite-plugin-react-native`'s `VIFX_IMPOSED_DEFINE_KEYS` (read-only
 * contract; duplicated as a literal to avoid a dependency cycle through the
 * plugin package).
 */
const RESERVED_DEFINE_KEYS = [
  "__DEV__",
  "global",
  "process.env.NODE_ENV",
  "process.env.EXPO_OS",
] as const;

/**
 * Top-level Vite keys vifx fully owns and a user config must never set. These
 * shape the bundle output contract (script-vs-ESM, single-file IIFE, the metro
 * staging CJS layout) and the build root/entry; a user override would silently
 * corrupt the emitted bundle.
 */
const ALWAYS_RESERVED_TOP_LEVEL_KEYS = [
  "appType",
  "build",
  "configFile",
  "envFile",
  "publicDir",
  "root",
] as const;

export interface VifxReservedViteKeys {
  /** Fully-owned top-level keys (dropped from the user config entirely). */
  topLevel: readonly string[];
  /** `resolve.*` sub-keys re-imposed from the vifx config after merge. */
  resolve: readonly string[];
  /** `define` keys re-imposed from the vifx config after merge. */
  define: readonly string[];
}

/**
 * Computes the reserved-key set for a build. The set is conditional on the
 * resolution platform: `optimizeDeps` and `server.*` are legitimate on the
 * *web* dev server (the browser preview / `startExpoDevServer` path), but on a
 * *native* build they would reroute resolution through a pre-bundle pass that
 * doesn't understand `.ios`/`.native`, so they are reserved there.
 */
export function reservedViteKeys(resolvePlatform: VifxPlatform): VifxReservedViteKeys {
  const topLevel: string[] = [...ALWAYS_RESERVED_TOP_LEVEL_KEYS];
  if (resolvePlatform !== "web") {
    topLevel.push("optimizeDeps", "server");
  }
  return {
    topLevel,
    resolve: [...RESERVED_RESOLVE_KEYS],
    define: [...RESERVED_DEFINE_KEYS],
  };
}

/**
 * Vite keys a user config is allowed to contribute. Anything outside this set
 * is either reserved (re-imposed/dropped) or merged verbatim only when it does
 * not collide with a reserved key. Exposed for tests and tooling.
 */
export function allowedViteKeys(resolvePlatform: VifxPlatform): readonly string[] {
  const allowed = ["css", "define", "esbuild", "json", "plugins", "resolve", "worker"];
  if (resolvePlatform === "web") {
    allowed.push("optimizeDeps", "server");
  }
  return allowed;
}

export interface LoadUserViteConfigOptions {
  /** Absolute project root the user config is resolved against. */
  projectRoot: string;
  /**
   * Explicit user-config path, or `false` to opt out entirely. When omitted,
   * the known `vite.config.vifx.*` file names are auto-detected under
   * `projectRoot`. A non-existent explicit path is treated as "absent"
   * (returns `null`), preserving the historic no-user-config behavior.
   */
  configFile?: string | false;
  /** Vite command (`build` for one-shot bundles, `serve` for dev servers). */
  command: ConfigEnv["command"];
  /** Vite mode (`development` / `production`). */
  mode: string;
}

export interface LoadedUserViteConfig {
  /** Absolute path the config was loaded from. */
  path: string;
  /** The raw user config object returned by `loadConfigFromFile`. */
  config: UserConfig;
}

/**
 * Loads the user's `vite.config.vifx.*` using Vite's own loader.
 *
 * Returns `null` when there is no user config (opted out via `false`, an
 * explicit-but-missing path, or none auto-detected), so callers fall back to
 * the exact historic behavior with zero user-config influence.
 */
export async function loadUserViteConfig(
  options: LoadUserViteConfigOptions,
): Promise<LoadedUserViteConfig | null> {
  if (options.configFile === false) {
    return null;
  }

  let configFile: string | undefined;
  if (typeof options.configFile === "string") {
    configFile = path.resolve(options.projectRoot, options.configFile);
    if (!(await fileExists(configFile))) {
      return null;
    }
  } else {
    configFile = await autodetectUserConfigFile(options.projectRoot);
    if (configFile === undefined) {
      return null;
    }
  }

  let loaded: Awaited<ReturnType<typeof loadConfigFromFile>>;
  try {
    loaded = await loadConfigFromFile(
      { command: options.command, mode: options.mode },
      configFile,
      options.projectRoot,
      // Keep the user-config load quiet; conflict warnings are surfaced
      // separately via `detectNativeResolutionConflicts` so they respect the
      // vifx logger's level.
      "silent",
    );
  } catch (error) {
    throw new VifxError({
      code: "VIFX_USER_VITE_CONFIG_CONFLICT",
      message: `Failed to load the user Vite config at ${configFile}.`,
      hint: "Fix the syntax/exports of your vite.config.vifx.* file, or set vite.userConfigFile: false to opt out.",
      docsPath: "/guide/vite-config",
      cause: error,
    });
  }

  if (loaded === null) {
    return null;
  }

  return { path: loaded.path, config: loaded.config };
}

async function autodetectUserConfigFile(projectRoot: string): Promise<string | undefined> {
  for (const fileName of VIFX_VITE_CONFIG_FILE_NAMES) {
    const candidate = path.resolve(projectRoot, fileName);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface PreparedUserViteConfig {
  /** The loaded user config, or `null` when there is none. */
  userResult: LoadedUserViteConfig | null;
  /** Native-resolution conflict diagnostics, already collected for the caller. */
  diagnostics: VifxDiagnosticData[];
}

export interface PrepareUserViteConfigOptions extends LoadUserViteConfigOptions {
  /** Resolution platform of the build (drives reserved keys + conflict checks). */
  resolvePlatform: VifxPlatform;
}

/**
 * One-shot helper for build/dev call-sites: loads the user config and collects
 * the native-resolution conflict diagnostics in a single call, so each call-site
 * does not repeat the load + detect plumbing.
 *
 * Returns `{ userResult: null, diagnostics: [] }` when there is no user config,
 * so callers stay on the exact historic (no-user-config) path.
 */
export async function prepareUserViteConfig(
  options: PrepareUserViteConfigOptions,
): Promise<PreparedUserViteConfig> {
  const userResult = await loadUserViteConfig(options);
  if (userResult === null) {
    return { userResult: null, diagnostics: [] };
  }
  return {
    userResult,
    diagnostics: detectNativeResolutionConflicts(userResult, options.resolvePlatform),
  };
}

export interface MergeWithVifxContext {
  /**
   * Resolution platform of the build. Drives which keys are reserved
   * (`optimizeDeps`/`server.*` are allowed on the web dev server only).
   */
  resolvePlatform: VifxPlatform;
  /**
   * Non-fatal conflict reporter. Defaults to a no-op so the merge respects a
   * `logLevel: "silent"` caller; the plugin layer wires this to `@vifx/logger`.
   */
  warn?: (diagnostic: VifxDiagnosticData) => void;
}

/**
 * Merges the user config slices into the vifx inline config, then re-imposes
 * every reserved key so vifx always wins.
 *
 * The merge order is deliberate: vifx is the *base* and the user config is the
 * *override* for the allowed keys (so e.g. user `define` entries layer on top),
 * but the reserved `resolve.conditions/dedupe` and `define` keys are copied
 * back from the vifx config afterwards because `mergeConfig` concatenates
 * arrays and deep-merges objects rather than letting vifx win. User plugins are
 * appended *after* vifx's (which the caller has already placed first in
 * `vifxInline.plugins`), so vifx keeps `resolveId` priority.
 */
export function mergeWithVifx(
  userResult: LoadedUserViteConfig | null,
  vifxInline: InlineConfig,
  context: MergeWithVifxContext,
): InlineConfig {
  if (userResult === null) {
    return vifxInline;
  }

  const warn = context.warn ?? (() => {});
  const reserved = reservedViteKeys(context.resolvePlatform);

  // Extract the user's own (non-vifx) plugins so the generated template's
  // `expo()`/`reactNative()` plugin instance is never duplicated.
  const userPlugins = extractUserPlugins(userResult.config);

  // Strip everything we own or do not allow from the user config before the
  // merge, warning on each dropped reserved/unknown key so the user is not
  // silently ignored.
  const userOverrides = pruneUserConfig(userResult.config, reserved, warn);

  // vifx is the base; allowed user keys override. We re-attach plugins
  // ourselves so vifx stays physically first.
  const vifxPlugins = toPluginArray(vifxInline.plugins);
  const merged = mergeConfig(
    { ...vifxInline, plugins: undefined } as Record<string, unknown>,
    userOverrides as Record<string, unknown>,
  ) as InlineConfig;

  merged.plugins = [...vifxPlugins, ...userPlugins];

  // Re-impose reserved resolve.* and define keys: mergeConfig concatenated /
  // deep-merged them, so copy the vifx values back verbatim.
  reimposeReservedKeys(merged, vifxInline, reserved);

  return merged;
}

export interface MetroStagingUserSlices {
  /** User plugins to append after vifx's (single injection seam). */
  userPlugins: Plugin[];
  /** Filtered, reserved-key-free `resolve` to merge into the staging config. */
  resolve?: UserConfig["resolve"];
  /** Filtered, reserved-key-free `define` to merge into the staging config. */
  define?: UserConfig["define"];
}

/**
 * Extracts only the user slices that are safe to inject into the metro staging
 * build: plugins, and the non-reserved parts of `resolve`/`define`.
 *
 * The metro staging build's `build.rollupOptions.output` (`format: "cjs"`,
 * `preserveModules: true`, `exports: "named"`, `preserveModulesRoot`) is the
 * Fast Refresh serialization contract — a user touching it would silently break
 * the `__d`/`__r` factory layout. So the metro path must NEVER `mergeConfig`
 * the whole staging config; it pulls these narrow slices instead.
 */
export function extractMetroStagingUserSlices(
  userResult: LoadedUserViteConfig | null,
  context: MergeWithVifxContext,
): MetroStagingUserSlices | null {
  if (userResult === null) {
    return null;
  }

  const warn = context.warn ?? (() => {});
  const reserved = reservedViteKeys(context.resolvePlatform);
  const userPlugins = extractUserPlugins(userResult.config);
  const pruned = pruneUserConfig(userResult.config, reserved, warn);

  const slices: MetroStagingUserSlices = { userPlugins };
  if (pruned.resolve !== undefined) {
    slices.resolve = pruned.resolve;
  }
  if (pruned.define !== undefined) {
    slices.define = pruned.define;
  }
  return slices;
}

/**
 * Detects user-config shapes that would silently break vifx's native
 * resolution and returns a diagnostic per finding. vifx still wins (it is
 * physically first / re-imposes reserved keys), so these are *warnings*, not
 * errors — but the user should know their override was neutralized.
 */
export function detectNativeResolutionConflicts(
  userResult: LoadedUserViteConfig | null,
  resolvePlatform: VifxPlatform,
): VifxDiagnosticData[] {
  if (userResult === null) {
    return [];
  }

  const diagnostics: VifxDiagnosticData[] = [];
  const config = userResult.config;

  // 1. A `react-native` alias would reroute the entire RN runtime (e.g. to
  // react-native-web), breaking the native bundle.
  const aliasNames = collectAliasKeys(config.resolve?.alias);
  for (const name of ["react-native", "react-native/Libraries/Image/AssetRegistry"]) {
    if (aliasNames.has(name)) {
      diagnostics.push({
        code: "VIFX_USER_VITE_CONFIG_CONFLICT",
        message: `User Vite config aliases "${name}", which vifx must own for native resolution.`,
        hint: "Remove this alias from vite.config.vifx.*; vifx resolves react-native and the AssetRegistry itself.",
        docsPath: "/guide/vite-config",
        details: { alias: name },
      });
    }
  }

  // 2. `optimizeDeps.include` pre-bundles deps through esbuild, which does not
  // honor `.ios`/`.native` platform extensions — only flagged for native.
  if (resolvePlatform !== "web") {
    const include = config.optimizeDeps?.include;
    if (Array.isArray(include) && include.length > 0) {
      diagnostics.push({
        code: "VIFX_USER_VITE_CONFIG_CONFLICT",
        message:
          "User Vite config sets optimizeDeps.include, which is ignored on native builds (it cannot resolve .ios/.native extensions).",
        hint: "optimizeDeps only applies to the web dev server; drop it for native targets.",
        docsPath: "/guide/vite-config",
        details: { include },
      });
    }
  }

  // 3. A user `enforce: "pre"` plugin that implements `resolveId` can race vifx
  // for resolution. vifx is physically first so it still wins, but the order is
  // not contractually guaranteed between same-enforce plugins, so warn.
  for (const plugin of extractUserPlugins(config)) {
    if (plugin.enforce === "pre" && plugin.resolveId !== undefined) {
      diagnostics.push({
        code: "VIFX_USER_VITE_CONFIG_CONFLICT",
        message: `User plugin "${plugin.name ?? "<anonymous>"}" declares enforce: "pre" with a resolveId hook; vifx runs first but the order is not guaranteed by Vite.`,
        hint: "Avoid resolving react-native / platform files in a pre-enforced user plugin.",
        docsPath: "/guide/vite-config",
        details: { plugin: plugin.name ?? "<anonymous>" },
      });
    }
  }

  return diagnostics;
}

// --- internals ---------------------------------------------------------------

function reimposeReservedKeys(
  target: InlineConfig,
  vifxInline: InlineConfig,
  reserved: VifxReservedViteKeys,
): void {
  // Re-impose resolve.conditions / resolve.dedupe verbatim from vifx.
  const vifxResolve = vifxInline.resolve as Record<string, unknown> | undefined;
  if (target.resolve !== undefined || vifxResolve !== undefined) {
    const resolve = (target.resolve ?? {}) as Record<string, unknown>;
    for (const key of reserved.resolve) {
      if (vifxResolve !== undefined && key in vifxResolve) {
        resolve[key] = vifxResolve[key];
      } else {
        delete resolve[key];
      }
    }
    target.resolve = resolve as InlineConfig["resolve"];
  }

  // Re-impose vifx define keys verbatim.
  const vifxDefine = vifxInline.define as Record<string, unknown> | undefined;
  if (target.define !== undefined || vifxDefine !== undefined) {
    const define = (target.define ?? {}) as Record<string, unknown>;
    for (const key of reserved.define) {
      if (vifxDefine !== undefined && key in vifxDefine) {
        define[key] = vifxDefine[key];
      } else {
        delete define[key];
      }
    }
    target.define = define;
  }

  // Drop fully-owned top-level keys outright (vifx values already live on the
  // base inline config, so deleting the merged copy restores them).
  for (const key of reserved.topLevel) {
    if (key in vifxInline) {
      (target as Record<string, unknown>)[key] = (vifxInline as Record<string, unknown>)[key];
    } else {
      delete (target as Record<string, unknown>)[key];
    }
  }
}

/**
 * Returns a shallow clone of the user config with reserved/unknown keys
 * removed, plugins stripped (re-attached by the caller), and the reserved
 * sub-keys of `resolve`/`define` filtered out. Warns on every dropped key.
 */
function pruneUserConfig(
  config: UserConfig,
  reserved: VifxReservedViteKeys,
  warn: (diagnostic: VifxDiagnosticData) => void,
): UserConfig {
  const result: Record<string, unknown> = {};
  const reservedTopLevel = new Set(reserved.topLevel);

  for (const [key, value] of Object.entries(config)) {
    if (key === "plugins") {
      // Handled separately by extractUserPlugins; never merge raw plugins.
      continue;
    }
    if (reservedTopLevel.has(key)) {
      warn({
        code: "VIFX_USER_VITE_CONFIG_CONFLICT",
        message: `User Vite config sets reserved key "${key}", which vifx owns; it is ignored.`,
        hint: `Remove "${key}" from vite.config.vifx.*; vifx controls it for correct native output.`,
        docsPath: "/guide/vite-config",
        details: { key },
      });
      continue;
    }
    result[key] = value;
  }

  // Filter reserved sub-keys out of resolve / define so the merge can't
  // concatenate them in (they are re-imposed afterwards regardless, but
  // filtering here keeps the intermediate merge clean and the warning honest).
  if (result.resolve !== undefined && isPlainObject(result.resolve)) {
    const resolve = { ...(result.resolve as Record<string, unknown>) };
    for (const key of reserved.resolve) {
      if (key in resolve) {
        warn({
          code: "VIFX_USER_VITE_CONFIG_CONFLICT",
          message: `User Vite config sets resolve.${key}, which vifx owns for platform resolution; it is ignored.`,
          hint: `Remove resolve.${key} from vite.config.vifx.*.`,
          docsPath: "/guide/vite-config",
          details: { key: `resolve.${key}` },
        });
        delete resolve[key];
      }
    }
    // Strip the vifx-owned alias entries (react-native / AssetRegistry). Vite's
    // own alias plugin is pre-enforced and can resolve these before vifx's
    // `resolveId`, so they must be physically removed, not merely warned about.
    // The warning is emitted separately by `detectNativeResolutionConflicts`
    // (run per call-site), so the strip itself is silent to avoid a duplicate.
    if (resolve.alias !== undefined) {
      resolve.alias = stripVifxOwnedAliases(resolve.alias);
    }
    result.resolve = resolve;
  }

  if (result.define !== undefined && isPlainObject(result.define)) {
    const define = { ...(result.define as Record<string, unknown>) };
    for (const key of reserved.define) {
      if (key in define) {
        warn({
          code: "VIFX_USER_VITE_CONFIG_CONFLICT",
          message: `User Vite config sets define["${key}"], which vifx owns; it is ignored.`,
          hint: `Remove define["${key}"] from vite.config.vifx.*.`,
          docsPath: "/guide/vite-config",
          details: { key: `define.${key}` },
        });
        delete define[key];
      }
    }
    result.define = define;
  }

  return result as UserConfig;
}

/**
 * Flattens a user config's `plugins` (which may be nested arrays / falsy
 * entries) and drops vifx's own plugins so the generated template's
 * `expo()`/`reactNative()` instance is never re-injected.
 */
function extractUserPlugins(config: UserConfig): Plugin[] {
  return flattenPlugins(config.plugins).filter((plugin) => !isVifxPlugin(plugin));
}

function flattenPlugins(plugins: UserConfig["plugins"]): Plugin[] {
  if (!Array.isArray(plugins)) {
    return [];
  }
  const result: Plugin[] = [];
  for (const entry of plugins) {
    if (Array.isArray(entry)) {
      result.push(...flattenPlugins(entry as UserConfig["plugins"]));
    } else if (isPluginObject(entry)) {
      result.push(entry);
    }
  }
  return result;
}

function isPluginObject(value: unknown): value is Plugin {
  return Boolean(value) && typeof value === "object" && "name" in (value as object);
}

function isVifxPlugin(plugin: Plugin): boolean {
  return (
    typeof plugin.name === "string" &&
    (plugin.name === VIFX_PLUGIN_NAME_PREFIX ||
      plugin.name.startsWith(`${VIFX_PLUGIN_NAME_PREFIX}:`))
  );
}

function toPluginArray(plugins: InlineConfig["plugins"]): Plugin[] {
  return flattenPlugins(plugins as UserConfig["plugins"]);
}

/**
 * Removes the vifx-owned alias entries (react-native / AssetRegistry) from a
 * user `resolve.alias`, preserving the rest. Handles both the object-map form
 * (`{ "react-native": "..." }`) and the array form
 * (`[{ find: "react-native", replacement: "..." }]`). Silent — the warning is
 * emitted by `detectNativeResolutionConflicts`; this only enforces. Returns the
 * original value untouched when there is nothing to strip.
 */
function stripVifxOwnedAliases(alias: unknown): unknown {
  const owned = new Set<string>(VIFX_OWNED_ALIAS_KEYS);

  if (Array.isArray(alias)) {
    return alias.filter((entry) => {
      const find = (entry as { find?: unknown } | null)?.find;
      return !(typeof find === "string" && owned.has(find));
    });
  }

  if (alias !== null && typeof alias === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(alias)) {
      if (!owned.has(key)) {
        next[key] = value;
      }
    }
    return next;
  }

  return alias;
}

function collectAliasKeys(alias: unknown): Set<string> {
  const names = new Set<string>();
  if (alias === undefined || alias === null) {
    return names;
  }
  if (Array.isArray(alias)) {
    for (const entry of alias) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { find?: unknown }).find === "string"
      ) {
        names.add((entry as { find: string }).find);
      }
    }
    return names;
  }
  if (typeof alias === "object") {
    for (const key of Object.keys(alias)) {
      names.add(key);
    }
  }
  return names;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
