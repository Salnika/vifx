import { createRequire } from "node:module";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import type { VifxPlatform } from "@vifx/types";

/** Structural view of the project-resolved `@babel/core` transform result. */
export interface ProjectBabelTransformOutput {
  code?: string | null;
  map?: unknown;
}

/** Structural subset of `@babel/core`'s `ConfigItem`. */
interface BabelConfigItemLike {
  file?: { request?: string | null; resolved?: string | null } | null;
  name?: string | null;
}

/** Structural subset of `@babel/core`'s `PartialConfig`. */
interface BabelPartialConfigLike {
  babelrc?: string | null;
  config?: string | null;
  options?: {
    plugins?: unknown[] | null;
    presets?: unknown[] | null;
  } | null;
}

/**
 * Babel entry points resolved from the TARGET project's own `@babel/core`
 * installation, so transforms run with the exact plugin versions the project
 * declares instead of anything bundled with Vifx.
 */
export interface ProjectBabelRuntime {
  /** `babel-preset-expo` or `@react-native/babel-preset`, resolved from the project. */
  presetPath: string;
  /** `null` when the project's `@babel/core` predates partial-config support. */
  loadPartialConfigAsync:
    | ((options: Record<string, unknown>) => Promise<BabelPartialConfigLike | null>)
    | null;
  transformAsync: (
    code: string,
    options: Record<string, unknown>,
  ) => Promise<ProjectBabelTransformOutput | null>;
}

/** A plugin or preset resolved from the project's Babel configuration. */
export interface ProjectBabelConfigEntry {
  /** Name declared by the plugin/preset itself, when available. */
  name: string | null;
  /** Original request string from the config, e.g. `react-native-worklets/plugin`. */
  request: string | null;
  /** Absolute path of the resolved plugin/preset module. */
  resolved: string | null;
}

/**
 * The target project's resolved Babel configuration, as discovered by the
 * project's own `@babel/core` via `loadPartialConfigAsync`.
 */
export interface ProjectBabelConfig {
  /**
   * Project-wide config file (`babel.config.js`) or file-relative config
   * (`.babelrc`) discovered for the project. `null` when the project has a
   * Babel runtime but no filesystem configuration.
   */
  configFilePath: string | null;
  plugins: ProjectBabelConfigEntry[];
  presets: ProjectBabelConfigEntry[];
}

export interface LoadProjectBabelConfigOptions {
  /**
   * File used for config discovery and `overrides` matching. Defaults to a
   * probe filename directly inside the project root so the root-level
   * configuration is resolved.
   */
  filename?: string;
  isDev: boolean;
  platform: VifxPlatform;
  projectRoot: string;
}

const projectBabelRuntimeCache = new Map<string, Promise<ProjectBabelRuntime | null>>();
const projectBabelConfigCache = new Map<string, Promise<ProjectBabelConfig | null>>();

/**
 * Loads `@babel/core` (and a React Native preset) from the target project's
 * own dependency tree. Returns `null` when the project does not ship a usable
 * Babel runtime, in which case callers fall back to OXC-only transforms.
 */
export async function loadProjectBabelRuntime(
  projectRoot: string,
): Promise<ProjectBabelRuntime | null> {
  const cached = projectBabelRuntimeCache.get(projectRoot);
  if (cached) {
    return cached;
  }

  const runtimePromise = (async () => {
    try {
      const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
      const babel = requireFromProject("@babel/core") as {
        loadPartialConfigAsync?: NonNullable<ProjectBabelRuntime["loadPartialConfigAsync"]>;
        transformAsync?: ProjectBabelRuntime["transformAsync"];
      };

      if (typeof babel.transformAsync !== "function") {
        return null;
      }

      let presetPath: string;
      try {
        presetPath = requireFromProject.resolve("babel-preset-expo");
      } catch {
        presetPath = requireFromProject.resolve("@react-native/babel-preset");
      }

      return {
        loadPartialConfigAsync:
          typeof babel.loadPartialConfigAsync === "function"
            ? babel.loadPartialConfigAsync.bind(babel)
            : null,
        presetPath,
        transformAsync: babel.transformAsync.bind(babel),
      } satisfies ProjectBabelRuntime;
    } catch {
      return null;
    }
  })();

  projectBabelRuntimeCache.set(projectRoot, runtimePromise);
  return runtimePromise;
}

/**
 * Resolves the target project's own Babel configuration using the
 * project-resolved `@babel/core`. The result lists the resolved plugin and
 * preset identities so transform rules can be derived from what the project
 * actually configures, instead of hard-coded package lists.
 *
 * Cached per project root, platform, and dev flag. Returns `null` when the
 * project has no usable Babel runtime. Throws `VifxError`
 * (`VIFX_BABEL_CONFIG_LOAD_FAILED`) when the project configuration exists but
 * cannot be evaluated, because silently ignoring it would produce bundles
 * missing required plugin output (e.g. worklets).
 */
export async function loadProjectBabelConfig(
  options: LoadProjectBabelConfigOptions,
): Promise<ProjectBabelConfig | null> {
  const cacheKey = [
    options.projectRoot,
    options.platform,
    options.isDev ? "dev" : "prod",
    options.filename ?? "",
  ].join("\n");

  const cached = projectBabelConfigCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const configPromise = (async () => {
    const runtime = await loadProjectBabelRuntime(options.projectRoot);
    if (!runtime?.loadPartialConfigAsync) {
      return null;
    }

    const filename =
      options.filename ?? path.join(options.projectRoot, "__vifx_babel_config_probe__.js");

    let partialConfig: BabelPartialConfigLike | null;
    try {
      partialConfig = await runtime.loadPartialConfigAsync({
        babelrc: true,
        caller: {
          isDev: options.isDev,
          isServer: false,
          name: "vifx",
          platform: options.platform,
          supportsStaticESM: false,
        },
        cwd: options.projectRoot,
        filename,
        root: options.projectRoot,
        rootMode: "root",
      });
    } catch (error) {
      throw new VifxError({
        cause: error,
        code: "VIFX_BABEL_CONFIG_LOAD_FAILED",
        hint: "Fix the project's babel.config.js (or .babelrc) so it evaluates without errors, or remove it to fall back to the default React Native preset.",
        message: `Failed to load the Babel configuration of the project at ${options.projectRoot}.`,
      });
    }

    if (!partialConfig) {
      return null;
    }

    return {
      configFilePath: partialConfig.config ?? partialConfig.babelrc ?? null,
      plugins: toConfigEntries(partialConfig.options?.plugins),
      presets: toConfigEntries(partialConfig.options?.presets),
    } satisfies ProjectBabelConfig;
  })();

  projectBabelConfigCache.set(cacheKey, configPromise);
  return configPromise;
}

function toConfigEntries(items: unknown[] | null | undefined): ProjectBabelConfigEntry[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => {
    const candidate = (
      typeof item === "object" && item !== null ? item : {}
    ) as BabelConfigItemLike;

    return {
      name: typeof candidate.name === "string" ? candidate.name : null,
      request: typeof candidate.file?.request === "string" ? candidate.file.request : null,
      resolved: typeof candidate.file?.resolved === "string" ? candidate.file.resolved : null,
    };
  });
}
