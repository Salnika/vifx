import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";

export {
  clearProjectRequireChainCache,
  createProjectRequireChain,
  listFrameworkHostManifests,
  requireFromProject,
  resolveFromProject,
  resolveProjectImportSpecifier,
  type ProjectRequire,
} from "./project-require.ts";

export type VifxPlatform = "android" | "ios" | "native" | "web" | (string & {});

export interface ResolveReactNativeModuleOptions {
  conditions?: readonly string[];
  extensions?: readonly string[];
  fromFile: string;
  mainFields?: readonly string[];
  platform: VifxPlatform;
  platformPriority?: readonly string[];
  preserveSymlinks?: boolean;
  projectRoot: string;
  specifier: string;
}

export interface ResolutionTraceEntry {
  candidate?: string;
  exists?: boolean;
  found?: boolean;
  kind?: string;
  message: string;
  reason?: string;
  type: "candidate" | "condition" | "package" | "package-json" | "resolved" | "start" | "workspace";
  value?: string;
}

export interface ResolveReactNativeModuleResult {
  /**
   * `true` when a `browser`-style map in a package.json replaces the module
   * with `false`: it resolves to an empty module, as with Metro. `filePath` is
   * then the path or specifier that was replaced, not a file to load.
   */
  empty?: boolean;
  filePath: string;
  packageName?: string;
  packageRoot?: string;
  resolvedVia: "absolute" | "package" | "relative";
  trace: readonly ResolutionTraceEntry[];
}

interface PackageJsonShape {
  browser?: unknown;
  exports?: unknown;
  main?: unknown;
  module?: unknown;
  name?: unknown;
  ["react-native"]?: unknown;
  workspaces?: unknown;
}

/** A package directory and its package.json. */
interface PackageScope {
  packageJson: PackageJsonShape;
  root: string;
}

/** What a `browser`-style map puts in place of a path or module: another one, or `false` for nothing. */
type Replacement = string | false;

interface WorkspaceInfo {
  patterns: string[];
  root: string;
  source: "package.json" | "pnpm-workspace";
}

const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js", "json"] as const;
const DEFAULT_MAIN_FIELDS = ["react-native", "module", "main"] as const;

const DEFAULT_PLATFORM_PRIORITIES: Record<"android" | "ios" | "native" | "web", readonly string[]> =
  {
    android: ["android", "native"],
    ios: ["ios", "native"],
    native: ["native"],
    web: ["web", "native"],
  };

export function buildPlatformCandidates(
  basePath: string,
  platform: string,
  extensions: readonly string[],
): string[] {
  return buildCandidatePaths(
    basePath,
    normalizeExtensions(extensions),
    normalizePlatformPriority(platform, undefined),
  );
}

