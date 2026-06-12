import path from "node:path";
import type { VifxPlatform, VifxReactNativeCompatMode } from "@vifx/types";
import {
  derivePackageTransformRules,
  EMPTY_PACKAGE_TRANSFORM_RULES,
  type PackageTransformRules,
} from "./package-rules.ts";
import { loadProjectBabelConfig, type ProjectBabelConfig } from "./project-config.ts";

/**
 * How the project Babel transform is configured for a file:
 *
 * - `project-config`: run the project's own config file so the project's REAL
 *   plugins (worklets, nativewind, react-compiler, ...) execute.
 * - `preset-only`: legacy behavior — run only the resolved React Native
 *   preset (`babel-preset-expo` / `@react-native/babel-preset`).
 */
export type ProjectBabelConfigMode = "preset-only" | "project-config";

export type TransformDecision =
  | { strategy: "none" }
  | { strategy: "oxc" }
  | {
      strategy: "project-babel";
      configMode: ProjectBabelConfigMode;
      isNodeModule: boolean;
    };

const NONE_DECISION: TransformDecision = Object.freeze({ strategy: "none" });
const OXC_DECISION: TransformDecision = Object.freeze({ strategy: "oxc" });

export interface BabelPipelineOptions {
  /** Manual override: packages forced through project Babel (highest priority). */
  babelInPackages: string[];
  isDev: boolean;
  /** Manual override: packages forced through the OXC JSX transform. */
  jsxInPackages: string[];
  projectRoot: string;
  reactNativeCompat: VifxReactNativeCompatMode;
  resolvePlatform: VifxPlatform;
}

/**
 * Per-file transform decision engine. Layering, highest priority first:
 *
 * 1. Manual overrides (`babelInPackages` / `jsxInPackages`).
 * 2. Rules derived from the project's own Babel config and dependency
 *    manifests (see {@link derivePackageTransformRules}).
 * 3. Defaults: on native platforms node_modules sources and project sources
 *    run through the React Native preset; on web only Expo package sources
 *    get the OXC JSX transform.
 *
 * The OXC fast path stays in place for plain TS/JSX — project Babel only runs
 * where the project's configuration requires it.
 */
export interface BabelPipeline {
  /** Decide how `id` must be transformed. `code` feeds content heuristics (Flow pragma). */
  decideTransform(id: string, code: string): Promise<TransformDecision>;
  /**
   * Fallback decision when project Babel was selected but the project has no
   * usable Babel runtime: OXC when any JSX-style rule matches, none
   * otherwise. Mirrors the legacy decision chain.
   */
  decideBabelUnavailableFallback(id: string): Promise<TransformDecision>;
  /** Resolved project Babel config backing the derived rules (null when unavailable). */
  getProjectBabelConfig(): Promise<ProjectBabelConfig | null>;
  /** Derived per-package rules (empty rules when no config is available). */
  getPackageTransformRules(): Promise<PackageTransformRules>;
}

