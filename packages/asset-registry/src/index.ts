import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";

export * from "./prod-layout.ts";

export interface AssetVariantDescriptor {
  filePath: string;
  hash: string;
  scale: number;
  size: number;
}

export interface CollectAssetGroupOptions {
  filePath: string;
  projectRoot: string;
  supportedExtensions?: readonly string[];
}

export interface NormalizedAssetDescriptor {
  canonicalFilePath: string;
  filePath: string;
  filePaths: readonly string[];
  files: readonly AssetVariantDescriptor[];
  hash: string;
  httpServerLocation: string;
  name: string;
  scales: readonly number[];
  type: string;
  variants: readonly AssetVariantDescriptor[];
  height?: number;
  width?: number;
}

export interface ParsedAssetPath {
  name: string;
  scale: number;
  type: string;
}

interface AssetDimensions {
  height: number;
  width: number;
}

const DEFAULT_SUPPORTED_ASSET_EXTENSIONS = [
  "gif",
  "jpeg",
  "jpg",
  "json",
  "mp4",
  "otf",
  "png",
  "svg",
  "ttf",
  "webp",
] as const;

export const supportedAssetExtensions = [...DEFAULT_SUPPORTED_ASSET_EXTENSIONS];

export async function collectAssetGroup(
  options: CollectAssetGroupOptions,
): Promise<NormalizedAssetDescriptor> {
  const projectRoot = path.resolve(options.projectRoot);
  const filePath = path.resolve(options.filePath);

  if (!(await isFile(filePath))) {
    throw new VifxError({
      code: "VIFX_ASSET_NOT_FOUND",
      details: { filePath },
      hint: "Pass the path to an existing asset file.",
      message: `Asset file "${filePath}" does not exist.`,
    });
  }

  const parsedInput = parseAssetPath(filePath, options.supportedExtensions);

  if (!parsedInput) {
    throw new VifxError({
      code: "VIFX_ASSET_UNSUPPORTED_TYPE",
      details: {
        filePath,
        supportedExtensions: [...(options.supportedExtensions ?? supportedAssetExtensions)],
      },
      hint: `Use one of the supported asset extensions: ${(options.supportedExtensions ?? supportedAssetExtensions).join(", ")}.`,
      message: `Unsupported asset type for "${filePath}".`,
    });
  }

  assertValidAssetScale(parsedInput.scale, filePath);

  const directory = path.dirname(filePath);
  const entries = await readdir(directory, { withFileTypes: true });
  const variants = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .map((candidatePath) => ({
        filePath: candidatePath,
        parsed: parseAssetPath(candidatePath, options.supportedExtensions),
      }))
      .filter(
        (entry): entry is { filePath: string; parsed: ParsedAssetPath } =>
          entry.parsed !== undefined &&
          entry.parsed.name === parsedInput.name &&
          entry.parsed.type === parsedInput.type,
      )
      .map(async ({ filePath: variantPath, parsed }) => {
        assertValidAssetScale(parsed.scale, variantPath);
        const buffer = await readFile(variantPath);
        return {
          filePath: variantPath,
          hash: createSha1(buffer),
          scale: parsed.scale,
          size: buffer.byteLength,
        } satisfies AssetVariantDescriptor;
      }),
  );

  variants.sort(
    (left, right) => left.scale - right.scale || left.filePath.localeCompare(right.filePath),
  );
  assertUniqueAssetScales(variants, filePath);

  const canonicalVariant = variants.find((variant) => variant.scale === 1) ?? variants[0];

  if (!canonicalVariant) {
    throw new VifxError({
      code: "VIFX_ASSET_NOT_FOUND",
      details: { filePath },
      hint: "Ensure at least one asset file exists in the group.",
      message: `No asset variants were found for "${filePath}".`,
    });
  }

  const dimensions = await readLogicalDimensions(
    canonicalVariant.filePath,
    parsedInput.type,
    canonicalVariant.scale,
  );

  return {
    canonicalFilePath: canonicalVariant.filePath,
    filePath: canonicalVariant.filePath,
    filePaths: variants.map((variant) => variant.filePath),
    files: variants,
    hash: createAssetGroupHash(variants, projectRoot),
    httpServerLocation: createHttpServerLocation(projectRoot, directory),
    name: parsedInput.name,
    scales: variants.map((variant) => variant.scale),
    type: parsedInput.type,
    variants,
    ...dimensions,
  };
}