export async function resolveReactNativeModule(
  options: ResolveReactNativeModuleOptions,
): Promise<ResolveReactNativeModuleResult> {
  const trace: ResolutionTraceEntry[] = [];
  pushTrace(
    trace,
    "start",
    `Resolving "${options.specifier}" from "${options.fromFile}" for "${options.platform}".`,
  );

  const extensionOrder = normalizeExtensions(options.extensions);
  const platformPriority = normalizePlatformPriority(options.platform, options.platformPriority);
  // Lookups walk logical paths; the result is canonicalized once at the end
  // (see canonicalizeResolvedPath) unless the caller opts out.
  const preserveSymlinks = true;
  const canonicalize = (resolvedPath: string) =>
    options.preserveSymlinks === true
      ? Promise.resolve(resolvedPath)
      : canonicalizeResolvedPath(resolvedPath, options.projectRoot);
  const mainFields = normalizeMainFields(options.mainFields);
  const resolveBasePath = (basePath: string) =>
    resolveCandidateBasePath({
      basePath,
      extensionOrder,
      mainFields,
      platformPriority,
      preserveSymlinks,
      trace,
    });
  // A path, after the `browser`-style map of the package it is in (Metro's
  // `resolveModulePath`): the importer's package for a relative path, the
  // target's for an absolute one.
  const resolvePath = async (
    basePath: string,
    scope: PackageScope | null,
    resolvedVia: ResolveReactNativeModuleResult["resolvedVia"],
  ): Promise<ResolveReactNativeModuleResult> => {
    const redirected = redirectPackagePath(scope, basePath, mainFields, trace);
    if (redirected === false) {
      return { empty: true, filePath: basePath, resolvedVia, trace };
    }
    return { filePath: await canonicalize(await resolveBasePath(redirected)), resolvedVia, trace };
  };

  if (isPathLikeSpecifier(options.specifier)) {
    if (path.isAbsolute(options.specifier)) {
      const basePath = path.resolve(options.specifier);
      return resolvePath(basePath, await findClosestPackage(basePath), "absolute");
    }
    return resolvePath(
      path.resolve(path.dirname(options.fromFile), options.specifier),
      await findClosestPackage(options.fromFile),
      "relative",
    );
  }

  // A module the importer's own package replaces in its `browser`-style map:
  // nothing (`"fs": false`), a file of that package, or another module.
  let specifier = options.specifier;
  const originScope = await findClosestPackage(options.fromFile);
  const originReplacement = originScope
    ? matchReplacement(
        replacementMapOf(originScope.packageJson, mainFields),
        expandSubpathVariants(specifier),
      )
    : undefined;
  if (originScope && originReplacement !== undefined) {
    pushTrace(
      trace,
      "package-json",
      `Replaced "${specifier}" with ${JSON.stringify(originReplacement)} as mapped by "${path.join(originScope.root, "package.json")}".`,
    );
    if (originReplacement === false) {
      return { empty: true, filePath: specifier, resolvedVia: "package", trace };
    }
    if (isRelativeReplacement(originReplacement)) {
      const basePath = path.resolve(originScope.root, originReplacement);
      return resolvePath(basePath, await findClosestPackage(basePath), "relative");
    }
    if (path.isAbsolute(originReplacement)) {
      throw new VifxError({
        code: "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
        details: {
          packageJsonPath: path.join(originScope.root, "package.json"),
          specifier,
          trace: serializeResolutionTrace(trace),
        },
        hint: 'A "browser" field may replace a module with a path relative to its package.json, another module, or false.',
        message: `"${path.join(originScope.root, "package.json")}" replaces "${specifier}" with the absolute path "${originReplacement}".`,
      });
    }
    specifier = originReplacement;
  }

  const packageImport = parsePackageSpecifier(specifier);
  const packageLocation = await findPackageLocation({
    packageName: packageImport.packageName,
    preserveSymlinks,
    projectRoot: options.projectRoot,
    startDir: path.dirname(options.fromFile),
    trace,
  });

  if (!packageLocation) {
    throw new VifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        fromFile: options.fromFile,
        platform: options.platform,
        projectRoot: options.projectRoot,
        specifier,
        trace: serializeResolutionTrace(trace),
      },
      hint: `Install or link "${packageImport.packageName}", or ensure a matching workspace package exists.`,
      message: `Unable to resolve package "${packageImport.packageName}" from "${options.fromFile}".`,
    });
  }

  const packageJsonPath = path.join(packageLocation.root, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  pushTrace(trace, "package-json", `Loaded package.json for "${packageImport.packageName}".`, {
    candidate: packageJsonPath,
    exists: true,
  });

  const packageResult = async (basePath: string | false) => ({
    ...(basePath === false
      ? { empty: true, filePath: specifier }
      : { filePath: await canonicalize(await resolveBasePath(basePath)) }),
    packageName: packageImport.packageName,
    packageRoot: await canonicalize(packageLocation.root),
    resolvedVia: "package" as const,
    trace,
  });

  const conditions = buildResolutionConditions(options.platform, options.conditions);
  const exportsTargetPath = (subpath: string) => {
    const target = resolveExportsTarget(packageJson.exports, subpath, conditions, trace);
    return target ? path.resolve(packageLocation.root, target) : undefined;
  };

  if (packageImport.subpath !== ".") {
    // Like Metro, the package's own `browser`-style map replaces a subpath
    // before `exports` is read (multiformats maps `./hashes/sha2` this way):
    // the replacement is then looked up in `exports`, else read as a file.
    const subpathPath = path.resolve(packageLocation.root, packageImport.subpath);
    const redirected = redirectPackagePath(
      { packageJson, root: packageLocation.root },
      subpathPath,
      mainFields,
      trace,
    );
    if (redirected === false) {
      return packageResult(false);
    }
    if (redirected !== subpathPath) {
      const redirectedSubpath = path
        .relative(packageLocation.root, redirected)
        .split(path.sep)
        .join("/");
      return packageResult(exportsTargetPath(redirectedSubpath) ?? redirected);
    }
    return packageResult(exportsTargetPath(packageImport.subpath) ?? subpathPath);
  }

  // The package itself: its `exports`, else the entry its main fields declare.
  const exportsTarget = exportsTargetPath(".");
  if (exportsTarget) {
    return packageResult(exportsTarget);
  }
  const entry = selectMainEntry(packageJson, mainFields, trace);
  return packageResult(entry === false ? false : path.resolve(packageLocation.root, entry));
}

const realFileCache = new Map<string, Promise<string>>();

/**
 * One identity per file. A package is reachable through as many paths as it
 * has dependents on an isolated install (`node_modules/<name>` symlinks, one
 * per dependent, all pointing at the same virtual-store directory); returning
 * those paths as-is makes the bundler treat one file as several modules and
 * ship — and instantiate — it several times. Like Node and Metro, the resolver
 * therefore answers with the real path.
 *
 * Real paths under the project are mapped back onto the project root as it was
 * given, so a project that itself sits behind a symlink keeps one prefix.
 */
async function canonicalizeResolvedPath(filePath: string, projectRoot: string): Promise<string> {
  let cached = realFileCache.get(filePath);
  if (!cached) {
    cached = realpath(filePath).catch(() => filePath);
    realFileCache.set(filePath, cached);
  }

  const realFilePath = await cached;
  if (realFilePath === filePath) {
    return filePath;
  }

  const logicalRoot = path.resolve(projectRoot);
  if ((await realDirectory(logicalRoot)) === logicalRoot) {
    return realFilePath;
  }

  // The project sits behind a symlinked ancestor. Re-anchor the real path on
  // the deepest logical ancestor that contains it, so files in the project and
  // in its workspace siblings keep the prefix the project was opened with.
  for (const logicalAncestor of iterateAncestorDirectories(logicalRoot)) {
    const realAncestor = await realDirectory(logicalAncestor);
    if (realAncestor !== logicalAncestor && realFilePath.startsWith(`${realAncestor}${path.sep}`)) {
      return path.join(logicalAncestor, realFilePath.slice(realAncestor.length + 1));
    }
  }

  return realFilePath;
}

function buildResolutionConditions(
  platform: string,
  extraConditions: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const conditions = ["react-native", platform, ...(extraConditions ?? []), "import", "default"];
  return conditions.filter((condition) => {
    if (seen.has(condition)) {
      return false;
    }

    seen.add(condition);
    return true;
  });
}

