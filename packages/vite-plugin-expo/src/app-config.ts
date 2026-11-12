import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VifxError } from "@vifx/errors";
import { requireFromProject } from "@vifx/platform-resolver";
import type { VifxJsonObject, VifxJsonValue } from "@vifx/types";

/**
 * Expo app config resolution.
 *
 * Expo projects describe themselves through a static file (`app.json` /
 * `app.config.json`), a dynamic one (`app.config.js` / `.ts`), or both: a
 * dynamic config that exports a function receives the static config and returns
 * the final one. Everything the Expo Go manifest and the export say about the
 * app (name, slug, scheme, `extra`, runtime version...) comes from the result.
 *
 * The project's own `@expo/config` is used whenever it is installed, so the
 * result is exactly what `expo start` would compute — config plugins applied,
 * TypeScript configs evaluated, SDK defaults filled in. A built-in evaluator
 * with the same static/dynamic semantics covers projects (and test fixtures)
 * that do not ship `@expo/config`.
 */

/** Static configs, in Expo's lookup order. */
export const EXPO_STATIC_CONFIG_NAMES = ["app.config.json", "app.json"] as const;
/** Dynamic configs, in Expo's lookup order. */
export const EXPO_DYNAMIC_CONFIG_NAMES = [
  "app.config.ts",
  "app.config.mts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
] as const;

export interface ResolveExpoAppConfigOptions {
  /**
   * Explicit config file. Pins resolution to that file and to the built-in
   * evaluator, since `@expo/config` only knows the conventional file names.
   */
  appConfigPath?: string;
  projectRoot: string;
}

export interface ResolvedExpoAppConfig {
  /** Dynamic config that was evaluated, if any (absolute path). */
  dynamicConfigPath: string | null;
  /** The resolved `expo` config object, JSON-serializable. */
  exp: VifxJsonObject;
  packageJson: VifxJsonObject;
  /** `expo-config`: the project's own `@expo/config`; `vifx`: the built-in evaluator. */
  resolvedBy: "expo-config" | "vifx";
  /** Static config that was read, if any (absolute path). */
  staticConfigPath: string | null;
}

