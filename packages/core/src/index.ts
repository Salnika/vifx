import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  defineVifxConfig as defineSharedVifxConfig,
  loadVifxConfig as loadSharedVifxConfig,
  type LoadVifxConfigOptions as SharedLoadVifxConfigOptions,
} from "@vifx/config";
import type { VifxConfig as SharedVifxConfig } from "@vifx/types";

export const VIFX_CONFIG_FILE_NAMES = [
  "vifx.config.ts",
  "vifx.config.mts",
  "vifx.config.js",
  "vifx.config.mjs",
] as const;

export interface VifxConfig extends SharedVifxConfig {}

export interface CreateVifxContextOptions extends LoadVifxConfigOptions {
  imports?: PrimitiveModuleLoaders;
}

export interface DetectProjectOptions {
  cwd: string;
}

export interface LoadVifxConfigOptions extends SharedLoadVifxConfigOptions {
  configFile?: string;
  cwd?: string;
  imports?: PrimitiveModuleLoaders;
}

export interface LoadedVifxConfig {
  config: VifxConfig;
  configFilePath?: string;
  project: VifxProjectInfo;
  workspace?: WorkspaceInfo;
}

export interface PrimitiveModuleLoaders {
  assetRegistry?: () => Promise<AssetRegistryModule | undefined>;
  platformResolver?: () => Promise<PlatformResolverModule | undefined>;
}

export interface ProjectInspection {
  appConfigPath?: string;
  configFilePath?: string;
  kind: VifxProjectInfo["projectType"];
  packageManager?: string;
  projectRoot: string;
  workspaceRoot?: string;
}

export interface VifxContext extends LoadedVifxConfig {
  collectAssetGroup(options: Record<string, unknown> & { filePath: string }): Promise<unknown>;
  resolveModule(
    options: Record<string, unknown> & {
      fromFile: string;
      platform: string;
      specifier: string;
    },
  ): Promise<unknown>;
}

export interface VifxProjectInfo {
  appConfigPath?: string;
  packageJsonPath?: string;
  projectRoot: string;
  projectType: "expo" | "react-native" | "unknown" | "workspace-package";
  reasons: readonly string[];
}

export interface WorkspaceInfo {
  patterns: readonly string[];
  root: string;
  source: "package.json" | "pnpm-workspace";
}

type Awaitable<T> = Promise<T> | T;

interface AssetRegistryModule extends Record<string, unknown> {
  collectAssetGroup?: (options: Record<string, unknown>) => Awaitable<unknown>;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  packageManager?: string;
  peerDependencies?: Record<string, string>;
  workspaces?: unknown;
}

interface PlatformResolverModule extends Record<string, unknown> {
  resolveReactNativeModule?: (options: Record<string, unknown>) => Awaitable<unknown>;
}

interface VifxErrorOptions {
  cause?: unknown;
  code: string;
  details?: unknown;
  hint?: string;
  message: string;
}

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

export function defineVifxConfig<const TConfig extends VifxConfig>(config: TConfig): TConfig {
  return defineSharedVifxConfig(config);
}

export async function createVifxContext(
  options: CreateVifxContextOptions = {},
): Promise<VifxContext> {
  const loaded = await loadVifxConfig(options);
  const moduleLoaders = options.imports ?? {};

  return {
    ...loaded,
    async collectAssetGroup(assetOptions) {
      const assetRegistry = await loadRequiredPrimitiveModule(
        moduleLoaders.assetRegistry,
        "@vifx/asset-registry",
        "collectAssetGroup",
      );
      const collectAssetGroup = assetRegistry.collectAssetGroup;

      if (typeof collectAssetGroup !== "function") {
        throw await createVifxError({
          code: "VIFX_CORE_MISSING_PRIMITIVE",
          details: { module: "@vifx/asset-registry" },
          hint: "Ensure @vifx/asset-registry exports collectAssetGroup().",
          message: "@vifx/asset-registry is available but does not export collectAssetGroup().",
        });
      }

      return collectAssetGroup({
        projectRoot: loaded.config.projectRoot ?? loaded.project.projectRoot,
        ...assetOptions,
      });
    },
    async resolveModule(resolveOptions) {
      const platformResolver = await loadRequiredPrimitiveModule(
        moduleLoaders.platformResolver,
        "@vifx/platform-resolver",
        "resolveReactNativeModule",
      );
      const resolveReactNativeModule = platformResolver.resolveReactNativeModule;

      if (typeof resolveReactNativeModule !== "function") {
        throw await createVifxError({
          code: "VIFX_CORE_MISSING_PRIMITIVE",
          details: { module: "@vifx/platform-resolver" },
          hint: "Ensure @vifx/platform-resolver exports resolveReactNativeModule().",
          message:
            "@vifx/platform-resolver is available but does not export resolveReactNativeModule().",
        });
      }

      return resolveReactNativeModule({
        projectRoot: loaded.config.projectRoot ?? loaded.project.projectRoot,
        ...resolveOptions,
      });
    },
  };
}