async function expandPatternSegments(
  currentDirectory: string,
  segments: readonly string[],
  index: number,
): Promise<string[]> {
  const segment = segments[index];

  if (segment === undefined) {
    return [currentDirectory];
  }

  if (segment === "**") {
    const matches = await expandPatternSegments(currentDirectory, segments, index + 1);
    const childDirectories = await readDirectories(currentDirectory);

    for (const childDirectory of childDirectories) {
      const childMatches = await expandPatternSegments(childDirectory, segments, index);
      matches.push(...childMatches);
    }

    return dedupe(matches);
  }

  if (segment === "*") {
    const matches: string[] = [];
    const childDirectories = await readDirectories(currentDirectory);

    for (const childDirectory of childDirectories) {
      const childMatches = await expandPatternSegments(childDirectory, segments, index + 1);
      matches.push(...childMatches);
    }

    return dedupe(matches);
  }

  const nextDirectory = path.join(currentDirectory, segment);

  if (!(await isDirectory(nextDirectory))) {
    return [];
  }

  return expandPatternSegments(nextDirectory, segments, index + 1);
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const segments = normalizePattern(pattern).split("/").filter(Boolean);
  return expandPatternSegments(root, segments, 0);
}

async function findPackageLocation(options: {
  packageName: string;
  preserveSymlinks: boolean;
  projectRoot: string;
  startDir: string;
  trace: ResolutionTraceEntry[];
}): Promise<{ root: string } | undefined> {
  const candidateDirectories = dedupe([
    ...(await iterateRealAncestorDirectories(options.startDir, options.projectRoot)),
    ...iterateAncestorDirectories(options.startDir),
    ...iterateAncestorDirectories(options.projectRoot),
  ]);

  for (const directory of candidateDirectories) {
    const candidate = path.join(directory, "node_modules", options.packageName);
    const exists = await isDirectoryLike(candidate);
    pushTrace(options.trace, "package", `Checked node_modules package candidate "${candidate}".`, {
      candidate,
      exists,
    });

    if (exists) {
      return {
        root: await normalizeExistingPath(candidate, options.preserveSymlinks),
      };
    }
  }

  const workspace = await findWorkspaceRoot(options.projectRoot, options.trace);

  if (workspace) {
    for (const pattern of workspace.patterns) {
      const packageDirectories = await expandWorkspacePattern(workspace.root, pattern);

      for (const packageDirectory of packageDirectories) {
        const packageJsonPath = path.join(packageDirectory, "package.json");

        if (!(await isFile(packageJsonPath))) {
          continue;
        }

        const packageJson = await readPackageJson(packageJsonPath);
        const isMatch = packageJson.name === options.packageName;
        pushTrace(
          options.trace,
          "workspace",
          `Checked workspace package candidate "${packageDirectory}".`,
          { candidate: packageDirectory, exists: isMatch },
        );

        if (isMatch) {
          return {
            root: await normalizeExistingPath(packageDirectory, options.preserveSymlinks),
          };
        }
      }
    }
  }

  return findHeuristicWorkspacePackageRoot(options);
}

async function findWorkspaceRoot(
  startDirectory: string,
  trace: ResolutionTraceEntry[],
): Promise<WorkspaceInfo | undefined> {
  for (const directory of iterateAncestorDirectories(startDirectory)) {
    const pnpmWorkspacePath = path.join(directory, "pnpm-workspace.yaml");

    if (await isFile(pnpmWorkspacePath)) {
      pushTrace(trace, "workspace", `Found pnpm workspace root at "${directory}".`, {
        candidate: pnpmWorkspacePath,
        exists: true,
      });
      return {
        patterns: await readPnpmWorkspacePatterns(pnpmWorkspacePath),
        root: directory,
        source: "pnpm-workspace",
      };
    }

    const packageJsonPath = path.join(directory, "package.json");

    if (!(await isFile(packageJsonPath))) {
      continue;
    }

    const packageJson = await readPackageJson(packageJsonPath);
    const patterns = readWorkspacePatterns(packageJson);

    if (!patterns) {
      continue;
    }

    pushTrace(trace, "workspace", `Found package.json workspace root at "${directory}".`, {
      candidate: packageJsonPath,
      exists: true,
    });
    return {
      patterns,
      root: directory,
      source: "package.json",
    };
  }

  return undefined;
}

async function findCandidateMatch(options: {
  candidates: readonly string[];
  preserveSymlinks: boolean;
  trace: ResolutionTraceEntry[];
}): Promise<string | undefined> {
  for (const candidate of options.candidates) {
    await assertNoCaseAmbiguousCandidate(candidate, options.trace);
    const exists = await isFile(candidate);
    pushTrace(
      options.trace,
      exists ? "resolved" : "candidate",
      exists ? `Resolved "${candidate}".` : `Checked file candidate "${candidate}".`,
      { candidate, exists },
    );

    if (exists) {
      return normalizeExistingPath(candidate, options.preserveSymlinks);
    }
  }

  return undefined;
}

async function assertNoCaseAmbiguousCandidate(
  candidate: string,
  trace: readonly ResolutionTraceEntry[],
) {
  const directory = path.dirname(candidate);
  const basename = path.basename(candidate);
  const listing = await listDirectory(directory);
  const matches = (listing?.filesByLowerCaseName.get(basename.toLowerCase()) ?? [])
    .map((name) => path.join(directory, name))
    .sort();

  if (matches.length <= 1) {
    return;
  }

  throw new VifxError({
    code: "VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE",
    details: {
      candidate,
      filePaths: matches,
      trace: serializeResolutionTrace(trace),
    },
    hint: "Rename files so each platform candidate has one casing-stable path.",
    message: `Multiple case variants match platform candidate "${candidate}".`,
  });
}

