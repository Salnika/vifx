import { access, lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type VifxPlatform = "android" | "ios" | "native" | "web" | (string & {});

export interface ResolveReactNativeModuleOptions {
  conditions?: readonly string[];
  extensions?: readonly string[];
  fromFile: string;
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

interface VifxErrorOptions {
  cause?: unknown;
  code: string;
  details?: unknown;
  hint?: string;
  message: string;
}

interface WorkspaceInfo {
  patterns: string[];
  root: string;
  source: "package.json" | "pnpm-workspace";
}

const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js", "json"] as const;

const DEFAULT_PLATFORM_PRIORITIES: Record<"android" | "ios" | "native" | "web", readonly string[]> =
  {
    android: ["android", "native"],
    ios: ["ios", "native"],
    native: ["native"],
    web: ["web", "native"],
  };

class LocalVifxError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly hint?: string;

  constructor(options: VifxErrorOptions) {
    super(options.message, { cause: options.cause });
    this.code = options.code;
    this.details = options.details;
    this.hint = options.hint;
    this.name = "VifxError";
  }
}

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
  const preserveSymlinks = options.preserveSymlinks ?? true;

  if (isPathLikeSpecifier(options.specifier)) {
    const basePath = path.isAbsolute(options.specifier)
      ? path.resolve(options.specifier)
      : path.resolve(path.dirname(options.fromFile), options.specifier);
    const filePath = await resolveCandidateBasePath({
      basePath,
      extensionOrder,
      platformPriority,
      preserveSymlinks,
      trace,
    });
    return {
      filePath,
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
    throw await createVifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        fromFile: options.fromFile,
        platform: options.platform,
        projectRoot: options.projectRoot,
        specifier: options.specifier,
        trace,
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
    trace,
  );
  const fallbackBasePath = packageTarget
    ? path.resolve(packageLocation.root, packageTarget)
    : packageImport.subpath === "."
      ? path.join(packageLocation.root, "index")
      : undefined;

  if (!fallbackBasePath) {
    throw await createVifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        packageJsonPath,
        specifier: options.specifier,
        trace,
      },
      hint: `Expose "${options.specifier}" via "react-native", "exports", or a resolvable file on disk.`,
      message: `Package "${packageImport.packageName}" does not expose "${packageImport.subpath}".`,
    });
  }

  const filePath = await resolveCandidateBasePath({
    basePath: fallbackBasePath,
    extensionOrder,
    platformPriority,
    preserveSymlinks,
    trace,
  });

  return {
    filePath,
    packageName: packageImport.packageName,
    packageRoot: packageLocation.root,
    resolvedVia: "package",
    trace,
  };
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

async function createVifxError(options: VifxErrorOptions): Promise<Error> {
  const moduleName = "@vifx/errors";

  try {
    const imported = (await import(moduleName)) as Record<string, unknown>;
    const create = imported.createVifxError;

    if (typeof create === "function") {
      return (create as (value: VifxErrorOptions) => Error)(options);
    }

    const VifxError = imported.VifxError;

    if (typeof VifxError === "function") {
      return new (VifxError as new (value: VifxErrorOptions) => Error)(options);
    }
  } catch {
    // Keep the first-pass resolver self-contained when the shared errors package
    // is not available yet.
  }

  return new LocalVifxError(options);
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

function parsePackageSpecifier(specifier: string): { packageName: string; subpath: string } {
  const segments = specifier.split("/");

  if (specifier.startsWith("@")) {
    const scope = segments[0];
    const name = segments[1];

    if (!scope || !name) {
      throw new Error(`Invalid scoped package specifier "${specifier}".`);
    }

    return {
      packageName: `${scope}/${name}`,
      subpath: segments.slice(2).join("/") || ".",
    };
  }

  const packageName = segments[0];

  if (!packageName) {
    throw new Error(`Invalid package specifier "${specifier}".`);
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

async function readDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !shouldSkipWorkspaceDirectory(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJsonShape> {
  const source = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(source) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid package.json shape at "${packageJsonPath}".`);
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

async function resolveCandidateBasePath(options: {
  basePath: string;
  extensionOrder: readonly string[];
  platformPriority: readonly string[];
  preserveSymlinks: boolean;
  trace: ResolutionTraceEntry[];
}): Promise<string> {
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
    throw await createVifxError({
      code: "VIFX_RESOLVE_NOT_FOUND",
      details: {
        basePath: options.basePath,
        trace: options.trace,
      },
      hint: "Verify that the explicit path exists or remove the extension so platform fallbacks can apply.",
      message: `Unable to resolve the explicit file "${options.basePath}".`,
    });
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

  throw await createVifxError({
    code: "VIFX_RESOLVE_NOT_FOUND",
    details: {
      basePath: options.basePath,
      trace: options.trace,
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
  trace: ResolutionTraceEntry[],
): string | undefined {
  const exportsTarget = resolveExportsTarget(packageJson.exports, subpath, conditions, trace);

  if (exportsTarget) {
    return exportsTarget;
  }

  if (subpath !== ".") {
    return subpath;
  }

  const reactNativeEntry = packageJson["react-native"];

  if (typeof reactNativeEntry === "string") {
    return reactNativeEntry;
  }

  if (typeof packageJson.module === "string") {
    return packageJson.module;
  }

  return typeof packageJson.main === "string" ? packageJson.main : undefined;
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

async function isDirectory(directory: string): Promise<boolean> {
  const fileStat = await stat(directory).catch(() => undefined);
  return fileStat?.isDirectory() ?? false;
}

async function isDirectoryLike(directory: string): Promise<boolean> {
  const fileStat = await lstat(directory).catch(() => undefined);
  return fileStat?.isDirectory() || fileStat?.isSymbolicLink() || false;
}

async function isFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => undefined);
  return fileStat?.isFile() ?? false;
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
