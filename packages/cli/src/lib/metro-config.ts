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
export type MetroConfigFilename =
  | "metro.config.js"
  | "metro.config.cjs"
  | "metro.config.mjs";

/** How the config was read: executed vs. parsed from source text. */
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
  /** Where the finding came from, e.g. `metro.config.js:resolver.resolveRequest`. */
  source: string;
  /** Stable Vifx error code (see `@vifx/errors`). */
  code: "VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST" | "VIFX_UNSUPPORTED_METRO_SERIALIZER";
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
  return { extraction: "none", found: true, hints: [], path: relativePath, unsupported: [] };
}

// Internal helpers below are exported for unit testing and incremental wiring.
export { findMetroConfig, METRO_CONFIG_FILENAMES };

// Placeholder bindings used while the analysis is built out incrementally.
void createRequire;
void pathToFileURL;
