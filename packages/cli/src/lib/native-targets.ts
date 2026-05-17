import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { inspectProject } from "@vifx/compat-runner";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import type { VifxBundleTargetConfig, VifxVitePluginMode } from "@vifx/types";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ResolvedNativeTargets {
  configFile: string | null;
  configKind: "configured" | "inferred-expo";
  projectRoot: string;
  projectType: "expo" | "react-native" | "workspace-package" | "unknown";
  targets: VifxBundleTargetConfig[];
  viteMode: Exclude<VifxVitePluginMode, "none">;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(projectRoot: string) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const contents = await readFile(packageJsonPath, "utf8");

  try {
    return JSON.parse(contents) as PackageJson;
  } catch (error) {
    throw new VifxError({
      code: "VIFX_PROJECT_INVALID_PACKAGE_JSON",
      cause: error,
      details: {
        packageJsonPath,
      },
      hint: "Fix package.json before running Vifx native commands.",
      message: `Invalid package.json syntax at "${packageJsonPath}".`,
    });
  }
}

async function inferExpoNativeTargetDefaults(projectRoot: string) {
  const packageJson = await readPackageJson(projectRoot);
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const hasExpoRouter = Boolean(dependencies["expo-router"]);
  const hasAppDirectory = await pathExists(path.join(projectRoot, "app"));
  const nativePackageTransforms = [
    "expo",
    "expo-",
    "expo-router",
    "@expo",
    "react-native",
    "react-native-",
    "@react-native",
    "@react-navigation",
  ];

  if (hasExpoRouter && hasAppDirectory) {
    return {
      babelInPackages: nativePackageTransforms,
      entry: "expo-router/entry",
      jsxInPackages: ["expo-router", "@react-navigation", "react-native-"],
      shimJsxRuntime: false,
      shimReact: false,
      shimReactNative: false,
    } satisfies Pick<
      VifxBundleTargetConfig,
      | "babelInPackages"
      | "entry"
      | "jsxInPackages"
      | "shimJsxRuntime"
      | "shimReact"
      | "shimReactNative"
    >;
  }

  return {
    babelInPackages: nativePackageTransforms,
    entry: "./index.js",
    jsxInPackages: ["react-native-"],
    shimJsxRuntime: false,
    shimReact: false,
    shimReactNative: false,
  } satisfies Pick<
    VifxBundleTargetConfig,
    | "babelInPackages"
    | "entry"
    | "jsxInPackages"
    | "shimJsxRuntime"
    | "shimReact"
    | "shimReactNative"
  >;
}

function validateConfiguredNativeTargets(
  resolved: Awaited<ReturnType<typeof loadVifxConfig>>,
): ResolvedNativeTargets {
  const nativeTargets = resolved.config.vite.targets.filter(
    (target) => target.platform === "ios" || target.platform === "android",
  );

  if (resolved.config.vite.mode === "none" || nativeTargets.length === 0) {
    throw new VifxError({
      code: "VIFX_NATIVE_TARGETS_MISSING",
      message: `No Vifx native targets are configured in "${resolved.filePath ?? "inline config"}".`,
      hint: "Set vite.mode and at least one ios or android vite.targets entry in vifx.config.*.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  return {
    configFile: resolved.filePath ?? null,
    configKind: "configured",
    projectRoot: resolved.config.projectRoot,
    projectType: resolved.config.projectType,
    targets: nativeTargets,
    viteMode: resolved.config.vite.mode,
  };
}

export function describeNativeTargetSource(targets: ResolvedNativeTargets) {
  return targets.configFile ?? "inferred Expo defaults";
}

export async function resolveNativeTargets(options: {
  configFile?: string;
  optional?: boolean;
  projectRoot: string;
}): Promise<ResolvedNativeTargets | null> {
  const projectRoot = path.resolve(options.projectRoot);
  const loaded = await loadVifxConfig({
    configFile: options.configFile,
    cwd: projectRoot,
    optional: true,
  });

  if (loaded.filePath) {
    return validateConfiguredNativeTargets(loaded);
  }

  const inspection = await inspectProject(projectRoot);
  if (inspection.projectType === "expo") {
    const targetDefaults = await inferExpoNativeTargetDefaults(projectRoot);

    return {
      configFile: null,
      configKind: "inferred-expo",
      projectRoot: inspection.projectRoot,
      projectType: inspection.projectType,
      targets: [
        {
          ...targetDefaults,
          hermes: false,
          outDir: ".vifx/inferred/ios",
          platform: "ios",
        },
        {
          ...targetDefaults,
          hermes: false,
          outDir: ".vifx/inferred/android",
          platform: "android",
        },
      ],
      viteMode: "expo",
    };
  }

  if (options.optional) {
    return null;
  }

  throw new VifxError({
    code: "VIFX_CONFIG_NOT_FOUND",
    message: `No Vifx config file was found in "${projectRoot}".`,
    hint: "Run vifx init to create vifx.config.ts, or target an Expo project that Vifx can infer.",
    details: {
      cwd: projectRoot,
    },
  });
}