export function createAssetServerUrl(options: {
  baseUrl?: string;
  descriptor: Pick<NormalizedAssetDescriptor, "hash" | "httpServerLocation" | "name" | "type">;
  platform?: string;
  scale?: number;
}): string {
  const pathname = `${stripTrailingSlash(options.descriptor.httpServerLocation)}/${options.descriptor.name}.${options.descriptor.type}`;
  const query = new URLSearchParams();
  query.set("hash", options.descriptor.hash);

  if (options.platform) {
    query.set("platform", options.platform);
  }

  if (options.scale !== undefined) {
    query.set("scale", String(options.scale));
  }

  const origin = options.baseUrl ? stripTrailingSlash(options.baseUrl) : "";
  return `${origin}${pathname}?${query.toString()}`;
}

export function isSupportedAssetFile(
  filePath: string,
  supportedExtensions: readonly string[] = supportedAssetExtensions,
): boolean {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return supportedExtensions.includes(extension);
}

export function parseAssetPath(
  filePath: string,
  supportedExtensions: readonly string[] = supportedAssetExtensions,
): ParsedAssetPath | undefined {
  const parsed = parseScaleFromAssetFileName(filePath, supportedExtensions);

  if (!parsed) {
    return undefined;
  }

  return {
    name: parsed.name,
    scale: parsed.scale,
    type: parsed.extension,
  };
}

export function parseScaleFromAssetFileName(
  filePath: string,
  supportedExtensions: readonly string[] = supportedAssetExtensions,
): { extension: string; name: string; scale: number } | null {
  if (!isSupportedAssetFile(filePath, supportedExtensions)) {
    return null;
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();
  const fileName = path.basename(filePath, path.extname(filePath));
  const match = fileName.match(/^(?<name>.+?)(?:@(?<scale>\d+(?:\.\d+)?)x)?$/u);
  const name = match?.groups?.name;

  if (!name) {
    return null;
  }

  return {
    extension,
    name,
    scale: match?.groups?.scale ? Number(match.groups.scale) : 1,
  };
}

function createAssetGroupHash(
  variants: readonly AssetVariantDescriptor[],
  projectRoot: string,
): string {
  const hash = createHash("sha256");

  for (const variant of variants) {
    hash.update(toPosixPath(path.relative(projectRoot, variant.filePath)));
    hash.update("\u0000");
    hash.update(String(variant.scale));
    hash.update("\u0000");
    hash.update(variant.hash);
    hash.update("\u0000");
  }

  return hash.digest("hex").slice(0, 16);
}

function assertUniqueAssetScales(variants: readonly AssetVariantDescriptor[], filePath: string) {
  const seenScales = new Map<number, string>();

  for (const variant of variants) {
    const existingFilePath = seenScales.get(variant.scale);
    if (!existingFilePath) {
      seenScales.set(variant.scale, variant.filePath);
      continue;
    }

    throw new VifxError({
      code: "VIFX_ASSET_INVALID_SCALE",
      details: {
        duplicateScale: variant.scale,
        filePath,
        filePaths: [existingFilePath, variant.filePath],
      },
      hint: `Keep only one asset variant for scale ${String(variant.scale)}x.`,
      message: `Multiple asset variants declare scale ${String(variant.scale)}x for "${filePath}".`,
    });
  }
}

function assertValidAssetScale(scale: number, filePath: string) {
  if (Number.isFinite(scale) && scale > 0) {
    return;
  }

  throw new VifxError({
    code: "VIFX_ASSET_INVALID_SCALE",
    details: {
      filePath,
      scale,
    },
    hint: "Use a positive numeric scale suffix such as @2x or omit the suffix for 1x.",
    message: `Invalid asset scale "${String(scale)}" for "${filePath}".`,
  });
}

function createHttpServerLocation(projectRoot: string, directory: string): string {
  const relativeDirectory = toPosixPath(path.relative(projectRoot, directory));

  if (!relativeDirectory || relativeDirectory === ".") {
    return "/assets";
  }

  return relativeDirectory === "assets" ? "/assets" : `/assets/${relativeDirectory}`;
}

function createSha1(buffer: Uint8Array): string {
  return createHash("sha1").update(buffer).digest("hex");
}

async function isFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => undefined);
  return fileStat?.isFile() ?? false;
}

async function readAssetDimensions(
  filePath: string,
  type: string,
): Promise<AssetDimensions | undefined> {
  if (!["gif", "jpeg", "jpg", "png", "svg", "webp"].includes(type)) {
    return undefined;
  }

  const buffer = await readFile(filePath);

  switch (type) {
    case "gif":
      return readGifDimensions(buffer);
    case "jpeg":
    case "jpg":
      return readJpegDimensions(buffer);
    case "png":
      return readPngDimensions(buffer);
    case "svg":
      return readSvgDimensions(buffer);
    case "webp":
      return readWebpDimensions(buffer);
    default:
      return undefined;
  }
}

