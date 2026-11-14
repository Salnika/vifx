import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { supportedAssetExtensions } from "@vifx/asset-registry";
import { VIFX_DEFAULT_RESOLVER_EXTENSIONS } from "@vifx/config";
import { VIFX_DOCS_BASE_URL } from "@vifx/errors";
import { readTextFileIfExists } from "./files.ts";

/**
 * Severity buckets for Metro -> Vifx migration findings.
 *
 * - `info`: behaviour Vifx already provides natively; informational only.
 * - `action`: the user should mirror a Metro setting in vifx.config.ts.
 * - `unsupported`: a Metro extension point Vifx does not implement yet.
 */
export type MetroMigrationSeverity = "info" | "action" | "unsupported";

/** Origin filename used for the relative `metro.config.js` discovery. */
export type MetroConfigFilename = "metro.config.js" | "metro.config.cjs" | "metro.config.mjs";

/**
 * How the config was read.
 *
 * - `evaluated`: the config module was successfully imported/required and its
 *   resolved object inspected.
 * - `static`: evaluation failed; findings come from regex/heuristics over the
 *   raw source text (conservative — see {@link analyzeMetroConfigSource}).
 * - `none`: no config file was discovered.
 */
export type MetroConfigExtractionMode = "evaluated" | "static" | "none";

/**
 * The defaults an evaluated config is compared with, so that only the
 * project's own changes are reported.
 *
 * - `expo`: `getDefaultConfig` from the project's `expo/metro-config`.
 * - `react-native`: `getDefaultConfig` from `@react-native/metro-config`.
 * - `metro`: a built-in copy of Metro's defaults (no framework config found).
 */
export type MetroConfigBaseline = "expo" | "react-native" | "metro";

/** A single actionable migration hint mapped from a Metro config field. */
export interface MetroMigrationHint {
  /** Where the finding came from, e.g. `metro.config.js:resolver.assetExts`. */
  source: string;
  /** Human-readable guidance for the migration. */
  suggestion: string;
  /** The vifx.config.ts key that mirrors the Metro setting, when one exists. */
  vifxConfigKey?: string;
  /** Severity bucket for ordering and presentation. */
  severity: MetroMigrationSeverity;
  /** `vifx doctor --fix` can write this setting into vifx.config.ts. */
  fixable?: boolean;
}

/** A Metro feature with no Vifx equivalent yet, carrying a Vifx error code. */
export interface MetroUnsupportedFeature {
  /** Where the finding came from, e.g. `metro.config.js:serializer`. */
  source: string;
  /**
   * Stable Vifx error code (see `@vifx/errors`). `resolver.resolveRequest` is no
   * longer here: it is supported via `vite.config.vifx.ts` and surfaced as an
   * actionable migration hint instead (see {@link buildResolveRequestHint}).
   */
  code: "VIFX_UNSUPPORTED_METRO_SERIALIZER";
  /** Human-readable explanation of why the feature is unsupported. */
  suggestion: string;
}

/** The settings `vifx doctor --fix` can write into vifx.config.ts. */
export interface MetroConfigFixes {
  /** Source extensions to add to `resolver.extensions`. */
  sourceExtensions: string[];
  /** Asset extensions to add to `resolver.assetExtensions`. */
  assetExtensions: string[];
  /** Module aliases to add to every `vite.targets` entry, by module name. */
  aliases: Record<string, string>;
}

/** Result of analyzing a project's Metro config for migration to Vifx. */
export interface MetroConfigAnalysis {
  /** Whether a metro config file was discovered at the project root. */
  found: boolean;
  /** Project-root-relative path to the config, when found. */
  path?: string;
  /** How the config was inspected (evaluated, static fallback, or none). */
  extraction: MetroConfigExtractionMode;
  /** The defaults the evaluated config was compared with. */
  baseline: MetroConfigBaseline;
  /** Actionable migration hints. */
  hints: MetroMigrationHint[];
  /** Metro features Vifx does not support yet. */
  unsupported: MetroUnsupportedFeature[];
  /** Settings `vifx doctor --fix` can apply. Empty after a static scan. */
  fixes: MetroConfigFixes;
}

const METRO_CONFIG_FILENAMES: readonly MetroConfigFilename[] = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
];

