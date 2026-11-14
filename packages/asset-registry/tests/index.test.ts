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
    expect(icon.httpServerLocation).toBe("/assets/assets");
    expect(logo.width).toBe(24);
    expect(logo.height).toBe(12);
  });

  it("uses the platform's own variants when there are any, like Metro", async () => {
    // expo-router 58 ships `back-icon.png` next to `back-icon@<n>x.ios.png` and
    // `back-icon@<n>x.android.png`.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-assets-"));
    const assetDir = path.join(projectRoot, "elements");
    await mkdir(assetDir);
    for (const fileName of [
      "back-icon.png",
      "back-icon@1x.ios.png",
      "back-icon@2x.ios.png",
      "back-icon@1x.android.png",
      "back-icon@3x.android.png",
      "close-icon.png",
      "close-icon@2x.png",
    ]) {
      await writeFile(path.join(assetDir, fileName), fileName, "utf8");
    }

    const collect = (fileName: string, platform: string | null) =>
      collectAssetGroup({ filePath: path.join(assetDir, fileName), platform, projectRoot });
    const relative = (group: { filePaths: readonly string[] }) =>
      group.filePaths.map((filePath) => path.basename(filePath));

    const ios = await collect("back-icon.png", "ios");
    expect(ios).toMatchObject({ httpServerLocation: "/assets/elements", name: "back-icon" });
    expect(ios.scales).toEqual([1, 2]);
    expect(relative(ios)).toEqual(["back-icon@1x.ios.png", "back-icon@2x.ios.png"]);
    expect(relative(await collect("back-icon.png", "android"))).toEqual([
      "back-icon@1x.android.png",
      "back-icon@3x.android.png",
    ]);
    // No platform files: the generic ones; no platform: never the suffixed ones.
    expect(relative(await collect("close-icon.png", "ios"))).toEqual([
      "close-icon.png",
      "close-icon@2x.png",
    ]);
    expect(relative(await collect("back-icon.png", null))).toEqual(["back-icon.png"]);
    expect(parseScaleFromAssetFileName("/x/back-icon@2x.android.png", undefined, "ios")).toEqual({
      extension: "png",
      name: "back-icon@2x.android",
      scale: 1,
    });
  });

  it("writes `_` for the `../` of an asset outside the project root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-assets-"));
    const projectRoot = path.join(workspaceRoot, "apps", "mobile");
    const assetDir = path.join(workspaceRoot, "node_modules", "ui", "img");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, "logo.png"), "logo", "utf8");

    const group = await collectAssetGroup({
      filePath: path.join(assetDir, "logo.png"),
      projectRoot,
    });

    expect(group.httpServerLocation).toBe("/assets/__node_modules/ui/img");
  });
});
