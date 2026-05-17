import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import type {
  VifxBuildAssetArtifact,
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxJsonObject,
} from "@vifx/types";

export type VifxNativePlatform = VifxBundlePlatform;
export type VifxNativeAction = "build" | "install" | "launch";
export type VifxNativeDiagnosticStatus = "pass" | "warn";
export type VifxNativeToolchainCheckStatus = "pass" | "warn";

export interface VifxPreparedNativeFile {
  outputPath: string;
  sizeBytes: number;
  sourcePath: string;
}

export interface VifxPreparedNativeAsset extends VifxPreparedNativeFile {
  hash?: string;
  height?: number;
  httpServerLocation: string;
  name: string;
  scales: number[];
  type: string;
  width?: number;
}

export interface VifxNativeArtifactManifest {
  assets: VifxPreparedNativeAsset[];
  bundle: VifxPreparedNativeFile;
  formatVersion: 1;
  hermesBytecode?: VifxPreparedNativeFile;
  manifestPath: string;
  outputRoot: string;
  platform: VifxNativePlatform;
  projectRoot: string;
  sourceMap?: VifxPreparedNativeFile;
}

export interface PrepareNativeArtifactsOptions {
  artifacts: VifxBundleArtifacts;
  outDir?: string;
  platform?: string;
  projectRoot?: string;
}

export interface NativeToolchainCheck {
  command?: string;
  hint?: string;
  message: string;
  name: string;
  status: VifxNativeToolchainCheckStatus;
}

export interface VifxNativeHostCheck {
  hint?: string;
  message: string;
  name: string;
  path?: string;
  status: VifxNativeDiagnosticStatus;
}

export interface NativeToolchainDiagnostics {
  checks: NativeToolchainCheck[];
  platform: VifxNativePlatform;
}

export interface VifxNativeHostValidation {
  checks: VifxNativeHostCheck[];
  host: VifxNativeHost;
  platform: VifxNativePlatform;
  status: VifxNativeDiagnosticStatus;
}

export interface VifxNativeHost {
  androidApplicationId?: string;
  androidRoot?: string;
  bundleId?: string;
  gradleCommand?: string;
  hostRoot: string;
  iosProject?: string;
  platform: VifxNativePlatform;
  projectRoot: string;
  scheme?: string;
}

export interface VifxNativeCommandStep {
  args: string[];
  command: string;
  cwd: string;
  label: string;
}

export interface VifxNativeCommandPlan {
  action: VifxNativeAction;
  host: VifxNativeHost;
  platform: VifxNativePlatform;
  steps: VifxNativeCommandStep[];
}

export interface DetectNativeHostOptions {
  platform: string;
  projectRoot: string;
}

export interface ValidateNativeHostOptions extends DetectNativeHostOptions {
  manifestPath?: string;
}

export interface CreateNativeCommandPlanOptions extends DetectNativeHostOptions {
  action: VifxNativeAction;
  androidApplicationId?: string;
  appPath?: string;
  bundleId?: string;
  configuration?: string;
  destination?: string;
  device?: string;
  scheme?: string;
  variant?: string;
}