/**
 * Metro's own default `assetExts` and `sourceExts`, used when the project's
 * framework config (`expo/metro-config`, `@react-native/metro-config`) cannot
 * be built. Close enough to `metro-config`'s defaults for migration guidance:
 * only the delta is reported.
 */
const METRO_DEFAULT_ASSET_EXTS = new Set<string>([
  "bmp",
  "gif",
  "jpg",
  "jpeg",
  "png",
  "psd",
  "svg",
  "webp",
  "m4v",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
  "aac",
  "aiff",
  "caf",
  "m4a",
  "mp3",
  "wav",
  "html",
  "json",
  "pdf",
  "yaml",
  "yml",
  "otf",
  "ttf",
  "zip",
  "db",
]);

const METRO_DEFAULT_SOURCE_EXTS = new Set<string>(["js", "jsx", "json", "ts", "tsx", "mjs", "cjs"]);

/** What Vifx bundles without any configuration: never worth a hint. */
const VIFX_DEFAULT_ASSET_EXTS = new Set<string>(supportedAssetExtensions);
const VIFX_DEFAULT_SOURCE_EXTS = new Set<string>(VIFX_DEFAULT_RESOLVER_EXTENSIONS);

/** Sentry's Metro integration (`getSentryExpoConfig`, `withSentryConfig`). */
const SENTRY_METRO_CONFIG = /@sentry\/react-native\/metro\b/u;

/** Babel transformers that ship with Expo and React Native: nothing to port. */
const DEFAULT_BABEL_TRANSFORMER =
  /@expo[\\/]metro-config[\\/]build[\\/]babel-transformer|@react-native[\\/]metro-babel-transformer|metro-react-native-babel-transformer/u;

const FRAMEWORK_CONFIGS = [
  { baseline: "expo", specifier: "expo/metro-config" },
  { baseline: "react-native", specifier: "@react-native/metro-config" },
] as const;

interface RawMetroConfig {
  resolver?: {
    assetExts?: unknown;
    sourceExts?: unknown;
    extraNodeModules?: unknown;
    resolveRequest?: unknown;
  };
  transformer?: {
    babelTransformerPath?: unknown;
  };
  serializer?: Record<string, unknown>;
  watchFolders?: unknown;
}

