export type VifxJsonPrimitive = string | number | boolean | null;
export type VifxJsonValue =
  | VifxJsonPrimitive
  | VifxJsonValue[]
  | {
      [key: string]: VifxJsonValue;
    };

export interface VifxJsonObject {
  [key: string]: VifxJsonValue;
}

export type VifxPlatform = "ios" | "android" | "native" | "web";
export type VifxBundlePlatform = Extract<VifxPlatform, "ios" | "android">;
export type VifxBundlerTarget = "metro" | "vite" | "vifx";
export type VifxProjectType = "expo" | "react-native" | "workspace-package" | "unknown";
export type VifxPackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type VifxLogLevel = "error" | "warn" | "info" | "debug";
export type VifxCompatibilityStatus = "pass" | "fail" | "partial" | "skip";
export type VifxVitePluginMode = "none" | "react-native" | "expo";
export type VifxReactNativeCompatMode = "none" | "web";

export interface VifxResolveOptions {
  platform: VifxPlatform;
  projectRoot: string;
  extensions?: string[];
  conditions?: string[];
  mainFields?: string[];
}

export interface VifxResolutionTraceEntry {
  candidate: string;
  matched: boolean;
  reason?: string;
}

export interface VifxResolutionResult {
  specifier: string;
  platform: VifxPlatform;
  filePath: string;
  trace: VifxResolutionTraceEntry[];
}

export interface VifxAssetDescriptor {
  filePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  scales: number[];
  width?: number;
  height?: number;
  hash?: string;
}

export interface VifxSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
}

export interface VifxSourceMapArtifact {
  path: string;
  sourceCount: number;
  valid: boolean;
  warnings: string[];
}

export interface VifxBundleFileArtifact {
  path: string;
  sizeBytes: number;
}

export interface VifxWebRuntimeArtifact {
  htmlPath: string;
  rootElementId: string;
  scriptPath: string;
}

export interface VifxBuildAssetArtifact {
  emittedPath: string;
  sourceFilePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  scales: number[];
  sizeBytes: number;
  width?: number;
  height?: number;
  hash?: string;
}

export interface VifxBundleArtifacts {
  appConfigPath?: string;
  assets: VifxBuildAssetArtifact[];
  bundle: VifxBundleFileArtifact;
  entry: string;
  hermesBytecodePath?: string;
  mode: Exclude<VifxVitePluginMode, "none">;
  platform: VifxBundlePlatform;
  projectRoot: string;
  runtime: VifxWebRuntimeArtifact | null;
  sourceMap: VifxSourceMapArtifact | null;
}

export interface VifxExpoExportBundleArtifact {
  bundle: VifxBundleFileArtifact;
  platform: VifxBundlePlatform | "unknown";
  sourceMap: VifxSourceMapArtifact | null;
}

export interface VifxExpoExportManifestArtifact {
  contents: VifxJsonValue;
  kind: string;
  path: string;
}

export interface VifxExpoExportInspectionResult {
  assets: VifxBuildAssetArtifact[];
  bundles: VifxExpoExportBundleArtifact[];
  exportRoot: string;
  manifests: VifxExpoExportManifestArtifact[];
  projectRoot: string;
  warnings: string[];
}

export interface VifxExpoExportGeneratedFile {
  kind: "asset" | "bundle" | "manifest" | "metadata" | "source-map";
  path: string;
  platform?: VifxBundlePlatform;
}

export interface VifxExpoExportGenerationResult extends VifxExpoExportInspectionResult {
  generatedFiles: VifxExpoExportGeneratedFile[];
}

export type VifxExpoNoMetroWorkflowId =
  | "config"
  | "dev-server"
  | "export-artifacts"
  | "metro-parity"
  | "vite-build";

export type VifxExpoNoMetroWorkflowStatus = "blocked" | "partial" | "supported";

export interface VifxExpoNoMetroWorkflowReport {
  blockers: string[];
  evidence: string[];
  id: VifxExpoNoMetroWorkflowId;
  notes: string[];
  status: VifxExpoNoMetroWorkflowStatus;
  title: string;
}

