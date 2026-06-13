import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  isGatedNativeCompatModule,
  isNativeCompatMockEnabled,
  NATIVE_COMPAT_PREVIEW_MODULE_IDS,
  resetNativeCompatPreviewWarnings,
  warnNativeCompatPreviewOnce,
} from "../src/compat-gate.ts";
import { buildReactNativeBundle } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-compat-gate-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

async function writeSyntheticReanimated(projectRoot: string, marker: string) {
  const packageRoot = path.join(projectRoot, "node_modules", "react-native-reanimated");

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "react-native-reanimated",
        main: "index.js",
        "react-native": "index.js",
        type: "module",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      `export const ${marker} = "real reanimated package";`,
      "export function useSharedValue(initialValue) {",
      "  return { value: initialValue };",
      "}",
      `export default { ${marker} };`,
      "",
    ].join("\n"),
  );
}

test("isNativeCompatMockEnabled requires both compatPreview and a native platform", () => {
  expect(isNativeCompatMockEnabled({ compatPreview: true, resolvePlatform: "ios" })).toBe(true);
  expect(isNativeCompatMockEnabled({ compatPreview: true, resolvePlatform: "android" })).toBe(true);
  expect(isNativeCompatMockEnabled({ compatPreview: false, resolvePlatform: "ios" })).toBe(false);
  expect(isNativeCompatMockEnabled({ compatPreview: true, resolvePlatform: "web" })).toBe(false);
});

test("react-native-reanimated is the gated native compat module", () => {
  expect(NATIVE_COMPAT_PREVIEW_MODULE_IDS).toContain("react-native-reanimated");
  expect(isGatedNativeCompatModule("react-native-reanimated")).toBe(true);
  expect(isGatedNativeCompatModule("react-native")).toBe(false);
});

test("buildReactNativeBundle resolves the real react-native-reanimated on native by default", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeSyntheticReanimated(projectRoot, "REAL_REANIMATED_MARKER");
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import Reanimated, { useSharedValue } from "react-native-reanimated";',
      "",
      "export function readMarker() {",
      "  return Reanimated.REAL_REANIMATED_MARKER;",
      "}",
      "",
      "export function makeShared() {",
      "  return useSharedValue(1);",
      "}",
      'console.log("reanimated marker", readMarker());',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-reanimated-real",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("real reanimated package");
  expect(bundleSource).not.toContain("vifx:compat:react-native-reanimated");
  expect(bundleSource).not.toContain("var AnimatedBase");
});

test("buildReactNativeBundle substitutes the JS mock for react-native-reanimated under compatPreview", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeSyntheticReanimated(projectRoot, "REAL_REANIMATED_MARKER");
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import Reanimated, { useSharedValue } from "react-native-reanimated";',
      "",
      "export function makeShared() {",
      "  return useSharedValue(1);",
      "}",
      'console.log("reanimated default", typeof Reanimated);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    compatPreview: true,
    entry: "./index.js",
    outDir: ".vifx/helper-ios-reanimated-mock",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("vifx:compat:react-native-reanimated");
  expect(bundleSource).toContain("var AnimatedBase");
  expect(bundleSource).not.toContain("real reanimated package");
});

test("warnNativeCompatPreviewOnce emits a single loud warning per module", () => {
  resetNativeCompatPreviewWarnings();

  const originalWarn = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    warnNativeCompatPreviewOnce("react-native-reanimated");
    warnNativeCompatPreviewOnce("react-native-reanimated");
    warnNativeCompatPreviewOnce("react-native-reanimated");
  } finally {
    console.warn = originalWarn;
  }

  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("compatPreview");
  expect(messages[0]).toContain("react-native-reanimated");
  expect(messages[0]).toContain("NOT real");

  resetNativeCompatPreviewWarnings();
});