function isConditionMap(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Object.keys(value).some((key) => key.startsWith("."));
}

function isPathLikeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function iterateAncestorDirectories(startDirectory: string): string[] {
  const directories: string[] = [];
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    directories.push(currentDirectory);
    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return directories;
    }

    currentDirectory = parentDirectory;
  }
}

const realDirectoryCache = new Map<string, Promise<string>>();

function realDirectory(directory: string): Promise<string> {
  const cached = realDirectoryCache.get(directory);
  if (cached) {
    return cached;
  }

  const resolved = realpath(directory).catch(() => directory);
  realDirectoryCache.set(directory, resolved);
  return resolved;
}

/**
 * Ancestors of the importer's REAL directory, searched before its logical ones.
 *
 * Node and Metro look packages up from the real location of the importing
 * file. That is what makes isolated installs (pnpm's default) work: a package
 * reached through the `node_modules/<name>` symlink keeps its dependencies next
 * to its real directory in the virtual store, not next to the symlink — and a
 * same-named package at the project root may be a different version.
 *
 * Real paths under the project are mapped back onto the project root as it was
 * given, so a project that itself lives behind a symlink (`/tmp` on macOS)
 * keeps one consistent path prefix. Empty when the importer is not behind a
 * symlink, which leaves hoisted installs resolving exactly as before.
 */
async function iterateRealAncestorDirectories(
  startDirectory: string,
  projectRoot: string,
): Promise<string[]> {
  const logicalStart = path.resolve(startDirectory);
  const realStart = await realDirectory(logicalStart);
  if (realStart === logicalStart) {
    return [];
  }

  const logicalRoot = path.resolve(projectRoot);
  const realRoot = await realDirectory(logicalRoot);

  return iterateAncestorDirectories(realStart).map((directory) => {
    if (realRoot === logicalRoot) {
      return directory;
    }

    if (directory === realRoot) {
      return logicalRoot;
    }

    return directory.startsWith(`${realRoot}${path.sep}`)
      ? path.join(logicalRoot, directory.slice(realRoot.length + 1))
      : directory;
  });
}

function normalizeExtensions(extensions: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized = (extensions ?? DEFAULT_EXTENSIONS)
    .map((extension) => extension.trim().replace(/^\./u, ""))
    .filter(Boolean);

  return normalized.filter((extension) => {
    if (seen.has(extension)) {
      return false;
    }

    seen.add(extension);
    return true;
  });
}

async function normalizeExistingPath(filePath: string, preserveSymlinks: boolean): Promise<string> {
  if (preserveSymlinks) {
    return filePath;
  }

  return realpath(filePath).catch(() => filePath);
}

function normalizePattern(pattern: string): string {
  return pattern
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "");
}

