import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { analyzeMetroConfig, pruneAppliedFixes } from "../src/lib/metro-config.ts";

async function createProject(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-metro-config-"));

  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = path.join(projectRoot, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  return projectRoot;
}

test("returns not-found when the project has no metro config", async () => {
  const projectRoot = await createProject({ "package.json": "{}\n" });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.found).toBe(false);
  expect(analysis.extraction).toBe("none");
  expect(analysis.hints).toEqual([]);
  expect(analysis.unsupported).toEqual([]);
  expect(analysis.path).toBeUndefined();
});

test("evaluates an expo-style default config passthrough as info only", async () => {
  // Stand in for `expo/metro-config` so the require resolves next to the config.
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js":
      "exports.getDefaultConfig = () => ({ transformer: {}, resolver: {} });\n",
    "metro.config.js": [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "module.exports = getDefaultConfig(__dirname);",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.found).toBe(true);
  expect(analysis.extraction).toBe("evaluated");
  expect(analysis.path).toBe("metro.config.js");
  expect(analysis.hints).toEqual([]);
  expect(analysis.unsupported).toEqual([]);
});

test("maps the svg transformer to a named recipe hint with a docs pointer", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      '  transformer: { babelTransformerPath: "react-native-svg-transformer" },',
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");
  const hint = analysis.hints.find((entry) =>
    entry.source.endsWith("transformer.babelTransformerPath"),
  );
  expect(hint).toBeDefined();
  expect(hint?.severity).toBe("action");
  expect(hint?.suggestion).toContain("react-native-svg-transformer");
  expect(hint?.suggestion).toContain(
    "https://salnika.github.io/vifx/guide/migration#_3-map-your-metro-config-js",
  );
  expect(hint?.vifxConfigKey).toBe("plugins");
});

test("maps a custom resolveRequest function to an actionable migration hint", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      "  resolver: { resolveRequest: (context, moduleName) => null },",
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");
  // resolveRequest is now supported via vite.config.vifx.ts, so it is no longer
  // a hard refusal — it is surfaced as an `action` hint instead.
  expect(analysis.unsupported).toHaveLength(0);
  const hint = analysis.hints.find((entry) => entry.source.endsWith("resolver.resolveRequest"));
  expect(hint?.severity).toBe("action");
  expect(hint?.suggestion).toContain("vite.config.vifx.ts");
  expect(hint?.suggestion).toContain("vifxResolveRequest");
});

test("flags custom serializer hooks as unsupported", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      "  serializer: { customSerializer: () => '' },",
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");
  expect(analysis.unsupported).toHaveLength(1);
  expect(analysis.unsupported[0]?.code).toBe("VIFX_UNSUPPORTED_METRO_SERIALIZER");
});

test("treats watchFolders as a native monorepo info hint", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      'const path = require("node:path");',
      "module.exports = {",
      '  watchFolders: [path.resolve(__dirname, "..", "..")],',
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");
  const hint = analysis.hints.find((entry) => entry.source.endsWith("watchFolders"));
  expect(hint).toBeDefined();
  expect(hint?.severity).toBe("info");
  expect(hint?.suggestion).toContain("workspace");
});

test("maps assetExts and sourceExts additions to vifx config hints", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      "  resolver: {",
      '    assetExts: ["png", "lottie", "kml"],',
      '    sourceExts: ["js", "ts", "mdx"],',
      "  },",
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");

  const assetHint = analysis.hints.find((entry) => entry.source.endsWith("resolver.assetExts"));
  expect(assetHint?.vifxConfigKey).toBe("resolver.assetExtensions");
  expect(assetHint?.fixable).toBe(true);
  expect(analysis.fixes.assetExtensions).toEqual(["lottie", "kml"]);
  expect(analysis.fixes.sourceExtensions).toEqual(["mdx"]);
  // Only the additions are surfaced, not the default `png`.
  expect(assetHint?.suggestion).toContain("lottie");
  expect(assetHint?.suggestion).toContain("kml");
  expect(assetHint?.suggestion).not.toContain("png");

  const sourceHint = analysis.hints.find((entry) => entry.source.endsWith("resolver.sourceExts"));
  expect(sourceHint?.vifxConfigKey).toBe("resolver.extensions");
  expect(sourceHint?.suggestion).toContain("mdx");
  expect(sourceHint?.suggestion).not.toContain("js");
});

