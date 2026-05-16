import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type { CompatAdapter } from "../../types.ts";
import {
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
      default: {
        return {
          unsupportedOperation: compatCase.operation,
        };
      }
    }
  },
};
