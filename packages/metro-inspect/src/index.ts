import { promises as fs } from "node:fs";
import path from "node:path";
import { validateSourceMap } from "@vifx/source-map-tools";

export interface MetroAssetArtifact {
  path: string;
  sizeBytes: number;
  type: string;
}

export interface MetroBundleArtifact {
  path: string;
  sizeBytes: number;
}

export interface MetroSourceMapArtifact {
  path: string;
  sourceCount: number;
  valid: boolean;
  warnings: string[];
}

export interface MetroInspectionReport {
  assets: MetroAssetArtifact[];
  bundle: MetroBundleArtifact | null;
  entry: string;
  platform: string;
  projectRoot: string;
  sourceMap: MetroSourceMapArtifact | null;
  warnings: string[];
}

export interface InspectMetroProjectOptions {
  entry?: string;
  outputDirectory?: string;
  platform: "android" | "ios" | "native" | "web";
  projectRoot: string;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(candidates: string[]) {
  for (const candidatePath of candidates) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function readAssetManifest(projectRoot: string, outputDirectory: string) {
  const assetManifestPath = path.join(outputDirectory, "assets.json");
  if (!(await pathExists(assetManifestPath))) {
    return [];
  }

  const contents = await fs.readFile(assetManifestPath, "utf8");
  const assets = JSON.parse(contents) as Array<{ path: string; sizeBytes: number; type: string }>;

  return assets.map((asset) => ({
    path: asset.path.startsWith(projectRoot) ? relativeFrom(projectRoot, asset.path) : asset.path,
    sizeBytes: asset.sizeBytes,
    type: asset.type,
  }));
}

export async function inspectMetroProject(
  options: InspectMetroProjectOptions,
): Promise<MetroInspectionReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const entry = options.entry ?? "index.js";
  const outputDirectory = path.resolve(
    projectRoot,
    options.outputDirectory ?? path.join("metro-output", options.platform),
  );
  const baseName = path.parse(entry).name;
  const warnings: string[] = [];

  const bundlePath = await firstExisting([
    path.join(outputDirectory, `${baseName}.${options.platform}.bundle`),
    path.join(outputDirectory, `${baseName}.bundle`),
    path.join(outputDirectory, "index.bundle"),
  ]);
  const sourceMapPath = await firstExisting([
    path.join(outputDirectory, `${baseName}.${options.platform}.map`),
    path.join(outputDirectory, `${baseName}.map`),
    path.join(outputDirectory, "index.map"),
    ...(bundlePath ? [`${bundlePath}.map`] : []),
  ]);

  if (!bundlePath) {
    warnings.push(
      `No captured Metro bundle was found under "${relativeFrom(projectRoot, outputDirectory)}".`,
    );
  }

  if (!sourceMapPath) {
    warnings.push(
      `No captured Metro source map was found under "${relativeFrom(projectRoot, outputDirectory)}".`,
    );
  }

  const bundle = bundlePath
    ? {
        path: relativeFrom(projectRoot, bundlePath),
        sizeBytes: (await fs.stat(bundlePath)).size,
      }
    : null;

  const sourceMap = sourceMapPath
    ? await validateSourceMap({
        sourceMapPath,
      }).then((validation) => ({
        path: relativeFrom(projectRoot, sourceMapPath),
        sourceCount: validation.sourceCount,
        valid: validation.valid,
        warnings: validation.warnings,
      }))
    : null;

  const assets = await readAssetManifest(projectRoot, outputDirectory);

  return {
    assets,
    bundle,
    entry,
    platform: options.platform,
    projectRoot,
    sourceMap,
    warnings,
  };
}

export function formatMetroInspectionReport(
  report: MetroInspectionReport,
  format: "json" | "terminal" = "terminal",
) {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  return [
    "Metro inspect report",
    "",
    `Project root: ${report.projectRoot}`,
    `Platform: ${report.platform}`,
    `Entry: ${report.entry}`,
    `Bundle: ${report.bundle ? `${report.bundle.path} (${String(report.bundle.sizeBytes)} bytes)` : "missing"}`,
    `Source map: ${
      report.sourceMap
        ? `${report.sourceMap.path} (${report.sourceMap.valid ? "valid" : "invalid"}, ${String(
            report.sourceMap.sourceCount,
          )} sources)`
        : "missing"
    }`,
    report.assets.length > 0
      ? [
          "Assets:",
          ...report.assets.map(
            (asset) => `  - ${asset.path} (${asset.type}, ${String(asset.sizeBytes)} bytes)`,
          ),
        ].join("\n")
      : "Assets: none",
    report.warnings.length > 0
      ? ["Warnings:", ...report.warnings.map((warning) => `  - ${warning}`)].join("\n")
      : "Warnings: none",
  ].join("\n");
}
