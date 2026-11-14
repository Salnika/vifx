import { chmod, cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "@voidzero-dev/vite-plus-core";
import { expect, test } from "vite-plus/test";
import { buildReactNativeBundle, reactNative } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-plugin-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

test("reactNative() works as a real Vite plugin for the RN smoke fixture", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await build({
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      emptyOutDir: true,
      minify: false,
      outDir: ".vifx/direct-ios",
      rollupOptions: {
        input: path.join(projectRoot, "index.js"),
        output: {
          assetFileNames: "assets/[name][extname]",
          entryFileNames: "index.bundle",
          format: "es",
        },
      },
      sourcemap: true,
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      reactNative({
        entry: "./index.js",
        platform: "ios",
        projectRoot,
      }),
    ],
    publicDir: false,
    root: projectRoot,
  });

  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/direct-ios/index.bundle"),
    "utf8",
  );

  expect(bundleSource).toContain("rn ios bundle");
});

test("buildReactNativeBundle returns typed artifacts and resolves Android platform files", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-android",
    platform: "android",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundle.assets).toHaveLength(1);
  expect(bundle.assets[0]?.type).toBe("svg");
  expect(bundle.sourceMap?.valid).toBe(true);
  expect(bundleSource).toContain("rn android bundle");
});

test("buildReactNativeBundle accepts a bare local filename entry", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const bundle = await buildReactNativeBundle({
    entry: "index.js",
    outDir: ".vifx/helper-ios-bare-entry",
    platform: "ios",
    projectRoot,
  });

  expect(bundle.bundle.path).toBe(".vifx/helper-ios-bare-entry/index.bundle");
  expect(bundle.sourceMap?.valid).toBe(true);
});

test("buildReactNativeBundle optionally runs Hermes after Vite finishes", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const compilerPath = path.join(projectRoot, "fake-hermesc");

  await writeFile(
    compilerPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('-out');",
      "const outputPath = args[outputIndex + 1];",
      "const inputPath = args.at(-1);",
      "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
      "fs.writeFileSync(outputPath, `HBC:${fs.readFileSync(inputPath, 'utf8')}`);",
      "",
    ].join("\n"),
  );
  await chmod(compilerPath, 0o755);

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    hermes: true,
    hermesCompilerPath: compilerPath,
    outDir: ".vifx/helper-ios-hermes",
    platform: "ios",
    projectRoot,
  });

  expect(bundle.hermesBytecodePath).toBe(".vifx/helper-ios-hermes/index.hbc");
});

test("buildReactNativeBundle resolves project aliases when configured", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry } from "react-native";',
      'import App from "@/src/App";',
      "",
      'AppRegistry.registerComponent("BareApp", () => App);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    aliases: {
      "@": ".",
    },
    entry: "./index.js",
    outDir: ".vifx/helper-ios-alias",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("rn ios bundle");
});

test("buildReactNativeBundle resolves React singletons from the project root", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const reactRoot = path.join(projectRoot, "node_modules", "react");
  const libraryRoot = path.join(projectRoot, "node_modules", "uses-react");
  const nestedReactRoot = path.join(libraryRoot, "node_modules", "react");

  await mkdir(reactRoot, { recursive: true });
  await mkdir(libraryRoot, { recursive: true });
  await mkdir(nestedReactRoot, { recursive: true });
  await writeFile(
    path.join(reactRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "react", type: "module" }, null, 2),
  );
  await writeFile(
    path.join(reactRoot, "index.js"),
    ['export const marker = "root react singleton";', "export default { marker };", ""].join("\n"),
  );
  await writeFile(
    path.join(libraryRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "uses-react", type: "module" }, null, 2),
  );
  await writeFile(
    path.join(libraryRoot, "index.js"),
    [
      'import React from "react";',
      "export function readMarker() {",
      "  return React.marker;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(nestedReactRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "react", type: "module" }, null, 2),
  );
  await writeFile(
    path.join(nestedReactRoot, "index.js"),
    ['export const marker = "nested react copy";', "export default { marker };", ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import React from "react";',
      'import { readMarker } from "uses-react";',
      'console.log("markers", React.marker, readMarker());',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-react-singleton",
    platform: "ios",
    projectRoot,
    shimReact: false,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("root react singleton");
  expect(bundleSource).not.toContain("nested react copy");
});

test("buildReactNativeBundle keeps JSON imports as JavaScript modules by default", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeFile(
    path.join(projectRoot, "icons.json"),
    JSON.stringify({ home: 59648, search: 59649 }, null, 2),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    ['import icons from "./icons.json";', 'console.log("icon home", icons.home);', ""].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-json-module",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("59648");
  expect(bundleSource).not.toContain("/assets/icons.json");
});

test("buildReactNativeBundle can use the built-in react-native-web compat layer", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "react-native-web");

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "react-native-web",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      'console.log("react-native-web compat active");',
      "export const AppRegistry = {",
      "  registerComponent(name, loader) {",
      "    return { loader, name };",
      "  },",
      "};",
      'export const Platform = { OS: "web", select(value) { return value?.web ?? value?.default ?? null; } };',
      "const ReactNativeWeb = { AppRegistry, Platform };",
      "export default ReactNativeWeb;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry, BackHandler, NativeModules, TurboModuleRegistry } from "react-native";',
      'console.log("compat native modules", typeof NativeModules.NativeUnimoduleProxy);',
      'console.log("compat turbo module", TurboModuleRegistry.getEnforcing());',
      'BackHandler.addEventListener("hardwareBackPress", () => true).remove();',
      'AppRegistry.registerComponent("BareApp", () => null);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-compat",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("react-native-web compat active");
  expect(bundleSource).toContain("compat native modules");
  expect(bundleSource).toContain("compat turbo module");
  // The shim-based browser preview (writeWebRuntimeArtifacts + the static
  // runtime.js/index.html + __VIFX_WEB_RUNTIME__) was removed. The
  // compat layer now wraps the real react-native-web AppRegistry inside the
  // bundle itself, with no preview artifact and no global runtime shim.
  expect(bundle.runtime).toBeNull();
  expect(bundleSource).not.toContain("__VIFX_WEB_RUNTIME__");
  expect(bundleSource).not.toContain("runtime.mount");
  // The compat AppRegistry routes to the real RNW base registry.
  expect(bundleSource).toContain("baseAppRegistry.runApplication");
});

