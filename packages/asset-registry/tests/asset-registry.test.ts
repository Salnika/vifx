import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
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
    httpServerLocation: "/assets",
    height: 12,
    name: "icon",
    scales: [1, 2, 3],
    type: "png",
    width: 10,
  });
  expect(firstDescriptor.hash).toBe(secondDescriptor.hash);
  expect(firstDescriptor.variants).toHaveLength(3);
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