export interface VifxExpoNoMetroContractReport {
  appDirectory: boolean;
  decision: "blocked" | "partial" | "supported";
  expoRouter: boolean;
  expoVersion: string | null;
  projectRoot: string;
  reactNativeVersion: string | null;
  supportedExpoSdk: string;
  warnings: string[];
  workflows: VifxExpoNoMetroWorkflowReport[];
}

export interface VifxCompatibilityResult {
  id: string;
  suite: string;
  status: VifxCompatibilityStatus;
  target: VifxBundlerTarget;
  summary: string;
  durationMs?: number;
  expected?: VifxJsonValue;
  actual?: VifxJsonValue;
  details?: VifxJsonObject;
}

export interface VifxWorkspaceInfo {
  root: string;
  packageManager: VifxPackageManager;
}

export interface VifxProjectMetadata {
  root: string;
  name?: string;
  projectType: VifxProjectType;
  platforms: VifxPlatform[];
  dependencies: string[];
  workspace?: VifxWorkspaceInfo;
  expo?: boolean;
  reactNative?: boolean;
}

export interface VifxResolverConfig {
  extensions: string[];
  conditions: string[];
  mainFields: string[];
}

export interface VifxLoggerConfig {
  level: VifxLogLevel;
  json: boolean;
}

export interface VifxBundleTargetConfig {
  aliases?: Record<string, string>;
  babelInPackages?: string[];
  entry: string;
  hermes: boolean;
  jsxInPackages?: string[];
  outDir?: string;
  platform: VifxBundlePlatform;
  reactNativeCompat?: VifxReactNativeCompatMode;
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
}

export interface VifxViteConfig {
  mode: VifxVitePluginMode;
  targets: VifxBundleTargetConfig[];
}

export interface VifxExpoOptions {
  appConfigPath?: string;
  inspectExportPath?: string;
  publicEnvPrefix: string;
}

export interface VifxDetectedVitePlugin {
  configFilePath?: string;
  mode: VifxVitePluginMode;
}

export interface VifxReactNativePluginOptions {
  aliases?: Record<string, string>;
  assetExtensions?: string[];
  babelInPackages?: string[];
  conditions?: string[];
  entry?: string;
  env?: NodeJS.ProcessEnv;
  extensions?: string[];
  hermes?: boolean;
  hermesCompilerPath?: string;
  jsxInPackages?: string[];
  mainFields?: string[];
  outDir?: string;
  platform: VifxBundlePlatform;
  projectRoot?: string;
  reactNativeCompat?: VifxReactNativeCompatMode;
  resolvePlatform?: VifxPlatform;
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
}

export interface VifxExpoPluginOptions extends Omit<
  VifxReactNativePluginOptions,
  "assetExtensions"
> {
  appConfigPath?: string;
  publicEnv?: Record<string, string>;
  publicEnvPrefix?: string;
}

export interface VifxConfigInput {
  projectRoot?: string;
  platforms?: VifxPlatform[];
  projectType?: VifxProjectType;
  expo?: boolean;
  expoOptions?: Partial<VifxExpoOptions>;
  reactNative?: boolean;
  vite?: Partial<VifxViteConfig>;
  resolver?: Partial<VifxResolverConfig>;
  logger?: Partial<VifxLoggerConfig>;
  docsBaseUrl?: string;
}

export interface VifxConfig {
  projectRoot: string;
  platforms: VifxPlatform[];
  projectType: VifxProjectType;
  expo: boolean;
  expoOptions: VifxExpoOptions;
  reactNative: boolean;
  vite: VifxViteConfig;
  resolver: VifxResolverConfig;
  logger: VifxLoggerConfig;
  docsBaseUrl: string;
}

export interface VifxDiagnosticData {
  code: string;
  message: string;
  hint?: string;
  docsPath?: string;
  details?: VifxJsonObject;
}
