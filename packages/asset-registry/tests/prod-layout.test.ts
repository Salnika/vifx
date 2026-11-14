import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
  PROD_ASSET_MAP_FILE_NAME,
  collectAssetGroup,
  filterPlatformAssetScales,
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

  // Metro's names: `assets/icon.png` lives at `/assets/assets`, whose resource
  // identifier is `assets_icon` once the leading `assets_` is stripped.
  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "drawable-mdpi/assets_icon.png",
    "drawable-mdpi/assets_logo.svg",
    "drawable-mdpi/src_assets_icon.png",
    "drawable-xhdpi/assets_icon.png",
    "drawable-xhdpi/src_assets_icon.png",
    "drawable-xxhdpi/assets_icon.png",
    "drawable-xxhdpi/src_assets_icon.png",
    "raw/assets_font.ttf",
    "raw/keep.xml",
    "raw/src_assets_display.ttf",
  ]);

  expect(result.platform).toBe("android");
  expect(result.assets).toHaveLength(5);
  expect(result.writtenFiles).toContain("drawable-xxhdpi/assets_icon.png");
  expect(result.writtenFiles).toContain(PROD_ASSET_MAP_FILE_NAME);
  // Every asset is kept from resource shrinking, as Metro and Expo CLI do.
  expect(await readFile(path.join(assetsDest, "raw", "keep.xml"), "utf8")).toBe(
    '<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="' +
      "@raw/assets_font,@drawable/assets_icon,@drawable/assets_logo," +
      '@raw/src_assets_display,@drawable/src_assets_icon" />',
  );

  const copied = await readFile(path.join(assetsDest, "drawable-xhdpi", "assets_icon.png"));
  const original = await readFile(path.join(FIXTURE_ROOT, "assets", "icon@2x.png"));
  expect(copied.equals(original)).toBe(true);
});

test("writes the iOS production layout from the rn-bare-assets fixture", async () => {
  const assetsDest = await createTemporaryDirectory();
  const assets = await collectFixtureAssets();

  const result = await writeProdAssets(assets, { assetsDest, platform: "ios" });

  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "assets/assets/font.ttf",
    "assets/assets/icon.png",
    "assets/assets/icon@2x.png",
    "assets/assets/icon@3x.png",
    "assets/assets/logo.svg",
    "assets/src/assets/display.ttf",
    "assets/src/assets/icon.png",
    "assets/src/assets/icon@2x.png",
    "assets/src/assets/icon@3x.png",
  ]);

  expect(result.platform).toBe("ios");

  const copied = await readFile(path.join(assetsDest, "assets", "assets", "icon@3x.png"));
  const original = await readFile(path.join(FIXTURE_ROOT, "assets", "icon@3x.png"));
  expect(copied.equals(original)).toBe(true);
});

test("ships only the 1x to 3x scales on iOS, like Metro", async () => {
  const assetsDest = await createTemporaryDirectory();
  const variant = (scale: number) => ({
    filePath: path.join(FIXTURE_ROOT, "assets", "icon.png"),
    scale,
  });

  await writeProdAssets(
    [
      {
        httpServerLocation: "/assets/img",
        name: "icon",
        type: "png",
        variants: [variant(1), variant(2), variant(3), variant(4)],
      },
      // No scale iOS uses: the smallest larger one stands in, as with Metro.
      { httpServerLocation: "/assets/img", name: "hero", type: "png", variants: [variant(4)] },
    ],
    { assetsDest, platform: "ios" },
  );

  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "assets/img/hero@4x.png",
    "assets/img/icon.png",
    "assets/img/icon@2x.png",
    "assets/img/icon@3x.png",
  ]);
  expect(filterPlatformAssetScales("android", [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  expect(filterPlatformAssetScales("ios", [0.5, 4, 5])).toEqual([4]);
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
    (asset) => asset.name === "icon" && asset.httpServerLocation === "/assets/assets",
  );
  expect(icon).toEqual({
    files: [
      { path: "drawable-mdpi/assets_icon.png", scale: 1 },
      { path: "drawable-xhdpi/assets_icon.png", scale: 2 },
      { path: "drawable-xxhdpi/assets_icon.png", scale: 3 },
    ],
    httpServerLocation: "/assets/assets",
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
    writeProdAssets([{ httpServerLocation: "/assets", name: "ghost", type: "png", variants: [] }], {
      assetsDest,
      platform: "android",
    }),
  ).rejects.toMatchObject({ code: "VIFX_PROD_ASSET_VARIANT_MISSING" });
});

test("refuses to write assets whose destination escapes the assets dest", async () => {
  const assetsDest = await createTemporaryDirectory();
  const escaping = path.join(FIXTURE_ROOT, "assets", "icon.png");

  // A crafted asset name with traversal segments resolves above assetsDest;
  // writeProdAssets must reject instead of clobbering files outside the tree.
  await expect(
    writeProdAssets(
      [
        {
          httpServerLocation: "/assets",
          name: "../../evil",
          type: "png",
          variants: [{ filePath: escaping, scale: 1 }],
        },
      ],
      { assetsDest, platform: "ios" },
    ),
  ).rejects.toMatchObject({ code: "VIFX_PROD_ASSET_WRITE_FAILED" });

  expect(await listFilesRecursively(assetsDest)).toEqual([]);
});
