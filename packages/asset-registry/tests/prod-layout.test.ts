import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
  PROD_ASSET_MAP_FILE_NAME,
  collectAssetGroup,
  getAndroidDensitySuffix,
  getAndroidResourceIdentifier,
  getAssetDestPathAndroid,
  getAssetDestPathIOS,
  writeProdAssets,
} from "../src/index.ts";
import type { NormalizedAssetDescriptor } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures/rn-bare-assets");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "vifx-prod-layout-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function collectFixtureAssets(): Promise<NormalizedAssetDescriptor[]> {
  const groups = [
    "assets/icon.png",
    "assets/font.ttf",
    "assets/logo.svg",
    "src/assets/icon.png",
    "src/assets/display.ttf",
  ];

  return Promise.all(
    groups.map((relativePath) =>
      collectAssetGroup({
        filePath: path.join(FIXTURE_ROOT, relativePath),
        projectRoot: FIXTURE_ROOT,
      }),
    ),
  );
}

async function listFilesRecursively(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(root, entryPath)));
      continue;
    }

    files.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
  }

  return files.sort();
}

test("maps scales to Android density qualifiers with nearest fallback", () => {
  expect(getAndroidDensitySuffix(1)).toBe("mdpi");
  expect(getAndroidDensitySuffix(1.5)).toBe("hdpi");
  expect(getAndroidDensitySuffix(2)).toBe("xhdpi");
  expect(getAndroidDensitySuffix(3)).toBe("xxhdpi");
  expect(getAndroidDensitySuffix(4)).toBe("xxxhdpi");

  // Non-standard scales resolve to the nearest density; ties prefer the
  // higher density.
  expect(getAndroidDensitySuffix(0.75)).toBe("mdpi");
  expect(getAndroidDensitySuffix(1.7)).toBe("hdpi");
  expect(getAndroidDensitySuffix(2.5)).toBe("xxhdpi");
  expect(getAndroidDensitySuffix(3.5)).toBe("xxxhdpi");
  expect(getAndroidDensitySuffix(8)).toBe("xxxhdpi");
});

test("derives Metro-compatible Android resource identifiers", () => {
  expect(getAndroidResourceIdentifier({ httpServerLocation: "/assets", name: "icon" })).toBe(
    "icon",
  );
  expect(
    getAndroidResourceIdentifier({ httpServerLocation: "/assets/src/assets", name: "icon" }),
  ).toBe("src_assets_icon");
  expect(
    getAndroidResourceIdentifier({ httpServerLocation: "/assets/Sub.Dir", name: "My-Icon 2" }),
  ).toBe("subdir_myicon2");
});

test("computes Metro-compatible destination paths per platform", () => {
  const drawable = { httpServerLocation: "/assets/img", name: "icon", type: "png" };
  const raw = { httpServerLocation: "/assets/fonts", name: "Display", type: "ttf" };

  expect(getAssetDestPathAndroid(drawable, 1)).toBe("drawable-mdpi/img_icon.png");
  expect(getAssetDestPathAndroid(drawable, 3)).toBe("drawable-xxhdpi/img_icon.png");
  expect(getAssetDestPathAndroid(raw, 1)).toBe("raw/fonts_display.ttf");

  expect(getAssetDestPathIOS(drawable, 1)).toBe("assets/img/icon.png");
  expect(getAssetDestPathIOS(drawable, 2)).toBe("assets/img/icon@2x.png");
  expect(getAssetDestPathIOS(raw, 1)).toBe("assets/fonts/Display.ttf");

  // Parent traversal in the server location never escapes the assets dest.
  expect(
    getAssetDestPathIOS({ httpServerLocation: "/assets/../evil", name: "icon", type: "png" }, 1),
  ).toBe("assets/_evil/icon.png");
});