function readGifDimensions(buffer: Uint8Array): AssetDimensions | undefined {
  if (buffer.byteLength < 10 || buffer[0] !== 0x47 || buffer[1] !== 0x49 || buffer[2] !== 0x46) {
    return undefined;
  }

  const view = asDataView(buffer);
  return {
    height: view.getUint16(8, true),
    width: view.getUint16(6, true),
  };
}

function readJpegDimensions(buffer: Uint8Array): AssetDimensions | undefined {
  if (buffer.byteLength < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }

  const view = asDataView(buffer);
  let offset = 2;

  while (offset + 3 < buffer.byteLength) {
    if (buffer[offset] !== 0xff) {
      // Skip padding bytes between segments
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];

    if (marker === undefined) {
      return undefined;
    }

    // Markers 0x00 and 0xFF are not actual markers (escaped 0xFF and padding)
    if (marker === 0x00 || marker === 0xff) {
      offset += 1;
      continue;
    }

    // Markers 0x01 and 0xD0–0xD9 have no length field (TEM, RST0–RST7, SOI, EOI)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    // Need at least 4 bytes to read the segment length
    if (offset + 3 >= buffer.byteLength) {
      return undefined;
    }

    const segmentLength = view.getUint16(offset + 2);

    // Guard against malformed segment lengths that would cause an infinite loop
    if (segmentLength < 2) {
      return undefined;
    }

    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      // SOF segment: need at least 9 bytes after the marker prefix
      if (offset + 8 >= buffer.byteLength) {
        return undefined;
      }

      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  return undefined;
}

async function readLogicalDimensions(
  filePath: string,
  type: string,
  scale: number,
): Promise<AssetDimensions | undefined> {
  const dimensions = await readAssetDimensions(filePath, type);

  if (!dimensions) {
    return undefined;
  }

  return {
    height: dimensions.height / scale,
    width: dimensions.width / scale,
  };
}

function readPngDimensions(buffer: Uint8Array): AssetDimensions | undefined {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (buffer.byteLength < 24 || pngSignature.some((byte, index) => buffer[index] !== byte)) {
    return undefined;
  }

  const view = asDataView(buffer);
  return {
    height: view.getUint32(20),
    width: view.getUint32(16),
  };
}

function readSvgDimensions(buffer: Uint8Array): AssetDimensions | undefined {
  const source = Buffer.from(buffer).toString("utf8");
  const width = readNumericSvgAttribute(source, "width");
  const height = readNumericSvgAttribute(source, "height");

  if (width !== undefined && height !== undefined) {
    return { height, width };
  }

  const viewBoxMatch = source.match(
    /viewBox=["']\s*[\d.]+\s+[\d.]+\s+(?<width>[\d.]+)\s+(?<height>[\d.]+)\s*["']/u,
  );
  const viewBoxWidth = viewBoxMatch?.groups?.width;
  const viewBoxHeight = viewBoxMatch?.groups?.height;

  if (!viewBoxWidth || !viewBoxHeight) {
    return undefined;
  }

  return {
    height: Number(viewBoxHeight),
    width: Number(viewBoxWidth),
  };
}

function readWebpDimensions(buffer: Uint8Array): AssetDimensions | undefined {
  if (
    buffer.byteLength < 30 ||
    Buffer.from(buffer.subarray(0, 4)).toString("ascii") !== "RIFF" ||
    Buffer.from(buffer.subarray(8, 12)).toString("ascii") !== "WEBP"
  ) {
    return undefined;
  }

  const chunkType = Buffer.from(buffer.subarray(12, 16)).toString("ascii");
  const view = asDataView(buffer);

  if (chunkType === "VP8X") {
    return {
      height: 1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16),
      width: 1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16),
    };
  }

  if (chunkType === "VP8 ") {
    return {
      height: view.getUint16(28, true) & 0x3fff,
      width: view.getUint16(26, true) & 0x3fff,
    };
  }

  if (chunkType === "VP8L") {
    const bits = view.getUint32(21, true);
    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }

  return undefined;
}

function readNumericSvgAttribute(source: string, attributeName: string): number | undefined {
  const match = source.match(new RegExp(`${attributeName}=["'](?<value>[\\d.]+)(?:px)?["']`, "u"));
  const value = match?.groups?.value;
  return value ? Number(value) : undefined;
}

function asDataView(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function toPosixPath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}
