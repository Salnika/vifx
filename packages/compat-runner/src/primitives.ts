import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageManager, ProjectType } from "@vifx/compat";
import type { AssetGroup, Diagnostic, ProjectInspection } from "./types.ts";

interface PackageJson {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const PACKAGE_MANAGER_FILES: Record<Exclude<PackageManager, "unknown">, string[]> = {
  pnpm: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json"],
  bun: ["bun.lock", "bun.lockb"],
};

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents) as T;
}

function getDependencyVersion(packageJson: PackageJson | null, dependencyName: string) {
  return (
    packageJson?.dependencies?.[dependencyName] ??
    packageJson?.devDependencies?.[dependencyName] ??
    null
  );
}

function parsePackageManager(rawValue: string | undefined) {
  if (!rawValue) {
    return "unknown";
  }

  const [packageManager] = rawValue.split("@");
  if (
    packageManager === "pnpm" ||
    packageManager === "yarn" ||
    packageManager === "npm" ||
    packageManager === "bun"
  ) {
    return packageManager;
  }

  return "unknown";
}

function hasWorkspaceField(packageJson: PackageJson | null) {
  const workspaces = packageJson?.workspaces;
  if (!workspaces) {
    return false;
  }

  return Array.isArray(workspaces) || Array.isArray(workspaces.packages);
}

async function walkUp(
  startDirectory: string,
  matcher: (directory: string) => Promise<boolean>,
): Promise<string | null> {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (await matcher(currentDirectory)) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

async function walkFiles(rootDirectory: string): Promise<string[]> {
  const filePaths: string[] = [];

  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      filePaths.push(entryPath);
    }
  }

  await visit(rootDirectory);
  return filePaths;
}

export async function findWorkspaceRoot(projectRoot: string) {
  return (
    (await walkUp(projectRoot, async (directory) => {
      if (await pathExists(path.join(directory, "pnpm-workspace.yaml"))) {
        return true;
      }

      const packageJson = await readJsonFile<PackageJson>(path.join(directory, "package.json"));
      return hasWorkspaceField(packageJson);
    })) ?? path.resolve(projectRoot)
  );
}

export async function detectPackageManager(projectRoot: string): Promise<PackageManager> {
  const workspaceRoot = await findWorkspaceRoot(projectRoot);
  const candidateDirectories = [projectRoot, workspaceRoot];

  for (const directory of candidateDirectories) {
    const packageJson = await readJsonFile<PackageJson>(path.join(directory, "package.json"));
    const parsedPackageManager = parsePackageManager(packageJson?.packageManager);
    if (parsedPackageManager !== "unknown") {
      return parsedPackageManager;
    }
  }

  for (const [packageManager, markerFiles] of Object.entries(PACKAGE_MANAGER_FILES) as [
    Exclude<PackageManager, "unknown">,
    string[],
  ][]) {
    for (const directory of candidateDirectories) {
      for (const markerFile of markerFiles) {
        if (await pathExists(path.join(directory, markerFile))) {
          return packageManager;
        }
      }
    }
  }

  return "unknown";
}

export async function resolvePlatformFile(
  projectRoot: string,
  options: {
    from: string;
    specifier: string;
    platform: "ios" | "android" | "native" | "web";
  },
) {
  const fromFilePath = path.resolve(projectRoot, options.from);
  const specifierBasePath = path.resolve(path.dirname(fromFilePath), options.specifier);
  const parsedSpecifier = path.parse(specifierBasePath);
  const basePath =
    parsedSpecifier.ext === ""
      ? specifierBasePath
      : path.join(parsedSpecifier.dir, parsedSpecifier.name);
  const extensions =
    parsedSpecifier.ext === "" ? [".tsx", ".ts", ".jsx", ".js", ".json"] : [parsedSpecifier.ext];
  const platformSuffixes =
    options.platform === "ios"
      ? [".ios", ".native", ""]
      : options.platform === "android"
        ? [".android", ".native", ""]
        : options.platform === "web"
          ? [".web", ""]
          : [".native", ""];

  for (const platformSuffix of platformSuffixes) {
    for (const extension of extensions) {
      const candidatePath = `${basePath}${platformSuffix}${extension}`;
      if (await pathExists(candidatePath)) {
        return {
          relativeFile: relativeFrom(projectRoot, candidatePath),
        };
      }
    }
  }

  return {
    relativeFile: null,
  };
}