export interface NativeCommandExecutionResult {
  plan: VifxNativeCommandPlan;
  steps: Array<{
    command: string;
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
}

export interface DiagnoseNativeToolchainOptions {
  commandExists?: (command: string) => boolean;
  env?: NodeJS.ProcessEnv;
  platform: string;
  projectRoot?: string;
}

export interface NativeRuntimeCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface DiagnoseNativeRuntimeTargetsOptions {
  device?: string;
  env?: NodeJS.ProcessEnv;
  pathExists?: (filePath: string) => boolean | Promise<boolean>;
  platform: string;
  projectRoot?: string;
  runCommand?: (command: string, args: string[]) => NativeRuntimeCommandResult;
}

export interface NativeRuntimeTargetDiagnostics {
  checks: NativeToolchainCheck[];
  device?: string;
  platform: VifxNativePlatform;
}

const MANIFEST_FILE_NAME = "vifx-native-manifest.json";
const DEFAULT_IOS_DESTINATION = "generic/platform=iOS Simulator";
const DEFAULT_IOS_DEVICE = "booted";
const DEFAULT_ANDROID_VARIANT = "Debug";

function isNativePlatform(value: string): value is VifxNativePlatform {
  return value === "ios" || value === "android";
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function resolveFromProject(projectRoot: string, filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

async function ensureReadableFile(filePath: string, code: string, hint: string) {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error(`Expected a file at "${filePath}".`);
    }

    return fileStats.size;
  } catch (error) {
    throw new VifxError({
      code,
      message: `Required native artifact input "${filePath}" was not found.`,
      hint,
      docsPath: "/reference/native#native-artifacts",
      cause: error,
    });
  }
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function nativeBundleFileName(platform: VifxNativePlatform) {
  return platform === "ios" ? "main.jsbundle" : "index.android.bundle";
}

function nativeSourceMapFileName(platform: VifxNativePlatform) {
  return `${nativeBundleFileName(platform)}.map`;
}

function nativeHermesFileName(platform: VifxNativePlatform) {
  return platform === "ios" ? "main.hbc" : "index.android.hbc";
}

function validateNativePlatform(value: string): VifxNativePlatform {
  if (isNativePlatform(value)) {
    return value;
  }

  throw new VifxError({
    code: "VIFX_NATIVE_INVALID_PLATFORM",
    message: `Unsupported native platform "${value}".`,
    hint: "Use platform ios or android.",
    docsPath: "/reference/native#native-artifacts",
  });
}

async function readTextIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function cleanBuildSettingValue(rawValue: string | undefined) {
  return rawValue?.trim().replace(/^"|"$/g, "");
}

function parseIosBundleId(projectContents: string | null) {
  if (!projectContents) {
    return undefined;
  }

  const matches = [...projectContents.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/gu)];
  const match = matches
    .map((candidate) => cleanBuildSettingValue(candidate[1]))
    .find((value) => value && !value.includes("$("));

  return match;
}

function parseIosBuildSetting(projectContents: string | null, settingName: string) {
  if (!projectContents) {
    return undefined;
  }

  const pattern = new RegExp(`${settingName} = ([^;]+);`, "u");
  return cleanBuildSettingValue(projectContents.match(pattern)?.[1]);
}

function parseIosProvisioningProfile(projectContents: string | null) {
  return (
    parseIosBuildSetting(projectContents, "PROVISIONING_PROFILE_SPECIFIER") ??
    parseIosBuildSetting(projectContents, "PROVISIONING_PROFILE")
  );
}

function parseAndroidApplicationId(buildFileContents: string | null) {
  if (!buildFileContents) {
    return undefined;
  }

  const applicationIdMatch = buildFileContents.match(/applicationId\s*(?:=)?\s*["']([^"']+)["']/u);
  const namespaceMatch = buildFileContents.match(/namespace\s*(?:=)?\s*["']([^"']+)["']/u);
  return applicationIdMatch?.[1] ?? namespaceMatch?.[1];
}

function hasAndroidSigningConfig(buildFileContents: string | null) {
  return Boolean(buildFileContents?.match(/\bsigningConfigs?\b|\bsigningConfig\b/u));
}

function hasAndroidSigningMaterial(buildFileContents: string | null) {
  return Boolean(
    buildFileContents?.match(/\bstoreFile\b/u) && buildFileContents.match(/\bkeyAlias\b/u),
  );
}

async function listDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function missingNativeHost(platform: VifxNativePlatform, projectRoot: string): never {
  throw new VifxError({
    code: "VIFX_NATIVE_HOST_MISSING",
    details: {
      platform,
      projectRoot,
    },
    docsPath: "/reference/native#native-hosts",
    hint:
      platform === "ios"
        ? "Add an ios/*.xcodeproj host or point the command at a project root that contains one."
        : "Add an android Gradle host with android/build.gradle or android/settings.gradle.",
    message: `No ${platform} native host was found in "${projectRoot}".`,
  });
}

async function detectIosHost(projectRoot: string): Promise<VifxNativeHost> {
  const iosRoot = path.join(projectRoot, "ios");
  const entries = await listDirectoryEntries(iosRoot);
  const xcodeProject = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"))
    .map((entry) => entry.name)
    .sort()[0];

  if (!xcodeProject) {
    missingNativeHost("ios", projectRoot);
  }

  const iosProject = path.join(iosRoot, xcodeProject);
  const scheme = path.basename(xcodeProject, ".xcodeproj");
  const projectContents = await readTextIfExists(path.join(iosProject, "project.pbxproj"));

  return {
    bundleId: parseIosBundleId(projectContents),
    hostRoot: iosRoot,
    iosProject,
    platform: "ios",
    projectRoot,
    scheme,
  };
}

async function detectAndroidHost(projectRoot: string): Promise<VifxNativeHost> {
  const androidRoot = path.join(projectRoot, "android");
  const buildGradlePath = path.join(androidRoot, "build.gradle");
  const buildGradleKtsPath = path.join(androidRoot, "build.gradle.kts");
  const settingsGradlePath = path.join(androidRoot, "settings.gradle");
  const settingsGradleKtsPath = path.join(androidRoot, "settings.gradle.kts");
  const hasHostMarker =
    (await pathExists(buildGradlePath)) ||
    (await pathExists(buildGradleKtsPath)) ||
    (await pathExists(settingsGradlePath)) ||
    (await pathExists(settingsGradleKtsPath));

  if (!hasHostMarker) {
    missingNativeHost("android", projectRoot);
  }

  const gradleWrapperPath = path.join(
    androidRoot,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  const appBuildFile =
    (await readTextIfExists(path.join(androidRoot, "app", "build.gradle"))) ??
    (await readTextIfExists(path.join(androidRoot, "app", "build.gradle.kts")));

  return {
    androidApplicationId: parseAndroidApplicationId(appBuildFile),
    androidRoot,
    gradleCommand: (await pathExists(gradleWrapperPath))
      ? process.platform === "win32"
        ? "gradlew.bat"
        : "./gradlew"
      : "gradle",
    hostRoot: androidRoot,
    platform: "android",
    projectRoot,
  };
}

function requireValue(options: {
  code?: string;
  docsPath?: string;
  hint: string;
  label: string;
  value: string | undefined;
}) {
  if (options.value) {
    return options.value;
  }

  throw new VifxError({
    code: options.code ?? "VIFX_NATIVE_LAUNCH_TARGET_MISSING",
    docsPath: options.docsPath ?? "/reference/native#native-commands",
    hint: options.hint,
    message: `Missing ${options.label} for native command planning.`,
  });
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function iosAppPath(options: { configuration: string; projectRoot: string; scheme: string }) {
  return path.join(
    options.projectRoot,
    ".vifx",
    "native-build",
    "ios",
    "Build",
    "Products",
    `${options.configuration}-iphonesimulator`,
    `${options.scheme}.app`,
  );
}

function manifestJson(manifest: VifxNativeArtifactManifest) {
  return JSON.stringify(manifest, null, 2);
}

async function copyPreparedFile(options: {
  docsHint: string;
  outputPath: string;
  projectRoot: string;
  sourcePath: string;
}) {
  const sourcePath = resolveFromProject(options.projectRoot, options.sourcePath);
  const outputPath = options.outputPath;
  const sizeBytes = await ensureReadableFile(
    sourcePath,
    "VIFX_NATIVE_ARTIFACT_MISSING",
    options.docsHint,
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);

  return {
    outputPath: relativeFrom(options.projectRoot, outputPath),
    sizeBytes,
    sourcePath: relativeFrom(options.projectRoot, sourcePath),
  } satisfies VifxPreparedNativeFile;
}

async function copyPreparedAsset(options: {
  asset: VifxBuildAssetArtifact;
  outputRoot: string;
  projectRoot: string;
}) {
  const sourcePath = resolveFromProject(options.projectRoot, options.asset.emittedPath);
  const outputPath = path.join(options.outputRoot, "assets", path.basename(sourcePath));
  const file = await copyPreparedFile({
    docsHint: "Run vifx build for the target platform before preparing native artifacts.",
    outputPath,
    projectRoot: options.projectRoot,
    sourcePath,
  });

  return {
    ...file,
    hash: options.asset.hash,
    height: options.asset.height,
    httpServerLocation: options.asset.httpServerLocation,
    name: options.asset.name,
    scales: options.asset.scales,
    type: options.asset.type,
    width: options.asset.width,
  } satisfies VifxPreparedNativeAsset;
}

export async function prepareNativeArtifacts(
  options: PrepareNativeArtifactsOptions,
): Promise<VifxNativeArtifactManifest> {
  const projectRoot = path.resolve(options.projectRoot ?? options.artifacts.projectRoot);
  const platform = options.platform ?? options.artifacts.platform;

  if (!isNativePlatform(platform)) {
    throw new VifxError({
      code: "VIFX_NATIVE_INVALID_PLATFORM",
      message: `Unsupported native platform "${platform}".`,
      hint: "Use platform ios or android.",
      docsPath: "/reference/native#native-artifacts",
    });
  }

  if (options.artifacts.platform !== platform) {
    throw new VifxError({
      code: "VIFX_NATIVE_INVALID_PLATFORM",
      message: `Build artifacts are for "${options.artifacts.platform}", not "${platform}".`,
      hint: "Prepare native artifacts from a matching Vifx build result.",
      docsPath: "/reference/native#native-artifacts",
    });
  }

  const outputRoot = path.resolve(projectRoot, options.outDir ?? `.vifx/native/${platform}`);
  await mkdir(outputRoot, { recursive: true });

  const bundle = await copyPreparedFile({
    docsHint: "Run vifx build for the target platform before preparing native artifacts.",
    outputPath: path.join(outputRoot, nativeBundleFileName(platform)),
    projectRoot,
    sourcePath: options.artifacts.bundle.path,
  });

  const sourceMap = options.artifacts.sourceMap
    ? await copyPreparedFile({
        docsHint: "Enable source maps on the Vifx build target or rebuild the target.",
        outputPath: path.join(outputRoot, nativeSourceMapFileName(platform)),
        projectRoot,
        sourcePath: options.artifacts.sourceMap.path,
      })
    : undefined;

  const hermesBytecode = options.artifacts.hermesBytecodePath
    ? await copyPreparedFile({
        docsHint: "Re-run the Hermes-enabled Vifx build for this target.",
        outputPath: path.join(outputRoot, nativeHermesFileName(platform)),
        projectRoot,
        sourcePath: options.artifacts.hermesBytecodePath,
      })
    : undefined;

  const assets = await Promise.all(
    options.artifacts.assets.map((asset) =>
      copyPreparedAsset({
        asset,
        outputRoot,
        projectRoot,
      }),
    ),
  );

  const manifestPath = path.join(outputRoot, MANIFEST_FILE_NAME);
  const manifest = {
    assets,
    bundle,
    formatVersion: 1,
    hermesBytecode,
    manifestPath: relativeFrom(projectRoot, manifestPath),
    outputRoot: relativeFrom(projectRoot, outputRoot),
    platform,
    projectRoot,
    sourceMap,
  } satisfies VifxNativeArtifactManifest;

  await writeFile(manifestPath, `${manifestJson(manifest)}\n`, "utf8");
  return manifest;
}

export async function detectNativeHost(options: DetectNativeHostOptions): Promise<VifxNativeHost> {
  const projectRoot = path.resolve(options.projectRoot);
  const platform = validateNativePlatform(options.platform);

  return platform === "ios" ? detectIosHost(projectRoot) : detectAndroidHost(projectRoot);
}

function checkPreparedManifest(options: {
  checks: VifxNativeHostCheck[];
  manifestPath?: string;
  platform: VifxNativePlatform;
  projectRoot: string;
}) {
  const manifestPath = path.resolve(
    options.projectRoot,
    options.manifestPath ?? path.join(".vifx", "native", options.platform, MANIFEST_FILE_NAME),
  );

  return pathExists(manifestPath).then((exists) => {
    options.checks.push(
      exists
        ? {
            message: `Prepared native manifest exists at "${relativeFrom(options.projectRoot, manifestPath)}".`,
            name: "native-manifest",
            path: relativeFrom(options.projectRoot, manifestPath),
            status: "pass",
          }
        : {
            hint: `Run: vifx native prepare --platform ${options.platform}`,
            message: `Prepared native manifest was not found at "${relativeFrom(options.projectRoot, manifestPath)}".`,
            name: "native-manifest",
            path: relativeFrom(options.projectRoot, manifestPath),
            status: "warn",
          },
    );
  });
}

async function validateIosHost(options: {
  host: VifxNativeHost;
  manifestPath?: string;
  projectRoot: string;
}) {
  const checks: VifxNativeHostCheck[] = [
    {
      message: `iOS host project detected at "${relativeFrom(options.projectRoot, options.host.iosProject ?? options.host.hostRoot)}".`,
      name: "ios-host",
      path: relativeFrom(options.projectRoot, options.host.iosProject ?? options.host.hostRoot),
      status: "pass",
    },
  ];
  const projectContents = await readTextIfExists(
    path.join(
      requireValue({
        hint: "Use a project root that contains ios/*.xcodeproj.",
        label: "iOS project",
        value: options.host.iosProject,
      }),
      "project.pbxproj",
    ),
  );
  const bundleId = options.host.bundleId;
  const developmentTeam = parseIosBuildSetting(projectContents, "DEVELOPMENT_TEAM");
  const codeSignStyle = parseIosBuildSetting(projectContents, "CODE_SIGN_STYLE");
  const provisioningProfile = parseIosProvisioningProfile(projectContents);

  checks.push(
    bundleId
      ? {
          message: `iOS bundle id is configured as "${bundleId}".`,
          name: "ios-bundle-id",
          status: "pass",
        }
      : {
          hint: "Set PRODUCT_BUNDLE_IDENTIFIER or pass --bundle-id when launching.",
          message: "iOS bundle id could not be inferred from PRODUCT_BUNDLE_IDENTIFIER.",
          name: "ios-bundle-id",
          status: "warn",
        },
  );
  checks.push(
    developmentTeam
      ? {
          message: `iOS development team is configured as "${developmentTeam}".`,
          name: "ios-signing-team",
          status: "pass",
        }
      : {
          hint: "Set DEVELOPMENT_TEAM before building for a physical device.",
          message: "iOS development team is not configured in the Xcode project.",
          name: "ios-signing-team",
          status: "warn",
        },
  );
  checks.push(
    codeSignStyle
      ? {
          message: `iOS code signing style is "${codeSignStyle}".`,
          name: "ios-code-sign-style",
          status: "pass",
        }
      : {
          hint: "Set CODE_SIGN_STYLE to Automatic or Manual in the Xcode project.",
          message: "iOS code signing style is not configured in the Xcode project.",
          name: "ios-code-sign-style",
          status: "warn",
        },
  );
  checks.push(
    codeSignStyle === "Automatic" && developmentTeam
      ? {
          message: "iOS automatic signing can manage provisioning profiles for this team.",
          name: "ios-provisioning-profile",
          status: "pass",
        }
      : provisioningProfile
        ? {
            message: `iOS provisioning profile is configured as "${provisioningProfile}".`,
            name: "ios-provisioning-profile",
            status: "pass",
          }
        : {
            hint: "Use Automatic signing with DEVELOPMENT_TEAM, or set PROVISIONING_PROFILE_SPECIFIER for manual signing.",
            message: "iOS provisioning profile readiness could not be confirmed.",
            name: "ios-provisioning-profile",
            status: "warn",
          },
  );
  await checkPreparedManifest({
    checks,
    manifestPath: options.manifestPath,
    platform: "ios",
    projectRoot: options.projectRoot,
  });

  return checks;
}

async function validateAndroidHost(options: {
  host: VifxNativeHost;
  manifestPath?: string;
  projectRoot: string;
}) {
  const checks: VifxNativeHostCheck[] = [
    {
      message: `Android host detected at "${relativeFrom(options.projectRoot, options.host.androidRoot ?? options.host.hostRoot)}".`,
      name: "android-host",
      path: relativeFrom(options.projectRoot, options.host.androidRoot ?? options.host.hostRoot),
      status: "pass",
    },
  ];
  const androidRoot = requireValue({
    hint: "Use a project root that contains android/build.gradle or android/settings.gradle.",
    label: "Android host root",
    value: options.host.androidRoot,
  });
  const appBuildFilePath = (await pathExists(path.join(androidRoot, "app", "build.gradle")))
    ? path.join(androidRoot, "app", "build.gradle")
    : path.join(androidRoot, "app", "build.gradle.kts");
  const appBuildFile = await readTextIfExists(appBuildFilePath);
  const applicationId = options.host.androidApplicationId;

  checks.push(
    applicationId
      ? {
          message: `Android application id is configured as "${applicationId}".`,
          name: "android-application-id",
          status: "pass",
        }
      : {
          hint: "Set applicationId in android/app/build.gradle or pass --application-id when launching.",
          message: "Android application id could not be inferred.",
          name: "android-application-id",
          status: "warn",
        },
  );
  checks.push(
    appBuildFile
      ? {
          message: `Android app Gradle file detected at "${relativeFrom(options.projectRoot, appBuildFilePath)}".`,
          name: "android-app-gradle",
          path: relativeFrom(options.projectRoot, appBuildFilePath),
          status: "pass",
        }
      : {
          hint: "Add android/app/build.gradle or android/app/build.gradle.kts.",
          message: "Android app Gradle file was not found.",
          name: "android-app-gradle",
          status: "warn",
        },
  );
  checks.push(
    hasAndroidSigningConfig(appBuildFile)
      ? {
          message: "Android signing configuration is referenced by the app Gradle file.",
          name: "android-signing-config",
          status: "pass",
        }
      : {
          hint: "Configure signingConfigs for release builds before device distribution.",
          message: "Android signing configuration was not found in the app Gradle file.",
          name: "android-signing-config",
          status: "warn",
        },
  );
  checks.push(
    hasAndroidSigningMaterial(appBuildFile)
      ? {
          message: "Android signing material references storeFile and keyAlias.",
          name: "android-signing-material",
          status: "pass",
        }
      : {
          hint: "Reference storeFile and keyAlias in signingConfigs before release/device distribution.",
          message: "Android signing material could not be confirmed from the app Gradle file.",
          name: "android-signing-material",
          status: "warn",
        },
  );
  await checkPreparedManifest({
    checks,
    manifestPath: options.manifestPath,
    platform: "android",
    projectRoot: options.projectRoot,
  });

  return checks;
}

export async function validateNativeHost(
  options: ValidateNativeHostOptions,
): Promise<VifxNativeHostValidation> {
  const projectRoot = path.resolve(options.projectRoot);
  const platform = validateNativePlatform(options.platform);
  const host = await detectNativeHost({
    platform,
    projectRoot,
  });
  const checks =
    platform === "ios"
      ? await validateIosHost({
          host,
          manifestPath: options.manifestPath,
          projectRoot,
        })
      : await validateAndroidHost({
          host,
          manifestPath: options.manifestPath,
          projectRoot,
        });

  return {
    checks,
    host,
    platform,
    status: checks.some((check) => check.status === "warn") ? "warn" : "pass",
  };
}

function createIosCommandPlan(options: {
  action: VifxNativeAction;
  appPath?: string;
  bundleId?: string;
  configuration?: string;
  destination?: string;
  device?: string;
  host: VifxNativeHost;
  scheme?: string;
}) {
  const scheme = options.scheme ?? options.host.scheme;
  const configuration = options.configuration ?? "Debug";
  const destination = options.destination ?? DEFAULT_IOS_DESTINATION;
  const device = options.device ?? DEFAULT_IOS_DEVICE;
  const requiredScheme = requireValue({
    hint: "Pass --scheme or use an ios/*.xcodeproj name that matches the scheme.",
    label: "iOS scheme",
    value: scheme,
  });
  const iosProject = requireValue({
    hint: "Use a project root that contains ios/*.xcodeproj.",
    label: "iOS project",
    value: options.host.iosProject,
  });

  if (options.action === "build") {
    return [
      {
        args: [
          "-project",
          iosProject,
          "-scheme",
          requiredScheme,
          "-configuration",
          configuration,
          "-destination",
          destination,
          "-derivedDataPath",
          path.join(options.host.projectRoot, ".vifx", "native-build", "ios"),
          "build",
        ],
        command: "xcodebuild",
        cwd: options.host.projectRoot,
        label: "Build iOS host with xcodebuild",
      },
    ];
  }

  if (options.action === "install") {
    return [
      {
        args: [
          "simctl",
          "install",
          device,
          options.appPath ??
            iosAppPath({
              configuration,
              projectRoot: options.host.projectRoot,
              scheme: requiredScheme,
            }),
        ],
        command: "xcrun",
        cwd: options.host.projectRoot,
        label: "Install iOS app on simulator",
      },
    ];
  }

  return [
    {
      args: [
        "simctl",
        "launch",
        device,
        requireValue({
          hint: "Pass --bundle-id or set PRODUCT_BUNDLE_IDENTIFIER in the Xcode project.",
          label: "iOS bundle id",
          value: options.bundleId ?? options.host.bundleId,
        }),
      ],
      command: "xcrun",
      cwd: options.host.projectRoot,
      label: "Launch iOS app on simulator",
    },
  ];
}

function createAndroidCommandPlan(options: {
  action: VifxNativeAction;
  androidApplicationId?: string;
  appPath?: string;
  host: VifxNativeHost;
  variant?: string;
}) {
  const variant = capitalize(options.variant ?? DEFAULT_ANDROID_VARIANT);
  const androidRoot = requireValue({
    hint: "Use a project root that contains android/build.gradle or android/settings.gradle.",
    label: "Android host root",
    value: options.host.androidRoot,
  });
  const gradleCommand = options.host.gradleCommand ?? "gradle";

  if (options.action === "build") {
    return [
      {
        args: [`:app:assemble${variant}`],
        command: gradleCommand,
        cwd: androidRoot,
        label: "Build Android host with Gradle",
      },
    ];
  }

  if (options.action === "install") {
    if (options.appPath) {
      return [
        {
          args: ["install", "-r", options.appPath],
          command: "adb",
          cwd: options.host.projectRoot,
          label: "Install Android APK with adb",
        },
      ];
    }

    return [
      {
        args: [`:app:install${variant}`],
        command: gradleCommand,
        cwd: androidRoot,
        label: "Install Android host with Gradle",
      },
    ];
  }

  return [
    {
      args: [
        "shell",
        "monkey",
        "-p",
        requireValue({
          hint: "Pass --application-id or set applicationId in android/app/build.gradle.",
          label: "Android application id",
          value: options.androidApplicationId ?? options.host.androidApplicationId,
        }),
        "1",
      ],
      command: "adb",
      cwd: options.host.projectRoot,
      label: "Launch Android app with adb",
    },
  ];
}

export async function createNativeCommandPlan(
  options: CreateNativeCommandPlanOptions,
): Promise<VifxNativeCommandPlan> {
  const platform = validateNativePlatform(options.platform);
  const host = await detectNativeHost({
    platform,
    projectRoot: options.projectRoot,
  });
  const steps =
    platform === "ios"
      ? createIosCommandPlan({
          action: options.action,
          appPath: options.appPath,
          bundleId: options.bundleId,
          configuration: options.configuration,
          destination: options.destination,
          device: options.device,
          host,
          scheme: options.scheme,
        })
      : createAndroidCommandPlan({
          action: options.action,
          androidApplicationId: options.androidApplicationId,
          appPath: options.appPath,
          host,
          variant: options.variant,
        });

  return {
    action: options.action,
    host,
    platform,
    steps,
  };
}

export function runNativeCommandPlan(plan: VifxNativeCommandPlan): NativeCommandExecutionResult {
  const steps = [];

  for (const step of plan.steps) {
    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd,
      encoding: "utf8",
    });
    const exitCode = result.status ?? 1;
    steps.push({
      command: [step.command, ...step.args].join(" "),
      exitCode,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    });

    if (exitCode !== 0) {
      throw new VifxError({
        code: "VIFX_NATIVE_COMMAND_FAILED",
        details: {
          command: step.command,
          exitCode,
          platform: plan.platform,
        },
        docsPath: "/reference/native#native-commands",
        hint: "Review the native toolchain output, fix the host project issue, and rerun the command.",
        message: `Native ${plan.platform} ${plan.action} command failed: ${step.command}.`,
      });
    }
  }

  return {
    plan,
    steps,
  };
}

function defaultCommandExists(command: string) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });

  return result.status === 0;
}

