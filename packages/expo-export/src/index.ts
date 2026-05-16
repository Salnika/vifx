import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { collectAssetGroup, isSupportedAssetFile } from "@vifx/asset-registry";
import { VifxError } from "@vifx/errors";
import { validateSourceMap } from "@vifx/source-map-tools";
import type { VifxExpoExportInspectionResult, VifxJsonValue } from "@vifx/types";

export interface InspectExpoExportOptions {
  exportRoot?: string;
  projectRoot: string;
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