function normalizePlatformPriority(
  platform: string,
  platformPriority: readonly string[] | undefined,
): string[] {
  const priority = platformPriority
    ? [...platformPriority]
    : platform === "android" || platform === "ios" || platform === "native" || platform === "web"
      ? [...DEFAULT_PLATFORM_PRIORITIES[platform]]
      : platform === "native"
        ? ["native"]
        : [platform, "native"];
  const seen = new Set<string>();

  return priority.filter((entry) => {
    const normalized = entry.trim();

    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function normalizeMainFields(mainFields: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  return (mainFields ?? DEFAULT_MAIN_FIELDS)
    .map((field) => field.trim())
    .filter(Boolean)
    .filter((field) => {
      if (seen.has(field)) {
        return false;
      }

      seen.add(field);
      return true;
    });
}

function parsePackageSpecifier(specifier: string): { packageName: string; subpath: string } {
  const segments = specifier.split("/");

  if (specifier.startsWith("@")) {
    const scope = segments[0];
    const name = segments[1];

    if (!scope || !name) {
      throw new VifxError({
        code: "VIFX_RESOLVE_INVALID_SPECIFIER",
        details: {
          specifier,
        },
        hint: 'Use a complete scoped package name such as "@scope/name".',
        message: `Invalid scoped package specifier "${specifier}".`,
      });
    }

    return {
      packageName: `${scope}/${name}`,
      subpath: segments.slice(2).join("/") || ".",
    };
  }

  const packageName = segments[0];

  if (!packageName) {
    throw new VifxError({
      code: "VIFX_RESOLVE_INVALID_SPECIFIER",
      details: {
        specifier,
      },
      hint: "Pass a non-empty package name or a relative/absolute path.",
      message: `Invalid package specifier "${specifier}".`,
    });
  }

  return {
    packageName,
    subpath: segments.slice(1).join("/") || ".",
  };
}

function pushTrace(
  trace: ResolutionTraceEntry[],
  type: ResolutionTraceEntry["type"],
  message: string,
  extra: Partial<ResolutionTraceEntry> = {},
): void {
  trace.push({
    ...extra,
    found: extra.exists,
    kind: extra.kind ?? type,
    message,
    reason: extra.reason ?? message,
    type,
    value: extra.value ?? extra.candidate,
  });
}

function serializeResolutionTrace(
  trace: readonly ResolutionTraceEntry[],
): Record<string, boolean | string>[] {
  return trace.map((entry) => {
    const serialized: Record<string, boolean | string> = {
      message: entry.message,
      type: entry.type,
    };

    if (entry.candidate !== undefined) {
      serialized.candidate = entry.candidate;
    }

    if (entry.exists !== undefined) {
      serialized.exists = entry.exists;
    }

    if (entry.found !== undefined) {
      serialized.found = entry.found;
    }

    if (entry.kind !== undefined) {
      serialized.kind = entry.kind;
    }

    if (entry.reason !== undefined) {
      serialized.reason = entry.reason;
    }

    if (entry.value !== undefined) {
      serialized.value = entry.value;
    }

    return serialized;
  });
}

async function readDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !shouldSkipWorkspaceDirectory(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

function readPackageJson(packageJsonPath: string): Promise<PackageJsonShape> {
  let cached = packageJsonCache.get(packageJsonPath);
  if (!cached) {
    cached = parsePackageJson(packageJsonPath);
    packageJsonCache.set(packageJsonPath, cached);
  }
  return cached;
}

async function parsePackageJson(packageJsonPath: string): Promise<PackageJsonShape> {
  const source = await readFile(packageJsonPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new VifxError({
      code: "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
      cause: error,
      details: {
        packageJsonPath,
      },
      hint: "Fix the package.json syntax before resolving React Native package entries.",
      message: `Invalid package.json syntax at "${packageJsonPath}".`,
    });
  }

  if (!isRecord(parsed)) {
    throw new VifxError({
      code: "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
      details: {
        packageJsonPath,
      },
      hint: "Ensure package.json contains a JSON object.",
      message: `Invalid package.json shape at "${packageJsonPath}".`,
    });
  }

  return parsed as PackageJsonShape;
}

async function readPnpmWorkspacePatterns(pnpmWorkspacePath: string): Promise<string[]> {
  const source = await readFile(pnpmWorkspacePath, "utf8");
  const patterns: string[] = [];
  let insidePackagesSection = false;

  for (const line of source.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine === "packages:") {
      insidePackagesSection = true;
      continue;
    }

    if (!insidePackagesSection) {
      continue;
    }

    if (/^[\w-]+:/u.test(trimmedLine)) {
      break;
    }

    const match = trimmedLine.match(/^-\s+(.+)$/u);
    const rawPattern = match?.[1];

    if (!rawPattern) {
      continue;
    }

    patterns.push(stripWrappingQuotes(rawPattern));
  }

  return dedupe(patterns);
}

function readWorkspacePatterns(packageJson: PackageJsonShape): string[] | undefined {
  const workspaces = packageJson.workspaces;

  if (Array.isArray(workspaces)) {
    return dedupe(workspaces.filter((entry): entry is string => typeof entry === "string"));
  }

  if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return dedupe(
      workspaces.packages.filter((entry): entry is string => typeof entry === "string"),
    );
  }

  return undefined;
}

interface ResolveCandidateBasePathOptions {
  basePath: string;
  extensionOrder: readonly string[];
  /** Main fields consulted when `basePath` is a directory with a package.json. */
  mainFields: readonly string[];
  platformPriority: readonly string[];
  preserveSymlinks: boolean;
  trace: ResolutionTraceEntry[];
}

/**
 * Entry file declared by a package.json sitting directly in `basePath`, or
 * `undefined` when there is none (or it points nowhere), in which case the
 * caller falls back to `index.*`.
 */
async function resolveDirectoryPackageEntry(
  options: ResolveCandidateBasePathOptions,
): Promise<string | undefined> {
  const packageJsonPath = path.join(options.basePath, "package.json");
  if (!(await isFile(packageJsonPath))) {
    return undefined;
  }

  const packageJson = await readPackageJson(packageJsonPath);
  const declaresEntry = options.mainFields.some((mainField) => {
    const value = packageJson[mainField as keyof PackageJsonShape];
    return typeof value === "string" && value !== "";
  });
  const entry = selectMainEntry(packageJson, options.mainFields, options.trace);
  // Nothing declared or replaced: the caller falls back to `index.*` itself.
  if (entry === false || (!declaresEntry && entry === "index")) {
    return undefined;
  }

  const entryBasePath = path.resolve(options.basePath, entry);
  // A package.json whose entry points back at its own directory would recurse.
  if (entryBasePath === path.resolve(options.basePath)) {
    return undefined;
  }

  pushTrace(options.trace, "package-json", `Matched a directory package.json entry "${entry}".`, {
    candidate: packageJsonPath,
    exists: true,
  });

  return resolveCandidateBasePath({ ...options, basePath: entryBasePath }).catch(() => undefined);
}

async function resolveCandidateBasePath(options: ResolveCandidateBasePathOptions): Promise<string> {
  // A path that names an existing file is that file, whatever its extension:
  // `exports` / `main` targets such as "./esm.mjs" are exact, and the
  // configured extension list only drives the lookup of extension-less paths.
  if (
    path.extname(options.basePath) !== "" &&
    !hasExplicitExtension(options.basePath, options.extensionOrder) &&
    (await isFile(options.basePath))
  ) {
    pushTrace(options.trace, "resolved", `Resolved the exact file "${options.basePath}".`, {
      candidate: options.basePath,
      exists: true,
    });
    return normalizeExistingPath(options.basePath, options.preserveSymlinks);
  }

  const directMatch = await findCandidateMatch({
    candidates: buildCandidatePaths(
      options.basePath,
      options.extensionOrder,
      options.platformPriority,
    ),
    preserveSymlinks: options.preserveSymlinks,
    trace: options.trace,
  });

  if (directMatch) {
    return directMatch;
  }

  if (hasExplicitExtension(options.basePath, options.extensionOrder)) {
    throw new VifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        basePath: options.basePath,
        trace: serializeResolutionTrace(options.trace),
      },
      hint: "Verify that the explicit path exists or remove the extension so platform fallbacks can apply.",
      message: `Unable to resolve the explicit file "${options.basePath}".`,
    });
  }

  // A directory carrying its own package.json is a package entry point in its
  // own right: `pkg/presets/decimal/package.json` -> { "react-native": "../.." }.
  // Node (`main`) and Metro (the configured main fields) both honor it, and
  // libraries rely on it to ship per-subpath entries without an `exports` map.
  const nestedEntry = await resolveDirectoryPackageEntry(options);
  if (nestedEntry) {
    return nestedEntry;
  }

  const indexMatch = await findCandidateMatch({
    candidates: buildCandidatePaths(
      path.join(options.basePath, "index"),
      options.extensionOrder,
      options.platformPriority,
    ),
    preserveSymlinks: options.preserveSymlinks,
    trace: options.trace,
  });

  if (indexMatch) {
    return indexMatch;
  }

  throw new VifxError({
    code: "VIFX_RESOLVE_NOT_FOUND",
    details: {
      basePath: options.basePath,
      trace: serializeResolutionTrace(options.trace),
    },
    hint: "Add a platform-specific file, a base file, or an index file matching the configured extension order.",
    message: `Unable to resolve a file for "${options.basePath}".`,
  });
}