function defaultRunCommand(command: string, args: string[]): NativeRuntimeCommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function findGradleWrapper(projectRoot: string | undefined) {
  if (!projectRoot) {
    return false;
  }

  return pathExists(
    path.join(projectRoot, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew"),
  );
}

export async function diagnoseNativeToolchain(
  options: DiagnoseNativeToolchainOptions,
): Promise<NativeToolchainDiagnostics> {
  const commandExists = options.commandExists ?? defaultCommandExists;
  const env = options.env ?? process.env;
  const checks: NativeToolchainCheck[] = [];

  if (options.platform === "ios") {
    checks.push(
      commandExists("xcodebuild")
        ? {
            command: "xcodebuild",
            message: "xcodebuild is available.",
            name: "xcodebuild",
            status: "pass",
          }
        : {
            command: "xcodebuild",
            hint: "Install Xcode command line tools and select an Xcode developer directory.",
            message: "xcodebuild was not found.",
            name: "xcodebuild",
            status: "warn",
          },
    );
    checks.push(
      commandExists("xcrun")
        ? {
            command: "xcrun",
            message: "xcrun is available.",
            name: "xcrun",
            status: "pass",
          }
        : {
            command: "xcrun",
            hint: "Install Xcode command line tools before launching simulators.",
            message: "xcrun was not found.",
            name: "xcrun",
            status: "warn",
          },
    );
  }

  if (options.platform === "android") {
    const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
    checks.push(
      sdkRoot
        ? {
            message: `Android SDK root is configured at "${sdkRoot}".`,
            name: "android-sdk",
            status: "pass",
          }
        : {
            hint: "Set ANDROID_HOME or ANDROID_SDK_ROOT before building or launching Android.",
            message: "Android SDK root is not configured.",
            name: "android-sdk",
            status: "warn",
          },
    );
    checks.push(
      commandExists("adb")
        ? {
            command: "adb",
            message: "adb is available.",
            name: "adb",
            status: "pass",
          }
        : {
            command: "adb",
            hint: "Install Android platform tools or add adb to PATH.",
            message: "adb was not found.",
            name: "adb",
            status: "warn",
          },
    );

    const hasGradleWrapper = await findGradleWrapper(options.projectRoot);
    checks.push(
      hasGradleWrapper || commandExists("gradle")
        ? {
            command: hasGradleWrapper ? "android/gradlew" : "gradle",
            message: hasGradleWrapper
              ? "Android Gradle wrapper is available."
              : "gradle is available.",
            name: "gradle",
            status: "pass",
          }
        : {
            command: "gradle",
            hint: "Add an Android Gradle wrapper or install Gradle before building Android.",
            message: "No Android Gradle wrapper or gradle command was found.",
            name: "gradle",
            status: "warn",
          },
    );
  }

  if (!isNativePlatform(options.platform)) {
    throw new VifxError({
      code: "VIFX_NATIVE_INVALID_PLATFORM",
      message: `Unsupported native platform "${options.platform}".`,
      hint: "Use platform ios or android.",
      docsPath: "/reference/native#native-artifacts",
    });
  }

  return {
    checks,
    platform: options.platform,
  };
}

interface IosSimctlDevice {
  isAvailable?: boolean;
  name?: string;
  state?: string;
  udid?: string;
}

function parseIosSimctlDevices(stdout: string): IosSimctlDevice[] {
  try {
    const parsed = JSON.parse(stdout) as {
      devices?: Record<string, IosSimctlDevice[]>;
    };

    return Object.values(parsed.devices ?? {}).flat();
  } catch {
    return [];
  }
}

function formatIosDevice(device: IosSimctlDevice) {
  return `${device.name ?? "unknown"} (${device.udid ?? "unknown"})`;
}

function parseAndroidAdbDevices(stdout: string) {
  return stdout
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/u);
      return {
        serial,
        state,
      };
    })
    .filter((device) => device.serial && device.state);
}

