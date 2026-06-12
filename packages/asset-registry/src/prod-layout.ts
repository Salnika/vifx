import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";

export type ProdAssetPlatform = "android" | "ios";

export interface ProdLayoutAssetVariant {
  filePath: string;
  scale: number;
}

export interface ProdLayoutAssetInput {
  httpServerLocation: string;
  name: string;
  type: string;
  variants: readonly ProdLayoutAssetVariant[];
}

export interface ProdAssetFileOutput {
  destinationPath: string;
  scale: number;
  sourceFilePath: string;
}

export interface ProdAssetOutput {
  files: ProdAssetFileOutput[];
  httpServerLocation: string;
  name: string;
  scales: number[];
  type: string;
}

export interface WriteProdAssetsOptions {
  assetsDest: string;
  platform: ProdAssetPlatform;
}

export interface WriteProdAssetsResult {
  assetMapPath: string;
  assets: ProdAssetOutput[];
  assetsDest: string;
  platform: ProdAssetPlatform;
  writtenFiles: string[];
}

interface AndroidDensity {
  density: string;
  scale: number;
}

export const PROD_ASSET_MAP_FILE_NAME = "assetmap.json";

const ANDROID_DENSITIES: readonly AndroidDensity[] = [
  { density: "mdpi", scale: 1 },
  { density: "hdpi", scale: 1.5 },
  { density: "xhdpi", scale: 2 },
  { density: "xxhdpi", scale: 3 },
  { density: "xxxhdpi", scale: 4 },
];

// Mirrors Metro's assetPathUtils drawableFileTypes: these asset types land in
// res/drawable-<density>/ while every other type lands in res/raw/.
const ANDROID_DRAWABLE_TYPES = new Set(["gif", "jpeg", "jpg", "ktx", "png", "svg", "webp", "xml"]);

/**
 * Maps an asset scale to the Android density qualifier. Exact Metro mappings
 * are used for the standard scales (1 -> mdpi, 1.5 -> hdpi, 2 -> xhdpi,
 * 3 -> xxhdpi, 4 -> xxxhdpi); non-standard scales pick the nearest density and
 * prefer the higher one on ties instead of failing like Metro does.
 */