function buildCandidatePaths(
  basePath: string,
  extensionOrder: readonly string[],
  platformPriority: readonly string[],
): string[] {
  if (hasExplicitExtension(basePath, extensionOrder)) {
    return [basePath];
  }

  const candidates: string[] = [];

  for (const extension of extensionOrder) {
    for (const platformSuffix of [...platformPriority, ""]) {
      const suffix = platformSuffix ? `.${platformSuffix}` : "";
      candidates.push(`${basePath}${suffix}.${extension}`);
    }
  }

  return dedupe(candidates);
}

async function findHeuristicWorkspacePackageRoot(options: {
  packageName: string;
  preserveSymlinks: boolean;
  projectRoot: string;
  trace: ResolutionTraceEntry[];
}): Promise<{ root: string } | undefined> {
  for (const searchRoot of [
    path.join(options.projectRoot, "packages"),
    path.join(options.projectRoot, "apps"),
  ]) {
    if (!(await isDirectory(searchRoot))) {
      continue;
    }

    const packageDirectories = await readDirectories(searchRoot);

    for (const packageDirectory of packageDirectories) {
      const packageJsonPath = path.join(packageDirectory, "package.json");

      if (!(await isFile(packageJsonPath))) {
        continue;
      }

      const packageJson = await readPackageJson(packageJsonPath);
      const isMatch = packageJson.name === options.packageName;
      pushTrace(
        options.trace,
        "workspace",
        `Checked heuristic workspace package candidate "${packageDirectory}".`,
        { candidate: packageDirectory, exists: isMatch },
      );

      if (isMatch) {
        return {
          root: await normalizeExistingPath(packageDirectory, options.preserveSymlinks),
        };
      }
    }
  }

  return undefined;
}

function hasExplicitExtension(basePath: string, extensionOrder: readonly string[]): boolean {
  const extension = path.extname(basePath).slice(1);
  return extension ? extensionOrder.includes(extension) : false;
}

// ---------------------------------------------------------------------------
// `browser`-style maps
//
// A main field whose value is an object instead of a path (`"browser": { … }`,
// sometimes `"react-native": { … }`) maps files and modules to replacements, as
// in https://github.com/defunctzombie/package-browser-field-spec. Metro applies
// the maps of every listed main field (React Native and Expo list `react-native`,
// `browser`, `main` for iOS and Android), and so does this resolver:
//
// - to the entry its main fields declare (`"./lib/index.js": "./lib/browser.js"`);
// - to the paths inside the package, whether imported by the package itself or
//   through a subpath (`pkg/lib/node`);
// - to the modules the package imports (`"fs": false`, `"crypto": "./shim.js"`,
//   `"util": "util-polyfill"`).
//
// `false` stands for an empty module. Like Metro, the package that applies is
// the closest package.json above the importing file (or above the path, for
// an absolute one), and keys are matched with `.js` and `.json` appended too.
// ---------------------------------------------------------------------------

const replacementMapCache = new WeakMap<
  PackageJsonShape,
  Map<string, ReadonlyMap<string, Replacement> | null>
>();

/**
 * The object-valued main fields of a package.json merged into one map, earlier
 * main fields winning a conflict (Metro's `matchSubpathFromMainFields`). `null`
 * when none of them is an object, the usual case.
 */
function replacementMapOf(
  packageJson: PackageJsonShape,
  mainFields: readonly string[],
): ReadonlyMap<string, Replacement> | null {
  const key = mainFields.join("\0");
  let byMainFields = replacementMapCache.get(packageJson);
  if (!byMainFields) {
    byMainFields = new Map();
    replacementMapCache.set(packageJson, byMainFields);
  }
  if (byMainFields.has(key)) {
    return byMainFields.get(key) ?? null;
  }

  let replacements: Map<string, Replacement> | null = null;
  for (let index = mainFields.length - 1; index >= 0; index -= 1) {
    const value = packageJson[mainFields[index] as keyof PackageJsonShape];
    if (!isRecord(value) || Array.isArray(value)) {
      continue;
    }
    replacements ??= new Map();
    for (const [from, to] of Object.entries(value)) {
      if (typeof to === "string" || to === false) {
        replacements.set(from, to);
      }
    }
  }

  byMainFields.set(key, replacements);
  return replacements;
}