test("maps extraNodeModules keys to alias hints", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      '  resolver: { extraNodeModules: { "@app/core": "../core", crypto: "crypto-browserify" } },',
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  const hint = analysis.hints.find((entry) => entry.source.endsWith("resolver.extraNodeModules"));
  expect(hint?.vifxConfigKey).toBe("vite.targets[].aliases");
  expect(hint?.suggestion).toContain("@app/core");
  expect(hint?.suggestion).toContain("crypto");
  expect(analysis.fixes.aliases).toEqual({ "@app/core": "../core", crypto: "crypto-browserify" });
});

test("an absolute extraNodeModules path becomes a project-relative alias", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      'const path = require("node:path");',
      "module.exports = {",
      '  resolver: { extraNodeModules: { shared: path.resolve(__dirname, "..", "shared"), local: path.join(__dirname, "src", "lib") } },',
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.fixes.aliases).toEqual({ local: "./src/lib", shared: "../shared" });
});

// A stand-in for expo/metro-config with the defaults that used to be reported as
// customizations: Expo's extra asset and CSS source extensions, its Babel
// transformer and its serializer.
const EXPO_METRO_CONFIG_STUB = [
  "exports.getDefaultConfig = (projectRoot) => ({",
  "  resolver: {",
  '    assetExts: ["png", "jpg", "ttf", "heic", "avif", "xml", "db"],',
  '    sourceExts: ["ts", "tsx", "js", "jsx", "json", "cjs", "mjs", "css", "scss", "sass"],',
  "  },",
  "  transformer: {",
  '    babelTransformerPath: projectRoot + "/node_modules/@expo/metro-config/build/babel-transformer.js",',
  "  },",
  "  serializer: {",
  "    customSerializer: function expoSerializer(entryPoint) { return String(entryPoint); },",
  "  },",
  "});",
  "",
].join("\n");

