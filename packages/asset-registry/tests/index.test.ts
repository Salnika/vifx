import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  collectAssetGroup,
  isSupportedAssetFile,
  parseScaleFromAssetFileName,
} from "../src/index.ts";

describe("@vifx/asset-registry", () => {
  it("parses scale suffixes from asset names", () => {
    expect(parseScaleFromAssetFileName("/tmp/icon@3x.png")).toMatchObject({
      extension: "png",
      name: "icon",
      scale: 3,
    });
  });

  it("recognizes supported first-pass asset extensions", () => {
    expect(isSupportedAssetFile("/tmp/font.ttf")).toBe(true);
    expect(isSupportedAssetFile("/tmp/file.exe")).toBe(false);
  });

  it("groups scale variants and computes stable metadata", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-assets-"));
    const assetDir = path.join(projectRoot, "assets");
    await mkdir(assetDir);
    await writeFile(path.join(assetDir, "icon.png"), "1x", "utf8");
    await writeFile(path.join(assetDir, "icon@2x.png"), "2x", "utf8");
    await writeFile(path.join(assetDir, "icon@3x.png"), "3x", "utf8");
    await writeFile(
      path.join(assetDir, "logo.svg"),
      '<svg width="24" height="12" viewBox="0 0 24 12"></svg>',
      "utf8",
    );

    const icon = await collectAssetGroup({
      filePath: path.join(assetDir, "icon.png"),
      projectRoot,
    });
    const logo = await collectAssetGroup({
      filePath: path.join(assetDir, "logo.svg"),
      projectRoot,
    });

    expect(icon.scales).toEqual([1, 2, 3]);
    expect(icon.hash).toHaveLength(16);
    expect(icon.httpServerLocation).toBe("/assets");
    expect(logo.width).toBe(24);
    expect(logo.height).toBe(12);
  });
});