async function findMetroConfig(
  projectRoot: string,
): Promise<{ filename: MetroConfigFilename; absolutePath: string } | null> {
  for (const filename of METRO_CONFIG_FILENAMES) {
    const absolutePath = path.join(projectRoot, filename);
    if ((await readTextFileIfExists(absolutePath)) !== null) {
      return { absolutePath, filename };
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\./u, "").trim().toLowerCase();
}

function formatList(values: string[]): string {
  return values.join(", ");
}

function emptyFixes(): MetroConfigFixes {
  return { aliases: {}, assetExtensions: [], sourceExtensions: [] };
}

/**
 * Whether two config values are the same setting. Functions are compared by
 * source text: `getDefaultConfig` builds new closures on every call.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "function" || typeof right === "function") {
    return (
      typeof left === "function" &&
      typeof right === "function" &&
      Function.prototype.toString.call(left) === Function.prototype.toString.call(right)
    );
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/** The extensions of `values` that are in none of the `excluded` sets. */
function extensionAdditions(values: unknown, ...excluded: ReadonlySet<string>[]): string[] {
  const additions = asStringArray(values)
    .map(normalizeExt)
    .filter((ext) => ext.length > 0 && !excluded.some((set) => set.has(ext)));
  return [...new Set(additions)];
}

/**
 * Attempt to evaluate the Metro config module and return its resolved object.
 *
 * The config's own `require`s (e.g. `expo/metro-config`,
 * `@react-native/metro-config`) resolve against the *target* project's
 * `node_modules`, which sit next to the config file, so evaluation usually
 * succeeds. `getDefaultConfig` and other side effects may still throw, so the
 * caller treats a `null` return as "fall back to static analysis".
 */
async function evaluateMetroConfig(absolutePath: string): Promise<RawMetroConfig | null> {
  try {
    const ext = path.extname(absolutePath);

    if (ext === ".mjs") {
      const imported = (await import(pathToFileURL(absolutePath).href)) as { default?: unknown };
      const resolved: unknown = await Promise.resolve(imported.default ?? imported);
      return isPlainObject(resolved) ? (resolved as RawMetroConfig) : null;
    }

    // `.js`/`.cjs`: most Metro configs are CommonJS. Use a require bound to the
    // config's own path so its relative/bare requires resolve correctly.
    const requireFromConfig = createRequire(absolutePath);
    const resolvedId = requireFromConfig.resolve(absolutePath);
    delete requireFromConfig.cache[resolvedId];
    const required: unknown = requireFromConfig(absolutePath);
    const resolved: unknown = await Promise.resolve(required);
    return isPlainObject(resolved) ? (resolved as RawMetroConfig) : null;
  } catch {
    return null;
  }
}

/** A copy of the compared fields, which a later config evaluation cannot mutate. */
function snapshot(config: RawMetroConfig): RawMetroConfig {
  const extraNodeModules = config.resolver?.extraNodeModules;
  return {
    resolver: {
      assetExts: [...asStringArray(config.resolver?.assetExts)],
      extraNodeModules: isPlainObject(extraNodeModules) ? { ...extraNodeModules } : undefined,
      resolveRequest: config.resolver?.resolveRequest,
      sourceExts: [...asStringArray(config.resolver?.sourceExts)],
    },
    serializer: isPlainObject(config.serializer) ? { ...config.serializer } : undefined,
    transformer: { babelTransformerPath: config.transformer?.babelTransformerPath },
    watchFolders: [...asStringArray(config.watchFolders)],
  };
}

/**
 * Builds the config the project's framework would produce on its own
 * (`getDefaultConfig(projectRoot)`), so that Expo's or React Native's defaults
 * — their asset and source extensions, Babel transformer and serializer — are
 * not reported as customizations. A config that only names
 * `@react-native/metro-config` is compared with React Native's defaults first.
 */
async function loadFrameworkDefaults(
  absolutePath: string,
  projectRoot: string,
  source: string,
): Promise<{ baseline: MetroConfigBaseline; config: RawMetroConfig } | null> {
  const prefersReactNative =
    source.includes("@react-native/metro-config") && !/\bexpo\b/u.test(source);
  const candidates = prefersReactNative ? [...FRAMEWORK_CONFIGS].reverse() : FRAMEWORK_CONFIGS;
  const requireFromConfig = createRequire(absolutePath);

  for (const candidate of candidates) {
    try {
      const framework = requireFromConfig(candidate.specifier) as { getDefaultConfig?: unknown };
      if (typeof framework.getDefaultConfig !== "function") {
        continue;
      }
      const config: unknown = await Promise.resolve(
        (framework.getDefaultConfig as (root: string) => unknown)(projectRoot),
      );
      if (isPlainObject(config)) {
        return { baseline: candidate.baseline, config: snapshot(config as RawMetroConfig) };
      }
    } catch {
      // Not installed or not buildable here: try the next framework.
    }
  }

  return null;
}

/**
 * The vifx.config.ts alias target for a Metro `extraNodeModules` value: an
 * absolute path becomes relative to the project root, as Vifx aliases are.
 */
function toAliasTarget(value: unknown, roots: readonly string[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (!path.isAbsolute(value)) {
    return value;
  }
  // The root as given and its real path (`__dirname` in the config is the real
  // one, as with /var and /private/var on macOS): the shorter relative wins.
  const [relative = ""] = roots
    .map((root) => path.relative(root, value).split(path.sep).join("/"))
    .sort((left, right) => left.length - right.length);
  if (relative.length === 0) {
    return "./";
  }
  return relative.startsWith("../") || relative === ".." ? relative : `./${relative}`;
}

const SVG_TRANSFORMER_DOCS = `${VIFX_DOCS_BASE_URL}/guide/migration#_3-map-your-metro-config-js`;

function buildBabelTransformerHint(
  filename: MetroConfigFilename,
  transformerPath: string,
): MetroMigrationHint {
  if (/react-native-svg-transformer/u.test(transformerPath)) {
    return {
      severity: "action",
      source: `${filename}:transformer.babelTransformerPath`,
      suggestion: `Replace react-native-svg-transformer with a Vite SVG plugin (such as vite-plugin-svgr) in vite.config.vifx.ts. See ${SVG_TRANSFORMER_DOCS}.`,
      vifxConfigKey: "plugins",
    };
  }

  return {
    severity: "action",
    source: `${filename}:transformer.babelTransformerPath`,
    suggestion: `Port the custom Babel transformer (${transformerPath}) to a Vifx/Vite plugin equivalent.`,
    vifxConfigKey: "plugins",
  };
}

const RESOLVE_REQUEST_DOCS = `${VIFX_DOCS_BASE_URL}/guide/migration#resolverequest`;

/**
 * A custom `resolver.resolveRequest` is now supported via a Vite-side hook, so
 * this is an actionable migration hint (port the function to
 * `vite.config.vifx.ts`), not a hard refusal. The function itself cannot ride
 * vifx's serializable config across the `export:embed` subprocess boundary, so
 * its home is the in-process `vite.config.vifx.*`, declared with
 * `vifxResolveRequest(...)` from `@vifx/vite-config-bridge`.
 */
function buildResolveRequestHint(filename: MetroConfigFilename): MetroMigrationHint {
  return {
    severity: "action",
    source: `${filename}:resolver.resolveRequest`,
    suggestion: `Port your custom resolveRequest to vite.config.vifx.ts with vifxResolveRequest(...) (same (context, moduleName, platform) contract, including the recursive context.resolveRequest for delegation). See ${RESOLVE_REQUEST_DOCS}.`,
    vifxConfigKey: "vite.config.vifx.ts",
  };
}

function buildSerializerUnsupported(
  filename: MetroConfigFilename,
  changed: { keys: string[]; sentry: boolean } = { keys: [], sentry: false },
): MetroUnsupportedFeature {
  const settings = changed.keys.length > 0 ? ` (${changed.keys.join(", ")})` : "";

  if (changed.sentry) {
    return {
      code: "VIFX_UNSUPPORTED_METRO_SERIALIZER",
      source: `${filename}:serializer`,
      suggestion: `Sentry's Metro serializer${settings}, from getSentryExpoConfig or withSentryConfig, adds a Debug ID to the bundle. Vifx does not run Metro serializers, so its bundles have none: upload their source maps to Sentry another way, or keep Metro for release builds.`,
    };
  }

  return {
    code: "VIFX_UNSUPPORTED_METRO_SERIALIZER",
    source: `${filename}:serializer`,
    suggestion: `Custom Metro serializer settings${settings} are not implemented in Vifx yet. Keep Metro for serializer-specific workflows for now.`,
  };
}

function buildWatchFoldersHint(filename: MetroConfigFilename): MetroMigrationHint {
  return {
    severity: "info",
    source: `${filename}:watchFolders`,
    suggestion:
      "watchFolders configures monorepo roots. Vifx resolves workspace packages natively, so no manual watchFolders mapping is required.",
  };
}

/** The suggestion of each fixable hint, by vifx.config.ts key. */
const FIX_SUGGESTIONS = {
  "resolver.assetExtensions": (values: string[]) =>
    `Add the asset extensions ${formatList(values)} to resolver.assetExtensions in vifx.config.ts.`,
  "resolver.extensions": (values: string[]) =>
    `Add the source extensions ${formatList(values)} to resolver.extensions in vifx.config.ts.`,
  "vite.targets[].aliases": (values: string[]) =>
    `Add the module aliases ${formatList(values)} to the aliases of each vite.targets entry in vifx.config.ts.`,
} as const;

/** The settings a vifx.config.ts already has, from its loaded (normalized) form. */
export interface CurrentVifxSettings {
  extensions: readonly string[];
  assetExtensions?: readonly string[];
  /** The aliases of each `vite.targets` entry. */
  targetAliases: ReadonlyArray<Readonly<Record<string, string>> | undefined>;
}

/**
 * Drops the fixes, and the parts of their hints, that vifx.config.ts already
 * has: after `vifx doctor --fix`, a second run reports only what is left.
 */
export function pruneAppliedFixes(
  analysis: MetroConfigAnalysis,
  current: CurrentVifxSettings,
): MetroConfigAnalysis {
  const sourceExtensions = analysis.fixes.sourceExtensions.filter(
    (ext) => !current.extensions.includes(ext),
  );
  const assetExtensions = analysis.fixes.assetExtensions.filter(
    (ext) => !(current.assetExtensions ?? []).includes(ext),
  );
  const aliases = Object.fromEntries(
    Object.entries(analysis.fixes.aliases).filter(
      ([name]) =>
        current.targetAliases.length === 0 ||
        current.targetAliases.some((targetAliases) => targetAliases?.[name] === undefined),
    ),
  );
  const remaining: Record<keyof typeof FIX_SUGGESTIONS, string[]> = {
    "resolver.assetExtensions": assetExtensions,
    "resolver.extensions": sourceExtensions,
    "vite.targets[].aliases": Object.keys(aliases),
  };

  const hints = analysis.hints.flatMap((hint) => {
    const key = hint.vifxConfigKey;
    if (!hint.fixable || key === undefined || !(key in remaining)) {
      return [hint];
    }
    const values = remaining[key as keyof typeof FIX_SUGGESTIONS];
    if (values.length === 0) {
      return [];
    }
    return [{ ...hint, suggestion: FIX_SUGGESTIONS[key as keyof typeof FIX_SUGGESTIONS](values) }];
  });

  return { ...analysis, fixes: { aliases, assetExtensions, sourceExtensions }, hints };
}

interface MappingContext {
  filename: MetroConfigFilename;
  /** The config's source text. */
  source: string;
  /** The project root as given and its real path, for alias paths. */
  projectRoots: readonly string[];
  /** The framework's own default config, or null to use Metro's defaults. */
  baseline: RawMetroConfig | null;
}

/**
 * Map an evaluated Metro config object to Vifx migration findings.
 *
 * Only what the project changed is reported: each field is compared with the
 * framework's own defaults (or Metro's, when they cannot be built), and
 * extensions Vifx already bundles are left out.
 */
function mapEvaluatedConfig(config: RawMetroConfig, context: MappingContext) {
  const { baseline, filename, projectRoots } = context;
  const hints: MetroMigrationHint[] = [];
  const unsupported: MetroUnsupportedFeature[] = [];
  const fixes = emptyFixes();

  const baselineAssetExts = baseline
    ? new Set(asStringArray(baseline.resolver?.assetExts).map(normalizeExt))
    : METRO_DEFAULT_ASSET_EXTS;
  const assetExtAdditions = extensionAdditions(
    config.resolver?.assetExts,
    baselineAssetExts,
    VIFX_DEFAULT_ASSET_EXTS,
  );
  if (assetExtAdditions.length > 0) {
    fixes.assetExtensions = assetExtAdditions;
    hints.push({
      fixable: true,
      severity: "action",
      source: `${filename}:resolver.assetExts`,
      suggestion: FIX_SUGGESTIONS["resolver.assetExtensions"](assetExtAdditions),
      vifxConfigKey: "resolver.assetExtensions",
    });
  }

  const baselineSourceExts = baseline
    ? new Set(asStringArray(baseline.resolver?.sourceExts).map(normalizeExt))
    : METRO_DEFAULT_SOURCE_EXTS;
  const sourceExtAdditions = extensionAdditions(
    config.resolver?.sourceExts,
    baselineSourceExts,
    VIFX_DEFAULT_SOURCE_EXTS,
  );
  if (sourceExtAdditions.length > 0) {
    fixes.sourceExtensions = sourceExtAdditions;
    hints.push({
      fixable: true,
      severity: "action",
      source: `${filename}:resolver.sourceExts`,
      suggestion: FIX_SUGGESTIONS["resolver.extensions"](sourceExtAdditions),
      vifxConfigKey: "resolver.extensions",
    });
  }

  const extraNodeModules = isPlainObject(config.resolver?.extraNodeModules)
    ? config.resolver.extraNodeModules
    : {};
  const baselineNodeModules = isPlainObject(baseline?.resolver?.extraNodeModules)
    ? baseline.resolver.extraNodeModules
    : {};
  const aliasNames = Object.keys(extraNodeModules).filter(
    (name) => !sameValue(extraNodeModules[name], baselineNodeModules[name]),
  );
  if (aliasNames.length > 0) {
    let allMapped = true;
    for (const name of aliasNames) {
      const target = toAliasTarget(extraNodeModules[name], projectRoots);
      if (target === undefined) {
        allMapped = false;
      } else {
        fixes.aliases[name] = target;
      }
    }
    hints.push({
      fixable: allMapped,
      severity: "action",
      source: `${filename}:resolver.extraNodeModules`,
      suggestion: FIX_SUGGESTIONS["vite.targets[].aliases"](aliasNames),
      vifxConfigKey: "vite.targets[].aliases",
    });
  }

  const babelTransformerPath = config.transformer?.babelTransformerPath;
  if (
    typeof babelTransformerPath === "string" &&
    babelTransformerPath.length > 0 &&
    !DEFAULT_BABEL_TRANSFORMER.test(babelTransformerPath) &&
    !(baseline && sameValue(babelTransformerPath, baseline.transformer?.babelTransformerPath))
  ) {
    hints.push(buildBabelTransformerHint(filename, babelTransformerPath));
  }

  const resolveRequest = config.resolver?.resolveRequest;
  if (
    typeof resolveRequest === "function" &&
    !(baseline && sameValue(resolveRequest, baseline.resolver?.resolveRequest))
  ) {
    hints.push(buildResolveRequestHint(filename));
  }

  if (isPlainObject(config.serializer)) {
    const serializer = config.serializer;
    const baselineSerializer = isPlainObject(baseline?.serializer) ? baseline.serializer : null;
    const changedKeys = Object.keys(serializer).filter(
      (key) => baselineSerializer === null || !sameValue(serializer[key], baselineSerializer[key]),
    );
    if (changedKeys.length > 0) {
      const sentry = changedKeys.some((key) => {
        const value = serializer[key];
        return (
          typeof value === "function" &&
          /sentry|debugid/iu.test(Function.prototype.toString.call(value))
        );
      });
      unsupported.push(
        buildSerializerUnsupported(filename, {
          keys: baselineSerializer === null ? [] : changedKeys,
          sentry,
        }),
      );
    }
  }

  // getSentryExpoConfig hands its Debug ID plugins to Expo's own serializer
  // (unstable_beforeAssetSerializationPlugins), which then compares equal to the
  // default one: the import is what gives it away.
  if (
    !unsupported.some((feature) => feature.code === "VIFX_UNSUPPORTED_METRO_SERIALIZER") &&
    SENTRY_METRO_CONFIG.test(stripComments(context.source))
  ) {
    unsupported.push(buildSerializerUnsupported(filename, { keys: [], sentry: true }));
  }

  const baselineWatchFolders = new Set(
    asStringArray(baseline?.watchFolders).map((folder) => path.resolve(folder)),
  );
  const watchFolders = asStringArray(config.watchFolders).filter(
    (folder) => !baselineWatchFolders.has(path.resolve(folder)),
  );
  if (watchFolders.length > 0) {
    hints.push(buildWatchFoldersHint(filename));
  }

  return { fixes, hints, unsupported };
}

/**
 * Remove line and block comments so commented-out fields do not trigger
 * false-positive findings in the static fallback. String contents are left
 * intact; this is a best-effort scrub, not a full JS lexer.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

/**
 * Static (source-text) fallback analysis.
 *
 * Used only when {@link evaluateMetroConfig} fails (syntax errors, missing
 * transitive deps, throwing `getDefaultConfig`, etc.). This cannot resolve
 * computed values, spreads, or helper-generated config, so it is intentionally
 * conservative and presence-based:
 *
 * - It reports the *presence* of a field, not its concrete values (e.g. it
 *   cannot list which assetExts were added — additions are flagged only as
 *   "review these manually"), so nothing it finds is applied by `--fix`.
 * - It only matches the documented Metro field names as identifiers; configs
 *   that build these dynamically (bracket access, string keys) are missed.
 * - `unsupported` detection (resolveRequest / serializer) errs toward flagging
 *   when the identifier appears, matching the conservative existing behaviour.
 */
function analyzeMetroConfigSource(source: string, filename: MetroConfigFilename) {
  const hints: MetroMigrationHint[] = [];
  const unsupported: MetroUnsupportedFeature[] = [];
  const scrubbed = stripComments(source);

  if (/\bassetExts\b/u.test(scrubbed)) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.assetExts`,
      suggestion:
        "Custom resolver.assetExts detected (static scan). Review the additions and mirror them in resolver.assetExtensions in vifx.config.ts.",
      vifxConfigKey: "resolver.assetExtensions",
    });
  }

  if (/\bsourceExts\b/u.test(scrubbed)) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.sourceExts`,
      suggestion:
        "Custom resolver.sourceExts detected (static scan). Review the additions and mirror them in resolver.extensions in vifx.config.ts.",
      vifxConfigKey: "resolver.extensions",
    });
  }

  if (/\bextraNodeModules\b/u.test(scrubbed)) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.extraNodeModules`,
      suggestion:
        "resolver.extraNodeModules detected (static scan). Recreate the module aliases in the aliases of each vite.targets entry in vifx.config.ts.",
      vifxConfigKey: "vite.targets[].aliases",
    });
  }

  const babelMatch = scrubbed.match(
    /babelTransformerPath\s*[:=]\s*(?:require\(\s*)?["'`]([^"'`]+)["'`]/u,
  );
  if (babelMatch) {
    if (!DEFAULT_BABEL_TRANSFORMER.test(babelMatch[1] ?? "")) {
      hints.push(buildBabelTransformerHint(filename, babelMatch[1] ?? ""));
    }
  } else if (/\bbabelTransformerPath\b/u.test(scrubbed)) {
    hints.push(buildBabelTransformerHint(filename, "custom"));
  }

  if (/\bresolveRequest\b/u.test(scrubbed)) {
    hints.push(buildResolveRequestHint(filename));
  }

  if (/\bserializer\b/u.test(scrubbed)) {
    unsupported.push(buildSerializerUnsupported(filename));
  }

  if (/\bwatchFolders\b/u.test(scrubbed)) {
    hints.push(buildWatchFoldersHint(filename));
  }

  return { hints, unsupported };
}

