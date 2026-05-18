import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectAssetGroup, isSupportedAssetFile } from "@vifx/asset-registry";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { validateSourceMap } from "@vifx/source-map-tools";
import type {
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxExpoExportGenerationResult,
  VifxExpoExportGeneratedFile,
  VifxExpoExportInspectionResult,
  VifxExpoNoMetroContractReport,
  VifxExpoNoMetroWorkflowReport,
  VifxJsonObject,
  VifxJsonValue,
} from "@vifx/types";

export interface InspectExpoExportOptions {
  exportRoot?: string;
  projectRoot: string;
}

export interface EvaluateExpoNoMetroContractOptions {
  exportRoot?: string;
  projectRoot: string;
  supportedExpoSdk?: string;
}

export interface WriteExpoExportOptions {
  bundles: VifxBundleArtifacts[];
  exportRoot?: string;
  manifest?: VifxJsonObject;
  metadata?: VifxJsonObject;
  projectRoot: string;
}

const DEFAULT_SUPPORTED_EXPO_SDK = "54";
const VIFX_CONFIG_NAMES = [
  "vifx.config.ts",
  "vifx.config.mts",
  "vifx.config.js",
  "vifx.config.mjs",
] as const;
const VITE_CONFIG_NAMES = [
  "vite.config.vifx.ts",
  "vite.config.vifx.mts",
  "vite.config.vifx.js",
  "vite.config.vifx.mjs",
] as const;

interface ConfiguredExpoSupport {
  buildConfigured: boolean;
  devConfigured: boolean;
  loadWarning: string | null;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

async function walkFiles(rootDirectory: string): Promise<string[]> {
  const filePaths: string[] = [];

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      filePaths.push(entryPath);
    }
  }

  await visit(rootDirectory);
  return filePaths.sort();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readStringDependency(
  packageJson: VifxJsonObject,
  fieldName: "dependencies" | "devDependencies" | "peerDependencies",
  dependencyName: string,
) {
  const field = packageJson[fieldName];
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return null;
  }

  const value = field[dependencyName];
  return typeof value === "string" ? value : null;
}

function readDependency(packageJson: VifxJsonObject, dependencyName: string) {
  return (
    readStringDependency(packageJson, "dependencies", dependencyName) ??
    readStringDependency(packageJson, "devDependencies", dependencyName) ??
    readStringDependency(packageJson, "peerDependencies", dependencyName)
  );
}

async function readPackageJson(projectRoot: string) {
  try {
    return JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ) as VifxJsonObject;
  } catch {
    return {};
  }
}

function isJsonObject(value: VifxJsonValue | undefined): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeJsonObjects(left: VifxJsonObject, right: VifxJsonObject | undefined) {
  return right ? { ...left, ...right } : left;
}

async function readExpoAppManifest(projectRoot: string): Promise<VifxJsonObject> {
  const packageJson = await readPackageJson(projectRoot);
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "vifx-expo-app";
  const appJsonPath = path.join(projectRoot, "app.json");
  const fallback = {
    assetBundlePatterns: ["assets/*"],
    name: packageName,
    slug: packageName,
  };

  try {
    const appJson = JSON.parse(await readFile(appJsonPath, "utf8")) as VifxJsonObject;
    const expo = appJson.expo;
    const manifest = isJsonObject(expo) ? expo : appJson;

    return {
      ...fallback,
      ...manifest,
      assetBundlePatterns: ["assets/*"],
    };
  } catch {
    return fallback;
  }
}

async function hasAnyFile(projectRoot: string, fileNames: readonly string[]) {
  for (const fileName of fileNames) {
    if (await pathExists(path.join(projectRoot, fileName))) {
      return true;
    }
  }

  return false;
}

async function inspectConfiguredExpoSupport(projectRoot: string): Promise<ConfiguredExpoSupport> {
  const hasVifxConfig = await hasAnyFile(projectRoot, VIFX_CONFIG_NAMES);
  if (!hasVifxConfig) {
    return {
      buildConfigured: false,
      devConfigured: false,
      loadWarning: null,
    };
  }

  try {
    const loaded = await loadVifxConfig({
      cwd: projectRoot,
      optional: false,
    });
    const expoTargets =
      loaded.config.vite.mode === "expo"
        ? loaded.config.vite.targets.filter(
            (target) => target.platform === "ios" || target.platform === "android",
          )
        : [];

    return {
      buildConfigured: expoTargets.length > 0,
      devConfigured: expoTargets.some((target) => target.reactNativeCompat === "web"),
      loadWarning: null,
    };
  } catch (error) {
    return {
      buildConfigured: false,
      devConfigured: false,
      loadWarning:
        error instanceof Error
          ? `Existing Vifx config could not be loaded: ${error.message}`
          : "Existing Vifx config could not be loaded.",
    };
  }
}

