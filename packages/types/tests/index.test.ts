import { expect, test } from "vite-plus/test";
import type {
  VifxAssetDescriptor,
  VifxCompatibilityResult,
  VifxConfigInput,
  VifxProjectMetadata,
  VifxResolveOptions,
} from "../src/index.ts";

function acceptsResolveOptions(options: VifxResolveOptions) {
  return options;
}

test("shared contracts compose resolver, asset, project, and config data", () => {
  const resolveOptions = acceptsResolveOptions({
    platform: "ios",
    projectRoot: "/repo",
    extensions: ["tsx", "ts", "js"],
    conditions: ["react-native"],
  });

  const asset: VifxAssetDescriptor = {
    filePath: "/repo/assets/icon.png",
    httpServerLocation: "/assets",
    name: "icon",
    type: "png",
    scales: [1, 2, 3],
    width: 256,
    height: 256,
  };

  const project: VifxProjectMetadata = {
    root: "/repo",
    name: "playground-expo",
    projectType: "expo",
    platforms: ["ios", "android", "web"],
    dependencies: ["expo", "react-native"],
    expo: true,
    reactNative: true,
  };

  const config: VifxConfigInput = {
    projectRoot: "/repo",
    platforms: ["ios", "android"],
    expo: true,
    resolver: {
      extensions: ["tsx", "ts", "js"],
    },
    logger: {
      json: true,
    },
  };

  const result: VifxCompatibilityResult = {
    id: "resolver-ios-basic",
    suite: "platform-resolver",
    status: "pass",
    target: "metro",
    summary: "Metro and Vifx resolved the same file.",
  };

  expect(resolveOptions.platform).toBe("ios");
  expect(asset.scales).toEqual([1, 2, 3]);
  expect(project.platforms).toContain("web");
  expect(config.logger?.json).toBe(true);
  expect(result.status).toBe("pass");
});