export async function collectAssetScaleGroup(
  projectRoot: string,
  assetPath: string,
): Promise<AssetGroup> {
  const absoluteAssetPath = path.resolve(projectRoot, assetPath);
  const parsedAssetPath = path.parse(absoluteAssetPath);
  const baseName = parsedAssetPath.name.replace(/@\dx$/, "");
  const directoryEntries = await fs.readdir(parsedAssetPath.dir);
  const matcher = new RegExp(`^${baseName}(?:@(\\d+)x)?\\${parsedAssetPath.ext}$`);
  const files: string[] = [];
  const scales = new Set<number>();

  for (const entry of directoryEntries) {
    const match = entry.match(matcher);
    if (!match) {
      continue;
    }

    const scale = match[1] ? Number(match[1]) : 1;
    files.push(relativeFrom(projectRoot, path.join(parsedAssetPath.dir, entry)));
    scales.add(scale);
  }

  files.sort();

  return {
    assetPath: relativeFrom(projectRoot, absoluteAssetPath),
    scales: [...scales].sort((left, right) => left - right),
    files,
  };
}

async function findConfigFile(projectRoot: string, names: string[]) {
  for (const name of names) {
    const configPath = path.join(projectRoot, name);
    if (await pathExists(configPath)) {
      return configPath;
    }
  }

  return null;
}

function detectProjectType(
  projectRoot: string,
  packageJson: PackageJson | null,
  appJson: Record<string, unknown> | null,
): ProjectType {
  const expoVersion = getDependencyVersion(packageJson, "expo");
  const reactNativeVersion = getDependencyVersion(packageJson, "react-native");

  if (expoVersion || Boolean(appJson?.expo)) {
    return "expo";
  }

  if (reactNativeVersion || projectRoot.includes("react-native")) {
    return "react-native";
  }

  return "unknown";
}

async function collectPlatformFiles(projectRoot: string) {
  const filePaths = await walkFiles(projectRoot);
  return filePaths
    .filter((filePath) => /\.(ios|android|native|web)\.[^.]+$/.test(filePath))
    .map((filePath) => relativeFrom(projectRoot, filePath))
    .sort();
}

async function collectAssetGroups(projectRoot: string) {
  const filePaths = await walkFiles(projectRoot);
  const groups = new Map<string, AssetGroup>();

  for (const filePath of filePaths) {
    const parsedPath = path.parse(filePath);
    if (!/\.(png|jpg|jpeg|gif|webp|svg|ttf|otf)$/.test(parsedPath.ext)) {
      continue;
    }

    const baseName = parsedPath.name.replace(/@\dx$/, "");
    const scaleMatch = parsedPath.name.match(/@(\d+)x$/);
    const scale = scaleMatch ? Number(scaleMatch[1]) : 1;
    const groupKey = `${path.join(parsedPath.dir, `${baseName}${parsedPath.ext}`)}`;
    const relativeFile = relativeFrom(projectRoot, filePath);
    const relativeAssetPath = relativeFrom(
      projectRoot,
      path.join(parsedPath.dir, `${baseName}${parsedPath.ext}`),
    );
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.scales.push(scale);
      existingGroup.files.push(relativeFile);
      continue;
    }

    groups.set(groupKey, {
      assetPath: relativeAssetPath,
      scales: [scale],
      files: [relativeFile],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      assetPath: group.assetPath,
      scales: [...new Set(group.scales)].sort((left, right) => left - right),
      files: [...new Set(group.files)].sort(),
    }))
    .sort((left, right) => left.assetPath.localeCompare(right.assetPath));
}

