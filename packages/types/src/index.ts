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
export type VifxBundleMode = "development" | "production";
export type VifxModuleFormat = "hoisted" | "metro";

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

/**
 * The Metro-shaped resolution result returned by a `resolveRequest` hook. A
 * tagged union mirroring Metro's `Resolution`:
 *
 * - `sourceFile`: resolve the request to a single source/module file.
 * - `assetFiles`: resolve to one or more asset files (every scale variant).
 * - `empty`: resolve to an empty module (Metro's "stub this import out").
 *
 * vifx routes each variant into its own asset / transform post-processing so a
 * migrated Metro resolver behaves the same way it did under Metro.
 */
export type VifxMetroResolution =
  | { type: "sourceFile"; filePath: string }
  | { type: "assetFiles"; filePaths: string[] }
  | { type: "empty" };

/**
 * The `context` argument vifx passes to a user `resolveRequest`, shaped like
 * Metro's `ResolutionContext`. Only the fields a real custom resolver reads are
 * populated; the load-bearing one is the RECURSIVE `resolveRequest`, which runs
 * vifx's own resolver so a hook can delegate (the dominant pattern:
 * `context.resolveRequest(context, modifiedName, platform)`).
 */
export interface VifxMetroResolutionContext {
  /**
   * The default (vifx) resolver, exposed so a hook can delegate to it with
   * modified arguments. Calling it is exactly what Metro's
   * `context.resolveRequest` does: run the platform resolver and return a
   * `VifxMetroResolution`.
   */
  resolveRequest: VifxMetroResolveRequest;
  /** Absolute path of the importing file (Metro's `originModulePath`). */
  originModulePath: string;
  /** The project root the build runs against. */
  projectRoot: string;
  /** Source-file extensions vifx tries, without the leading dot. */
  sourceExts: readonly string[];
  /** Asset-file extensions vifx tries, without the leading dot. */
  assetExts: readonly string[];
}

/**
 * A Metro `resolver.resolveRequest`-compatible hook. Signature and semantics
 * match Metro: `(context, moduleName, platform) => Resolution`. The hook may
 * delegate to the default resolver via `context.resolveRequest(...)`, mutate the
 * arguments, return a fabricated `VifxMetroResolution`, or throw to fail the
 * resolution. May be async (vifx awaits the result).
 */
export type VifxMetroResolveRequest = (
  context: VifxMetroResolutionContext,
  moduleName: string,
  platform: string | null,
) => VifxMetroResolution | Promise<VifxMetroResolution>;

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
  /**
   * Every emitted variant, one per scale, relative to the project root. A
   * production layout copies each scale from its own file; `emittedPath` is the
   * canonical (1x when there is one) variant.
   */
  files?: Array<{ path: string; scale: number }>;
}

export interface VifxTransformCacheStats {
  hits: number;
  misses: number;
  writes: number;
  errors: number;
}

/**
 * Per-phase wall-clock timings for one dev-server rebuild cycle. Reserved for
 * the instrumentation workstream; populated by the dev rebuild path, undefined
 * elsewhere. `hbcMs`/`applyMs` are optional (some paths have no Hermes compile
 * or HMR-apply phase).
 */
export interface VifxRebuildPhaseTimings {
  transformMs: number;
  serializeMs: number;
  writeMs: number;
  hbcMs?: number;
  applyMs?: number;
  totalMs: number;
}

/**
 * Transform-cache hit/miss counts for a SINGLE rebuild cycle (a delta, not the
 * cumulative {@link VifxTransformCacheStats}). `hitRate` is `hits / (hits +
 * misses)` for that cycle, or 0 when nothing was looked up.
 */
export interface VifxCycleCacheStats {
  hits: number;
  misses: number;
  computed: number;
  hitRate: number;
}

/**
 * One dev-server rebuild report, surfaced for terminal / `--json` output.
 * Reserved for the instrumentation workstream; nothing emits it yet.
 * `changedPaths` is optional (the dev watcher does not propagate it into the
 * rebuild closure today).
 */