export function detectProjectKind(
  dependencies: Record<string, string | undefined>,
): "expo" | "react-native" | "unknown" {
  if (dependencies.expo) {
    return "expo";
  }

  if (dependencies["react-native"]) {
    return "react-native";
  }

  return "unknown";
}

export async function detectProject(
  input: DetectProjectOptions | string,
): Promise<VifxProjectInfo> {
  const cwd = typeof input === "string" ? input : input.cwd;
  const searchRoot = path.resolve(cwd);
  const packageJsonPath = await findNearestPackageJson(searchRoot);
  const projectRoot = packageJsonPath ? path.dirname(packageJsonPath) : searchRoot;
  const workspace = await detectWorkspaceRoot(searchRoot);
  const reasons: string[] = [];

  let packageJson: PackageJsonShape | undefined;

  if (packageJsonPath) {
    packageJson = await readPackageJson(packageJsonPath);
    reasons.push(`Found package.json at "${packageJsonPath}".`);
  } else {
    reasons.push(`No package.json found while walking upward from "${searchRoot}".`);
  }

  const appConfigPath = await findExpoAppConfig(projectRoot);
  const hasExpoDependency = hasDependency(packageJson, "expo");
  const hasReactNativeDependency = hasDependency(packageJson, "react-native");

  if (hasExpoDependency) {
    reasons.push('Detected an "expo" dependency.');
  }

  if (appConfigPath) {
    reasons.push(`Found Expo app config at "${appConfigPath}".`);
  }

  if (workspace) {
    reasons.push(`Found workspace root at "${workspace.root}" via ${workspace.source}.`);
  }

  if (hasExpoDependency && appConfigPath) {
    return {
      appConfigPath,
      packageJsonPath,
      projectRoot,
      projectType: "expo",
      reasons,
    };
  }

  if (hasReactNativeDependency) {
    reasons.push('Detected a "react-native" dependency.');
    return {
      appConfigPath,
      packageJsonPath,
      projectRoot,
      projectType: "react-native",
      reasons,
    };
  }

  if (workspace && packageJsonPath && path.resolve(projectRoot) !== path.resolve(workspace.root)) {
    reasons.push(
      "The current package lives inside a workspace but does not expose Expo or React Native signals.",
    );
    return {
      appConfigPath,
      packageJsonPath,
      projectRoot,
      projectType: "workspace-package",
      reasons,
    };
  }

  return {
    appConfigPath,
    packageJsonPath,
    projectRoot,
    projectType: "unknown",
    reasons,
  };
}

