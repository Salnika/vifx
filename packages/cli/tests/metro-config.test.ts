import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { analyzeMetroConfig } from "../src/lib/metro-config.ts";

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
    "https://vifx.dev/migration/metro#react-native-svg-transformer",
  );
  expect(hint?.vifxConfigKey).toBe("plugins");
});

test("flags a custom resolveRequest function as unsupported", async () => {
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
  expect(analysis.unsupported).toHaveLength(1);
  expect(analysis.unsupported[0]?.code).toBe("VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST");
  expect(analysis.unsupported[0]?.source).toBe("metro.config.js:resolver.resolveRequest");
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
  expect(assetHint?.vifxConfigKey).toBe("assetExtensions");
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
  expect(hint?.vifxConfigKey).toBe("aliases");
  expect(hint?.suggestion).toContain("@app/core");
  expect(hint?.suggestion).toContain("crypto");
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

  expect(
    analysis.unsupported.some((entry) => entry.code === "VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST"),
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
