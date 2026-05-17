import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
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
  expect(bundle.runtime?.htmlPath).toBe(".vifx/helper-ios-compat/index.html");
  expect(bundle.runtime?.scriptPath).toBe(".vifx/helper-ios-compat/runtime/runtime.js");
  expect(bundle.runtime?.rootElementId).toBe("root");
  const runtimeScriptSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-compat/runtime/runtime.js"),
    "utf8",
  );

  expect(runtimeScriptSource).toContain('runtime.mount("root")');
  expect(runtimeScriptSource).toContain("globalThis.__VIFX_BROWSER_GLOBALS__");
  expect(runtimeScriptSource).toContain("globalThis.ErrorUtils");
  expect(
    await readFile(path.join(projectRoot, ".vifx/helper-ios-compat/index.html"), "utf8"),
  ).toContain('<div id="root"></div>');
});

test("buildReactNativeBundle generates an Expo Router context for web runtime previews", async () => {
  const projectRoot = await copyFixture("expo-router-basic");
  const packageRoot = path.join(projectRoot, "node_modules", "expo-router");
  const reactPackageRoot = path.join(projectRoot, "node_modules", "react");
  const expoRouterBuildRoot = path.join(packageRoot, "build");

  await mkdir(packageRoot, { recursive: true });
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
  const previewBundleSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-expo-router/runtime/bundle.js"),
    "utf8",
  );

  expect(bundle.runtime?.htmlPath).toBe(".vifx/helper-ios-expo-router/index.html");
  expect(previewBundleSource).toContain("vifx-expo-router-context");
  expect(previewBundleSource).toContain("./post.tsx");
  expect(previewBundleSource).not.toContain("expo-router app");
  expect(previewBundleSource).not.toContain("__require.context");
  expect(previewBundleSource).toContain("ios route");
  expect(previewBundleSource).not.toContain('routeName = "android route"');
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
  await writeFile(path.join(expoWinterRoot, "url.ts"), "export const placeholder = true;\n");
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
    outDir: ".vifx/helper-ios-expo-winter-url",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
  });
  const previewBundleSource = await readFile(
    path.join(projectRoot, ".vifx/helper-ios-expo-winter-url/runtime/bundle.js"),
    "utf8",
  );

  expect(bundle.runtime?.htmlPath).toBe(".vifx/helper-ios-expo-winter-url/index.html");
  expect(previewBundleSource).toContain("globalThis.__VIFX_BROWSER_GLOBALS__ ?? {}");
  expect(previewBundleSource).toContain("browserGlobals.URL ??");
  expect(previewBundleSource).toContain("browserGlobals.URLSearchParams ??");
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