async function buildDiagnostics(
  inspection: Omit<ProjectInspection, "diagnostics">,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (!inspection.vifxConfigPath) {
    diagnostics.push({
      level: "warn",
      code: "VIFX_CONFIG_MISSING",
      summary: "No vifx.config.ts found.",
      hint: "Run: vifx init",
      docsPath: "/cli/doctor#vifx-config",
    });
  }

  if (inspection.projectType === "expo") {
    diagnostics.push({
      level: "info",
      code: "VIFX_EXPERIMENTAL_EXPO",
      summary: "Expo support is currently experimental.",
      docsPath: "/migration/expo#experimental",
    });
  }

  if (inspection.workspaceRoot !== inspection.projectRoot) {
    diagnostics.push({
      level: "info",
      code: "VIFX_MONOREPO_EXPERIMENTAL",
      summary: "Workspace project detected. Monorepo support is still first-pass.",
      docsPath: "/compat/monorepo#workspace-resolution",
    });
  }

  if (inspection.metroConfigPath) {
    const metroConfigContents = await fs.readFile(
      path.join(inspection.projectRoot, inspection.metroConfigPath),
      "utf8",
    );

    if (metroConfigContents.includes("resolveRequest")) {
      diagnostics.push({
        level: "warn",
        code: "VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST",
        summary: "Custom Metro resolveRequest hooks are not implemented in the Vifx adapter yet.",
        hint: "Keep Metro for that path or remove the custom resolver before migrating.",
        docsPath: "/migration/metro#unsupported-resolve-request",
      });
    }

    if (metroConfigContents.includes("serializer")) {
      diagnostics.push({
        level: "warn",
        code: "VIFX_UNSUPPORTED_METRO_SERIALIZER",
        summary: "Custom Metro serializer hooks are not implemented in the Vifx adapter yet.",
        hint: "Keep Metro for serializer-specific workflows for now.",
        docsPath: "/migration/metro#unsupported-serializer",
      });
    }
  }

  return diagnostics;
}

export async function inspectProject(projectRoot: string): Promise<ProjectInspection> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const packageJson = await readJsonFile<PackageJson>(
    path.join(resolvedProjectRoot, "package.json"),
  );
  const appJson = await readJsonFile<Record<string, unknown>>(
    path.join(resolvedProjectRoot, "app.json"),
  );
  const workspaceRoot = await findWorkspaceRoot(resolvedProjectRoot);
  const packageManager = await detectPackageManager(resolvedProjectRoot);
  const metroConfigPath = await findConfigFile(resolvedProjectRoot, [
    "metro.config.ts",
    "metro.config.mjs",
    "metro.config.cjs",
    "metro.config.js",
  ]);
  const viteConfigPath = await findConfigFile(resolvedProjectRoot, [
    "vite.config.ts",
    "vite.config.mjs",
    "vite.config.cjs",
    "vite.config.js",
  ]);
  const vifxConfigPath = await findConfigFile(resolvedProjectRoot, [
    "vifx.config.ts",
    "vifx.config.mjs",
    "vifx.config.cjs",
    "vifx.config.js",
  ]);
  const hermesCompilerPath =
    (await findConfigFile(resolvedProjectRoot, ["node_modules/.bin/hermesc"])) ??
    (workspaceRoot !== resolvedProjectRoot
      ? await findConfigFile(workspaceRoot, ["node_modules/.bin/hermesc"])
      : null);

  const baseInspection = {
    projectRoot: resolvedProjectRoot,
    workspaceRoot,
    packageName: packageJson?.name ?? null,
    projectType: detectProjectType(resolvedProjectRoot, packageJson, appJson),
    packageManager,
    nodeVersion: process.version,
    expoVersion: getDependencyVersion(packageJson, "expo"),
    reactNativeVersion: getDependencyVersion(packageJson, "react-native"),
    metroConfigPath: metroConfigPath ? relativeFrom(resolvedProjectRoot, metroConfigPath) : null,
    viteConfigPath: viteConfigPath ? relativeFrom(resolvedProjectRoot, viteConfigPath) : null,
    vifxConfigPath: vifxConfigPath ? relativeFrom(resolvedProjectRoot, vifxConfigPath) : null,
    hermesCompilerPath: hermesCompilerPath
      ? relativeFrom(resolvedProjectRoot, hermesCompilerPath)
      : null,
    platformFiles: await collectPlatformFiles(resolvedProjectRoot),
    assetGroups: await collectAssetGroups(resolvedProjectRoot),
  };

  return {
    ...baseInspection,
    diagnostics: await buildDiagnostics(baseInspection),
  };
}