test("compares with expo/metro-config defaults, so Expo's own settings are not reported", async () => {
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js": EXPO_METRO_CONFIG_STUB,
    "metro.config.js": [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "const config = getDefaultConfig(__dirname);",
      'config.resolver.sourceExts.push("cjs");',
      'config.resolver.assetExts.push("lottie");',
      "config.resolver.useWatchman = false;",
      "config.transformer = { ...config.transformer, inlineRequires: true };",
      "module.exports = config;",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("evaluated");
  expect(analysis.baseline).toBe("expo");
  expect(analysis.unsupported).toEqual([]);
  expect(analysis.hints.map((hint) => hint.source)).toEqual(["metro.config.js:resolver.assetExts"]);
  expect(analysis.fixes).toEqual({
    aliases: {},
    assetExtensions: ["lottie"],
    sourceExtensions: [],
  });
});

test("flags a serializer the project replaced, and names Sentry's", async () => {
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js": EXPO_METRO_CONFIG_STUB,
    "metro.config.js": [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "const config = getDefaultConfig(__dirname);",
      "config.serializer.customSerializer = function sentrySerializer(entryPoint) {",
      '  return "//# debugId=" + String(entryPoint);',
      "};",
      "module.exports = config;",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.unsupported).toHaveLength(1);
  expect(analysis.unsupported[0]?.code).toBe("VIFX_UNSUPPORTED_METRO_SERIALIZER");
  expect(analysis.unsupported[0]?.suggestion).toContain("Sentry");
  expect(analysis.unsupported[0]?.suggestion).toContain("customSerializer");
});

test("flags getSentryExpoConfig, which keeps Expo's serializer function", async () => {
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js": EXPO_METRO_CONFIG_STUB,
    // Like Sentry's: Debug ID plugins go to Expo's getDefaultConfig as an option,
    // so the serializer function stays Expo's own.
    "node_modules/@sentry/react-native/metro.js": [
      'const { getDefaultConfig } = require("expo/metro-config");',
      "exports.getSentryExpoConfig = (projectRoot) =>",
      "  getDefaultConfig(projectRoot, { unstable_beforeAssetSerializationPlugins: [] });",
      "",
    ].join("\n"),
    "metro.config.js": [
      'const { getSentryExpoConfig } = require("@sentry/react-native/metro");',
      "module.exports = getSentryExpoConfig(__dirname);",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.baseline).toBe("expo");
  expect(analysis.hints).toEqual([]);
  expect(analysis.unsupported).toHaveLength(1);
  expect(analysis.unsupported[0]?.suggestion).toContain("Sentry");
});

// Like react-native-worklets': module ids and a polyfill for bundle mode.
const WORKLETS_BUNDLE_MODE_STUB = [
  "exports.getBundleModeMetroConfig = (config) => {",
  "  config.serializer.createModuleIdFactory = () => () => 0;",
  "  config.serializer.polyfillModuleNames = [",
  "    ...(config.serializer.polyfillModuleNames ?? []),",
  '    __dirname + "/polyfills/prepareBundleMode.js",',
  "  ];",
  "  return config;",
  "};",
  "",
].join("\n");

const SENTRY_EXPO_CONFIG_STUB = [
  'const { getDefaultConfig } = require("expo/metro-config");',
  "exports.getSentryExpoConfig = (projectRoot) =>",
  "  getDefaultConfig(projectRoot, { unstable_beforeAssetSerializationPlugins: [] });",
  "",
].join("\n");

test("evaluates a TypeScript config, and reports worklets bundle mode and Sentry apart", async () => {
  // Shaped like bluesky-social/social-app's: ES module syntax, type annotations,
  // import.meta.dirname, Sentry's Expo config wrapped in worklets bundle mode.
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js": EXPO_METRO_CONFIG_STUB,
    "node_modules/@sentry/react-native/metro.js": SENTRY_EXPO_CONFIG_STUB,
    "node_modules/react-native-worklets/bundleMode/index.js": WORKLETS_BUNDLE_MODE_STUB,
    "metro.config.ts": [
      "import { getBundleModeMetroConfig } from 'react-native-worklets/bundleMode/index.js';",
      "import { getSentryExpoConfig } from '@sentry/react-native/metro.js';",
      "",
      "type MetroConfig = { resolver: { assetExts: string[] } };",
      "const config: MetroConfig = getSentryExpoConfig(import.meta.dirname);",
      "config.resolver.assetExts = [...config.resolver.assetExts, 'lottie'];",
      "",
      "export default getBundleModeMetroConfig(config) as MetroConfig;",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.path).toBe("metro.config.ts");
  expect(analysis.extraction).toBe("evaluated");
  expect(analysis.baseline).toBe("expo");
  expect(analysis.fixes.assetExtensions).toEqual(["lottie"]);
  expect(analysis.hints.map((hint) => hint.source)).toEqual(["metro.config.ts:resolver.assetExts"]);
  expect(analysis.unsupported.map((feature) => feature.code)).toEqual([
    "VIFX_UNSUPPORTED_METRO_SERIALIZER",
    "VIFX_UNSUPPORTED_METRO_SERIALIZER",
  ]);
  expect(analysis.unsupported[0]?.suggestion).toContain("react-native-worklets bundle mode");
  expect(analysis.unsupported[0]?.suggestion).not.toContain("createModuleIdFactory");
  expect(analysis.unsupported[1]?.suggestion).toContain("Sentry");
});

test("worklets bundle mode leaves other serializer changes reported", async () => {
  const projectRoot = await createProject({
    "node_modules/expo/metro-config.js": EXPO_METRO_CONFIG_STUB,
    "node_modules/react-native-worklets/bundleMode/index.js": WORKLETS_BUNDLE_MODE_STUB,
    "metro.config.js": [
      'const { getDefaultConfig } = require("expo/metro-config");',
      'const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode");',
      "const config = getBundleModeMetroConfig(getDefaultConfig(__dirname));",
      "config.serializer.getModulesRunBeforeMainModule = () => [];",
      "module.exports = config;",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.unsupported).toHaveLength(2);
  expect(analysis.unsupported[0]?.suggestion).toContain("react-native-worklets bundle mode");
  expect(analysis.unsupported[1]?.suggestion).toContain("(getModulesRunBeforeMainModule)");
});

test(".cts and .mts configs are discovered", async () => {
  const ctsProject = await createProject({
    "metro.config.cts": [
      "const config: { resolver: { sourceExts: string[] } } = { resolver: { sourceExts: ['mdx'] } };",
      "module.exports = config;",
      "",
    ].join("\n"),
  });
  const mtsProject = await createProject({
    "metro.config.mts": [
      "const config: { resolver: { sourceExts: string[] } } = { resolver: { sourceExts: ['mdx'] } };",
      "export default config;",
      "",
    ].join("\n"),
  });

  for (const [projectRoot, filename] of [
    [ctsProject, "metro.config.cts"],
    [mtsProject, "metro.config.mts"],
  ] as const) {
    const analysis = await analyzeMetroConfig(projectRoot);
    expect(analysis.path).toBe(filename);
    expect(analysis.extraction).toBe("evaluated");
    expect(analysis.fixes.sourceExtensions).toEqual(["mdx"]);
  }
});

test("a broken TypeScript config falls back to the static scan, which names bundle mode", async () => {
  const projectRoot = await createProject({
    "metro.config.ts": [
      "import { getBundleModeMetroConfig } from 'react-native-worklets/bundleMode/index.js';",
      "export default getBundleModeMetroConfig({ resolver: { assetExts: [",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.path).toBe("metro.config.ts");
  expect(analysis.extraction).toBe("static");
  expect(analysis.unsupported).toHaveLength(1);
  expect(analysis.unsupported[0]?.suggestion).toContain("react-native-worklets bundle mode");
  expect(
    analysis.hints.some((entry) => entry.source === "metro.config.ts:resolver.assetExts"),
  ).toBe(true);
});

test("does not report the default Expo or React Native Babel transformer", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      '  transformer: { babelTransformerPath: "/app/node_modules/@expo/metro-config/build/babel-transformer.js" },',
      "};",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.hints).toEqual([]);
});

test("pruneAppliedFixes keeps only what vifx.config.ts does not have yet", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      '  resolver: { sourceExts: ["js", "mdx", "svg"], assetExts: ["lottie"], extraNodeModules: { shared: "../shared" } },',
      "};",
      "",
    ].join("\n"),
  });
  const analysis = await analyzeMetroConfig(projectRoot);

  const pruned = pruneAppliedFixes(analysis, {
    extensions: ["tsx", "ts", "jsx", "js", "json", "mdx"],
    assetExtensions: ["png", "lottie"],
    targetAliases: [{ shared: "../shared" }, undefined],
  });

  expect(pruned.fixes).toEqual({
    aliases: { shared: "../shared" },
    assetExtensions: [],
    sourceExtensions: ["svg"],
  });
  expect(pruned.hints.map((hint) => hint.source)).toEqual([
    "metro.config.js:resolver.sourceExts",
    "metro.config.js:resolver.extraNodeModules",
  ]);
  expect(pruned.hints[0]?.suggestion).toContain("svg");
  expect(pruned.hints[0]?.suggestion).not.toContain("mdx");
});