async function diagnoseIosRuntimeTargets(
  options: DiagnoseNativeRuntimeTargetsOptions,
  platform: VifxNativePlatform,
): Promise<NativeRuntimeTargetDiagnostics> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const target = options.device ?? DEFAULT_IOS_DEVICE;
  const listTarget = target === DEFAULT_IOS_DEVICE ? "booted" : "available";
  const result = runCommand("xcrun", ["simctl", "list", "devices", listTarget, "--json"]);
  const checks: NativeToolchainCheck[] = [];

  if (result.exitCode !== 0) {
    checks.push({
      command: "xcrun",
      hint: "Install Xcode command line tools and ensure Simulator support is available.",
      message: `Unable to inspect iOS simulator target "${target}".`,
      name: "ios-simulator-target",
      status: "warn",
    });

    return {
      checks,
      device: target,
      platform,
    };
  }

  const devices = parseIosSimctlDevices(result.stdout);
  const matchingDevices =
    target === DEFAULT_IOS_DEVICE
      ? devices.filter((device) => device.state === "Booted")
      : devices.filter((device) => device.name === target || device.udid === target);
  const bootedDevices = matchingDevices.filter((device) => device.state === "Booted");

  checks.push(
    bootedDevices.length > 0
      ? {
          command: "xcrun",
          message: `iOS simulator target is booted: ${bootedDevices.map(formatIosDevice).join(", ")}.`,
          name: "ios-simulator-target",
          status: "pass",
        }
      : matchingDevices.length > 0
        ? {
            command: "xcrun",
            hint: `Run: xcrun simctl boot ${matchingDevices[0]?.udid ?? target}`,
            message: `iOS simulator target "${target}" exists but is not booted.`,
            name: "ios-simulator-target",
            status: "warn",
          }
        : {
            command: "xcrun",
            hint: "Create or boot an iOS simulator before install or launch.",
            message: `No booted iOS simulator target matched "${target}".`,
            name: "ios-simulator-target",
            status: "warn",
          },
  );

  return {
    checks,
    device: target,
    platform,
  };
}