export function createBabelPipeline(options: BabelPipelineOptions): BabelPipeline {
  let configPromise: Promise<ProjectBabelConfig | null> | null = null;
  let rulesPromise: Promise<PackageTransformRules> | null = null;

  const getProjectBabelConfig = () => {
    configPromise ??= loadProjectBabelConfig({
      isDev: options.isDev,
      platform: options.resolvePlatform,
      projectRoot: options.projectRoot,
    });
    return configPromise;
  };

  const getPackageTransformRules = () => {
    rulesPromise ??= (async () => {
      const config = await getProjectBabelConfig();
      if (!config) {
        return EMPTY_PACKAGE_TRANSFORM_RULES;
      }

      return derivePackageTransformRules({ config, projectRoot: options.projectRoot });
    })();
    return rulesPromise;
  };

  const decideNodeModuleTransform = async (id: string, code: string) => {
    const rules = await getPackageTransformRules();
    const config = await getProjectBabelConfig();
    const fullConfigAvailable = Boolean(config?.configFilePath);
    const matchesFullBabelPackage =
      fullConfigAvailable && matchesNodeModulePackagePattern(id, rules.fullBabelPackages);

    if (options.resolvePlatform !== "web") {
      // Default native route: every transformable node_modules source goes
      // through project Babel; derived rules upgrade it to the full config.
      return {
        configMode: matchesFullBabelPackage ? "project-config" : "preset-only",
        isNodeModule: true,
        strategy: "project-babel",
      } satisfies TransformDecision;
    }

    if (matchesNodeModulePackagePattern(id, options.babelInPackages)) {
      return {
        configMode: matchesFullBabelPackage ? "project-config" : "preset-only",
        isNodeModule: true,
        strategy: "project-babel",
      } satisfies TransformDecision;
    }

    if (shouldTransformJsxFile(id, options.jsxInPackages)) {
      return OXC_DECISION;
    }

    if (matchesFullBabelPackage) {
      return {
        configMode: "project-config",
        isNodeModule: true,
        strategy: "project-babel",
      } satisfies TransformDecision;
    }

    if (matchesNodeModulePackagePattern(id, rules.nativeSourcePackages)) {
      if (hasFlowPragma(code)) {
        return {
          configMode: "preset-only",
          isNodeModule: true,
          strategy: "project-babel",
        } satisfies TransformDecision;
      }

      if (isPlainJsPath(id)) {
        return OXC_DECISION;
      }

      return NONE_DECISION;
    }

    if (isExpoPackageSourcePath(id, options.reactNativeCompat, options.resolvePlatform)) {
      return OXC_DECISION;
    }

    return NONE_DECISION;
  };

  const decideProjectSourceTransform = async (id: string) => {
    if (!isProjectSourcePath(id, options.projectRoot)) {
      return NONE_DECISION;
    }

    const rules = await getPackageTransformRules();
    if (rules.fullBabelProjectSource) {
      const config = await getProjectBabelConfig();
      if (config?.configFilePath) {
        return {
          configMode: "project-config",
          isNodeModule: false,
          strategy: "project-babel",
        } satisfies TransformDecision;
      }
    }

    if (options.resolvePlatform === "web") {
      // Default web route: Vite's own pipeline handles project TS/JSX.
      return NONE_DECISION;
    }

    return {
      configMode: "preset-only",
      isNodeModule: false,
      strategy: "project-babel",
    } satisfies TransformDecision;
  };

  return {
    async decideTransform(id, code) {
      if (id.includes("\0") || !isTransformableJavaScriptPath(id)) {
        return NONE_DECISION;
      }

      if (id.includes("/node_modules/")) {
        return decideNodeModuleTransform(id, code);
      }

      return decideProjectSourceTransform(id);
    },
    async decideBabelUnavailableFallback(id) {
      if (shouldTransformJsxFile(id, options.jsxInPackages)) {
        return OXC_DECISION;
      }

      if (isExpoPackageSourcePath(id, options.reactNativeCompat, options.resolvePlatform)) {
        return OXC_DECISION;
      }

      const rules = await getPackageTransformRules();
      if (matchesNodeModulePackagePattern(id, rules.nativeSourcePackages) && isPlainJsPath(id)) {
        return OXC_DECISION;
      }

      return NONE_DECISION;
    },
    getPackageTransformRules,
    getProjectBabelConfig,
  };
}

export function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

export function stripQuery(filePath: string) {
  return filePath.replace(/[?#].*$/u, "");
}

export function isTransformableJavaScriptPath(id: string) {
  return /\.[cm]?[jt]sx?$/u.test(stripQuery(id));
}

export function matchesNodeModulePackagePattern(id: string, packagePatterns: string[]) {
  const normalizedId = toPosixPath(stripQuery(id));

  return packagePatterns.some((packagePattern) => {
    if (!normalizedId.includes("/node_modules/")) {
      return false;
    }

    if (packagePattern.endsWith("-") || packagePattern.endsWith("/")) {
      return normalizedId.includes(`/node_modules/${packagePattern}`);
    }

    return normalizedId.includes(`/node_modules/${packagePattern}/`);
  });
}

/** Manual `jsxInPackages` rule: plain `.js` files inside listed packages get OXC JSX. */
export function shouldTransformJsxFile(id: string, jsxInPackages: string[]) {
  if (!id.includes("/node_modules/") || !id.endsWith(".js")) {
    return false;
  }

  return matchesNodeModulePackagePattern(id, jsxInPackages);
}

/** Web-compat rule: Expo package sources ship TS/JSX and get the OXC transform. */
export function isExpoPackageSourcePath(
  id: string,
  reactNativeCompat: VifxReactNativeCompatMode,
  resolvePlatform: VifxPlatform,
) {
  if (reactNativeCompat !== "web" || resolvePlatform !== "web") {
    return false;
  }

  if (!id.includes("/node_modules/")) {
    return false;
  }

  const normalizedId = toPosixPath(stripQuery(id));
  if (!/\.(jsx?|tsx?)$/u.test(normalizedId)) {
    return false;
  }

  return (
    normalizedId.includes("/node_modules/expo/") ||
    normalizedId.includes("/node_modules/expo-") ||
    normalizedId.includes("/node_modules/@expo/")
  );
}

/** Whether `id` is a first-party source file inside the project root. */
export function isProjectSourcePath(id: string, projectRoot: string) {
  if (id.includes("\0") || id.includes("/node_modules/")) {
    return false;
  }

  const normalizedId = stripQuery(id);
  const relativePath = path.relative(projectRoot, normalizedId);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isPlainJsPath(id: string) {
  return /\.[cm]?js$/u.test(stripQuery(id));
}

/**
 * Flow sources must go through Babel; OXC does not strip Flow types. The
 * pragma scan is bounded to the leading comment region.
 */
function hasFlowPragma(code: string) {
  return code.slice(0, 2048).includes("@flow");
}
