import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LibraryBuildOperation, LibraryBuildResult } from "@vifx/compat";
import { toVifxError } from "@vifx/errors";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type { CompatAdapter, CompatCaseContext } from "../../types.ts";
import {
  collectAssetMetadata,
  collectAssetScaleGroup,
  detectPackageManager,
  findWorkspaceRoot,
  inspectProject,
  resolvePlatformFile,
} from "../../primitives.ts";

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

const viteBundleCache = new Map<string, ReturnType<typeof buildFixtureBundle>>();

async function buildFixtureBundle(
  fixturePath: string,
  platform: "ios" | "android",
  entry = "index.js",
) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-compat-bundle-"));
  const projectRoot = path.join(tempRoot, path.basename(fixturePath));

  await cp(fixturePath, projectRoot, { recursive: true });

  return buildReactNativeBundle({
    entry,
    outDir: `.vifx/compat/${platform}`,
    platform,
    projectRoot,
  });
}

function getBundleArtifacts(fixturePath: string, platform: "ios" | "android", entry = "index.js") {
  const cacheKey = `${fixturePath}:${platform}:${entry}`;
  const cached = viteBundleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bundle = buildFixtureBundle(fixturePath, platform, entry);
  viteBundleCache.set(cacheKey, bundle);
  return bundle;
}

function summarizeBuildFailure(error: unknown) {
  const vifxError = toVifxError(error);
  const summary = `${vifxError.code}: ${vifxError.message}`.replace(/\s+/g, " ").trim();
  return summary.length > 400 ? `${summary.slice(0, 400)}…` : summary;
}

async function runLibraryBuildOperation(
  operation: LibraryBuildOperation,
  context: CompatCaseContext,
): Promise<LibraryBuildResult> {
  let artifacts: Awaited<ReturnType<typeof buildFixtureBundle>>;
  try {
    artifacts = await getBundleArtifacts(
      context.fixturePath,
      operation.platform,
      operation.entry ?? "index.js",
    );
  } catch (error) {
    return {
      packageName: operation.packageName,
      toolchain: "vifx",
      status: "fail",
      detail: `Bundle build failed. ${summarizeBuildFailure(error)}`,
    };
  }

  const bundleSource = await readFile(
    path.join(artifacts.projectRoot, artifacts.bundle.path),
    "utf8",
  );
  const missingProbes = operation.bundleProbes.filter((probe) => !bundleSource.includes(probe));
  const detailParts: string[] = [];

  if (missingProbes.length > 0) {
    detailParts.push(
      `library source markers missing from the bundle (substituted by a compat or shim layer): ${missingProbes.join(", ")}`,
    );
  }

  if (operation.partialAspects.length > 0) {
    detailParts.push(`aspects a build cannot verify: ${operation.partialAspects.join("; ")}`);
  }

  if (detailParts.length > 0) {
    return {
      packageName: operation.packageName,
      toolchain: "vifx",
      status: "partial",
      detail: `Bundle built. Remaining gaps: ${detailParts.join(". ")}.`,
    };
  }

  return {
    packageName: operation.packageName,
    toolchain: "vifx",
    status: "pass",
    detail: "Bundle built from the synthetic package sources.",
  };
}

export const vifxAdapter: CompatAdapter = {
  id: "vifx",
  label: "vifx",
  async runCase(compatCase, context) {
    switch (compatCase.operation.kind) {
      case "project-info": {
        const inspection = await inspectProject(context.fixturePath);
        return {
          projectType: inspection.projectType,
          packageManager: inspection.packageManager,
          expoVersion: inspection.expoVersion,
          reactNativeVersion: inspection.reactNativeVersion,
        };
      }
      case "resolve-file": {
        return resolvePlatformFile(context.fixturePath, compatCase.operation);
      }
      case "asset-scales": {
        return collectAssetScaleGroup(context.fixturePath, compatCase.operation.assetPath);
      }
      case "asset-metadata": {
        return collectAssetMetadata(context.fixturePath, compatCase.operation.assetPath);
      }
      case "workspace-root": {
        const workingDirectory = path.join(context.fixturePath, compatCase.operation.cwd);
        const workspaceRoot = await findWorkspaceRoot(workingDirectory);
        return {
          relativeRoot: toPosixPath(path.relative(context.fixturePath, workspaceRoot) || "."),
          packageManager: await detectPackageManager(workingDirectory),
        };
      }
      case "bundle-artifacts": {
        const bundle = await getBundleArtifacts(
          context.fixturePath,
          compatCase.operation.platform,
          compatCase.operation.entry,
        );

        return {
          assetCount: bundle.assets.length,
          assetTypes: [...new Set(bundle.assets.map((asset) => asset.type))].sort(),
          bundleFile: path.basename(bundle.bundle.path),
          entry: path.basename(bundle.entry),
          platform: compatCase.operation.platform,
        };
      }
      case "source-map-validity": {
        const bundle = await getBundleArtifacts(
          context.fixturePath,
          compatCase.operation.platform,
          compatCase.operation.entry,
        );

        return {
          platform: compatCase.operation.platform,
          sourceMapPresent: Boolean(bundle.sourceMap),
          valid: bundle.sourceMap?.valid ?? false,
        };
      }
      case "library-build": {
        return runLibraryBuildOperation(compatCase.operation, context);
      }
      default: {
        return {
          unsupportedOperation: compatCase.operation,
        };
      }
    }
  },
};
