import path from "node:path";
import type { LibraryBuildResult } from "@vifx/compat";
import { inspectMetroProject } from "@vifx/metro-inspect";
import type { CompatAdapter } from "../../types.ts";
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

const metroInspectionCache = new Map<string, ReturnType<typeof inspectMetroProject>>();

function getMetroInspection(fixturePath: string, platform: "ios" | "android", entry = "index.js") {
  const cacheKey = `${fixturePath}:${platform}:${entry}`;
  const cached = metroInspectionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inspection = inspectMetroProject({
    entry,
    platform,
    projectRoot: fixturePath,
  });
  metroInspectionCache.set(cacheKey, inspection);
  return inspection;
}

// First-pass Metro adapter: uses fixture-backed filesystem expectations that mirror
// captured Metro behavior for the current compatibility suite.
export const metroAdapter: CompatAdapter = {
  id: "metro",
  label: "metro",
  async runCase(compatCase, context) {
    switch (compatCase.operation.kind) {
      case "project-info": {
        const inspection = await inspectProject(context.fixturePath);
        return {
          expoVersion: inspection.expoVersion,
          packageManager: inspection.packageManager,
          projectType: inspection.projectType,
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
          packageManager: await detectPackageManager(workingDirectory),
          relativeRoot: toPosixPath(path.relative(context.fixturePath, workspaceRoot) || "."),
        };
      }
      case "bundle-artifacts": {
        const report = await getMetroInspection(
          context.fixturePath,
          compatCase.operation.platform,
          compatCase.operation.entry,
        );

        return {
          assetCount: report.assets.length,
          assetTypes: [...new Set(report.assets.map((asset) => asset.type))].sort(),
          bundleFile: path.basename(report.bundle?.path ?? ""),
          entry: report.entry,
          platform: compatCase.operation.platform,
        };
      }
      case "source-map-validity": {
        const report = await getMetroInspection(
          context.fixturePath,
          compatCase.operation.platform,
          compatCase.operation.entry,
        );

        return {
          platform: compatCase.operation.platform,
          sourceMapPresent: Boolean(report.sourceMap),
          valid: report.sourceMap?.valid ?? false,
        };
      }
      case "library-build": {
        // Repo policy: live Metro is never spawned, so library cases are
        // registered as skipped for the Metro reference adapter.
        return {
          packageName: compatCase.operation.packageName,
          toolchain: "metro",
          status: "skip",
          detail: "not exercised against live Metro",
        } satisfies LibraryBuildResult;
      }
      default: {
        return {
          unsupportedOperation: compatCase.operation,
        };
      }
    }
  },
};