export interface VifxRebuildReport {
  cycle: number;
  changedPaths?: string[];
  phases: VifxRebuildPhaseTimings;
  cache?: VifxCycleCacheStats;
  moduleCount?: number;
  hmr: "fast-refresh" | "reload" | "error";
  error?: string;
  /**
   * True when the report comes from the incremental dev engine: `phases` then
   * only carries `totalMs` (save seen → update sent), there is no
   * transform/serialize/write breakdown to show.
   */
  engine?: boolean;
  /** Why the app had to reload instead of applying the edit in place. */
  reason?: string;
}

/**
 * One serialized module from a `moduleFormat: "metro"` build, surfaced so a dev
 * server can diff rebuilds into Fast Refresh deltas. Structurally identical to
 * the `SerializedModule` in `@vifx/vite-plugin-react-native`; it is re-declared
 * here so `@vifx/types` keeps no dependency back onto that package.
 */
export interface VifxSerializedModule {
  dependencyIds: number[];
  factory: string;
  fileName: string;
  id: number;
}

export interface VifxBundleArtifacts {
  appConfigPath?: string;
  assets: VifxBuildAssetArtifact[];
  bundle: VifxBundleFileArtifact;
  cacheStats?: VifxTransformCacheStats;
  /**
   * Per-phase rebuild timings. Reserved for the instrumentation workstream;
   * undefined on current build paths.
   */
  rebuildTimings?: VifxRebuildPhaseTimings;
  entry: string;
  hermesBytecodePath?: string;
  mode: Exclude<VifxVitePluginMode, "none">;
  /**
   * Metro module graph for Fast Refresh, populated only by the development
   * `moduleFormat: "metro"` build path. The dev server feeds `moduleIds` back as
   * the next rebuild's `existingModuleIds` (for stable ids) and diffs `modules`
   * into `/hot` deltas. Undefined for hoisted, web, and production bundles.
   */
  moduleGraph?: {
    moduleIds: ReadonlyMap<string, number>;
    modules: readonly VifxSerializedModule[];
  };
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

export type VifxExpoSdkSupportTier = "experimental" | "validated";

export interface VifxExpoSdkSupportEntry {
  notes: string[];
  tier: VifxExpoSdkSupportTier;
}

export interface VifxExpoSdkSupportStatus {
  notes: string[];
  sdk: string | null;
  tier: VifxExpoSdkSupportTier | "unknown" | "unsupported";
}

export interface VifxExpoNoMetroContractReport {
  appDirectory: boolean;
  decision: "blocked" | "partial" | "supported";
  expoRouter: boolean;
  expoVersion: string | null;
  projectRoot: string;
  reactNativeVersion: string | null;
  sdkSupport: VifxExpoSdkSupportStatus;
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
  /**
   * Extra package `exports` conditions, tried in this order after
   * `react-native` and the platform (`browser` and `web` on web) and before
   * `import` and `default`. Those conditions, and `require`, are set by the
   * bundler, so they are dropped from this list.
   */
  conditions: string[];
  mainFields: string[];
  /**
   * The file extensions bundled as assets (`require("./a.lottie")` returns an
   * asset id). Replaces Vifx's default list; unset keeps it.
   */
  assetExtensions?: string[];
}

export interface VifxLoggerConfig {
  level: VifxLogLevel;
  json: boolean;
}

export interface VifxBundleTargetConfig {
  aliases?: Record<string, string>;
  babelInPackages?: string[];
  compatPreview?: boolean;
  entry: string;
  hermes: boolean;
  jsxInPackages?: string[];
  mode?: VifxBundleMode;
  moduleFormat?: VifxModuleFormat;
  outDir?: string;
  platform: VifxBundlePlatform;
  reactNativeCompat?: VifxReactNativeCompatMode;
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
  transformCache?: boolean;
}

export interface VifxViteConfig {
  mode: VifxVitePluginMode;
  targets: VifxBundleTargetConfig[];
  /**
   * Path to a user Vite config (e.g. `vite.config.vifx.ts`) to merge into the
   * vifx build, or `false` to opt out. Reserved for the plugin workstream; the
   * config loader does not read or load it yet.
   */
  userConfigFile?: string | false;
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
  compatPreview?: boolean;
  conditions?: string[];
  entry?: string;
  env?: NodeJS.ProcessEnv;
  extensions?: string[];
  hermes?: boolean;
  hermesCompilerPath?: string;
  jsxInPackages?: string[];
  mainFields?: string[];
  /**
   * Minify the bundle. Defaults to the mode: production bundles are minified,
   * development bundles are not (`export:embed --minify` overrides it).
   */
  minify?: boolean;
  mode?: VifxBundleMode;
  moduleFormat?: VifxModuleFormat;
  outDir?: string;
  platform: VifxBundlePlatform;
  projectRoot?: string;
  reactNativeCompat?: VifxReactNativeCompatMode;
  /**
   * Compile project modules with the React Compiler, as Expo's
   * `experiments.reactCompiler` does: babel-preset-expo applies it when its
   * Babel caller says so. The Expo builds read it from the app config.
   */
  reactCompiler?: boolean;
  resolvePlatform?: VifxPlatform;
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
  transformCache?: boolean;
  /**
   * Path to a user Vite config (e.g. `vite.config.vifx.ts`) to load and merge
   * into the build, or `false` to opt out. When omitted, the build auto-detects
   * the known `vite.config.vifx.*` file names under the project root. The CLI
   * threads the resolved path (or `false`) here so the build loads it in-process
   * via Vite's own `loadConfigFromFile`.
   */
  userViteConfig?: string | false;
  /**
   * A Metro-compatible `resolveRequest` hook to run before vifx's own
   * resolution, for projects migrating a custom `metro.config.js` resolver.
   * Carried in-process from the user's `vite.config.vifx.*` (it cannot cross the
   * `export:embed`/CLI subprocess boundary, so the CLI never serializes it — the
   * build extracts it from the loaded config). When omitted, resolution is
   * exactly the historic path.
   */
  userResolveRequest?: VifxMetroResolveRequest;
  /**
   * Injection seam for a shared transform-cache instance (the concrete type is
   * `@vifx/transform-cache`'s `TransformCache`). Typed opaque to keep
   * `@vifx/types` free of a dependency on that package. Reserved for the
   * instrumentation workstream; current builds ignore it and create their own.
   */
  transformCacheInstance?: unknown;
  /**
   * Keep what the resolver learned about the file system (directory listings,
   * package manifests) from the previous build instead of starting empty. Only
   * safe when something else invalidates it on file additions and removals —
   * the dev server's watcher does, which is what makes rebuilds skip resolution
   * I/O. One-shot builds leave it off.
   */
  reuseResolverCaches?: boolean;
  /**
   * Instrument project modules for Fast Refresh under the Rolldown dev engine
   * (development, scope-hoisted bundle): `react-refresh/babel` runs with the
   * project's Babel and each module binds its registrations to the in-app dev
   * runtime. Set by the dev server; one-shot builds leave it off.
   */
  fastRefresh?: boolean;
  /**
   * Public env vars (e.g. `EXPO_PUBLIC_*`) to inline as build-time defines.
   * Reserved for the native+web workstream; the RN define table does not read
   * them yet.
   */
  publicEnv?: Record<string, string>;
  publicEnvPrefix?: string;
}

export interface VifxExpoPluginOptions extends VifxReactNativePluginOptions {
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
  /**
   * Reserved for the native+web workstream: opt into a unified define/env table
   * shared by native and web. Not consumed yet.
   */
  unifiedEnv?: boolean;
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
  /**
   * Reserved for the native+web workstream. Present only when the input set it;
   * normalization does not synthesize a default, so existing configs keep their
   * exact shape.
   */
  unifiedEnv?: boolean;
}

export interface VifxDiagnosticData {
  code: string;
  message: string;
  hint?: string;
  docsPath?: string;
  details?: VifxJsonObject;
}