/**
 * Analyze a project's Metro config and surface Vifx migration guidance.
 *
 * Resolution strategy: attempt to evaluate the config (its own `require`s, such
 * as `expo/metro-config`, live in the target project's `node_modules`, so this
 * usually works) and compare it with the framework's own default config. Both
 * are wrapped in try/catch: if the config cannot be evaluated we fall back to
 * STATIC source analysis (regex/heuristics over the file text), and if the
 * framework defaults cannot be built we compare with Metro's own defaults.
 */
export async function analyzeMetroConfig(projectRoot: string): Promise<MetroConfigAnalysis> {
  const discovered = await findMetroConfig(projectRoot);

  if (!discovered) {
    return {
      baseline: "metro",
      extraction: "none",
      fixes: emptyFixes(),
      found: false,
      hints: [],
      unsupported: [],
    };
  }

  const relativePath = path.relative(projectRoot, discovered.absolutePath);
  const source = (await readTextFileIfExists(discovered.absolutePath)) ?? "";
  // The defaults are built first: a config that pushes into an array its
  // framework shares between calls must not change them.
  const framework = await loadFrameworkDefaults(discovered.absolutePath, projectRoot, source);
  const evaluated = await evaluateMetroConfig(discovered.absolutePath);

  if (evaluated) {
    const realProjectRoot = await realpath(projectRoot).catch(() => projectRoot);
    const { fixes, hints, unsupported } = mapEvaluatedConfig(evaluated, {
      baseline: framework?.config ?? null,
      filename: discovered.filename,
      projectRoots: [projectRoot, realProjectRoot],
      source,
    });
    return {
      baseline: framework?.baseline ?? "metro",
      extraction: "evaluated",
      fixes,
      found: true,
      hints,
      path: relativePath,
      unsupported,
    };
  }

  const { hints, unsupported } = analyzeMetroConfigSource(source, discovered.filename);
  return {
    baseline: "metro",
    extraction: "static",
    fixes: emptyFixes(),
    found: true,
    hints,
    path: relativePath,
    unsupported,
  };
}

export { findMetroConfig, METRO_CONFIG_FILENAMES };