test("buildReactNativeBundle does not tag react-native-worklets internals as compat on web", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  const webRoot = path.join(projectRoot, "node_modules", "react-native-web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(
    path.join(webRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "react-native-web" }, null, 2),
  );
  await writeFile(
    path.join(webRoot, "index.js"),
    [
      "export const AppRegistry = { registerComponent(name, loader) { return { loader, name }; } };",
      'export const Platform = { OS: "web", select(value) { return value?.web ?? value?.default ?? null; } };',
      "export default { AppRegistry, Platform };",
      "",
    ].join("\n"),
  );

  // react-native-worklets internals (bundleUnpacker / workletRuntimeEntry) are
  // native-only compat targets. On web they must resolve to their real source,
  // not to a `\0vifx:compat:` virtual id the web renderer returns null for —
  // which previously crashed the build with UNLOADABLE_DEPENDENCY.
  const workletsSrc = path.join(projectRoot, "node_modules", "react-native-worklets", "src");
  await mkdir(workletsSrc, { recursive: true });
  await writeFile(
    path.join(projectRoot, "node_modules", "react-native-worklets", "package.json"),
    JSON.stringify({ name: "react-native-worklets" }, null, 2),
  );
  await writeFile(
    path.join(workletsSrc, "bundleUnpacker.ts"),
    'export function bundleValueUnpacker() { return "web-worklets-unpacker"; }\n',
  );
  await writeFile(
    path.join(workletsSrc, "workletRuntimeEntry.ts"),
    'export function bundleModeInit() { return "web-worklets-entry"; }\n',
  );
  await writeFile(
    path.join(workletsSrc, "index.ts"),
    [
      "import './workletRuntimeEntry';",
      "export { bundleValueUnpacker } from './bundleUnpacker';",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry } from "react-native";',
      'import { bundleValueUnpacker } from "react-native-worklets/src/bundleUnpacker";',
      'import { bundleModeInit } from "react-native-worklets/src/workletRuntimeEntry";',
      'console.log("worklets web", bundleValueUnpacker(), bundleModeInit());',
      'AppRegistry.registerComponent("BareApp", () => null);',
      "",
    ].join("\n"),
  );

  // Must build cleanly (this threw UNLOADABLE_DEPENDENCY before the fix).
  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-worklets-web",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
    resolvePlatform: "web",
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).not.toContain("vifx:compat:react-native-worklets");
  expect(bundleSource).toContain("web-worklets-unpacker");
  expect(bundleSource).toContain("web-worklets-entry");
});

