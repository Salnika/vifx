import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

/** Result of analyzing a project's Metro config for migration to Vifx. */
export interface MetroConfigAnalysis {
  /** Whether a metro config file was discovered at the project root. */
  found: boolean;
  /** Project-root-relative path to the config, when found. */
  path?: string;
  /** How the config was inspected (evaluated, static fallback, or none). */
  extraction: MetroConfigExtractionMode;
  /** Actionable migration hints. */
  hints: MetroMigrationHint[];
  /** Metro features Vifx does not support yet. */
  unsupported: MetroUnsupportedFeature[];
}

const METRO_CONFIG_FILENAMES: readonly MetroConfigFilename[] = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
];

/**
 * Default Metro `assetExts` and `sourceExts`. Metro merges user additions on
 * top of these defaults, so when we read an evaluated config we subtract the
 * defaults to report only the *additions* the project actually made. Mirrors
 * `metro-config`'s `getDefaultConfig` defaults closely enough for migration
 * guidance; an exact match is unnecessary because we only surface the delta.
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

const SVG_TRANSFORMER_DOCS = "https://vifx.dev/migration/metro#react-native-svg-transformer";

function buildBabelTransformerHint(
  filename: MetroConfigFilename,
  transformerPath: string,
): MetroMigrationHint {
  if (/react-native-svg-transformer/u.test(transformerPath)) {
    return {
      severity: "action",
      source: `${filename}:transformer.babelTransformerPath`,
      suggestion: `Replace react-native-svg-transformer with Vifx SVG support. See ${SVG_TRANSFORMER_DOCS}.`,
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

const RESOLVE_REQUEST_DOCS = "https://vifx.dev/guide/migration#resolverequest";

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

function buildSerializerUnsupported(filename: MetroConfigFilename): MetroUnsupportedFeature {
  return {
    code: "VIFX_UNSUPPORTED_METRO_SERIALIZER",
    source: `${filename}:serializer`,
    suggestion:
      "Custom Metro serializer hooks are not implemented in Vifx yet. Keep Metro for serializer-specific workflows for now.",
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

/**
 * Map an evaluated Metro config object to Vifx migration findings.
 *
 * Only fields with a known Vifx mapping (or a known gap) are reported. Asset
 * and source extension lists are diffed against Metro's defaults so we surface
 * the project's additions rather than the full default list.
 */
function mapEvaluatedConfig(config: RawMetroConfig, filename: MetroConfigFilename) {
  const hints: MetroMigrationHint[] = [];
  const unsupported: MetroUnsupportedFeature[] = [];

  const assetExtAdditions = asStringArray(config.resolver?.assetExts)
    .map(normalizeExt)
    .filter((ext) => ext.length > 0 && !METRO_DEFAULT_ASSET_EXTS.has(ext));
  if (assetExtAdditions.length > 0) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.assetExts`,
      suggestion: `Add custom asset extensions (${formatList(assetExtAdditions)}) to vifx.config.ts assetExtensions.`,
      vifxConfigKey: "assetExtensions",
    });
  }

  const sourceExtAdditions = asStringArray(config.resolver?.sourceExts)
    .map(normalizeExt)
    .filter((ext) => ext.length > 0 && !METRO_DEFAULT_SOURCE_EXTS.has(ext));
  if (sourceExtAdditions.length > 0) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.sourceExts`,
      suggestion: `Add custom source extensions (${formatList(sourceExtAdditions)}) to vifx.config.ts resolver.extensions.`,
      vifxConfigKey: "resolver.extensions",
    });
  }

  const extraNodeModules = isPlainObject(config.resolver?.extraNodeModules)
    ? Object.keys(config.resolver.extraNodeModules)
    : [];
  if (extraNodeModules.length > 0) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.extraNodeModules`,
      suggestion: `Recreate module aliases (${formatList(extraNodeModules)}) as vifx.config.ts target aliases.`,
      vifxConfigKey: "aliases",
    });
  }

  const babelTransformerPath = config.transformer?.babelTransformerPath;
  if (typeof babelTransformerPath === "string" && babelTransformerPath.length > 0) {
    hints.push(buildBabelTransformerHint(filename, babelTransformerPath));
  }

  if (typeof config.resolver?.resolveRequest === "function") {
    hints.push(buildResolveRequestHint(filename));
  }

  if (isPlainObject(config.serializer) && Object.keys(config.serializer).length > 0) {
    unsupported.push(buildSerializerUnsupported(filename));
  }

  if (asStringArray(config.watchFolders).length > 0) {
    hints.push(buildWatchFoldersHint(filename));
  }

  return { hints, unsupported };
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
 *   "review these manually").
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
        "Custom resolver.assetExts detected (static scan). Review the additions and mirror them in vifx.config.ts assetExtensions.",
      vifxConfigKey: "assetExtensions",
    });
  }

  if (/\bsourceExts\b/u.test(scrubbed)) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.sourceExts`,
      suggestion:
        "Custom resolver.sourceExts detected (static scan). Review the additions and mirror them in vifx.config.ts resolver.extensions.",
      vifxConfigKey: "resolver.extensions",
    });
  }

  if (/\bextraNodeModules\b/u.test(scrubbed)) {
    hints.push({
      severity: "action",
      source: `${filename}:resolver.extraNodeModules`,
      suggestion:
        "resolver.extraNodeModules detected (static scan). Recreate the module aliases as vifx.config.ts target aliases.",
      vifxConfigKey: "aliases",
    });
  }

  const babelMatch = scrubbed.match(
    /babelTransformerPath\s*[:=]\s*(?:require\(\s*)?["'`]([^"'`]+)["'`]/u,
  );
  if (babelMatch) {
    hints.push(buildBabelTransformerHint(filename, babelMatch[1] ?? ""));
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
 * usually works). `getDefaultConfig` and other side effects may still throw, so
 * everything is wrapped in try/catch and we fall back to STATIC source analysis
 * (regex/heuristics over the file text). Static analysis is intentionally
 * conservative — see {@link analyzeMetroConfigSource} for its documented limits.
 */
export async function analyzeMetroConfig(projectRoot: string): Promise<MetroConfigAnalysis> {
  const discovered = await findMetroConfig(projectRoot);

  if (!discovered) {
    return { extraction: "none", found: false, hints: [], unsupported: [] };
  }

  const relativePath = path.relative(projectRoot, discovered.absolutePath);
  const evaluated = await evaluateMetroConfig(discovered.absolutePath);

  if (evaluated) {
    const { hints, unsupported } = mapEvaluatedConfig(evaluated, discovered.filename);
    return { extraction: "evaluated", found: true, hints, path: relativePath, unsupported };
  }

  const source = (await readTextFileIfExists(discovered.absolutePath)) ?? "";
  const { hints, unsupported } = analyzeMetroConfigSource(source, discovered.filename);
  return { extraction: "static", found: true, hints, path: relativePath, unsupported };
}

export { findMetroConfig, METRO_CONFIG_FILENAMES };
