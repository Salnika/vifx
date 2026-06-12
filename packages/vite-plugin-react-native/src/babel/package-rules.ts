import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { ProjectBabelConfig, ProjectBabelConfigEntry } from "./project-config.ts";

/**
 * Per-package transform requirements derived from the target project's own
 * Babel configuration and dependency manifests. These replace guess-based
 * manual package lists: when a project configures e.g.
 * `react-native-worklets/plugin`, its REAL plugin must run over both library
 * and app sources.
 */
export interface PackageTransformRules {
  /**
   * Packages whose sources must run through the project's FULL Babel config
   * (config file + all of its plugins), not just the React Native preset.
   */
  fullBabelPackages: string[];
  /**
   * Whether first-party project sources must also run through the project's
   * full Babel config (e.g. worklets and the React Compiler operate on app
   * code).
   */
  fullBabelProjectSource: boolean;
  /**
   * Dependencies that ship untranspiled React Native sources (a
   * `react-native` source entry in their package.json). Files from these
   * packages get Babel when they carry Flow types and OXC when they are plain
   * JS/JSX.
   */
  nativeSourcePackages: string[];
}

export const EMPTY_PACKAGE_TRANSFORM_RULES: PackageTransformRules = Object.freeze({
  fullBabelPackages: [],
  fullBabelProjectSource: false,
  nativeSourcePackages: [],
});

export interface DerivePackageTransformRulesOptions {
  config: ProjectBabelConfig | null;
  projectRoot: string;
}

/**
 * Derives transform requirements from the project's resolved Babel config:
 *
 * - `react-native-worklets/plugin` or `react-native-reanimated/plugin`
 *   (declared directly, or implied by `babel-preset-expo` plus an installed
 *   worklets plugin, which the preset auto-enables) -> full project Babel
 *   over `react-native-reanimated`, `react-native-worklets`, and project
 *   sources.
 * - `nativewind/babel` -> full project Babel over `nativewind` and project
 *   sources.
 * - `babel-plugin-react-compiler` -> full project Babel over project sources.
 * - Generic heuristic: dependencies whose package.json declares a
 *   `react-native` source field ship untranspiled sources and are flagged for
 *   per-file handling (Babel for Flow, OXC for plain JSX).
 */
export async function derivePackageTransformRules(
  options: DerivePackageTransformRulesOptions,
): Promise<PackageTransformRules> {
  const { config, projectRoot } = options;
  const fullBabelPackages = new Set<string>();
  let fullBabelProjectSource = false;

  if (config?.configFilePath) {
    const declaresWorkletsPlugin =
      configReferences(config.plugins, "react-native-worklets", "plugin") ||
      configReferences(config.plugins, "react-native-reanimated", "plugin");
    const impliesWorkletsPlugin =
      configReferences(config.presets, "babel-preset-expo") &&
      resolvesWorkletsPlugin(projectRoot);

    if (declaresWorkletsPlugin || impliesWorkletsPlugin) {
      fullBabelPackages.add("react-native-reanimated");
      fullBabelPackages.add("react-native-worklets");
      fullBabelProjectSource = true;
    }

    if (
      configReferences(config.presets, "nativewind", "babel") ||
      configReferences(config.plugins, "nativewind", "babel")
    ) {
      fullBabelPackages.add("nativewind");
      fullBabelProjectSource = true;
    }

    if (configReferences(config.plugins, "babel-plugin-react-compiler")) {
      fullBabelProjectSource = true;
    }
  }

  const nativeSourcePackages = await collectNativeSourceDependencies(projectRoot);

  return {
    fullBabelPackages: [...fullBabelPackages].sort(),
    fullBabelProjectSource,
    nativeSourcePackages,
  };
}

/**
 * Whether any config entry references `packageName` (optionally constrained
 * to a `subpath` request such as `plugin` or `babel`). Matches the original
 * request string, the resolved module path, and the declared plugin name, so
 * shorthand requests (`react-compiler`) and relative-path configs are caught
 * via their resolved location.
 */
function configReferences(
  entries: ProjectBabelConfigEntry[],
  packageName: string,
  subpath?: string,
): boolean {
  return entries.some((entry) => {
    if (entry.request) {
      if (subpath === undefined) {
        if (entry.request === packageName || entry.request.startsWith(`${packageName}/`)) {
          return true;
        }
      } else if (entry.request === `${packageName}/${subpath}`) {
        return true;
      }
    }

    if (entry.name && (entry.name === packageName || entry.name.startsWith(`${packageName}/`))) {
      return true;
    }

    if (entry.resolved) {
      const resolvedPosix = entry.resolved.split(path.sep).join("/");
      if (resolvedPosix.includes(`/node_modules/${packageName}/`)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * `babel-preset-expo` auto-enables the worklets/reanimated Babel plugin when
 * the package is installed, so its presence in the project implies the plugin
 * even though the partial config cannot expand presets.
 */
function resolvesWorkletsPlugin(projectRoot: string): boolean {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));

  for (const request of ["react-native-worklets/plugin", "react-native-reanimated/plugin"]) {
    try {
      requireFromProject.resolve(request);
      return true;
    } catch {
      // Not installed; try the next candidate.
    }
  }

  return false;
}

async function collectNativeSourceDependencies(projectRoot: string): Promise<string[]> {
  const dependencyNames = await readProjectDependencyNames(projectRoot);
  const nativeSourcePackages: string[] = [];

  for (const dependencyName of dependencyNames) {
    const manifest = await readDependencyManifest(projectRoot, dependencyName);
    if (manifest && typeof manifest["react-native"] === "string") {
      nativeSourcePackages.push(dependencyName);
    }
  }

  return nativeSourcePackages.sort();
}

async function readProjectDependencyNames(projectRoot: string): Promise<string[]> {
  const manifest = await readJsonFile(path.join(projectRoot, "package.json"));
  if (!manifest) {
    return [];
  }

  const dependencies = manifest["dependencies"];
  if (typeof dependencies !== "object" || dependencies === null) {
    return [];
  }

  return Object.keys(dependencies);
}

async function readDependencyManifest(
  projectRoot: string,
  dependencyName: string,
): Promise<Record<string, unknown> | null> {
  const directManifest = await readJsonFile(
    path.join(projectRoot, "node_modules", dependencyName, "package.json"),
  );
  if (directManifest) {
    return directManifest;
  }

  try {
    const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
    const manifestPath = requireFromProject.resolve(`${dependencyName}/package.json`);
    return await readJsonFile(manifestPath);
  } catch {
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const source = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
