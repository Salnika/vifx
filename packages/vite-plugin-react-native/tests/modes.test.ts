import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { isVifxError } from "@vifx/errors";
import { validateSourceMap } from "@vifx/source-map-tools";
import { expect, test } from "vite-plus/test";
import { buildReactNativeBundle } from "../src/index.ts";
import {
  resolveBuildMinify,
  resolveBundleMode,
  resolveDefines,
  resolveOutputOptions,
} from "../src/modes.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-modes-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

function expectScriptBundle(bundleSource: string) {
  expect(bundleSource).not.toContain("import ");
  expect(bundleSource).not.toContain("export ");
  expect(bundleSource).not.toContain("import.meta");
}

function evaluateScriptBundle(bundleSource: string) {
  const logs: unknown[][] = [];
  const sandbox: Record<string, unknown> = {
    console: {
      error: (...args: unknown[]) => logs.push(args),
      info: (...args: unknown[]) => logs.push(args),
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
    },
  };
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);

  vm.runInContext(bundleSource, context, { filename: "index.bundle" });

  return logs;
}

async function writeDefineProbeEntry(projectRoot: string) {
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry } from "react-native";',
      "",
      'console.log("vifx-define", __DEV__, process.env.NODE_ENV, process.env.EXPO_OS);',
      'AppRegistry.registerComponent("BareApp", () => null);',
      "",
    ].join("\n"),
  );
}

async function writeFakeReactNativeWebPackage(projectRoot: string) {
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
}

async function writeFakeHermesCompiler(projectRoot: string) {
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

  return compilerPath;
}

test("resolveBundleMode defaults to development and keeps explicit modes", () => {
  expect(resolveBundleMode({})).toBe("development");
  expect(resolveBundleMode({ mode: undefined })).toBe("development");
  expect(resolveBundleMode({ mode: "development" })).toBe("development");
  expect(resolveBundleMode({ mode: "production" })).toBe("production");
});

test("resolveDefines derives __DEV__ and NODE_ENV from the mode for every native platform", () => {
  for (const platform of ["ios", "android"] as const) {
    expect(resolveDefines({ mode: "development", platform, resolvePlatform: platform })).toEqual({
      __DEV__: "true",
      global: "globalThis",
      "process.env.EXPO_OS": JSON.stringify(platform),
      "process.env.NODE_ENV": '"development"',
    });
    expect(resolveDefines({ mode: "production", platform, resolvePlatform: platform })).toEqual({
      __DEV__: "false",
      global: "globalThis",
      "process.env.EXPO_OS": JSON.stringify(platform),
      "process.env.NODE_ENV": '"production"',
    });
  }
});

test("resolveDefines keeps the web define shape without EXPO_OS", () => {
  expect(resolveDefines({ mode: "development", platform: "ios", resolvePlatform: "web" })).toEqual({
    __DEV__: "true",
    global: "globalThis",
    "process.env.NODE_ENV": '"development"',
  });
  expect(
    resolveDefines({ mode: "production", platform: "android", resolvePlatform: "web" }),
  ).toEqual({
    __DEV__: "false",
    global: "globalThis",
    "process.env.NODE_ENV": '"production"',
  });
});

test("resolveOutputOptions emits a single IIFE script for hoisted native bundles", () => {
  for (const mode of ["development", "production"] as const) {
    for (const platform of ["ios", "android"] as const) {
      expect(resolveOutputOptions({ mode, moduleFormat: "hoisted", platform })).toEqual({
        entryFileNames: "index.bundle",
        format: "iife",
        inlineDynamicImports: true,
        name: "__vifx",
      });
    }
  }
});

test("resolveOutputOptions keeps web bundles as ES modules", () => {
  for (const mode of ["development", "production"] as const) {
    expect(resolveOutputOptions({ mode, moduleFormat: "hoisted", platform: "web" })).toEqual({
      format: "es",
    });
  }
});

