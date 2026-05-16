export const FIXTURE_IDS = [
  "expo-basic",
  "expo-export-basic",
  "rn-bare-basic",
  "rn-bare-platform-files",
  "rn-bare-assets",
  "monorepo-pnpm-workspaces",
  "monorepo-yarn-workspaces",
] as const;

export type FixtureId = (typeof FIXTURE_IDS)[number];

export const COMPAT_CATEGORIES = [
  "doctor.projectDetection",
  "resolver.platformExtensions",
  "assets.scaleGroups",
  "bundler.bundleArtifacts",
  "bundler.sourceMapValidity",
  "monorepo.workspaceResolution",
] as const;

export type CompatCategory = (typeof COMPAT_CATEGORIES)[number];
export type Platform = "ios" | "android" | "native" | "web";
export type BuildPlatform = Extract<Platform, "ios" | "android">;
export type PackageManager = "pnpm" | "yarn" | "npm" | "bun" | "unknown";
export type ProjectType = "expo" | "react-native" | "unknown";
export type FixtureProjectType = ProjectType | "monorepo";

export interface FixtureManifest {
  id: FixtureId;
  title: string;
  relativePath: string;
  projectType: FixtureProjectType;
  packageManager: PackageManager;
  primaryPackagePath?: string;
  features: string[];
  notes?: string[];
}

export interface ProjectInfoOperation {
  kind: "project-info";
}

export interface ResolveFileOperation {
  kind: "resolve-file";
  from: string;
  specifier: string;
  platform: Platform;
}

export interface AssetScalesOperation {
  kind: "asset-scales";
  assetPath: string;
}

export interface WorkspaceRootOperation {
  kind: "workspace-root";
  cwd: string;
}

export interface BundleArtifactsOperation {
  kind: "bundle-artifacts";
  entry?: string;
  platform: BuildPlatform;
}

export interface SourceMapValidityOperation {
  kind: "source-map-validity";
  entry?: string;
  platform: BuildPlatform;
}

export type CompatOperation =
  | ProjectInfoOperation
  | ResolveFileOperation
  | AssetScalesOperation
  | WorkspaceRootOperation
  | BundleArtifactsOperation
  | SourceMapValidityOperation;

export interface ProjectInfoExpectation {
  projectType: ProjectType;
  packageManager: PackageManager;
  expoVersion: string | null;
  reactNativeVersion: string | null;
}

export interface ResolveFileExpectation {
  relativeFile: string | null;
}

export interface AssetScalesExpectation {
  assetPath: string;
  scales: number[];
  files: string[];
}

export interface WorkspaceRootExpectation {
  relativeRoot: string;
  packageManager: PackageManager;
}

export interface BundleArtifactsExpectation {
  assetCount: number;
  assetTypes: string[];
  bundleFile: string;
  entry: string;
  platform: BuildPlatform;
}

export interface SourceMapValidityExpectation {
  platform: BuildPlatform;
  sourceMapPresent: boolean;
  valid: boolean;
}

export type CompatExpectation =
  | ProjectInfoExpectation
  | ResolveFileExpectation
  | AssetScalesExpectation
  | WorkspaceRootExpectation
  | BundleArtifactsExpectation
  | SourceMapValidityExpectation;

export interface CompatCase<
  TOperation extends CompatOperation = CompatOperation,
  TExpected extends CompatExpectation = CompatExpectation,
> {
  id: string;
  title: string;
  category: CompatCategory;
  fixtureId: FixtureId;
  operation: TOperation;
  expected: TExpected;
  docsPath: string;
  notes?: string[];
}

export interface CompatCaseOutcome {
  caseId: string;
  title: string;
  category: CompatCategory;
  fixtureId: FixtureId;
  passed: boolean;
  expected: CompatExpectation;
  actual: CompatExpectation | Record<string, unknown>;
  message: string;
  docsPath: string;
}