function matchReplacement(
  replacements: ReadonlyMap<string, Replacement> | null,
  variants: readonly string[],
): Replacement | undefined {
  if (!replacements) {
    return undefined;
  }
  for (const variant of variants) {
    const replacement = replacements.get(variant);
    if (replacement !== undefined) {
      return replacement;
    }
  }
  return undefined;
}

/** The keys a path or module is looked up under in a map: as written, then with `.js` and `.json`. */
function expandSubpathVariants(subpath: string): string[] {
  return [subpath, `${subpath}.js`, `${subpath}.json`];
}

/**
 * The keys a main entry is looked up under: with and without `./`, each as
 * written, with `.js` or `.json` added, and without its extension (Metro's
 * `getPackageEntryPoint`).
 */
function expandMainVariants(main: string): string[] {
  const toggled = main.startsWith("./") ? main.slice(2) : `./${main}`;
  return [main, toggled].flatMap((variant) => [
    variant,
    `${variant}.js`,
    `${variant}.json`,
    variant.replace(/\.(js|json)$/u, ""),
  ]);
}

function isRelativeReplacement(replacement: string): boolean {
  return /^\.\.?(?:\/|$)/u.test(replacement);
}

/**
 * The entry a package.json gives its directory: the first non-empty string
 * main field, `index` when there is none, unless a `browser`-style map
 * replaces it (Metro's `getPackageEntryPoint`). `false` when the map replaces
 * it with an empty module.
 */
function selectMainEntry(
  packageJson: PackageJsonShape,
  mainFields: readonly string[],
  trace: ResolutionTraceEntry[],
): string | false {
  let main = "index";
  for (const mainField of mainFields) {
    const entry = packageJson[mainField as keyof PackageJsonShape];
    if (typeof entry === "string" && entry !== "") {
      pushTrace(trace, "package-json", `Matched package main field "${mainField}".`);
      main = entry;
      break;
    }
  }

  const replacement = matchReplacement(
    replacementMapOf(packageJson, mainFields),
    expandMainVariants(main),
  );
  if (replacement === undefined) {
    return main;
  }

  pushTrace(
    trace,
    "package-json",
    `Replaced the entry "${main}" with ${JSON.stringify(replacement)}.`,
  );
  return replacement;
}

/**
 * What the `browser`-style map of `scope` puts in place of `targetPath`, a
 * path in that package with or without extension: another path, `false` for
 * an empty module, or `targetPath` itself (Metro's `redirectModulePath`).
 */
function redirectPackagePath(
  scope: PackageScope | null,
  targetPath: string,
  mainFields: readonly string[],
  trace: ResolutionTraceEntry[],
): string | false {
  const replacements = scope ? replacementMapOf(scope.packageJson, mainFields) : null;
  if (!scope || !replacements) {
    return targetPath;
  }

  const packagePath = `./${path.relative(scope.root, targetPath).split(path.sep).join("/")}`;
  const replacement = matchReplacement(replacements, expandSubpathVariants(packagePath));
  if (replacement === undefined) {
    return targetPath;
  }

  pushTrace(
    trace,
    "package-json",
    `Replaced "${packagePath}" with ${JSON.stringify(replacement)} as mapped by "${path.join(scope.root, "package.json")}".`,
  );
  if (replacement === false) {
    return false;
  }
  // Like Metro, a replacement is read as a path relative to the package.json.
  return path.isAbsolute(replacement)
    ? path.normalize(replacement)
    : path.join(scope.root, replacement);
}

const closestPackageCache = new Map<string, Promise<PackageScope | null>>();

/**
 * The package a file belongs to: the closest directory above it with a
 * package.json (Metro's `getPackageForModule`), `null` when there is none.
 */
function findClosestPackage(filePath: string): Promise<PackageScope | null> {
  return findPackageAbove(path.dirname(path.resolve(filePath)));
}

function findPackageAbove(directory: string): Promise<PackageScope | null> {
  let cached = closestPackageCache.get(directory);
  if (!cached) {
    cached = (async () => {
      const packageJsonPath = path.join(directory, "package.json");
      if (await isFile(packageJsonPath)) {
        // A manifest that does not parse maps nothing; it fails where it is
        // resolved as a package instead.
        const packageJson = await readPackageJson(packageJsonPath).catch(
          (): PackageJsonShape => ({}),
        );
        return { packageJson, root: directory };
      }
      const parent = path.dirname(directory);
      return parent === directory ? null : findPackageAbove(parent);
    })();
    closestPackageCache.set(directory, cached);
  }
  return cached;
}

function resolveExportsTarget(
  exportsField: unknown,
  subpath: string,
  conditions: readonly string[],
  trace: ResolutionTraceEntry[],
): string | undefined {
  if (
    typeof exportsField === "string" ||
    Array.isArray(exportsField) ||
    isConditionMap(exportsField)
  ) {
    return subpath === "." ? resolveExportsValue(exportsField, conditions, trace) : undefined;
  }

  if (!isRecord(exportsField)) {
    return undefined;
  }

  const exportKey = subpath === "." ? "." : `./${subpath}`;

  if (!(exportKey in exportsField)) {
    return undefined;
  }

  return resolveExportsValue(exportsField[exportKey], conditions, trace);
}