function createWorkflow(options: VifxExpoNoMetroWorkflowReport): VifxExpoNoMetroWorkflowReport {
  return {
    blockers: [...options.blockers],
    evidence: [...options.evidence],
    id: options.id,
    notes: [...options.notes],
    status: options.status,
    title: options.title,
  };
}

function inferPlatform(filePath: string): "ios" | "android" | "unknown" {
  const normalized = toPosixPath(filePath);
  if (normalized.includes("/ios/")) {
    return "ios";
  }

  if (normalized.includes("/android/")) {
    return "android";
  }

  return "unknown";
}

function inferManifestKind(filePath: string) {
  const fileName = path.basename(filePath).toLowerCase();

  if (fileName.includes("metadata")) {
    return "metadata";
  }

  if (fileName.includes("manifest")) {
    return "manifest";
  }

  return "json";
}

export async function inspectExpoExport(
  options: InspectExpoExportOptions,
): Promise<VifxExpoExportInspectionResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const exportRoot = path.resolve(projectRoot, options.exportRoot ?? ".");
  const files = await walkFiles(exportRoot).catch(() => null);

  if (!files) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_NOT_FOUND",
      message: `Could not inspect Expo export root "${exportRoot}".`,
      hint: "Pass an existing exported directory that already contains bundles, assets, and JSON metadata.",
      docsPath: "/reference/packages#vifxexpo-export",
    });
  }

  const bundlePaths = files.filter((filePath) => filePath.endsWith(".bundle"));
  const bundles = await Promise.all(
    bundlePaths.map(async (bundlePath) => {
      const sourceMapPath = `${bundlePath}.map`;
      const bundleStats = await stat(bundlePath);
      const sourceMap = files.includes(sourceMapPath)
        ? await validateSourceMap({ sourceMapPath }).then((validation) => ({
            path: relativeFrom(projectRoot, sourceMapPath),
            sourceCount: validation.sourceCount,
            valid: validation.valid,
            warnings: validation.warnings,
          }))
        : null;

      return {
        bundle: {
          path: relativeFrom(projectRoot, bundlePath),
          sizeBytes: bundleStats.size,
        },
        platform: inferPlatform(bundlePath),
        sourceMap,
      };
    }),
  );

  const manifestPaths = files.filter(
    (filePath) => filePath.endsWith(".json") && !filePath.endsWith(".map"),
  );
  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      contents: JSON.parse(await readFile(manifestPath, "utf8")) as VifxJsonValue,
      kind: inferManifestKind(manifestPath),
      path: relativeFrom(projectRoot, manifestPath),
    })),
  );

  const assetSourcePaths = files.filter(
    (filePath) => isSupportedAssetFile(filePath) && !filePath.endsWith(".json"),
  );
  const assets = await Promise.all(
    assetSourcePaths.map(async (assetPath) => {
      const descriptor = await collectAssetGroup({
        filePath: assetPath,
        projectRoot,
      });
      const assetStats = await stat(assetPath);

      return {
        emittedPath: relativeFrom(projectRoot, assetPath),
        hash: descriptor.hash,
        height: descriptor.height,
        httpServerLocation: descriptor.httpServerLocation,
        name: descriptor.name,
        scales: [...descriptor.scales],
        sizeBytes: assetStats.size,
        sourceFilePath: relativeFrom(projectRoot, assetPath),
        type: descriptor.type,
        width: descriptor.width,
      };
    }),
  );

  const warnings: string[] = [];
  if (bundles.length === 0) {
    warnings.push(
      `No Expo export bundles were found under "${relativeFrom(projectRoot, exportRoot)}".`,
    );
  }

  return {
    assets: assets.sort((left, right) => left.emittedPath.localeCompare(right.emittedPath)),
    bundles: bundles.sort((left, right) => left.bundle.path.localeCompare(right.bundle.path)),
    exportRoot: relativeFrom(projectRoot, exportRoot),
    manifests: manifests.sort((left, right) => left.path.localeCompare(right.path)),
    projectRoot,
    warnings,
  };
}

