export const FIXTURE_IDS = [
  "expo-basic",
  "expo-export-basic",
  "expo-router-basic",
  "expo-sdk55-basic",
  "expo-sdk56-basic",
  "rn-bare-basic",
  "rn-bare-platform-files",
  "rn-bare-assets",
  "monorepo-pnpm-workspaces",
  "monorepo-yarn-workspaces",
  "lib-react-native-reanimated",
  "lib-react-native-gesture-handler",
  "lib-react-native-screens",
  "lib-react-native-safe-area-context",
  "lib-react-native-svg",
  "lib-expo-image",
  "lib-flash-list",
  "lib-expo-sqlite",
  "lib-react-native-vector-icons",
  "lib-lottie-react-native",
  "lib-nativewind",
  "lib-react-native-webview",
  "lib-react-native-mmkv",
  "lib-async-storage",
  "lib-react-native-maps",
  "lib-expo-camera",
] as const;

export type FixtureId = (typeof FIXTURE_IDS)[number];

export const COMPAT_CATEGORIES = [
  "doctor.projectDetection",
  "resolver.platformExtensions",
  "resolver.packageMainFields",
  "resolver.packageExports",
  "assets.scaleGroups",
  "assets.metadata",
  "bundler.bundleArtifacts",
  "bundler.sourceMapValidity",
  "monorepo.workspaceResolution",
  "libraries",
] as const;

export type CompatCategory = (typeof COMPAT_CATEGORIES)[number];

export const COMPAT_CASE_STATUSES = ["pass", "fail", "partial", "skip"] as const;

export type CompatCaseStatus = (typeof COMPAT_CASE_STATUSES)[number];

export const COMPAT_TOOLCHAINS = ["vifx", "metro"] as const;

export type CompatToolchain = (typeof COMPAT_TOOLCHAINS)[number];
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

export interface AssetMetadataOperation {
  kind: "asset-metadata";
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

export interface LibraryBuildOperation {
  kind: "library-build";
  /** Published package name replicated by the synthetic fixture. */
  packageName: string;
  platform: BuildPlatform;
  entry?: string;
  /**
   * Marker strings that must appear in the output bundle to prove the
   * synthetic package sources were resolved and bundled. A successful build
   * with missing probes means a compat or shim layer substituted the package.
   */
  bundleProbes: string[];
  /**
   * Library aspects a bundler build alone cannot verify (native module
   * runtime behavior, worklet compilation, CSS application). A successful
   * build with pending aspects is classified as "partial".
   */
  partialAspects: string[];
}

export type CompatOperation =
  | ProjectInfoOperation
  | ResolveFileOperation
  | AssetScalesOperation
  | AssetMetadataOperation
  | WorkspaceRootOperation
  | BundleArtifactsOperation
  | SourceMapValidityOperation
  | LibraryBuildOperation;

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

export interface AssetMetadataExpectation {
  assetPath: string;
  fileCount: number;
  height: number | null;
  httpServerLocation: string;
  name: string;
  scales: number[];
  type: string;
  width: number | null;
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

export interface LibraryToolchainExpectation {
  status: CompatCaseStatus;
  note: string;
}

export interface LibraryBuildExpectation {
  packageName: string;
  /** Status snapshot per toolchain. Later units flip these as support lands. */
  toolchains: Record<CompatToolchain, LibraryToolchainExpectation>;
}

export interface LibraryBuildResult {
  packageName: string;
  toolchain: CompatToolchain;
  status: CompatCaseStatus;
  detail: string;
}

export type CompatExpectation =
  | ProjectInfoExpectation
  | ResolveFileExpectation
  | AssetScalesExpectation
  | AssetMetadataExpectation
  | WorkspaceRootExpectation
  | BundleArtifactsExpectation
  | SourceMapValidityExpectation
  | LibraryBuildExpectation;

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
  /**
   * Observed status for the case. Non-library cases map pass/fail from the
   * boolean outcome; library cases carry the adapter classification so the
   * support matrix can distinguish partial and skipped coverage.
   */
  status: CompatCaseStatus;
  expected: CompatExpectation;
  actual: CompatExpectation | LibraryBuildResult | Record<string, unknown>;
  message: string;
  docsPath: string;
  notes?: string[];
}
