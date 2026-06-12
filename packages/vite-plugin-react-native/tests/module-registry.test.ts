import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { SourceMap, type SourceMapPayload } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import {
  MODULE_REGISTRY_PRELUDE,
  buildModuleRegistryBundle,
  buildReactNativeBundle,
  reactNative,
} from "../src/index.ts";

const BUILD_TIMEOUT = 120_000;

interface RegisteredApp {
  name: string;
  provider: () => unknown;
}

interface BundleEvaluation {
  order: string[];
  registered: RegisteredApp[];
}

/**
 * Evaluates a module-registry bundle the way Hermes would: as a plain script
 * (`vm.Script` rejects import/export statements, `import.meta`, and top-level
 * await outright), with the global shims the synthetic fixtures expect.
 */
function evaluateBundle(code: string): BundleEvaluation {
  const order: string[] = [];
  const registered: RegisteredApp[] = [];
  const context = vm.createContext({
    __order: order,
    __registry: {
      register(name: string, provider: () => unknown) {
        registered.push({ name, provider });
      },
    },
    console,
  });
  new vm.Script(code, { filename: "index.bundle" }).runInContext(context, { timeout: 10_000 });
  return { order, registered };
}

function callRegisteredProvider(evaluation: BundleEvaluation): Record<string, unknown> {
  const first = evaluation.registered[0];
  if (!first) {
    throw new Error("Expected the bundle to register an application provider.");
  }
  return first.provider() as Record<string, unknown>;
}

async function createSyntheticProject(name: string, files: Record<string, string>) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), `vifx-${name}-`));
  const allFiles: Record<string, string> = {
    "package.json": `${JSON.stringify({ name, private: true, version: "1.0.0" }, null, 2)}\n`,
    ...files,
  };
  for (const [relativePath, content] of Object.entries(allFiles)) {
    const filePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
  return projectRoot;
}

/**
 * An expo-basic-like synthetic app covering the module-registry feature set:
 * registration order side effects, a dependency cycle, a CommonJS default
 * import, a JSON module, an AppRegistry-style registration from the entry,
 * and fake `react-native` / `@react-native/js-polyfills` packages so the
 * InitializeCore-and-polyfills-first ordering is observable.
 */
const RICH_FIXTURE_FILES: Record<string, string> = {
  "index.js": [
    'import "./order/side-a.js";',
    'import { cycleA } from "./cycle/a.js";',
    'import greet from "cjs-dep";',
    'import data from "./data.json";',
    'import { registerApp } from "./registry.js";',
    "",
    'globalThis.__order.push("entry");',
    'registerApp("main", () => ({',
    "  answer: data.answer,",
    "  cycle: cycleA(),",
    "  greeting: greet(),",
    "}));",
    "",
  ].join("\n"),
  "order/side-a.js": ['import "./side-b.js";', 'globalThis.__order.push("side-a");', ""].join(
    "\n",
  ),
  "order/side-b.js": ['globalThis.__order.push("side-b");', ""].join("\n"),
  "cycle/a.js": [
    'import { bValue, readAValue } from "./b.js";',
    'export const aValue = "a";',
    "export function cycleA() {",
    '  return bValue + ":" + readAValue();',
    "}",
    "",
  ].join("\n"),
  "cycle/b.js": [
    'import { aValue } from "./a.js";',
    'export const bValue = "b";',
    "export function readAValue() {",
    "  return aValue;",
    "}",
    "",
  ].join("\n"),
  "registry.js": [
    "export function registerApp(name, provider) {",
    "  globalThis.__registry.register(name, provider);",
    "}",
    "",
  ].join("\n"),
  "data.json": '{ "answer": 42 }\n',
  "node_modules/cjs-dep/package.json": '{ "name": "cjs-dep", "main": "index.js" }\n',
  "node_modules/cjs-dep/index.js":
    'module.exports = function greet() { return "hello-from-cjs"; };\n',
  "node_modules/@react-native/js-polyfills/package.json":
    '{ "name": "@react-native/js-polyfills", "version": "1.0.0" }\n',
  "node_modules/@react-native/js-polyfills/error-guard.js":
    'globalThis.__order.push("error-guard");\n',
  "node_modules/react-native/package.json":
    '{ "name": "react-native", "version": "1.0.0", "main": "index.js" }\n',
  "node_modules/react-native/index.js": "module.exports = {};\n",
  "node_modules/react-native/Libraries/Core/InitializeCore.js":
    'globalThis.__order.push("initialize-core");\n',
};

const TINY_FIXTURE_FILES: Record<string, string> = {
  "index.js": [
    'import { tag } from "./util.js";',
    'globalThis.__order.push("tiny-entry:" + tag);',
    "",
  ].join("\n"),
  "util.js": ['export const tag = "u";', 'globalThis.__order.push("util");', ""].join("\n"),
};

interface RichFixture {
  bundleCode: string;
  mapText: string;
  projectRoot: string;
  result: Awaited<ReturnType<typeof buildReactNativeBundle>>;
}