interface ExpoConfigModule {
  getConfig?: (
    projectRoot: string,
    options?: Record<string, unknown>,
  ) => {
    dynamicConfigPath?: string | null;
    exp?: unknown;
    staticConfigPath?: string | null;
  };
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function isFile(filePath: string) {
  return (await stat(filePath).catch(() => null))?.isFile() ?? false;
}

async function findFirstExisting(projectRoot: string, fileNames: readonly string[]) {
  for (const fileName of fileNames) {
    const candidate = path.join(projectRoot, fileName);
    if (await isFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function readJsonObject(filePath: string): Promise<VifxJsonObject> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as VifxJsonValue;
  return isJsonObject(parsed) ? parsed : {};
}

/** Drops functions, `undefined` and other non-JSON values (e.g. config-plugin `mods`). */
function toJsonObject(value: unknown): VifxJsonObject {
  const serialized = JSON.parse(JSON.stringify(value ?? {})) as VifxJsonValue;
  return isJsonObject(serialized) ? serialized : {};
}

/** A config file may wrap the config in an `expo` key (`app.json` always does). */
function unwrapExpoKey(config: VifxJsonObject): VifxJsonObject {
  return isJsonObject(config.expo) ? config.expo : config;
}

function invalidConfigError(configPath: string, reason: string, cause?: unknown) {
  return new VifxError({
    cause,
    code: "VIFX_EXPO_CONFIG_INVALID",
    details: { configPath },
    docsPath: "/reference/packages#vifxvite-plugin-expo",
    hint: "Export a config object, or a function ({ config }) => config, from the app config file.",
    message: `Could not evaluate the Expo app config "${configPath}": ${reason}`,
  });
}

async function evaluateDynamicConfig(
  configPath: string,
  staticConfig: VifxJsonObject,
): Promise<VifxJsonObject> {
  let exported: unknown;
  try {
    // Node loads `.ts` configs through its built-in type stripping, and both
    // CommonJS (`module.exports =`) and ES module configs through `import()`.
    const loaded = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
    exported = loaded.default ?? loaded;
  } catch (error) {
    throw invalidConfigError(
      configPath,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }

  // CommonJS configs loaded through `import()` can arrive double-wrapped.
  if (isJsonObject(exported) && "default" in exported && Object.keys(exported).length === 1) {
    exported = (exported as { default: unknown }).default;
  }

  let evaluated: unknown = exported;
  if (typeof exported === "function") {
    try {
      evaluated = await (exported as (context: { config: VifxJsonObject }) => unknown)({
        config: structuredClone(staticConfig),
      });
    } catch (error) {
      throw invalidConfigError(
        configPath,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  if (!isJsonObject(evaluated)) {
    throw invalidConfigError(configPath, "it did not produce a config object.");
  }

  return unwrapExpoKey(toJsonObject(evaluated));
}

function resolveWithExpoConfigPackage(projectRoot: string): {
  dynamicConfigPath: string | null;
  exp: VifxJsonObject;
  staticConfigPath: string | null;
} | null {
  let expoConfig: ExpoConfigModule | null;
  try {
    expoConfig = requireFromProject(projectRoot, "@expo/config") as ExpoConfigModule | null;
  } catch {
    return null;
  }

  if (typeof expoConfig?.getConfig !== "function") {
    return null;
  }

  // Same call as Expo CLI's dev server. A config plugin that cannot be loaded
  // must not take the manifest down with it, so retry without plugins; any
  // other failure falls back to the built-in evaluator.
  for (const skipPlugins of [false, true]) {
    try {
      const result = expoConfig.getConfig(projectRoot, {
        isPublicConfig: true,
        skipPlugins,
        skipSDKVersionRequirement: true,
      });
      if (isJsonObject(result.exp)) {
        return {
          dynamicConfigPath: result.dynamicConfigPath ?? null,
          exp: toJsonObject(result.exp),
          staticConfigPath: result.staticConfigPath ?? null,
        };
      }
    } catch {
      // Try the next strategy.
    }
  }

  return null;
}

async function readPackageJson(projectRoot: string): Promise<VifxJsonObject> {
  return readJsonObject(path.join(projectRoot, "package.json")).catch(() => ({}));
}

/**
 * Resolves the Expo app config of a project the way Expo CLI does. Never
 * throws for a project without any config file: `name` and `slug` then default
 * to the package name, as they do under Expo.
 */
export async function resolveExpoAppConfig(
  options: ResolveExpoAppConfigOptions,
): Promise<ResolvedExpoAppConfig> {
  const projectRoot = path.resolve(options.projectRoot);
  const packageJson = await readPackageJson(projectRoot);
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "vifx-expo-app";
  const defaults: VifxJsonObject = { name: packageName, slug: packageName };

  if (!options.appConfigPath) {
    const resolved = resolveWithExpoConfigPackage(projectRoot);
    if (resolved) {
      return {
        dynamicConfigPath: resolved.dynamicConfigPath,
        exp: { ...defaults, ...resolved.exp },
        packageJson,
        resolvedBy: "expo-config",
        staticConfigPath: resolved.staticConfigPath,
      };
    }
  }

  const explicitPath = options.appConfigPath
    ? path.resolve(projectRoot, options.appConfigPath)
    : null;
  const explicitIsStatic = explicitPath !== null && path.extname(explicitPath) === ".json";
  const staticConfigPath = explicitIsStatic
    ? explicitPath
    : await findFirstExisting(projectRoot, EXPO_STATIC_CONFIG_NAMES);
  const dynamicConfigPath =
    explicitPath !== null
      ? explicitIsStatic
        ? null
        : explicitPath
      : await findFirstExisting(projectRoot, EXPO_DYNAMIC_CONFIG_NAMES);

  const staticConfig: VifxJsonObject = {
    ...defaults,
    ...(staticConfigPath && (await isFile(staticConfigPath))
      ? unwrapExpoKey(await readJsonObject(staticConfigPath).catch(() => ({})))
      : {}),
  };

  // A dynamic config is the final word: a function builds on the static config
  // it is handed, an object export replaces it.
  const exp =
    dynamicConfigPath && (await isFile(dynamicConfigPath))
      ? { ...defaults, ...(await evaluateDynamicConfig(dynamicConfigPath, staticConfig)) }
      : staticConfig;

  return {
    dynamicConfigPath,
    exp,
    packageJson,
    resolvedBy: "vifx",
    staticConfigPath,
  };
}