test("falls back to a conservative static scan when the config is unparseable", async () => {
  const projectRoot = await createProject({
    // Deliberately broken JS so evaluation throws and the static path is used.
    "metro.config.js": [
      "module.exports = {",
      "  resolver: {",
      "    assetExts: [", // unterminated array + missing braces
      "    resolveRequest: function (context) { return",
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.found).toBe(true);
  expect(analysis.extraction).toBe("static");

  // resolveRequest is now an actionable migration hint (supported via
  // vite.config.vifx.ts), even on the conservative static scan.
  expect(
    analysis.hints.some(
      (entry) => entry.source.endsWith("resolver.resolveRequest") && entry.severity === "action",
    ),
  ).toBe(true);
  expect(analysis.hints.some((entry) => entry.source.endsWith("resolver.assetExts"))).toBe(true);
});

test("ignores commented-out fields in the static fallback", async () => {
  const projectRoot = await createProject({
    "metro.config.js": [
      "module.exports = {",
      "  // resolveRequest: () => null,",
      "  /* serializer: { customSerializer() {} }, */",
      "  resolver: { sourceExts: [", // broken to force static mode
      "",
    ].join("\n"),
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.extraction).toBe("static");
  expect(analysis.unsupported).toHaveLength(0);
  expect(analysis.hints.some((entry) => entry.source.endsWith("resolver.sourceExts"))).toBe(true);
});

test(".cjs and .mjs configs are discovered", async () => {
  const cjsProject = await createProject({
    "metro.config.cjs": 'module.exports = { resolver: { sourceExts: ["mdx"] } };\n',
  });
  const mjsProject = await createProject({
    "metro.config.mjs": 'export default { resolver: { sourceExts: ["mdx"] } };\n',
  });

  const cjsAnalysis = await analyzeMetroConfig(cjsProject);
  const mjsAnalysis = await analyzeMetroConfig(mjsProject);

  expect(cjsAnalysis.found).toBe(true);
  expect(cjsAnalysis.path).toBe("metro.config.cjs");
  expect(cjsAnalysis.hints.some((entry) => entry.source.startsWith("metro.config.cjs:"))).toBe(
    true,
  );

  expect(mjsAnalysis.found).toBe(true);
  expect(mjsAnalysis.path).toBe("metro.config.mjs");
  expect(mjsAnalysis.hints.some((entry) => entry.source.startsWith("metro.config.mjs:"))).toBe(
    true,
  );
});

test("a broken .mjs config degrades to the static scan instead of throwing", async () => {
  const projectRoot = await createProject({
    "metro.config.mjs": "export default { resolver: { resolveRequest: (\n",
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  expect(analysis.found).toBe(true);
  expect(analysis.extraction).toBe("static");
  expect(
    analysis.hints.some(
      (entry) => entry.source.endsWith("resolver.resolveRequest") && entry.severity === "action",
    ),
  ).toBe(true);
});

test("a config exported as a factory function degrades to the static scan", async () => {
  const projectRoot = await createProject({
    "metro.config.js": "module.exports = function () { return { serializer: { x() {} } }; };\n",
  });

  const analysis = await analyzeMetroConfig(projectRoot);

  // A function is not a plain config object, so evaluation yields no object and
  // the static scan takes over (rather than crashing or returning empty).
  expect(analysis.found).toBe(true);
  expect(analysis.extraction).toBe("static");
});

test("re-analyzing the same config returns a stable result", async () => {
  const projectRoot = await createProject({
    "metro.config.js": 'module.exports = { resolver: { assetExts: ["png", "lottie"] } };\n',
  });

  const first = await analyzeMetroConfig(projectRoot);
  const second = await analyzeMetroConfig(projectRoot);

  expect(second.extraction).toBe("evaluated");
  expect(second.hints).toEqual(first.hints);
  expect(second.unsupported).toEqual(first.unsupported);
});