test("writes the Android production layout from the rn-bare-assets fixture", async () => {
  const assetsDest = await createTemporaryDirectory();
  const assets = await collectFixtureAssets();

  const result = await writeProdAssets(assets, { assetsDest, platform: "android" });

  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "drawable-mdpi/icon.png",
    "drawable-mdpi/logo.svg",
    "drawable-mdpi/src_assets_icon.png",
    "drawable-xhdpi/icon.png",
    "drawable-xhdpi/src_assets_icon.png",
    "drawable-xxhdpi/icon.png",
    "drawable-xxhdpi/src_assets_icon.png",
    "raw/font.ttf",
    "raw/src_assets_display.ttf",
  ]);

  expect(result.platform).toBe("android");
  expect(result.assets).toHaveLength(5);
  expect(result.writtenFiles).toContain("drawable-xxhdpi/icon.png");
  expect(result.writtenFiles).toContain(PROD_ASSET_MAP_FILE_NAME);

  const copied = await readFile(path.join(assetsDest, "drawable-xhdpi", "icon.png"));
  const original = await readFile(path.join(FIXTURE_ROOT, "assets", "icon@2x.png"));
  expect(copied.equals(original)).toBe(true);
});

test("writes the iOS production layout from the rn-bare-assets fixture", async () => {
  const assetsDest = await createTemporaryDirectory();
  const assets = await collectFixtureAssets();

  const result = await writeProdAssets(assets, { assetsDest, platform: "ios" });

  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "assets/font.ttf",
    "assets/icon.png",
    "assets/icon@2x.png",
    "assets/icon@3x.png",
    "assets/logo.svg",
    "assets/src/assets/display.ttf",
    "assets/src/assets/icon.png",
    "assets/src/assets/icon@2x.png",
    "assets/src/assets/icon@3x.png",
  ]);

  expect(result.platform).toBe("ios");

  const copied = await readFile(path.join(assetsDest, "assets", "icon@3x.png"));
  const original = await readFile(path.join(FIXTURE_ROOT, "assets", "icon@3x.png"));
  expect(copied.equals(original)).toBe(true);
});

test("describes every written file in assetmap.json", async () => {
  const assetsDest = await createTemporaryDirectory();
  const assets = await collectFixtureAssets();

  const result = await writeProdAssets(assets, { assetsDest, platform: "android" });
  const assetMap = JSON.parse(await readFile(result.assetMapPath, "utf8")) as {
    assets: Array<{
      files: Array<{ path: string; scale: number }>;
      httpServerLocation: string;
      name: string;
      scales: number[];
      type: string;
    }>;
    platform: string;
    version: number;
  };

  expect(result.assetMapPath).toBe(path.join(assetsDest, PROD_ASSET_MAP_FILE_NAME));
  expect(assetMap.platform).toBe("android");
  expect(assetMap.version).toBe(1);
  expect(assetMap.assets).toHaveLength(5);

  const icon = assetMap.assets.find(
    (asset) => asset.name === "icon" && asset.httpServerLocation === "/assets",
  );
  expect(icon).toEqual({
    files: [
      { path: "drawable-mdpi/icon.png", scale: 1 },
      { path: "drawable-xhdpi/icon.png", scale: 2 },
      { path: "drawable-xxhdpi/icon.png", scale: 3 },
    ],
    httpServerLocation: "/assets",
    name: "icon",
    scales: [1, 2, 3],
    type: "png",
  });
});

test("writes assetmap.json even when there are no assets", async () => {
  const assetsDest = await createTemporaryDirectory();

  const result = await writeProdAssets([], { assetsDest, platform: "ios" });

  expect(await listFilesRecursively(assetsDest)).toEqual([PROD_ASSET_MAP_FILE_NAME]);
  expect(result.assets).toEqual([]);
  expect(result.writtenFiles).toEqual([PROD_ASSET_MAP_FILE_NAME]);
});

test("rejects asset groups without variants", async () => {
  const assetsDest = await createTemporaryDirectory();

  await expect(
    writeProdAssets(
      [{ httpServerLocation: "/assets", name: "ghost", type: "png", variants: [] }],
      { assetsDest, platform: "android" },
    ),
  ).rejects.toMatchObject({ code: "VIFX_PROD_ASSET_VARIANT_MISSING" });
});