test("buildReactNativeBundle registers native assets via AssetRegistry with scale variants", async () => {
  const projectRoot = await copyFixture("rn-bare-assets");

  // Synthetic AssetRegistry so the registered-asset module resolves in the fixture.
  const registryRoot = path.join(projectRoot, "node_modules", "@react-native", "assets-registry");
  await mkdir(registryRoot, { recursive: true });
  await writeFile(
    path.join(registryRoot, "package.json"),
    JSON.stringify({ name: "@react-native/assets-registry" }, null, 2),
  );
  await writeFile(
    path.join(registryRoot, "registry.js"),
    [
      "let nextId = 1;",
      "export function registerAsset(asset) { return nextId++; }",
      "export function getAssetByID(id) { return null; }",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry } from "react-native";',
      'import icon from "./assets/icon.png";',
      'import font from "./assets/font.ttf";',
      'console.log("native assets", icon, font);',
      'AppRegistry.registerComponent("BareApp", () => null);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-assets",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  // Native asset imports compile to AssetRegistry.registerAsset (a numeric id),
  // like Metro — not Vite's default URL string, which breaks <Image>/font loading.
  expect(bundleSource).toContain("registerAsset");
  expect(bundleSource).toContain('"__packager_asset": true');
  // Metro's location: `/assets` followed by the file's directory.
  expect(bundleSource).toContain('"httpServerLocation": "/assets/assets"');
  expect(bundleSource).not.toContain('"/assets/icon.png"');
  expect(bundleSource).not.toContain('"/assets/font.ttf"');

  // Every scale variant is emitted under that location, where the dev server
  // serves it and React Native looks for it next to a release bundle.
  const assetsDir = path.join(projectRoot, ".vifx/helper-ios-assets/assets/assets");
  for (const name of ["icon.png", "icon@2x.png", "icon@3x.png", "font.ttf"]) {
    expect((await stat(path.join(assetsDir, name))).isFile()).toBe(true);
  }
  expect(bundle.assets.find((asset) => asset.name === "icon")?.files).toEqual([
    { path: ".vifx/helper-ios-assets/assets/assets/icon.png", scale: 1 },
    { path: ".vifx/helper-ios-assets/assets/assets/icon@2x.png", scale: 2 },
    { path: ".vifx/helper-ios-assets/assets/assets/icon@3x.png", scale: 3 },
  ]);
});

test("buildReactNativeBundle registers assets through react-native/asset-registry (React Native 0.88)", async () => {
  const projectRoot = await copyFixture("rn-bare-assets");

  // React Native 0.88 has no @react-native/assets-registry package: the
  // registry is the `react-native/asset-registry` entry point.
  const reactNativeRoot = path.join(projectRoot, "node_modules", "react-native");
  await mkdir(path.join(reactNativeRoot, "src"), { recursive: true });
  await writeFile(
    path.join(reactNativeRoot, "package.json"),
    JSON.stringify(
      {
        exports: { "./asset-registry": "./src/asset-registry.js" },
        name: "react-native",
        version: "0.88.1",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(reactNativeRoot, "src", "asset-registry.js"),
    ["let nextId = 1;", "export function registerAsset(asset) { return nextId++; }", ""].join("\n"),
  );
  // Through the template's aliases, from a file below the project root, and
  // with platform variants beside the generic image, as expo-router ships them
  // (Metro resolves the generic file, then groups the platform's variants).
  await mkdir(path.join(projectRoot, "src", "screens"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "assets", "badge.png"),
    await readFile(path.join(projectRoot, "assets", "icon.png")),
  );
  await writeFile(
    path.join(projectRoot, "assets", "badge@2x.ios.png"),
    await readFile(path.join(projectRoot, "assets", "icon@2x.png")),
  );
  await writeFile(
    path.join(projectRoot, "assets", "badge@2x.android.png"),
    await readFile(path.join(projectRoot, "assets", "icon@3x.png")),
  );
  await writeFile(
    path.join(projectRoot, "src", "screens", "Home.js"),
    [
      'export const icon = require("@/assets/icon.png");',
      'export const badge = require("@/assets/badge.png");',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { badge, icon } from "@/screens/Home";',
      "globalThis.__assetCheck = { badge, icon };",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    aliases: { "@": "./src", "@/assets": "./assets" },
    entry: "./index.js",
    outDir: ".vifx/helper-ios-rn088",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  const sandbox: { __assetCheck?: { badge: unknown; icon: unknown } } = {};
  runInNewContext(bundleSource, Object.assign(sandbox, { globalThis: sandbox }));
  expect(sandbox.__assetCheck).toEqual({ badge: 2, icon: 1 });

  // The iOS build takes `badge@2x.ios.png` (Metro's platform variant rule).
  const badge = bundle.assets.find((asset) => asset.name === "badge");
  expect(badge).toMatchObject({ httpServerLocation: "/assets/assets", scales: [2] });
  expect(
    (
      await readFile(path.join(projectRoot, ".vifx/helper-ios-rn088/assets/assets/badge@2x.png"))
    ).equals(await readFile(path.join(projectRoot, "assets", "icon@2x.png"))),
  ).toBe(true);
});

test("buildReactNativeBundle makes require() of an asset the asset id, like an import", async () => {
  const projectRoot = await copyFixture("rn-bare-assets");

  const registryRoot = path.join(projectRoot, "node_modules", "@react-native", "assets-registry");
  await mkdir(registryRoot, { recursive: true });
  await writeFile(
    path.join(registryRoot, "package.json"),
    JSON.stringify({ name: "@react-native/assets-registry" }, null, 2),
  );
  await writeFile(
    path.join(registryRoot, "registry.js"),
    ["let nextId = 1;", "export function registerAsset(asset) { return nextId++; }", ""].join("\n"),
  );
  // React Native's own code (LogBox, for one) and most apps write
  // `<Image source={require("./icon.png")} />`.
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import imported from "./assets/icon.png";',
      'const required = require("./assets/icon.png");',
      'const font = require("./assets/font.ttf");',
      "globalThis.__assetCheck = { font, imported, required };",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-asset-require",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  const sandbox: { __assetCheck?: { font: unknown; imported: unknown; required: unknown } } = {};
  runInNewContext(bundleSource, Object.assign(sandbox, { globalThis: sandbox }));

  // A namespace object here would reach `<Image source>` as `{ default: 1 }`.
  expect(sandbox.__assetCheck?.imported).toBe(1);
  expect(sandbox.__assetCheck?.required).toBe(1);
  expect(sandbox.__assetCheck?.font).toBe(2);
});

test("getDevServer reads the Expo manifest only once globalThis.expo exists", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  // Like the real package: expo-constants throws while loading without
  // globalThis.expo, and React Native's InitializeCore runs getDevServer first.
  const expoConstantsRoot = path.join(projectRoot, "node_modules", "expo-constants");
  await mkdir(expoConstantsRoot, { recursive: true });
  await writeFile(
    path.join(expoConstantsRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "expo-constants" }),
  );
  await writeFile(
    path.join(expoConstantsRoot, "index.js"),
    [
      "if (globalThis.expo === undefined) {",
      "  throw new TypeError(\"Cannot read property 'EventEmitter' of undefined\");",
      "}",
      "exports.__esModule = true;",
      "exports.default = {",
      "  __unsafeNoWarnManifest2: {",
      "    launchAsset: { url: 'http://127.0.0.1:8091/expo-router/entry.bundle?platform=android' },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import getDevServer from "react-native/Libraries/Core/Devtools/getDevServer";',
      "globalThis.__early = getDevServer();",
      "globalThis.__whenReady = () => {",
      "  globalThis.expo = {};",
      "  return getDevServer();",
      "};",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-android-dev-server",
    platform: "android",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  const sandbox: {
    __early?: { bundleLoadedFromServer: boolean; url: string };
    __whenReady?: () => { bundleLoadedFromServer: boolean; url: string };
  } = {};
  runInNewContext(bundleSource, Object.assign(sandbox, { globalThis: sandbox }));

  expect(sandbox.__early).toMatchObject({ bundleLoadedFromServer: false, url: "" });
  expect(sandbox.__whenReady?.()).toMatchObject({
    bundleLoadedFromServer: true,
    url: "http://127.0.0.1:8091/",
  });
});

test("buildReactNativeBundle uses native Reanimated compat for Expo Go bundles when compatPreview is enabled", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";',
      "",
      "export function AnimatedExample() {",
      "  const shared = useSharedValue(1);",
      "  const style = useAnimatedStyle(() => ({ opacity: shared.value }));",
      "  return { animatedView: Animated.View, style };",
      "}",
      "",
      "export function readCompat() {",
      "  let hidden = false;",
      "  const value = { value: 1 };",
      "  value.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }, (finished) => {",
      "    if (finished) {",
      "      runOnJS((next) => { hidden = next; })(true);",
      "    }",
      "  });",
      "  return [hidden, value.value, interpolate(0.5, [0, 1], [10, 20])];",
      "}",
      "",
      'console.log("reanimated compat", readCompat());',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    compatPreview: true,
    entry: "./index.js",
    outDir: ".vifx/helper-ios-reanimated-compat",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("vifx:compat:react-native-reanimated");
  expect(bundleSource).toContain("var AnimatedBase");
  expect(bundleSource).toContain("callback?.(true, toValue);");
  expect(bundleSource).toContain("outputMin + clamp");
  expect(bundleSource).not.toContain("initializeReanimatedModule");
});

test("buildReactNativeBundle generates an Expo Router context with platform routing", async () => {
  const projectRoot = await copyFixture("expo-router-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "expo-router");
  const metroRuntimeRoot = path.join(projectRoot, "node_modules", "@expo", "metro-runtime");
  const reactPackageRoot = path.join(projectRoot, "node_modules", "react");
  const expoPackageRoot = path.join(projectRoot, "node_modules", "expo");
  const expoRouterBuildRoot = path.join(packageRoot, "build");

  await mkdir(packageRoot, { recursive: true });
  await mkdir(path.join(metroRuntimeRoot, "src"), { recursive: true });
  await mkdir(reactPackageRoot, { recursive: true });
  await mkdir(expoPackageRoot, { recursive: true });
  await mkdir(expoRouterBuildRoot, { recursive: true });
  await writeFile(
    path.join(reactPackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "react",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(reactPackageRoot, "index.js"),
    [
      "const React = {",
      "  Fragment: Symbol.for('react.fragment'),",
      "  createElement(type, props, ...children) {",
      "    return {",
      "      props: { ...(props ?? {}), children },",
      "      type,",
      "    };",
      "  },",
      "};",
      "",
      "module.exports = React;",
      "module.exports.default = React;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoPackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(expoPackageRoot, "index.js"),
    [
      "export function registerRootComponent(Component) {",
      "  globalThis.__vifxRegisteredRootComponent = Component;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo-router",
        main: "entry.js",
        exports: {
          "./_ctx": {
            web: "./_ctx.web.js",
            default: "./_ctx.js",
          },
          "./build/ExpoRoot": "./build/ExpoRoot.js",
          "./build/head": "./build/head.js",
          "./build/qualified-entry": "./build/qualified-entry.js",
          "./build/renderRootComponent": "./build/renderRootComponent.js",
          "./entry": "./entry.js",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "package.json"),
    JSON.stringify(
      {
        main: "src/index.ts",
        name: "@expo/metro-runtime",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "src/index.ts"),
    ['console.log("metro runtime bootstrap");', "export {};", ""].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "entry.js"),
    [
      'import { App } from "expo-router/build/qualified-entry";',
      'console.log("expo-router app", App);',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "ExpoRoot.js"),
    ["export function ExpoRoot(props) {", "  return props.context;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "head.js"),
    [
      "export const Head = {",
      "  Provider({ children }) {",
      "    return children;",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "renderRootComponent.js"),
    ["export function renderRootComponent(Component) {", "  return Component;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "fast-refresh.js"),
    ['console.log("fast-refresh loaded");', "export {};", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "qualified-entry.js"),
    [
      'const { ctx } = require("expo-router/_ctx");',
      "exports.App = function App() {",
      '  return ctx("./post.tsx");',
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "_ctx.js"),
    [
      "export const ctx = Object.assign(() => ({}), {",
      "  keys() {",
      "    return [];",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "_ctx.web.js"),
    ['export const ctx = require.context("app", true, /\\.tsx?$/, "sync");', ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.tsx"),
    [
      'export const routeName = "base route";',
      "export default function PostRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.ios.tsx"),
    [
      'export const routeName = "ios route";',
      "export default function PostIosRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.android.tsx"),
    [
      'export const routeName = "android route";',
      "export default function PostAndroidRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "expo-router/entry",
    outDir: ".vifx/helper-ios-expo-router",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
  });
  // The web-preview artifact (runtime/bundle.js + index.html) was removed with
  // the __VIFX_WEB_RUNTIME__ shim. The router context, platform route
  // resolution, and require.context replacement are now asserted on the native
  // bundle directly — the same coverage without the dead preview path.
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundle.runtime).toBeNull();
  expect(bundleSource).toContain("vifx-expo-router-context");
  expect(bundleSource).toContain("./post.tsx");
  expect(bundleSource).not.toContain("expo-router app");
  expect(bundleSource).not.toContain("__require.context");
  expect(bundleSource).toContain("ios route");
  expect(bundleSource).not.toContain('routeName = "android route"');
});

test("buildReactNativeBundle generates a native Expo Router context without require.context", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "expo-router");
  const metroRuntimeRoot = path.join(projectRoot, "node_modules", "@expo", "metro-runtime");
  const reactPackageRoot = path.join(projectRoot, "node_modules", "react");
  const expoRouterBuildRoot = path.join(packageRoot, "build");

  await mkdir(path.join(projectRoot, "app"), { recursive: true });
  await mkdir(path.join(metroRuntimeRoot, "src"), { recursive: true });
  await mkdir(reactPackageRoot, { recursive: true });
  await mkdir(expoRouterBuildRoot, { recursive: true });
  await writeFile(
    path.join(reactPackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "react",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(reactPackageRoot, "index.js"),
    [
      "const React = {",
      "  Fragment: Symbol.for('react.fragment'),",
      "  createElement(type, props, ...children) {",
      "    return {",
      "      props: { ...(props ?? {}), children },",
      "      type,",
      "    };",
      "  },",
      "};",
      "",
      "module.exports = React;",
      "module.exports.default = React;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo-router",
        main: "entry.js",
        exports: {
          "./_ctx": {
            default: "./_ctx.js",
          },
          "./build/ExpoRoot": "./build/ExpoRoot.js",
          "./build/head": "./build/head.js",
          "./build/qualified-entry": "./build/qualified-entry.js",
          "./build/renderRootComponent": "./build/renderRootComponent.js",
          "./entry": "./entry.js",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "package.json"),
    JSON.stringify(
      {
        main: "src/index.ts",
        name: "@expo/metro-runtime",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "src/index.ts"),
    ['console.log("metro runtime bootstrap");', "export {};", ""].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "_ctx.js"),
    [
      "export const ctx = Object.assign(() => ({}), {",
      "  keys() {",
      "    return [];",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "ExpoRoot.js"),
    ["export function ExpoRoot(props) {", "  return props.context;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "head.js"),
    [
      "export const Head = {",
      "  Provider({ children }) {",
      "    return children;",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "renderRootComponent.js"),
    ["export function renderRootComponent(Component) {", "  return Component;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "fast-refresh.js"),
    ['console.log("fast-refresh loaded");', "export {};", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "qualified-entry.js"),
    [
      'const { ctx } = require("expo-router/_ctx");',
      "exports.App = function App() {",
      '  return ctx("./post.tsx");',
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "entry.js"),
    [
      'import { App } from "expo-router/build/qualified-entry";',
      'console.log("expo-router app", App);',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { App } from "expo-router/build/qualified-entry";',
      'console.log("expo-router app", App);',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.tsx"),
    [
      'export const routeName = "base route";',
      "export default function PostRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.ios.tsx"),
    [
      'export const routeName = "ios route";',
      "export default function PostIosRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-expo-router-native",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-expo-router-native/index.bundle"),
    "utf8",
  );

  expect(bundle.runtime).toBeNull();
  expect(bundleSource).toContain("vifx-expo-router-context");
  expect(bundleSource).toContain("fast-refresh loaded");
  expect(bundleSource).toContain("./post.tsx");
  expect(bundleSource).not.toContain("__require.context");
  expect(bundleSource).toContain("ios route");
  expect(bundleSource).not.toContain('routeName = "android route"');
});

test("buildReactNativeBundle keeps the Expo Router native bootstrap aligned with Metro", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "expo-router");
  const metroRuntimeRoot = path.join(projectRoot, "node_modules", "@expo", "metro-runtime");
  const sqlitePackageRoot = path.join(projectRoot, "node_modules", "expo-sqlite");
  const sqliteBuildRoot = path.join(sqlitePackageRoot, "build");
  const reactPackageRoot = path.join(projectRoot, "node_modules", "react");
  const expoPackageRoot = path.join(projectRoot, "node_modules", "expo");
  const expoConstantsRoot = path.join(projectRoot, "node_modules", "expo-constants");
  const expoRouterBuildRoot = path.join(packageRoot, "build");

  await mkdir(path.join(projectRoot, "app"), { recursive: true });
  await mkdir(path.join(metroRuntimeRoot, "src"), { recursive: true });
  await mkdir(reactPackageRoot, { recursive: true });
  await mkdir(expoPackageRoot, { recursive: true });
  await mkdir(expoConstantsRoot, { recursive: true });
  await mkdir(expoRouterBuildRoot, { recursive: true });
  await writeFile(
    path.join(reactPackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "react",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(reactPackageRoot, "index.js"),
    [
      "const React = {",
      "  Fragment: Symbol.for('react.fragment'),",
      "  createElement(type, props, ...children) {",
      "    return {",
      "      props: { ...(props ?? {}), children },",
      "      type,",
      "    };",
      "  },",
      "};",
      "",
      "module.exports = React;",
      "module.exports.default = React;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoPackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(expoPackageRoot, "index.js"),
    [
      "export function registerRootComponent(Component) {",
      "  globalThis.__vifxRegisteredRootComponent = Component;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoConstantsRoot, "package.json"),
    JSON.stringify(
      {
        main: "index.js",
        name: "expo-constants",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(expoConstantsRoot, "index.js"),
    [
      "export default {",
      "  __unsafeNoWarnManifest2: {",
      "    launchAsset: { url: 'http://127.0.0.1:55888/expo-router/entry.bundle' },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo-router",
        main: "entry.js",
        exports: {
          "./_ctx": {
            default: "./_ctx.js",
          },
          "./build/ExpoRoot": "./build/ExpoRoot.js",
          "./build/fast-refresh": "./build/fast-refresh.js",
          "./build/head": "./build/head.js",
          "./build/qualified-entry": "./build/qualified-entry.js",
          "./build/renderRootComponent": "./build/renderRootComponent.js",
          "./entry": "./entry.js",
          "./entry-classic": "./entry-classic.js",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "package.json"),
    JSON.stringify(
      {
        main: "src/index.ts",
        name: "@expo/metro-runtime",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(metroRuntimeRoot, "src/index.ts"),
    ['console.log("metro runtime bootstrap");', "export {};", ""].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "_ctx.js"),
    [
      "export const ctx = Object.assign(() => ({}), {",
      "  keys() {",
      "    return [];",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "ExpoRoot.js"),
    ["export function ExpoRoot(props) {", "  return props.context;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "head.js"),
    [
      "export const Head = {",
      "  Provider({ children }) {",
      "    return children;",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "renderRootComponent.js"),
    ["export function renderRootComponent(Component) {", "  return Component;", "}", ""].join("\n"),
  );
  await writeFile(
    path.join(expoRouterBuildRoot, "fast-refresh.js"),
    ['console.log("fast-refresh loaded");', "export {};", ""].join("\n"),
  );
  await mkdir(sqliteBuildRoot, { recursive: true });
  await writeFile(
    path.join(sqlitePackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "expo-sqlite",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(sqlitePackageRoot, "index.js"),
    [
      'export { SQLiteProvider } from "./build/hooks.js";',
      'export { openDatabaseAsync } from "./build/SQLiteDatabase.js";',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(sqliteBuildRoot, "SQLiteDatabase.js"),
    [
      "export async function openDatabaseAsync() {",
      "  return {",
      "    closeAsync() {},",
      "    execAsync() {},",
      "    getAllAsync() {},",
      "    getEachAsync() {},",
      "    getFirstAsync() {},",
      "    isInTransactionAsync() { return false; },",
      "    loadExtensionAsync() {},",
      "    prepareAsync() {},",
      "    runAsync() {},",
      "    serializeAsync() {},",
      "    withExclusiveTransactionAsync() {},",
      "    withTransactionAsync() {},",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(sqliteBuildRoot, "hooks.js"), "export {};\n");
  await writeFile(
    path.join(expoRouterBuildRoot, "qualified-entry.js"),
    [
      'const { ctx } = require("expo-router/_ctx");',
      'require("expo-router/build/fast-refresh");',
      "exports.App = function App() {",
      '  return ctx("./post.tsx");',
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "entry.js"),
    ['import "expo-router/entry-classic";', ""].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "entry-classic.js"),
    [
      'import "@expo/metro-runtime";',
      'import { App } from "expo-router/build/qualified-entry";',
      'import { renderRootComponent } from "expo-router/build/renderRootComponent";',
      "",
      "renderRootComponent(App);",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.tsx"),
    [
      'export const routeName = "base route";',
      "export default function PostRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "post.ios.tsx"),
    [
      'export const routeName = "ios route";',
      "export default function PostIosRoute() {",
      "  return null;",
      "}",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(projectRoot, "src", "db"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "src", "db", "SQLiteProvider.tsx"),
    [
      'import { SQLiteProvider as ExpoSQLiteProvider } from "expo-sqlite";',
      "",
      "export function SQLiteProvider(props) {",
      "  return ExpoSQLiteProvider(props);",
      "}",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(projectRoot, "node_modules", "react-native-worklets", "src"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, "node_modules", "react-native-worklets", "package.json"),
    JSON.stringify(
      {
        name: "react-native-worklets",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "node_modules", "react-native-worklets", "src", "bundleUnpacker.ts"),
    [
      "export function bundleValueUnpacker() {",
      "  return globalThis.__r(1).default({});",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(
      projectRoot,
      "node_modules",
      "react-native-worklets",
      "src",
      "workletRuntimeEntry.ts",
    ),
    [
      "export function bundleModeInit() {",
      "  globalThis._WORKLETS_BUNDLE_MODE = true;",
      "}",
      "",
      "bundleModeInit();",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "node_modules", "react-native-worklets", "src", "index.ts"),
    [
      "import './workletRuntimeEntry';",
      "export { bundleValueUnpacker } from './bundleUnpacker';",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "app", "_layout.tsx"),
    [
      'import { createElement } from "react";',
      'import getDevServer from "react-native/Libraries/Core/Devtools/getDevServer";',
      'import { bundleModeInit } from "react-native-worklets/src/workletRuntimeEntry";',
      'import { bundleValueUnpacker } from "react-native-worklets/src/bundleUnpacker";',
      'import { SQLiteProvider } from "../src/db/SQLiteProvider";',
      "",
      "(globalThis as any).__vifxGetDevServer = getDevServer;",
      "(globalThis as any).__vifxBundleModeInit = bundleModeInit;",
      "(globalThis as any).__vifxWorkletsUnpacker = bundleValueUnpacker;",
      "",
      "export default function RootLayout() {",
      "  return createElement(SQLiteProvider, {",
      '    databaseName: "rn-bare-basic.db",',
      "    onInit: async () => {},",
      "  }, null);",
      "}",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "expo-router/entry",
    outDir: ".vifx/helper-ios-expo-router-bootstrap",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-expo-router-bootstrap/index.bundle"),
    "utf8",
  );

  expect(bundle.runtime).toBeNull();
  expect(bundleSource).toContain("metro runtime bootstrap");
  expect(bundleSource).toContain("fast-refresh loaded");
  expect(bundleSource).toContain("registerRootComponent(App)");
  expect(bundleSource).toContain("const [loading, setLoading] = React.useState(true);");
  expect(bundleSource).toContain("SQLiteContext.Provider");
  expect(bundleSource).toContain("databaseRef.current = database");
  expect(bundleSource).toContain("loading || !databaseRef.current");
  // Rolldown prints the transformed module's id (`vifx:\0transformed:...`) in
  // its region comment with the NUL byte replaced.
  const transformedModuleIndex = bundleSource.search(/vifx:.?transformed:/u);
  expect(transformedModuleIndex).toBeGreaterThan(-1);
  expect(bundleSource.indexOf("expo-sqlite/build/SQLiteDatabase.js")).toBeGreaterThan(-1);
  expect(bundleSource.indexOf("vifx:compat:expo-sqlite/build/SQLiteDatabase")).toBeGreaterThan(
    transformedModuleIndex,
  );
  expect(bundleSource).toContain("vifx:compat:react-native-worklets/src/bundleUnpacker");
  expect(bundleSource).toContain("vifx:compat:react-native-worklets/src/workletRuntimeEntry");
  expect(bundleSource).not.toContain("const windowLocation = typeof window !==");
  expect(bundleSource).toContain('SourceCode.getConstants().scriptURL ?? ""');
  expect(bundleSource).toContain("Vifx could not resolve a Worklets bundle-mode worklet");
  expect(bundleSource).not.toContain("return globalThis.__r(1).default({});");
  expect(bundleSource).not.toContain("globalThis._WORKLETS_BUNDLE_MODE = true;");
  expect(bundleSource).not.toContain("init_SQLiteDatabase();");
  expect(bundleSource).not.toContain("__require.context");
  expect(bundleSource).toContain("vifx-expo-router-context");
});

test("buildReactNativeBundle uses captured browser globals for Expo winter URL compat", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const expoWinterRoot = path.join(projectRoot, "node_modules", "expo", "src", "winter");

  await mkdir(expoWinterRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "node_modules", "expo", "package.json"),
    JSON.stringify(
      {
        name: "expo",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(expoWinterRoot, "url.ts"),
    ["export function URL() {}", "export function URLSearchParams() {}", ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { URL, URLSearchParams } from "expo/src/winter/url";',
      'console.log("expo winter url", typeof URL, typeof URLSearchParams);',
      "export default { URL, URLSearchParams };",
      "",
    ].join("\n"),
  );

  // Web resolution (resolvePlatform "web") is what triggers the browser-globals
  // winter URL. With the preview artifact gone, this is now asserted
  // on the web-resolved native bundle directly instead of runtime/bundle.js.
  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-expo-winter-url",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
    resolvePlatform: "web",
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundle.runtime).toBeNull();
  expect(bundleSource).toContain("globalThis.__VIFX_BROWSER_GLOBALS__ ?? {}");
  expect(bundleSource).toContain("browserGlobals.URL ??");
  expect(bundleSource).toContain("browserGlobals.URLSearchParams ??");
});

test("buildReactNativeBundle keeps the native Expo winter URL implementation", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const expoWinterRoot = path.join(projectRoot, "node_modules", "expo", "src", "winter");

  await mkdir(expoWinterRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "node_modules", "expo", "package.json"),
    JSON.stringify(
      {
        name: "expo",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(expoWinterRoot, "url.ts"),
    [
      "export function URL() {}",
      "export function URLSearchParams() {}",
      "URL.createObjectURL = () => 'blob:vifx';",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { URL, URLSearchParams } from "expo/src/winter/url";',
      'console.log("expo winter url", typeof URL, typeof URLSearchParams);',
      "export default { URL, URLSearchParams };",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-expo-winter-url-native",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-expo-winter-url-native/index.bundle"),
    "utf8",
  );

  expect(bundle.runtime).toBeNull();
  expect(bundleSource).toContain("URL.createObjectURL");
  expect(bundleSource).not.toContain("vifx:compat:expo/src/winter/url");
  expect(bundleSource).not.toContain(
    "browserGlobals.URLSearchParams ?? globalThis.URLSearchParams",
  );
});

test("buildReactNativeBundle accepts a package-style entry and transforms JSX in configured packages", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "vifx-jsx-entry");
  const outDir = path.join(path.dirname(projectRoot), "vifx-external-package-entry");

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "vifx-jsx-entry",
        main: "index.js",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      'console.log("package jsx entry");',
      "export default function Entry() {",
      "  return <div />;",
      "}",
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "vifx-jsx-entry",
    jsxInPackages: ["vifx-jsx-entry"],
    outDir,
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("package jsx entry");
});

test("buildReactNativeBundle applies project Babel to native node_modules transitively", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-plugin-babel-native-"));
  const babelCoreRoot = path.join(projectRoot, "node_modules", "@babel", "core");
  const babelPresetRoot = path.join(projectRoot, "node_modules", "@react-native", "babel-preset");
  const dependencyRoot = path.join(projectRoot, "node_modules", "unlisted-native-dependency");

  await mkdir(babelCoreRoot, { recursive: true });
  await mkdir(babelPresetRoot, { recursive: true });
  await mkdir(dependencyRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "unlisted-native-dependency": "1.0.0",
        },
        name: "native-babel-project",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(babelCoreRoot, "index.js"),
    [
      "exports.transformAsync = async function transformAsync(code, options) {",
      "  const scope = options.caller?.isNodeModule ? 'node' : 'project';",
      "  const transformed = code.replace('class NativeDependency {}', 'function NativeDependency() {}');",
      "  return {",
      "    code: `console.log(\"babel:${scope}:${options.filename.includes('unlisted-native-dependency')}\");\\n${transformed}`,",
      "    map: null,",
      "  };",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(babelPresetRoot, "index.js"),
    "module.exports = function preset() {};\n",
  );
  await writeFile(
    path.join(dependencyRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "unlisted-native-dependency" }, null, 2),
  );
  await writeFile(
    path.join(dependencyRoot, "index.js"),
    [
      "export const marker = class NativeDependency {};",
      'console.log("native dependency", marker.name);',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { marker } from "unlisted-native-dependency";',
      'console.log("native entry", marker.name);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    jsxInPackages: ["unlisted-native-dependency"],
    outDir: ".vifx/helper-ios-babel-native",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("babel:node:true");
  expect(bundleSource).toContain("babel:project:false");
  expect(bundleSource).not.toContain("class NativeDependency");
});

test("buildReactNativeBundle keeps package sources of Babel-transformed node_modules in the bundle map", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-plugin-babel-map-"));
  const babelCoreRoot = path.join(projectRoot, "node_modules", "@babel", "core");
  const babelPresetRoot = path.join(projectRoot, "node_modules", "@react-native", "babel-preset");
  const dependencyRoot = path.join(projectRoot, "node_modules", "vifx-mapped-package");

  await mkdir(babelCoreRoot, { recursive: true });
  await mkdir(babelPresetRoot, { recursive: true });
  await mkdir(path.join(dependencyRoot, "build"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ dependencies: { "vifx-mapped-package": "1.0.0" }, name: "babel-map" }),
  );
  // Stands in for Babel merging the package's own `build/widget.js.map`: the
  // merged map names the TypeScript source relative to the built file, and
  // the caller tells which engine the preset targets.
  await writeFile(
    path.join(babelCoreRoot, "index.js"),
    [
      "exports.transformAsync = async function transformAsync(code, options) {",
      "  const lines = code.split('\\n');",
      "  return {",
      "    code: `globalThis.engine = ${JSON.stringify(options.caller.engine ?? 'none')};\\n${code}`,",
      "    map: {",
      "      mappings: ';' + lines.map((_, index) => (index === 0 ? 'AAAA' : 'AACA')).join(';'),",
      "      names: [],",
      "      sources: ['../src/widget.ts'],",
      "      sourcesContent: [code],",
      "      version: 3,",
      "    },",
      "  };",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(babelPresetRoot, "index.js"),
    "module.exports = function preset() {};\n",
  );
  await writeFile(
    path.join(dependencyRoot, "package.json"),
    JSON.stringify({ main: "build/widget.js", name: "vifx-mapped-package" }),
  );
  await writeFile(
    path.join(dependencyRoot, "build", "widget.js"),
    'export const widget = "mapped widget";\n',
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    'import { widget } from "vifx-mapped-package";\nconsole.log(widget);\n',
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    jsxInPackages: ["vifx-mapped-package"],
    outDir: ".vifx/helper-ios-babel-map",
    platform: "ios",
    projectRoot,
    transformCache: false,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  const sourceMap = JSON.parse(
    await readFile(path.join(projectRoot, bundle.sourceMap?.path ?? ""), "utf8"),
  ) as { sources: string[] };

  // Native bundles run on Hermes, so babel-preset-expo gets Metro's engine.
  expect(bundleSource).toContain('globalThis.engine = "hermes"');
  // The package module is loaded through a virtual id and still maps back to
  // the source its own map names.
  expect(
    sourceMap.sources.some((source) =>
      source.endsWith("node_modules/vifx-mapped-package/src/widget.ts"),
    ),
  ).toBe(true);
});

test("buildReactNativeBundle tells babel-preset-expo to apply the React Compiler when enabled", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-plugin-react-compiler-"));
  const babelCoreRoot = path.join(projectRoot, "node_modules", "@babel", "core");
  const babelPresetRoot = path.join(projectRoot, "node_modules", "babel-preset-expo");

  await mkdir(babelCoreRoot, { recursive: true });
  await mkdir(babelPresetRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "compiler" }));
  // babel-preset-expo reads `supportsReactCompiler` from its caller, which
  // Expo CLI sets from `experiments.reactCompiler`.
  await writeFile(
    path.join(babelCoreRoot, "index.js"),
    [
      "exports.transformAsync = async function transformAsync(code, options) {",
      "  const enabled = options.caller.supportsReactCompiler === true;",
      "  return { code: `globalThis.reactCompiler = ${enabled};\\n${code}`, map: null };",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(babelPresetRoot, "index.js"),
    "module.exports = function preset() {};\n",
  );
  await writeFile(path.join(projectRoot, "index.js"), 'console.log("compiled");\n');

  const readBundle = async (reactCompiler: boolean) => {
    const bundle = await buildReactNativeBundle({
      entry: "./index.js",
      outDir: `.vifx/helper-react-compiler-${String(reactCompiler)}`,
      platform: "ios",
      projectRoot,
      reactCompiler,
    });
    return readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  };

  expect(await readBundle(true)).toContain("globalThis.reactCompiler = true");
  // The transform cache keeps the two apart.
  expect(await readBundle(false)).toContain("globalThis.reactCompiler = false");
});

test("buildReactNativeBundle can opt out of React and React Native shims", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-plugin-real-runtime-"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          react: "19.1.0",
          "react-native": "0.81.0",
        },
        name: "real-runtime-opt-out",
      },
      null,
      2,
    ),
  );

  const reactRoot = path.join(projectRoot, "node_modules", "react");
  const reactNativeRoot = path.join(projectRoot, "node_modules", "react-native");
  await mkdir(reactRoot, { recursive: true });
  await mkdir(reactNativeRoot, { recursive: true });

  await writeFile(
    path.join(reactRoot, "package.json"),
    JSON.stringify({ name: "react", main: "index.js" }, null, 2),
  );
  await writeFile(
    path.join(reactRoot, "index.js"),
    [
      "export function createRef() {",
      "  return { current: null };",
      "}",
      "export class PureComponent {}",
      "const React = { createRef, PureComponent };",
      "export default React;",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(reactNativeRoot, "package.json"),
    JSON.stringify({ name: "react-native", main: "index.js" }, null, 2),
  );
  await writeFile(
    path.join(reactNativeRoot, "index.js"),
    [
      'console.log("real react-native runtime active");',
      'export const NativeModules = { EXDevLauncher: { manifestString: "{}" } };',
      "export function Text() {",
      "  return null;",
      "}",
      'export const Platform = { OS: "ios", select(value) { return value?.ios ?? value?.default ?? null; } };',
      "const ReactNative = { NativeModules, Platform, Text };",
      "export default ReactNative;",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { createRef, PureComponent } from "react";',
      'import { NativeModules, Platform, Text } from "react-native";',
      'console.log("runtime exports", createRef(), typeof PureComponent, NativeModules.EXDevLauncher, Platform.OS, Text);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/helper-ios-real-runtime",
    platform: "ios",
    projectRoot,
    shimJsxRuntime: false,
    shimReact: false,
    shimReactNative: false,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("real react-native runtime active");
  expect(bundleSource).toContain("runtime exports");
  expect(bundleSource).not.toContain("\\0vifx:shim:react-native");
});

async function writeJsxPackageFixture(projectRoot: string) {
  const packageRoot = path.join(projectRoot, "node_modules", "vifx-jsx-cache");

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "vifx-jsx-cache", main: "index.js" }, null, 2),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      'console.log("jsx cache package");',
      "export default function CachedEntry() {",
      '  return <div className="cached" />;',
      "}",
      "",
    ].join("\n"),
  );

  return packageRoot;
}

test("buildReactNativeBundle reports transform cache stats and reuses them on a warm rebuild", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  await writeJsxPackageFixture(projectRoot);

  const buildOnce = () =>
    buildReactNativeBundle({
      entry: "vifx-jsx-cache",
      jsxInPackages: ["vifx-jsx-cache"],
      outDir: ".vifx/helper-ios-transform-cache",
      platform: "ios",
      projectRoot,
    });

  const cold = await buildOnce();
  expect(cold.cacheStats).toBeDefined();
  expect(cold.cacheStats?.misses ?? 0).toBeGreaterThan(0);
  expect(cold.cacheStats?.writes ?? 0).toBeGreaterThan(0);
  expect(cold.cacheStats?.hits).toBe(0);
  expect(cold.cacheStats?.errors).toBe(0);

  const warm = await buildOnce();
  expect(warm.cacheStats?.hits ?? 0).toBeGreaterThan(0);
  expect(warm.cacheStats?.misses).toBe(0);
  expect(warm.cacheStats?.writes).toBe(0);
  expect(warm.cacheStats?.errors).toBe(0);

  const bundleSource = await readFile(path.join(projectRoot, warm.bundle.path), "utf8");
  expect(bundleSource).toContain("jsx cache package");
});

test("buildReactNativeBundle omits cache stats when the transform cache is disabled", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  await writeJsxPackageFixture(projectRoot);

  const first = await buildReactNativeBundle({
    entry: "vifx-jsx-cache",
    jsxInPackages: ["vifx-jsx-cache"],
    outDir: ".vifx/helper-ios-transform-cache-off",
    platform: "ios",
    projectRoot,
    transformCache: false,
  });
  const second = await buildReactNativeBundle({
    entry: "vifx-jsx-cache",
    jsxInPackages: ["vifx-jsx-cache"],
    outDir: ".vifx/helper-ios-transform-cache-off",
    platform: "ios",
    projectRoot,
    transformCache: false,
  });

  expect(first.cacheStats).toBeUndefined();
  expect(second.cacheStats).toBeUndefined();
  const bundleSource = await readFile(path.join(projectRoot, second.bundle.path), "utf8");
  expect(bundleSource).toContain("jsx cache package");
});

test("buildReactNativeBundle invalidates the transform cache when source content changes", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const packageRoot = await writeJsxPackageFixture(projectRoot);

  const buildOnce = () =>
    buildReactNativeBundle({
      entry: "vifx-jsx-cache",
      jsxInPackages: ["vifx-jsx-cache"],
      outDir: ".vifx/helper-ios-transform-cache-invalidate",
      platform: "ios",
      projectRoot,
    });

  await buildOnce();

  // Change the package source: the warm build must miss (and re-transform).
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      'console.log("jsx cache package edited");',
      "export default function CachedEntry() {",
      '  return <div className="edited" />;',
      "}",
      "",
    ].join("\n"),
  );

  const afterEdit = await buildOnce();
  expect(afterEdit.cacheStats?.misses ?? 0).toBeGreaterThan(0);
  const bundleSource = await readFile(path.join(projectRoot, afterEdit.bundle.path), "utf8");
  expect(bundleSource).toContain("jsx cache package edited");
});