async function diagnoseAndroidRuntimeTargets(
  options: DiagnoseNativeRuntimeTargetsOptions,
  platform: VifxNativePlatform,
): Promise<NativeRuntimeTargetDiagnostics> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const env = options.env ?? process.env;
  const pathExistsOption = options.pathExists ?? pathExists;
  const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const checks: NativeToolchainCheck[] = [];
  const deviceResult = options.device
    ? runCommand("adb", ["-s", options.device, "get-state"])
    : runCommand("adb", ["devices"]);

  if (deviceResult.exitCode !== 0) {
    checks.push({
      command: "adb",
      hint: "Start an Android emulator or connect an authorized device before install or launch.",
      message: options.device
        ? `Unable to inspect Android device "${options.device}".`
        : "Unable to list Android runtime targets with adb.",
      name: "android-device-target",
      status: "warn",
    });
  } else if (options.device) {
    const state = deviceResult.stdout.trim();
    checks.push(
      state === "device"
        ? {
            command: "adb",
            message: `Android device target "${options.device}" is connected and authorized.`,
            name: "android-device-target",
            status: "pass",
          }
        : {
            command: "adb",
            hint: "Authorize the device or choose a different adb serial.",
            message: `Android device target "${options.device}" is in state "${state || "unknown"}".`,
            name: "android-device-target",
            status: "warn",
          },
    );
  } else {
    const devices = parseAndroidAdbDevices(deviceResult.stdout);
    const authorizedDevices = devices.filter((device) => device.state === "device");
    checks.push(
      authorizedDevices.length > 0
        ? {
            command: "adb",
            message: `Android runtime target is connected: ${authorizedDevices
              .map((device) => device.serial)
              .join(", ")}.`,
            name: "android-device-target",
            status: "pass",
          }
        : {
            command: "adb",
            hint: "Start an emulator or connect and authorize a device before install or launch.",
            message: "No connected Android emulator or device is ready.",
            name: "android-device-target",
            status: "warn",
          },
    );
  }

  const emulatorPath = sdkRoot
    ? path.join(sdkRoot, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator")
    : undefined;
  checks.push(
    emulatorPath && (await pathExistsOption(emulatorPath))
      ? {
          command: emulatorPath,
          message: `Android emulator binary is available at "${emulatorPath}".`,
          name: "android-emulator",
          status: "pass",
        }
      : {
          hint: "Install Android Emulator in the SDK manager for emulator launch workflows.",
          message: sdkRoot
            ? `Android emulator binary was not found under "${sdkRoot}".`
            : "Android SDK root is not configured, so emulator availability could not be checked.",
          name: "android-emulator",
          status: "warn",
        },
  );

  return {
    checks,
    device: options.device,
    platform,
  };
}

export async function diagnoseNativeRuntimeTargets(
  options: DiagnoseNativeRuntimeTargetsOptions,
): Promise<NativeRuntimeTargetDiagnostics> {
  const platform = validateNativePlatform(options.platform);

  return platform === "ios"
    ? diagnoseIosRuntimeTargets(options, platform)
    : diagnoseAndroidRuntimeTargets(options, platform);
}

export function serializeNativeManifestForJson(
  manifest: VifxNativeArtifactManifest,
): VifxJsonObject {
  return manifest as unknown as VifxJsonObject;
}