let richFixturePromise: Promise<RichFixture> | undefined;

function getRichFixture(): Promise<RichFixture> {
  richFixturePromise ??= (async () => {
    const projectRoot = await createSyntheticProject("metro-rich", RICH_FIXTURE_FILES);
    const result = await buildReactNativeBundle({
      entry: "./index.js",
      moduleFormat: "metro",
      outDir: ".vifx/metro-ios",
      platform: "ios",
      projectRoot,
    });
    const bundlePath = path.join(projectRoot, result.bundle.path);
    return {
      bundleCode: await readFile(bundlePath, "utf8"),
      mapText: await readFile(`${bundlePath}.map`, "utf8"),
      projectRoot,
      result,
    };
  })();
  return richFixturePromise;
}

test(
  "metro bundle runs polyfills and InitializeCore first and the entry last",
  async () => {
    const fixture = await getRichFixture();
    const evaluation = evaluateBundle(fixture.bundleCode);

    expect(evaluation.order).toEqual([
      "error-guard",
      "initialize-core",
      "side-b",
      "side-a",
      "entry",
    ]);

    expect(fixture.bundleCode.startsWith(MODULE_REGISTRY_PRELUDE)).toBe(true);

    const trailingRequire = fixture.bundleCode.match(
      /__r\((\d+)\);\n\/\/# sourceMappingURL=index\.bundle\.map\n$/,
    );
    expect(trailingRequire).not.toBeNull();
    const entryModuleId = trailingRequire?.[1];
    expect(entryModuleId).toBeDefined();

    const registrationFooters = [
      ...fixture.bundleCode.matchAll(/^\}, (\d+), \[[^\]]*\]\); \/\/ (.+)$/gm),
    ];
    expect(registrationFooters.length).toBeGreaterThanOrEqual(10);
    const lastRegistration = registrationFooters[registrationFooters.length - 1];
    expect(lastRegistration?.[1]).toBe(entryModuleId);

    const registeredFileNames = registrationFooters.map((footer) => footer[2] ?? "");
    const positionOf = (suffix: string) =>
      registeredFileNames.findIndex((fileName) => fileName.endsWith(suffix));
    expect(positionOf("order/side-b.js")).toBeGreaterThanOrEqual(0);
    expect(positionOf("order/side-b.js")).toBeLessThan(positionOf("order/side-a.js"));
    expect(positionOf("order/side-a.js")).toBeLessThan(positionOf("index.js"));
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle resolves dependency cycles with partially-initialized exports",
  async () => {
    const fixture = await getRichFixture();
    const provided = callRegisteredProvider(evaluateBundle(fixture.bundleCode));

    expect(provided["cycle"]).toBe("b:a");
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle supports default-import interop with a CommonJS dependency",
  async () => {
    const fixture = await getRichFixture();
    const provided = callRegisteredProvider(evaluateBundle(fixture.bundleCode));

    expect(provided["greeting"]).toBe("hello-from-cjs");
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle includes JSON modules",
  async () => {
    const fixture = await getRichFixture();
    const provided = callRegisteredProvider(evaluateBundle(fixture.bundleCode));

    expect(provided["answer"]).toBe(42);
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle invokes an AppRegistry-style mock from the entry",
  async () => {
    const fixture = await getRichFixture();
    const evaluation = evaluateBundle(fixture.bundleCode);

    expect(evaluation.registered).toHaveLength(1);
    expect(evaluation.registered[0]?.name).toBe("main");
    expect(typeof evaluation.registered[0]?.provider).toBe("function");
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle is a plain script without ESM tokens",
  async () => {
    const fixture = await getRichFixture();

    expect(() => new vm.Script(fixture.bundleCode, { filename: "index.bundle" })).not.toThrow();
    expect(fixture.bundleCode).not.toContain("import.meta");
    expect(fixture.bundleCode).not.toContain("import(");
    expect(/^\s*import\s/m.test(fixture.bundleCode)).toBe(false);
    expect(/^\s*export\s/m.test(fixture.bundleCode)).toBe(false);
  },
  BUILD_TIMEOUT,
);

test(
  "metro bundle composes a flat source map preserving per-module sources",
  async () => {
    const fixture = await getRichFixture();

    expect(fixture.result.sourceMap?.valid).toBe(true);
    expect(fixture.result.sourceMap?.sourceCount).toBeGreaterThanOrEqual(5);

    const map = JSON.parse(fixture.mapText) as {
      file: string;
      mappings: string;
      names: string[];
      sources: string[];
      sourcesContent: (string | null)[];
      version: number;
    };
    expect(map.version).toBe(3);
    expect(map.file).toBe("index.bundle");
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sources.some((source) => source.endsWith("cycle/a.js"))).toBe(true);
    expect(map.sources.some((source) => source.endsWith("order/side-b.js"))).toBe(true);
    expect(map.sourcesContent.join("\n")).toContain('registerApp("main"');

    const bundleLines = fixture.bundleCode.split("\n");
    const generatedLine = bundleLines.findIndex((line) => line.includes("function readAValue("));
    expect(generatedLine).toBeGreaterThanOrEqual(0);
    const generatedColumn = bundleLines[generatedLine]?.indexOf("function") ?? 0;
    const entry = new SourceMap(map as unknown as SourceMapPayload).findEntry(
      generatedLine,
      generatedColumn,
    );
    expect(entry.originalSource?.endsWith("cycle/b.js")).toBe(true);
    expect(entry.originalLine).toBe(2);
  },
  BUILD_TIMEOUT,
);

test(
  "default hoisted output is unchanged compared to a build without the option",
  async () => {
    const projectRoot = await createSyntheticProject("metro-tiny", TINY_FIXTURE_FILES);

    const withoutOption = await buildReactNativeBundle({
      entry: "./index.js",
      outDir: ".vifx/dflt",
      platform: "ios",
      projectRoot,
    });
    const withHoisted = await buildReactNativeBundle({
      entry: "./index.js",
      moduleFormat: "hoisted",
      outDir: ".vifx/hstd",
      platform: "ios",
      projectRoot,
    });

    const withoutOptionBundle = await readFile(
      path.join(projectRoot, withoutOption.bundle.path),
      "utf8",
    );
    const withHoistedBundle = await readFile(
      path.join(projectRoot, withHoisted.bundle.path),
      "utf8",
    );
    expect(withHoistedBundle).toBe(withoutOptionBundle);
    expect(withHoistedBundle).not.toContain("__d(");

    const withoutOptionMap = await readFile(
      path.join(projectRoot, `${withoutOption.bundle.path}.map`),
      "utf8",
    );
    const withHoistedMap = await readFile(
      path.join(projectRoot, `${withHoisted.bundle.path}.map`),
      "utf8",
    );
    expect(withHoistedMap).toBe(withoutOptionMap);
  },
  BUILD_TIMEOUT,
);

test(
  "buildModuleRegistryBundle warns and skips InitializeCore when it is not resolvable",
  async () => {
    const projectRoot = await createSyntheticProject("metro-no-core", TINY_FIXTURE_FILES);
    const warnings: string[] = [];

    const registry = await buildModuleRegistryBundle({
      absoluteOutDir: path.join(projectRoot, ".vifx/metro-direct"),
      entry: "./index.js",
      onWarn: (message) => warnings.push(message),
      plugins: [reactNative({ entry: "./index.js", platform: "ios", projectRoot })],
      projectRoot,
    });

    expect(registry.plan.includesInitializeCore).toBe(false);
    expect(registry.plan.polyfillSpecifiers).toEqual([]);
    expect(warnings.some((warning) => warning.includes("InitializeCore"))).toBe(true);
    expect(registry.plan.warnings).toEqual(warnings);
    expect(registry.moduleCount).toBeGreaterThan(0);

    const evaluation = evaluateBundle(await readFile(registry.bundlePath, "utf8"));
    expect(evaluation.order).toEqual(["util", "tiny-entry:u"]);
  },
  BUILD_TIMEOUT,
);

test("module-registry prelude implements importDefault/importAll interop and cycle partials", () => {
  const context = vm.createContext({});
  vm.runInContext(MODULE_REGISTRY_PRELUDE, context, { filename: "prelude.js" });
  vm.runInContext(
    [
      "__d(function (global, require, importDefault, importAll, module, exports) {",
      '  module.exports = function greet() { return "cjs"; };',
      "}, 0, []);",
      "__d(function (global, require, importDefault, importAll, module, exports) {",
      "  exports.__esModule = true;",
      '  exports.default = "esm-default";',
      '  exports.named = "esm-named";',
      "}, 1, []);",
      "__d(function (global, require, importDefault, importAll, module, exports) {",
      '  exports.early = "early";',
      "  var partner = require(3);",
      "  exports.fromPartner = partner.sawEarly;",
      "}, 2, [3]);",
      "__d(function (global, require, importDefault, importAll, module, exports) {",
      "  var partial = require(2);",
      "  exports.sawEarly = partial.early;",
      "}, 3, [2]);",
    ].join("\n"),
    context,
    { filename: "modules.js" },
  );

  const snapshot = vm.runInContext(
    [
      "({",
      "  cjsAllDefaultIsExports: __r.importAll(0).default === __r(0),",
      "  cjsDefault: __r.importDefault(0)(),",
      "  cycleSawPartial: __r(2).fromPartner,",
      "  esmAllNamed: __r.importAll(1).named,",
      "  esmDefault: __r.importDefault(1),",
      "})",
    ].join("\n"),
    context,
  ) as Record<string, unknown>;

  expect(snapshot["cjsDefault"]).toBe("cjs");
  expect(snapshot["cjsAllDefaultIsExports"]).toBe(true);
  expect(snapshot["esmDefault"]).toBe("esm-default");
  expect(snapshot["esmAllNamed"]).toBe("esm-named");
  expect(snapshot["cycleSawPartial"]).toBe("early");

  expect(() => vm.runInContext("__r(99)", context)).toThrow(/unknown module/i);
});