export function getAndroidDensitySuffix(scale: number): string {
  let best = ANDROID_DENSITIES[0]!;
  let bestDistance = Math.abs(scale - best.scale);

  for (const candidate of ANDROID_DENSITIES) {
    const distance = Math.abs(scale - candidate.scale);

    if (distance < bestDistance || (distance === bestDistance && candidate.scale > best.scale)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best.density;
}

/**
 * Mirrors Metro's getAndroidResourceIdentifier: the asset directory and name
 * are lowercased, path separators become underscores, characters that are
 * invalid in Android resource names are removed, and the leading "assets_"
 * prefix is stripped.
 */
export function getAndroidResourceIdentifier(
  asset: Pick<ProdLayoutAssetInput, "httpServerLocation" | "name">,
): string {
  return `${getAssetBasePath(asset)}/${asset.name}`
    .toLowerCase()
    .replaceAll("/", "_")
    .replaceAll(/[^a-z0-9_]/gu, "")
    .replace(/^assets_/u, "");
}

/**
 * Mirrors Metro's getAssetDestPathAndroid: drawable types are written to
 * drawable-<density>/<resource-identifier>.<type>, everything else to
 * raw/<resource-identifier>.<type>. Paths are relative to the assets dest.
 */
export function getAssetDestPathAndroid(
  asset: Pick<ProdLayoutAssetInput, "httpServerLocation" | "name" | "type">,
  scale: number,
): string {
  const folder = ANDROID_DRAWABLE_TYPES.has(asset.type.toLowerCase())
    ? `drawable-${getAndroidDensitySuffix(scale)}`
    : "raw";

  return `${folder}/${getAndroidResourceIdentifier(asset)}.${asset.type}`;
}

/**
 * Mirrors Metro's getAssetDestPathIOS: assets keep their server directory
 * layout (httpServerLocation without the leading slash, "../" hardened to
 * "_") and the scale suffix is omitted for 1x. Paths are relative to the
 * assets dest.
 */
export function getAssetDestPathIOS(
  asset: Pick<ProdLayoutAssetInput, "httpServerLocation" | "name" | "type">,
  scale: number,
): string {
  const suffix = scale === 1 ? "" : `@${scale}x`;
  const basePath = getAssetBasePath(asset).replaceAll("../", "_");

  return `${basePath}/${asset.name}${suffix}.${asset.type}`;
}

export function getProdAssetDestPath(
  platform: ProdAssetPlatform,
  asset: Pick<ProdLayoutAssetInput, "httpServerLocation" | "name" | "type">,
  scale: number,
): string {
  return platform === "android"
    ? getAssetDestPathAndroid(asset, scale)
    : getAssetDestPathIOS(asset, scale);
}

/**
 * Writes asset groups into the production layout used by release builds:
 * Android res directories (drawable-<density>/ and raw/) or the iOS bundle
 * assets/ directory layout. An assetmap.json manifest describing every
 * written file is always created at the assets dest root.
 */
export async function writeProdAssets(
  assets: readonly ProdLayoutAssetInput[],
  options: WriteProdAssetsOptions,
): Promise<WriteProdAssetsResult> {
  const assetsDest = path.resolve(options.assetsDest);
  const outputs: ProdAssetOutput[] = [];
  const writtenFiles: string[] = [];
  const seenDestinations = new Set<string>();
  const sortedAssets = [...assets].sort(
    (left, right) =>
      left.httpServerLocation.localeCompare(right.httpServerLocation) ||
      left.name.localeCompare(right.name) ||
      left.type.localeCompare(right.type),
  );

  await mkdir(assetsDest, { recursive: true });

  for (const asset of sortedAssets) {
    assertHasVariants(asset);

    const files: ProdAssetFileOutput[] = [];
    const variants = [...asset.variants].sort((left, right) => left.scale - right.scale);

    for (const variant of variants) {
      const destinationPath = getProdAssetDestPath(options.platform, asset, variant.scale);
      const absoluteDestination = path.join(assetsDest, ...destinationPath.split("/"));

      await mkdir(path.dirname(absoluteDestination), { recursive: true });
      await copyAssetVariant(variant.filePath, absoluteDestination, asset);

      files.push({
        destinationPath,
        scale: variant.scale,
        sourceFilePath: variant.filePath,
      });

      if (!seenDestinations.has(destinationPath)) {
        seenDestinations.add(destinationPath);
        writtenFiles.push(destinationPath);
      }
    }

    outputs.push({
      files,
      httpServerLocation: asset.httpServerLocation,
      name: asset.name,
      scales: variants.map((variant) => variant.scale),
      type: asset.type,
    });
  }

  const assetMapPath = path.join(assetsDest, PROD_ASSET_MAP_FILE_NAME);
  await writeFile(
    assetMapPath,
    `${JSON.stringify(
      {
        assets: outputs.map((output) => ({
          files: output.files.map((file) => ({
            path: file.destinationPath,
            scale: file.scale,
          })),
          httpServerLocation: output.httpServerLocation,
          name: output.name,
          scales: output.scales,
          type: output.type,
        })),
        platform: options.platform,
        version: 1,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writtenFiles.push(PROD_ASSET_MAP_FILE_NAME);

  return {
    assetMapPath,
    assets: outputs,
    assetsDest,
    platform: options.platform,
    writtenFiles,
  };
}

function assertHasVariants(asset: ProdLayoutAssetInput) {
  if (asset.variants.length > 0) {
    return;
  }

  throw new VifxError({
    code: "VIFX_PROD_ASSET_VARIANT_MISSING",
    message: `Asset "${asset.httpServerLocation}/${asset.name}.${asset.type}" has no file variants to write.`,
    hint: "Collect the asset group with collectAssetGroup before writing the production layout.",
    details: {
      httpServerLocation: asset.httpServerLocation,
      name: asset.name,
      type: asset.type,
    },
  });
}

async function copyAssetVariant(
  sourceFilePath: string,
  absoluteDestination: string,
  asset: ProdLayoutAssetInput,
) {
  try {
    await copyFile(sourceFilePath, absoluteDestination);
  } catch (error) {
    throw new VifxError({
      code: "VIFX_PROD_ASSET_WRITE_FAILED",
      message: `Failed to write asset variant "${sourceFilePath}" to "${absoluteDestination}".`,
      hint: "Ensure the asset source file exists and the assets destination is writable.",
      cause: error,
      details: {
        destination: absoluteDestination,
        name: asset.name,
        source: sourceFilePath,
        type: asset.type,
      },
    });
  }
}

function getAssetBasePath(asset: Pick<ProdLayoutAssetInput, "httpServerLocation">): string {
  const basePath = asset.httpServerLocation;
  return basePath.startsWith("/") ? basePath.slice(1) : basePath;
}
