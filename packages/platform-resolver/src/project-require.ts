import { createRequire } from "node:module";
import path from "node:path";

/**
 * Packages whose own dependency tree carries React Native / Expo framework
 * internals: the Babel toolchain, the JS polyfills, the asset registry, the
 * Metro runtime shims.
 *
 * Under an isolated `node_modules` layout (pnpm's default) those internals are
 * transitive dependencies of these packages and are NOT resolvable from the
 * project root. Metro and Expo CLI still find them, because they resolve
 * relative to the package that depends on them. Vifx generates virtual modules
 * that have no real location, so it has to walk through the same packages
 * explicitly.
 */
const FRAMEWORK_HOST_PACKAGES = [
  "expo",
  "react-native",
  "expo-router",
  "babel-preset-expo",
  "@expo/metro-config",
  "@expo/cli",
  "@react-native/babel-preset",
  "@react-native/metro-config",
] as const;

export type ProjectRequire = ReturnType<typeof createRequire>;

interface ProjectResolutionAnchor {
  /** `package.json` the lookups start from. */
  manifestPath: string;
  require: ProjectRequire;
}

const anchorCache = new Map<string, ProjectResolutionAnchor[]>();

/**
 * Anchors to try in order: the project root first (an explicit dependency
 * always wins), then every installed framework host package, including hosts
 * only reachable through another host (`expo` -> `@expo/metro-config`).
 */
function collectProjectResolutionAnchors(projectRoot: string): ProjectResolutionAnchor[] {
  const cached = anchorCache.get(projectRoot);
  if (cached) {
    return cached;
  }

  const rootManifestPath = path.join(projectRoot, "package.json");
  const anchors: ProjectResolutionAnchor[] = [
    { manifestPath: rootManifestPath, require: createRequire(rootManifestPath) },
  ];
  const seen = new Set<string>();

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (!anchor) {
      continue;
    }

    for (const hostPackage of FRAMEWORK_HOST_PACKAGES) {
      let manifestPath: string;
      try {
        manifestPath = anchor.require.resolve(`${hostPackage}/package.json`);
      } catch {
        continue;
      }

      if (!seen.has(manifestPath)) {
        seen.add(manifestPath);
        anchors.push({ manifestPath, require: createRequire(manifestPath) });
      }
    }
  }

  anchorCache.set(projectRoot, anchors);
  return anchors;
}

/** Require functions for {@link collectProjectResolutionAnchors}, in order. */
export function createProjectRequireChain(projectRoot: string): readonly ProjectRequire[] {
  return collectProjectResolutionAnchors(projectRoot).map((anchor) => anchor.require);
}

/**
 * `package.json` paths of the installed framework host packages (the project
 * root excluded). A resolver that works on importer paths rather than Node's
 * `require` uses these as fallback importers.
 */
export function listFrameworkHostManifests(projectRoot: string): string[] {
  return collectProjectResolutionAnchors(projectRoot)
    .slice(1)
    .map((anchor) => anchor.manifestPath);
}

/** Forgets cached require chains (a dependency install changes what resolves). */
export function clearProjectRequireChainCache(): void {
  anchorCache.clear();
}

/**
 * Resolves `request` from the project root, falling back to the framework host
 * packages. Returns the absolute file path, or `null` when nothing provides it.
 */
export function resolveFromProject(projectRoot: string, request: string): string | null {
  for (const requireFrom of createProjectRequireChain(projectRoot)) {
    try {
      return requireFrom.resolve(request);
    } catch {
      // Not reachable from this package; try the next one.
    }
  }

  return null;
}

/**
 * Loads `request` the same way {@link resolveFromProject} resolves it. Returns
 * `null` when it is not installed; a module that resolves but throws while
 * loading still throws.
 */
export function requireFromProject(projectRoot: string, request: string): unknown {
  for (const requireFrom of createProjectRequireChain(projectRoot)) {
    let resolved: string;
    try {
      resolved = requireFrom.resolve(request);
    } catch {
      continue;
    }

    return requireFrom(resolved);
  }

  return null;
}

/**
 * The specifier a generated (virtual) module must use to import `request`.
 *
 * When the project root resolves `request` itself the bare specifier is kept,
 * so hoisted installs emit exactly what they always did. Otherwise the absolute
 * path found through a framework host package is returned, because a virtual
 * module has no location to resolve a bare specifier from. `null` when
 * `request` is not installed at all.
 */
export function resolveProjectImportSpecifier(projectRoot: string, request: string): string | null {
  const [requireFromRoot] = createProjectRequireChain(projectRoot);
  try {
    requireFromRoot?.resolve(request);
    return request;
  } catch {
    // Fall through to the framework host packages.
  }

  const resolved = resolveFromProject(projectRoot, request);
  return resolved === null ? null : resolved.split(path.sep).join("/");
}
