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
export type VifxBundlerTarget = "metro" | "vite" | "vifx";
export type VifxProjectType = "expo" | "react-native" | "workspace-package" | "unknown";
export type VifxPackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type VifxLogLevel = "error" | "warn" | "info" | "debug";
export type VifxCompatibilityStatus = "pass" | "fail" | "partial" | "skip";

export interface VifxResolveOptions {
  platform: VifxPlatform;
  projectRoot: string;
  extensions?: string[];
  conditions?: string[];
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

export interface VifxConfigInput {
  projectRoot?: string;
  platforms?: VifxPlatform[];
  projectType?: VifxProjectType;
  expo?: boolean;
  reactNative?: boolean;
  resolver?: Partial<VifxResolverConfig>;
  logger?: Partial<VifxLoggerConfig>;
  docsBaseUrl?: string;
}

export interface VifxConfig {
  projectRoot: string;
  platforms: VifxPlatform[];
  projectType: VifxProjectType;
  expo: boolean;
  reactNative: boolean;
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