function ensureBundlePlatforms(bundles: VifxBundleArtifacts[]) {
  const seenPlatforms = new Set<VifxBundlePlatform>();

  for (const bundle of bundles) {
    if (seenPlatforms.has(bundle.platform)) {
      throw new VifxError({
        code: "VIFX_EXPO_EXPORT_DUPLICATE_PLATFORM",
        message: `Expo export received more than one bundle for platform "${bundle.platform}".`,
        hint: "Build one configured target per platform before generating an Expo export.",
        docsPath: "/reference/cli#vifx-expo-export",
      });
    }

    seenPlatforms.add(bundle.platform);
  }
}

function resolveProjectFile(projectRoot: string, relativePath: string) {
  return path.resolve(projectRoot, relativePath);
}

export async function writeExpoExport(
  options: WriteExpoExportOptions,
): Promise<VifxExpoExportGenerationResult> {
  if (options.bundles.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_TARGETS_MISSING",
      message: "Expo export generation requires at least one Vifx bundle artifact.",
      hint: "Run a Vifx Expo build target before generating an Expo export.",
      docsPath: "/reference/cli#vifx-expo-export",
    });
  }

  ensureBundlePlatforms(options.bundles);

  const projectRoot = path.resolve(options.projectRoot);
  const exportRoot = path.resolve(projectRoot, options.exportRoot ?? "dist/expo");
  const generatedFiles: VifxExpoExportGeneratedFile[] = [];
  const platforms = options.bundles.map((bundle) => bundle.platform).sort();
  const bundleMetadata: Record<string, string> = {};
  const sourceMapMetadata: Record<string, string> = {};
  const assetMetadata = new Map<string, VifxJsonObject>();

  await rm(exportRoot, { force: true, recursive: true });
  await mkdir(exportRoot, { recursive: true });

  for (const bundle of [...options.bundles].sort((left, right) =>
    left.platform.localeCompare(right.platform),
  )) {
    const platformDirectory = path.join(exportRoot, bundle.platform);
    await mkdir(platformDirectory, { recursive: true });

    const bundleOutputPath = path.join(platformDirectory, "index.bundle");
    await copyFile(resolveProjectFile(projectRoot, bundle.bundle.path), bundleOutputPath);
    bundleMetadata[bundle.platform] = relativeFrom(exportRoot, bundleOutputPath);
    generatedFiles.push({
      kind: "bundle",
      path: relativeFrom(projectRoot, bundleOutputPath),
      platform: bundle.platform,
    });

    if (bundle.sourceMap) {
      const sourceMapOutputPath = `${bundleOutputPath}.map`;
      await copyFile(resolveProjectFile(projectRoot, bundle.sourceMap.path), sourceMapOutputPath);
      sourceMapMetadata[bundle.platform] = relativeFrom(exportRoot, sourceMapOutputPath);
      generatedFiles.push({
        kind: "source-map",
        path: relativeFrom(projectRoot, sourceMapOutputPath),
        platform: bundle.platform,
      });
    }

    for (const asset of bundle.assets) {
      const assetOutputPath = path.join(exportRoot, "assets", path.basename(asset.emittedPath));
      const assetRelativePath = relativeFrom(exportRoot, assetOutputPath);

      if (assetMetadata.has(assetRelativePath)) {
        continue;
      }

      await mkdir(path.dirname(assetOutputPath), { recursive: true });
      await copyFile(resolveProjectFile(projectRoot, asset.emittedPath), assetOutputPath);
      assetMetadata.set(assetRelativePath, {
        hash: asset.hash ?? null,
        height: asset.height ?? null,
        httpServerLocation: asset.httpServerLocation,
        name: asset.name,
        path: assetRelativePath,
        scales: asset.scales,
        type: asset.type,
        width: asset.width ?? null,
      });
      generatedFiles.push({
        kind: "asset",
        path: relativeFrom(projectRoot, assetOutputPath),
        platform: bundle.platform,
      });
    }
  }

  const manifest = mergeJsonObjects(await readExpoAppManifest(projectRoot), options.manifest);
  const metadata = mergeJsonObjects(
    {
      assets: [...assetMetadata.values()],
      bundles: bundleMetadata,
      generatedBy: "vifx",
      platforms,
      sourceMaps: sourceMapMetadata,
      version: 1,
    },
    options.metadata,
  );
  const manifestPath = path.join(exportRoot, "manifest.json");
  const metadataPath = path.join(exportRoot, "metadata.json");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  generatedFiles.push(
    {
      kind: "manifest",
      path: relativeFrom(projectRoot, manifestPath),
    },
    {
      kind: "metadata",
      path: relativeFrom(projectRoot, metadataPath),
    },
  );

  const inspection = await inspectExpoExport({
    exportRoot: relativeFrom(projectRoot, exportRoot),
    projectRoot,
  });

  return {
    ...inspection,
    generatedFiles: generatedFiles.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function hasVifxGeneratedMetadata(exportInspection: VifxExpoExportInspectionResult) {
  return exportInspection.manifests.some(
    (manifest) =>
      manifest.kind === "metadata" &&
      isJsonObject(manifest.contents) &&
      manifest.contents.generatedBy === "vifx",
  );
}

async function inspectMetroReference(projectRoot: string) {
  const metroRoot = path.join(projectRoot, "metro-output");
  const files = await walkFiles(metroRoot).catch(() => null);

  if (!files) {
    return {
      bundleCount: 0,
      sourceMapCount: 0,
    };
  }

  return {
    bundleCount: files.filter((filePath) => filePath.endsWith(".bundle")).length,
    sourceMapCount: files.filter((filePath) => filePath.endsWith(".map")).length,
  };
}

function selectDecision(workflows: VifxExpoNoMetroWorkflowReport[]) {
  if (workflows.every((workflow) => workflow.status === "supported")) {
    return "supported";
  }

  if (workflows.some((workflow) => workflow.status !== "blocked")) {
    return "partial";
  }

  return "blocked";
}

export async function evaluateExpoNoMetroContract(
  options: EvaluateExpoNoMetroContractOptions,
): Promise<VifxExpoNoMetroContractReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const supportedExpoSdk = options.supportedExpoSdk ?? DEFAULT_SUPPORTED_EXPO_SDK;
  const packageJson = await readPackageJson(projectRoot);
  const expoVersion = readDependency(packageJson, "expo");
  const reactNativeVersion = readDependency(packageJson, "react-native");
  const expoRouterVersion = readDependency(packageJson, "expo-router");
  const appDirectory = await pathExists(path.join(projectRoot, "app"));
  const hasVifxConfig = await hasAnyFile(projectRoot, VIFX_CONFIG_NAMES);
  const hasViteConfig = await hasAnyFile(projectRoot, VITE_CONFIG_NAMES);
  const configuredExpoSupport = await inspectConfiguredExpoSupport(projectRoot);
  const hasConfiguredExpoBuildSupport = configuredExpoSupport.buildConfigured;
  const hasConfiguredExpoDevSupport = configuredExpoSupport.devConfigured;
  const metroReference = await inspectMetroReference(projectRoot);
  const exportInspection = options.exportRoot
    ? await inspectExpoExport({
        exportRoot: options.exportRoot,
        projectRoot,
      }).catch(() => null)
    : null;
  const vifxGeneratedExport = exportInspection ? hasVifxGeneratedMetadata(exportInspection) : false;
  const warnings: string[] = [];

  if (!expoVersion) {
    warnings.push("Expo dependency was not found in package.json.");
  } else if (!expoVersion.includes(supportedExpoSdk)) {
    warnings.push(
      `Expo dependency "${expoVersion}" is outside the fixture-backed SDK ${supportedExpoSdk} range.`,
    );
  }

  if (!reactNativeVersion) {
    warnings.push("React Native dependency was not found in package.json.");
  }

  if (configuredExpoSupport.loadWarning) {
    warnings.push(configuredExpoSupport.loadWarning);
  }

  const workflows: VifxExpoNoMetroWorkflowReport[] = [
    createWorkflow({
      blockers: [
        ...(!expoVersion ? ["Add an Expo dependency before using the Expo Vite corridor."] : []),
        ...(!reactNativeVersion
          ? ["Add a React Native dependency before building Expo bundles."]
          : []),
        ...(!hasVifxConfig ? ['Add a Vifx config with vite.mode "expo".'] : []),
      ],
      evidence: [
        ...(expoVersion ? [`Expo dependency detected: ${expoVersion}.`] : []),
        ...(reactNativeVersion ? [`React Native dependency detected: ${reactNativeVersion}.`] : []),
        ...(expoRouterVersion ? [`expo-router dependency detected: ${expoRouterVersion}.`] : []),
        ...(appDirectory ? ["Expo app/ directory detected."] : []),
        ...(hasVifxConfig ? ["Vifx config detected."] : []),
        ...(hasViteConfig ? ["Vifx-owned Vite config detected."] : []),
      ],
      id: "config",
      notes: ["The audit only tracks configuration needed to produce and compare Vite bundles."],
      status: expoVersion && reactNativeVersion && hasVifxConfig ? "supported" : "blocked",
      title: "Expo Vite configuration",
    }),
    createWorkflow({
      blockers: hasConfiguredExpoBuildSupport
        ? ["Bundle parity with Metro artifacts still needs to be compared for the target app."]
        : hasVifxConfig
          ? ['Configure vite.mode "expo" and at least one ios or android Vite target.']
          : ["Add a Vifx config before running Vite bundle builds."],
      evidence: hasConfiguredExpoBuildSupport
        ? ["`vifx build` can produce configured Expo bundle artifacts."]
        : [],
      id: "vite-build",
      notes: [
        "`vifx build` is the production bundle surface. It does not run Expo CLI or native builds.",
      ],
      status: hasConfiguredExpoBuildSupport ? "partial" : "blocked",
      title: "Vite bundle build",
    }),
    createWorkflow({
      blockers:
        metroReference.bundleCount > 0 && hasConfiguredExpoBuildSupport
          ? ["Automated semantic bundle diffing remains a follow-up gate."]
          : metroReference.bundleCount > 0
            ? ["Produce Vifx bundles before comparing them against captured Metro output."]
            : ["Capture or provide Metro reference artifacts before claiming parity."],
      evidence: [
        ...(metroReference.bundleCount > 0
          ? [
              `Metro reference artifacts detected: ${metroReference.bundleCount} bundle(s), ${metroReference.sourceMapCount} source map(s).`,
            ]
          : []),
        ...(hasConfiguredExpoBuildSupport ? ["Configured Vifx bundle targets detected."] : []),
      ],
      id: "metro-parity",
      notes: [
        "Metro remains the comparison baseline; this workflow is evidence for bundling behavior only.",
      ],
      status:
        metroReference.bundleCount > 0 || hasConfiguredExpoBuildSupport ? "partial" : "blocked",
      title: "Metro bundle parity evidence",
    }),
    createWorkflow({
      blockers: hasConfiguredExpoDevSupport
        ? [
            "React Native Fast Refresh and native dev-client protocol parity are outside this Vite dev server.",
          ]
        : hasConfiguredExpoBuildSupport
          ? ['Add reactNativeCompat: "web" to one Expo target before using `vifx expo dev`.']
          : ["Configure an Expo Vite target before using `vifx expo dev`."],
      evidence: hasConfiguredExpoDevSupport
        ? ["`vifx expo dev` can start a Vite bundle/dev server."]
        : [],
      id: "dev-server",
      notes: [
        "This server is a Vite bundle/dev surface. It is not a replacement for Expo CLI or Expo Go.",
      ],
      status: hasConfiguredExpoDevSupport ? "partial" : "blocked",
      title: "Expo Vite dev server",
    }),
    createWorkflow({
      blockers: exportInspection
        ? vifxGeneratedExport
          ? ["Metro comparison and runtime consumption still need separate project-specific gates."]
          : ["Existing export root was inspected, but it was not generated by Vifx metadata."]
        : ["Run `vifx expo export` or pass --export-root to inspect generated artifacts."],
      evidence: exportInspection
        ? [
            `Inspected ${exportInspection.bundles.length} bundle(s), ${exportInspection.assets.length} asset(s), and ${exportInspection.manifests.length} manifest(s).`,
            ...(vifxGeneratedExport ? ["Vifx-generated export metadata detected."] : []),
          ]
        : [],
      id: "export-artifacts",
      notes: [
        "Export artifacts are limited to bundles, source maps, assets, manifest, and metadata.",
      ],
      status: exportInspection ? (vifxGeneratedExport ? "supported" : "partial") : "blocked",
      title: "Export artifacts without Metro",
    }),
  ];

  return {
    appDirectory,
    decision: selectDecision(workflows),
    expoRouter: Boolean(expoRouterVersion || appDirectory),
    expoVersion,
    projectRoot,
    reactNativeVersion,
    supportedExpoSdk,
    warnings,
    workflows,
  };
}