test("resolveOutputOptions rejects the unimplemented metro module format", () => {
  try {
    resolveOutputOptions({ mode: "production", moduleFormat: "metro", platform: "ios" });
    expect.unreachable("resolveOutputOptions should reject moduleFormat metro");
  } catch (error) {
    expect(isVifxError(error)).toBe(true);
    expect(isVifxError(error) && error.code).toBe("VIFX_MODULE_FORMAT_UNSUPPORTED");
  }
});

test("resolveBuildMinify enables the Oxc minifier only in production", () => {
  expect(resolveBuildMinify("development")).toBe(false);
  expect(resolveBuildMinify("production")).toBe("oxc");
});

test("development native bundles are IIFE scripts that evaluate in a plain script context", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeDefineProbeEntry(projectRoot);

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/modes-ios-dev",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundle.bundle.path).toBe(".vifx/modes-ios-dev/index.bundle");
  expectScriptBundle(bundleSource);

  const logs = evaluateScriptBundle(bundleSource);

  expect(logs).toContainEqual(["vifx-define", true, "development", "ios"]);
});

test("production native bundles are minified, smaller, and keep a valid composed source map", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeDefineProbeEntry(projectRoot);

  const developmentBundle = await buildReactNativeBundle({
    entry: "./index.js",
    mode: "development",
    outDir: ".vifx/modes-android-dev",
    platform: "android",
    projectRoot,
  });
  const productionBundle = await buildReactNativeBundle({
    entry: "./index.js",
    mode: "production",
    outDir: ".vifx/modes-android-prod",
    platform: "android",
    projectRoot,
  });
  const productionSource = await readFile(
    path.join(projectRoot, productionBundle.bundle.path),
    "utf8",
  );
  const validation = await validateSourceMap({
    sourceMapPath: path.join(projectRoot, `${productionBundle.bundle.path}.map`),
  });

  expectScriptBundle(productionSource);
  expect(productionBundle.bundle.sizeBytes).toBeLessThan(developmentBundle.bundle.sizeBytes);
  expect(productionBundle.sourceMap?.valid).toBe(true);
  expect(validation.valid).toBe(true);
  expect(validation.sourceCount).toBeGreaterThan(0);

  const logs = evaluateScriptBundle(productionSource);

  expect(logs).toContainEqual(["vifx-define", false, "production", "android"]);
});

test("hermes production builds compile bytecode from the minified bundle", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const compilerPath = await writeFakeHermesCompiler(projectRoot);

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    hermes: true,
    hermesCompilerPath: compilerPath,
    mode: "production",
    outDir: ".vifx/modes-ios-hermes-prod",
    platform: "ios",
    projectRoot,
  });

  expect(bundle.hermesBytecodePath).toBe(".vifx/modes-ios-hermes-prod/index.hbc");

  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  const bytecodeSource = await readFile(
    path.join(projectRoot, bundle.hermesBytecodePath ?? ""),
    "utf8",
  );

  expectScriptBundle(bundleSource);
  expect(bytecodeSource).toBe(`HBC:${bundleSource}`);
});

test("web runtime previews keep ESM output while the native bundle is IIFE", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeFakeReactNativeWebPackage(projectRoot);
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { AppRegistry } from "react-native";',
      "",
      'console.log("vifx modes compat probe");',
      'AppRegistry.registerComponent("BareApp", () => null);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/modes-ios-web-compat",
    platform: "ios",
    projectRoot,
    reactNativeCompat: "web",
  });
  const nativeBundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  const previewBundleSource = await readFile(
    path.join(projectRoot, ".vifx/modes-ios-web-compat/runtime/bundle.js"),
    "utf8",
  );

  expectScriptBundle(nativeBundleSource);
  expect(bundle.runtime?.htmlPath).toBe(".vifx/modes-ios-web-compat/index.html");
  expect(previewBundleSource).toContain("vifx modes compat probe");
});