function resolveExportsValue(
  value: unknown,
  conditions: readonly string[],
  trace: ResolutionTraceEntry[],
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveExportsValue(item, conditions, trace);

      if (resolved) {
        return resolved;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const condition of conditions) {
    if (!(condition in value)) {
      continue;
    }

    pushTrace(trace, "condition", `Matched package export condition "${condition}".`);
    const resolved = resolveExportsValue(value[condition], conditions, trace);

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// In-memory view of the file system
//
// Resolving one import probes many candidates (platform x extension variants,
// then `index.*`, in every `node_modules` up the tree). Asking the disk about
// each of them made resolution the dominant cost of a warm build: thousands of
// imports, each re-reading whole directories. A directory is instead listed
// once and every later question about its entries is answered from memory —
// the idea behind Metro's file map, but lazy: only directories a resolution
// actually looks into are ever read.
//
// Lookups are exact-case, like Metro's and like a case-sensitive file system,
// so an import that only works because macOS ignores case fails here too
// instead of failing later in CI.
// ---------------------------------------------------------------------------

interface DirectoryListing {
  directories: Set<string>;
  files: Set<string>;
  /** Regular files grouped by lower-cased name, to spot case-only duplicates. */
  filesByLowerCaseName: Map<string, string[]>;
  symlinks: Set<string>;
}

const directoryListingCache = new Map<string, Promise<DirectoryListing | null>>();
const symlinkTargetKindCache = new Map<string, Promise<"directory" | "file" | "missing">>();
const packageJsonCache = new Map<string, Promise<PackageJsonShape>>();

/**
 * Forgets everything the resolver has learned about the file system. Call it
 * whenever files may have been added, removed or re-linked: at the start of a
 * build, and from a file watcher on add / unlink events. A plain content change
 * does not affect resolution and needs no reset.
 */
export function clearResolverCaches(): void {
  directoryListingCache.clear();
  symlinkTargetKindCache.clear();
  packageJsonCache.clear();
  closestPackageCache.clear();
  realDirectoryCache.clear();
  realFileCache.clear();
}

/**
 * Forgets what is known about one path after it changed on disk: the listing of
 * its parent directory (the entry may have appeared or disappeared), its own
 * listing if it is a directory, and anything derived from its content. Cheap
 * enough to call for every file-watcher event, whatever its kind.
 */
export function invalidateResolverPath(changedPath: string): void {
  const absolutePath = path.resolve(changedPath);
  directoryListingCache.delete(path.dirname(absolutePath));
  directoryListingCache.delete(absolutePath);
  symlinkTargetKindCache.delete(absolutePath);
  packageJsonCache.delete(absolutePath);
  realDirectoryCache.delete(absolutePath);
  realFileCache.delete(absolutePath);
  // A package.json that appears, goes or changes moves every file below it to
  // another package scope or changes its maps.
  if (path.basename(absolutePath) === "package.json") {
    closestPackageCache.clear();
  }
}

function listDirectory(directory: string): Promise<DirectoryListing | null> {
  let cached = directoryListingCache.get(directory);
  if (!cached) {
    cached = readDirectoryListing(directory);
    directoryListingCache.set(directory, cached);
  }
  return cached;
}

async function readDirectoryListing(directory: string): Promise<DirectoryListing | null> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return null;
  }

  const listing: DirectoryListing = {
    directories: new Set(),
    files: new Set(),
    filesByLowerCaseName: new Map(),
    symlinks: new Set(),
  };
  for (const entry of entries) {
    if (entry.isDirectory()) {
      listing.directories.add(entry.name);
    } else if (entry.isSymbolicLink()) {
      listing.symlinks.add(entry.name);
    } else if (entry.isFile()) {
      listing.files.add(entry.name);
      const lowerCaseName = entry.name.toLowerCase();
      const sameName = listing.filesByLowerCaseName.get(lowerCaseName);
      if (sameName) {
        sameName.push(entry.name);
      } else {
        listing.filesByLowerCaseName.set(lowerCaseName, [entry.name]);
      }
    }
  }
  return listing;
}

/** What a symlink points at; the only question that still needs a `stat`. */
function symlinkTargetKind(linkPath: string): Promise<"directory" | "file" | "missing"> {
  let cached = symlinkTargetKindCache.get(linkPath);
  if (!cached) {
    cached = stat(linkPath).then(
      (linkStat) => (linkStat.isDirectory() ? "directory" : linkStat.isFile() ? "file" : "missing"),
      () => "missing" as const,
    );
    symlinkTargetKindCache.set(linkPath, cached);
  }
  return cached;
}

async function entryKind(entryPath: string): Promise<"directory" | "file" | "missing" | "symlink"> {
  const parent = path.dirname(entryPath);
  if (parent === entryPath) {
    // A file system root has no parent listing to consult.
    return (await stat(entryPath).catch(() => undefined))?.isDirectory() ? "directory" : "missing";
  }

  const listing = await listDirectory(parent);
  const name = path.basename(entryPath);
  if (!listing) {
    return "missing";
  }
  if (listing.files.has(name)) {
    return "file";
  }
  if (listing.directories.has(name)) {
    return "directory";
  }
  return listing.symlinks.has(name) ? "symlink" : "missing";
}

async function isDirectory(directory: string): Promise<boolean> {
  const kind = await entryKind(directory);
  return kind === "symlink"
    ? (await symlinkTargetKind(directory)) === "directory"
    : kind === "directory";
}

async function isDirectoryLike(directory: string): Promise<boolean> {
  const kind = await entryKind(directory);
  return kind === "directory" || kind === "symlink";
}

async function isFile(filePath: string): Promise<boolean> {
  const kind = await entryKind(filePath);
  return kind === "symlink" ? (await symlinkTargetKind(filePath)) === "file" : kind === "file";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function shouldSkipWorkspaceDirectory(directoryName: string): boolean {
  return directoryName === ".git" || directoryName === "dist" || directoryName === "node_modules";
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

export async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}
