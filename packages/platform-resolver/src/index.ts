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
  filePath: string;
  packageName?: string;
  packageRoot?: string;
  resolvedVia: "absolute" | "package" | "relative";
  trace: readonly ResolutionTraceEntry[];
}

interface PackageJsonShape {
  exports?: unknown;
  main?: unknown;
  module?: unknown;
  name?: unknown;
  ["react-native"]?: unknown;
  workspaces?: unknown;
}

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

  if (isPathLikeSpecifier(options.specifier)) {
    const basePath = path.isAbsolute(options.specifier)
      ? path.resolve(options.specifier)
      : path.resolve(path.dirname(options.fromFile), options.specifier);
    const filePath = await resolveCandidateBasePath({
      basePath,
      extensionOrder,
      mainFields,
      platformPriority,
      preserveSymlinks,
      trace,
    });
    return {
      filePath: await canonicalize(filePath),
      resolvedVia: path.isAbsolute(options.specifier) ? "absolute" : "relative",
      trace,
    };
  }

  const packageImport = parsePackageSpecifier(options.specifier);
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
        specifier: options.specifier,
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

  const packageTarget = selectPackageEntryTarget(
    packageJson,
    packageImport.subpath,
    buildResolutionConditions(options.platform, options.conditions),
    mainFields,
    trace,
  );
  const fallbackBasePath = packageTarget
    ? path.resolve(packageLocation.root, packageTarget)
    : packageImport.subpath === "."
      ? path.join(packageLocation.root, "index")
      : undefined;

  if (!fallbackBasePath) {
    throw new VifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        packageJsonPath,
        specifier: options.specifier,
        trace: serializeResolutionTrace(trace),
      },
      hint: `Expose "${options.specifier}" via "react-native", "exports", or a resolvable file on disk.`,
      message: `Package "${packageImport.packageName}" does not expose "${packageImport.subpath}".`,
    });
  }

  const filePath = await resolveCandidateBasePath({
    basePath: fallbackBasePath,
    extensionOrder,
    mainFields,
    platformPriority,
    preserveSymlinks,
    trace,
  });

  return {
    filePath: await canonicalize(filePath),
    packageName: packageImport.packageName,
    packageRoot: await canonicalize(packageLocation.root),
    resolvedVia: "package",
    trace,
  };
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
  const entry = options.mainFields
    .map((mainField) => packageJson[mainField as keyof PackageJsonShape])
    .find((value): value is string => typeof value === "string" && value !== "");
  if (!entry) {
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

function selectPackageEntryTarget(
  packageJson: PackageJsonShape,
  subpath: string,
  conditions: readonly string[],
  mainFields: readonly string[],
  trace: ResolutionTraceEntry[],
): string | undefined {
  const exportsTarget = resolveExportsTarget(packageJson.exports, subpath, conditions, trace);

  if (exportsTarget) {
    return exportsTarget;
  }

  if (subpath !== ".") {
    return subpath;
  }

  for (const mainField of mainFields) {
    const entry = packageJson[mainField as keyof PackageJsonShape];
    if (typeof entry === "string") {
      pushTrace(trace, "package-json", `Matched package main field "${mainField}".`);
      return entry;
    }
  }

  return undefined;
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
