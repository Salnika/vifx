import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
  type AssetScaleConflict,
  collectAssetGroup,
  createAssetServerUrl,
  isSupportedAssetFile,
  parseAssetPath,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("detects supported assets and parses scale suffixes", () => {
  expect(isSupportedAssetFile("/app/assets/icon.png")).toBe(true);
  expect(isSupportedAssetFile("/app/assets/Inter.ttf")).toBe(true);
  expect(isSupportedAssetFile("/app/assets/notes.txt")).toBe(false);
  // Metro's and Expo's defaults: Android vector drawables (expo-router 58
  // requires them), audio, documents, web fonts and expo-sqlite databases.
  for (const asset of ["arrow.xml", "ding.mp3", "terms.pdf", "Inter.woff2", "seed.db"]) {
    expect(isSupportedAssetFile(`/app/assets/${asset}`)).toBe(true);
  }

  expect(parseAssetPath("/app/assets/icon@2x.png")).toEqual({
    name: "icon",
    scale: 2,
    type: "png",
  });
  expect(parseAssetPath("/app/assets/icon.png")).toEqual({
    name: "icon",
    scale: 1,
    type: "png",
  });
});

test("groups scaled PNG assets into a deterministic normalized descriptor", async () => {
  const projectRoot = await createTempProject();

  await writeBinaryFiles(projectRoot, {
    "assets/icon.png": createPngHeader(10, 12),
    "assets/icon@2x.png": createPngHeader(20, 24),
    "assets/icon@3x.png": createPngHeader(30, 36),
  });

  const firstDescriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "assets/icon@2x.png"),
    projectRoot,
  });
  const secondDescriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "assets/icon.png"),
    projectRoot,
  });

  expect(firstDescriptor).toMatchObject({
    canonicalFilePath: path.join(projectRoot, "assets/icon.png"),
    // Metro's location: `/assets` followed by the file's directory.
    httpServerLocation: "/assets/assets",
    height: 12,
    name: "icon",
    scales: [1, 2, 3],
    type: "png",
    width: 10,
  });
  expect(firstDescriptor.hash).toBe(secondDescriptor.hash);
  expect(firstDescriptor.variants).toHaveLength(3);
});

test("rejects invalid asset scales with structured diagnostics", async () => {
  const projectRoot = await createTempProject();

  await writeBinaryFiles(projectRoot, {
    "assets/icon.png": createPngHeader(10, 12),
    "assets/icon@0x.png": createPngHeader(10, 12),
  });

  await expect(
    collectAssetGroup({
      filePath: path.join(projectRoot, "assets/icon@0x.png"),
      projectRoot,
    }),
  ).rejects.toMatchObject({
    code: "VIFX_ASSET_INVALID_SCALE",
    message: expect.stringContaining("Invalid asset scale"),
  });
});

test("tolerates duplicate scale variants by de-duping and warning (matches Metro)", async () => {
  const projectRoot = await createTempProject();

  await writeBinaryFiles(projectRoot, {
    "assets/icon.png": createPngHeader(10, 12),
    "assets/icon@1x.png": createPngHeader(20, 24),
  });

  const warnings: { conflict: AssetScaleConflict; message: string }[] = [];

  const descriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "assets/icon.png"),
    projectRoot,
    onWarning: (warning) => warnings.push(warning),
  });

  // Both files resolve to scale 1x; only one variant survives, deterministically
  // the one that names its scale ("icon@1x.png"), as in a Metro release build.
  expect(descriptor.scales).toEqual([1]);
  expect(descriptor.variants).toHaveLength(1);
  expect(descriptor.filePaths).toEqual([path.join(projectRoot, "assets/icon@1x.png")]);
  expect(descriptor.canonicalFilePath).toBe(path.join(projectRoot, "assets/icon@1x.png"));

  // The duplicate is reported, not thrown.
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.conflict).toMatchObject({
    keptFilePath: path.join(projectRoot, "assets/icon@1x.png"),
    droppedFilePaths: [path.join(projectRoot, "assets/icon.png")],
    scale: 1,
  });
  expect(warnings[0]?.message).toContain("scale 1x");
});

test("drops an identical copy of a variant without a warning", async () => {
  const projectRoot = await createTempProject();

  // expo-router ships clear-icon.png next to a byte-identical clear-icon@1x.png.
  await writeBinaryFiles(projectRoot, {
    "assets/clear-icon.png": createPngHeader(10, 12),
    "assets/clear-icon@1x.png": createPngHeader(10, 12),
  });

  const warnings: { conflict: AssetScaleConflict; message: string }[] = [];
  const descriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "assets/clear-icon.png"),
    projectRoot,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(descriptor.variants).toHaveLength(1);
  expect(warnings).toEqual([]);
});

test("de-dupes duplicate scales deterministically even without an onWarning callback", async () => {
  const projectRoot = await createTempProject();

  await writeBinaryFiles(projectRoot, {
    "assets/icon.png": createPngHeader(10, 12),
    "assets/icon@1x.png": createPngHeader(20, 24),
  });

  // No callback: the duplicate is still dropped (silent, like Metro), and the
  // build does not throw.
  const descriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "assets/icon@1x.png"),
    projectRoot,
  });

  expect(descriptor.scales).toEqual([1]);
  expect(descriptor.variants).toHaveLength(1);
  expect(descriptor.filePaths).toEqual([path.join(projectRoot, "assets/icon@1x.png")]);
});

test("collects font assets and builds dev-server URLs", async () => {
  const projectRoot = await createTempProject();

  await writeBinaryFiles(projectRoot, {
    "fonts/Inter.ttf": Buffer.from("not-a-real-font", "utf8"),
  });

  const descriptor = await collectAssetGroup({
    filePath: path.join(projectRoot, "fonts/Inter.ttf"),
    projectRoot,
  });

  expect(descriptor).toMatchObject({
    canonicalFilePath: path.join(projectRoot, "fonts/Inter.ttf"),
    httpServerLocation: "/assets/fonts",
    name: "Inter",
    scales: [1],
    type: "ttf",
  });
  expect(descriptor.width).toBeUndefined();
  expect(descriptor.height).toBeUndefined();
  expect(
    createAssetServerUrl({
      baseUrl: "http://localhost:8081/",
      descriptor,
      platform: "ios",
      scale: 2,
    }),
  ).toBe(
    `http://localhost:8081/assets/fonts/Inter.ttf?hash=${descriptor.hash}&platform=ios&scale=2`,
  );
});

async function createTempProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "vifx-asset-registry-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createPngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, 4, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeBinaryFiles(
  rootDirectory: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    await ensureParentDirectory(filePath);
    await writeFile(filePath, source);
  }
}