export async function detectWorkspaceRoot(
  startDirectory: string,
): Promise<WorkspaceInfo | undefined> {
  for (const directory of iterateAncestorDirectories(startDirectory)) {
    const pnpmWorkspacePath = path.join(directory, "pnpm-workspace.yaml");

    if (await isFile(pnpmWorkspacePath)) {
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

    return {
      patterns,
      root: directory,
      source: "package.json",
    };
  }

  return undefined;
}

export async function findWorkspaceRoot(startDirectory: string): Promise<string | null> {
  return (await detectWorkspaceRoot(startDirectory))?.root ?? null;
}

export async function findVifxConfig(startDirectory: string): Promise<string | undefined> {
  for (const directory of iterateAncestorDirectories(startDirectory)) {
    for (const fileName of VIFX_CONFIG_FILE_NAMES) {
      const candidate = path.join(directory, fileName);

      if (await isFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export async function loadVifxConfig(
  options: LoadVifxConfigOptions = {},
): Promise<LoadedVifxConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const project = await detectProject(cwd);
  const workspace = await detectWorkspaceRoot(project.projectRoot);
  const loaded = await loadSharedVifxConfig({
    configFile: options.configFile,
    cwd: project.projectRoot,
    optional: options.optional ?? true,
  });

  return {
    config: loaded.config as VifxConfig,
    configFilePath: loaded.filePath,
    project,
    workspace,
  };
}

export async function inspectProject(cwd: string): Promise<ProjectInspection> {
  const project = await detectProject(cwd);
  const workspace = await detectWorkspaceRoot(project.projectRoot);
  const packageJson = project.packageJsonPath
    ? await readPackageJson(project.packageJsonPath)
    : undefined;
  const dependencyKind = detectProjectKind({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  });

  return {
    appConfigPath: project.appConfigPath,
    configFilePath: await findVifxConfig(project.projectRoot),
    kind:
      project.projectType === "unknown" && dependencyKind !== "unknown"
        ? dependencyKind
        : project.projectType,
    packageManager: normalizePackageManagerName(packageJson?.packageManager),
    projectRoot: project.projectRoot,
    workspaceRoot: workspace?.root,
  };
}

export async function loadProjectContext(cwd: string): Promise<{
  config: VifxConfig;
  configFilePath?: string;
  inspection: ProjectInspection;
}> {
  const [loaded, inspection] = await Promise.all([loadVifxConfig({ cwd }), inspectProject(cwd)]);

  return {
    config: loaded.config,
    configFilePath: loaded.configFilePath,
    inspection,
  };
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
    // Fall back to the local first-pass error while the shared package is absent.
  }

  return new LocalVifxError(options);
}

async function findExpoAppConfig(projectRoot: string): Promise<string | undefined> {
  const fileNames = [
    "app.json",
    "app.config.ts",
    "app.config.mts",
    "app.config.js",
    "app.config.mjs",
  ];

  for (const fileName of fileNames) {
    const candidate = path.join(projectRoot, fileName);

    if (await isFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function findNearestPackageJson(startDirectory: string): Promise<string | undefined> {
  for (const directory of iterateAncestorDirectories(startDirectory)) {
    const packageJsonPath = path.join(directory, "package.json");

    if (await isFile(packageJsonPath)) {
      return packageJsonPath;
    }
  }

  return undefined;
}

function hasDependency(packageJson: PackageJsonShape | undefined, dependencyName: string): boolean {
  return Boolean(
    packageJson?.dependencies?.[dependencyName] ||
    packageJson?.devDependencies?.[dependencyName] ||
    packageJson?.peerDependencies?.[dependencyName],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function isFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => undefined);
  return fileStat?.isFile() ?? false;
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

function normalizePackageManagerName(packageManager: string | undefined): string | undefined {
  if (!packageManager) {
    return undefined;
  }

  const [name] = packageManager.split("@");
  return name || undefined;
}

async function loadOptionalModule<TModule>(
  loader: (() => Promise<TModule | undefined>) | undefined,
  moduleName: string,
): Promise<TModule | undefined> {
  if (loader) {
    return loader();
  }

  try {
    return (await import(moduleName)) as TModule;
  } catch {
    return undefined;
  }
}

async function loadRequiredPrimitiveModule<TModule extends Record<string, unknown>>(
  loader: (() => Promise<TModule | undefined>) | undefined,
  moduleName: string,
  exportName: string,
): Promise<TModule> {
  const moduleValue = await loadOptionalModule(loader, moduleName);

  if (moduleValue) {
    return moduleValue;
  }

  throw await createVifxError({
    code: "VIFX_CORE_MISSING_PRIMITIVE",
    details: { exportName, moduleName },
    hint: `Install ${moduleName}, or inject it through createVifxContext({ imports: ... }).`,
    message: `Unable to load ${moduleName} while preparing ${exportName}().`,
  });
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJsonShape> {
  const source = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(source) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid package.json at "${packageJsonPath}".`);
  }

  return parsed as PackageJsonShape;
}

async function readPnpmWorkspacePatterns(pnpmWorkspacePath: string): Promise<string[]> {
  const source = await readFile(pnpmWorkspacePath, "utf8");
  const patterns: string[] = [];
  let insidePackages = false;

  for (const line of source.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine === "packages:") {
      insidePackages = true;
      continue;
    }

    if (!insidePackages) {
      continue;
    }

    if (/^[\w-]+:/u.test(trimmedLine)) {
      break;
    }

    const match = trimmedLine.match(/^-\s+(.+)$/u);
    const rawPattern = match?.[1];

    if (rawPattern) {
      patterns.push(rawPattern.replace(/^['"]|['"]$/gu, ""));
    }
  }

  return [...new Set(patterns)];
}

function readWorkspacePatterns(packageJson: PackageJsonShape): string[] | undefined {
  const workspaces = packageJson.workspaces;

  if (Array.isArray(workspaces)) {
    return [...new Set(workspaces.filter((value): value is string => typeof value === "string"))];
  }

  if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return [
      ...new Set(workspaces.packages.filter((value): value is string => typeof value === "string")),
    ];
  }

  return undefined;
}
