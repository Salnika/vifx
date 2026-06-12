import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "vite";
import { expect, test } from "vite-plus/test";
import { VifxError } from "@vifx/errors";
import { transformDynamicImport } from "../src/dynamic/dynamic-import.ts";
import { transformRequireContext } from "../src/dynamic/require-context.ts";
import { buildReactNativeBundle, reactNative } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-dynamic-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

async function writePagesFixture(projectRoot: string) {
  await mkdir(path.join(projectRoot, "pages", "nested"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "pages", "home.ts"),
    ['export const name = "home";', ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "pages", "about.tsx"),
    ['export const name = "about";', ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "pages", "nested", "deep.ts"),
    ['export const name = "deep";', ""].join("\n"),
  );
  await writeFile(path.join(projectRoot, "pages", "notes.md"), "# not a module\n");
  await writeFile(
    path.join(projectRoot, "pages", "data.json"),
    JSON.stringify({ hello: "world" }, null, 2),
  );
}

async function buildIifeBundle(projectRoot: string, outDir: string) {
  await build({
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: path.join(projectRoot, "index.js"),
        output: {
          entryFileNames: "index.bundle",
          format: "iife",
        },
      },
      sourcemap: false,
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

  return await readFile(path.join(projectRoot, outDir, "index.bundle"), "utf8");
}

function evalBundle(bundleSource: string) {
  const sandbox: Record<string, unknown> = { console };
  vm.createContext(sandbox);
  vm.runInContext(bundleSource, sandbox, { filename: "index.bundle" });
  return sandbox;
}

test("require.context enumerates nested project files with a regex filter", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writePagesFixture(projectRoot);
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'const pagesContext = require.context("./pages", true, /\\.(ts|tsx)$/u);',
      "",
      "let missingErrorCode = null;",
      "try {",
      '  pagesContext("./missing.ts");',
      "} catch (error) {",
      "  missingErrorCode = error.code;",
      "}",
      "",
      "globalThis.__vifxContext = {",
      '  home: pagesContext("./home.ts"),',
      "  id: pagesContext.id,",
      "  keys: pagesContext.keys(),",
      "  missingErrorCode,",
      '  resolved: pagesContext.resolve("./nested/deep.ts"),',
      "};",
      "",
    ].join("\n"),
  );

  const bundleSource = await buildIifeBundle(projectRoot, ".vifx/dynamic-context");
  const sandbox = evalBundle(bundleSource);
  const captured = sandbox.__vifxContext as {
    home: { name: string };
    id: string;
    keys: string[];
    missingErrorCode: string | null;
    resolved: string;
  };

  expect(captured.keys).toEqual(["./about.tsx", "./home.ts", "./nested/deep.ts"]);
  expect(captured.home.name).toBe("home");
  expect(captured.resolved).toBe("./nested/deep.ts");
  expect(captured.id).toContain("vifx-require-context:pages");
  expect(captured.missingErrorCode).toBe("MODULE_NOT_FOUND");
});

test("require.context respects recursive: false", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writePagesFixture(projectRoot);
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'const pagesContext = require.context("./pages", false, /\\.ts$/u);',
      "globalThis.__vifxContext = { keys: pagesContext.keys() };",
      "",
    ].join("\n"),
  );

  const bundleSource = await buildIifeBundle(projectRoot, ".vifx/dynamic-context-flat");
  const sandbox = evalBundle(bundleSource);
  const captured = sandbox.__vifxContext as { keys: string[] };

  expect(captured.keys).toEqual(["./home.ts"]);
});

test("require.context loads JSON modules", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writePagesFixture(projectRoot);
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'const dataContext = require.context("./pages", true, /\\.json$/u);',
      "globalThis.__vifxContext = {",
      '  data: dataContext("./data.json"),',
      "  keys: dataContext.keys(),",
      "};",
      "",
    ].join("\n"),
  );

  const bundleSource = await buildIifeBundle(projectRoot, ".vifx/dynamic-context-json");
  const sandbox = evalBundle(bundleSource);
  const captured = sandbox.__vifxContext as {
    data: { default: { hello: string } };
    keys: string[];
  };

  expect(captured.keys).toEqual(["./data.json"]);
  expect(captured.data.default.hello).toBe("world");
});

test("literal import() emits a single native bundle and resolves in a VM", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");
  const dependencyRoot = path.join(projectRoot, "node_modules", "lazy-dep");

  await mkdir(dependencyRoot, { recursive: true });
  await writeFile(
    path.join(dependencyRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "lazy-dep" }, null, 2),
  );
  await writeFile(
    path.join(dependencyRoot, "index.js"),
    ['export const marker = "lazy dep loaded";', ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "detail.js"),
    [
      'export const value = "detail value";',
      'export default { kind: "detail" };',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'globalThis.__vifxImport = import("./detail.js");',
      'globalThis.__vifxDepImport = import("lazy-dep");',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/dynamic-import",
    platform: "ios",
    projectRoot,
  });
  const outDirEntries = await readdir(path.join(projectRoot, ".vifx/dynamic-import"));
  const bundleFiles = outDirEntries.filter((entry) => entry.endsWith(".bundle"));
  const nativeBundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleFiles).toEqual(["index.bundle"]);
  expect(outDirEntries).not.toContain("chunks");
  expect(nativeBundleSource).toContain("Promise.resolve().then");
  expect(nativeBundleSource).not.toContain('import("./detail.js")');
  expect(nativeBundleSource).not.toContain('import("lazy-dep")');

  const iifeBundleSource = await buildIifeBundle(projectRoot, ".vifx/dynamic-import-vm");
  const sandbox = evalBundle(iifeBundleSource);
  const detailModule = (await sandbox.__vifxImport) as {
    default: { kind: string };
    value: string;
  };
  const dependencyModule = (await sandbox.__vifxDepImport) as { marker: string };

  expect(detailModule.value).toBe("detail value");
  expect(detailModule.default.kind).toBe("detail");
  expect(dependencyModule.marker).toBe("lazy dep loaded");
});

test("non-literal import() rejects native builds with file and location details", async () => {
  const projectRoot = await copyFixture("rn-bare-basic");

  await writeFile(
    path.join(projectRoot, "detail.js"),
    ['export const value = "detail value";', ""].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    ['const target = "./detail.js";', "globalThis.__vifxImport = import(target);", ""].join("\n"),
  );

  await expect(
    buildReactNativeBundle({
      entry: "./index.js",
      outDir: ".vifx/dynamic-import-error",
      platform: "ios",
      projectRoot,
    }),
  ).rejects.toThrow(/import\(\.\.\.\) expression in ".*index\.js" \(line 2, column 34\)/u);
});

test("web builds keep dynamic import() expressions untouched", () => {
  const result = transformDynamicImport({
    code: 'const lazyModule = import("./detail.js");\n',
    filePath: "/project/index.js",
    resolvePlatform: "web",
  });

  expect(result).toBeNull();
});

test("transformDynamicImport rewrites literal import() into a lazy require", () => {
  const result = transformDynamicImport({
    code: 'const lazyModule = import("./detail.js");\n',
    filePath: "/project/index.js",
    resolvePlatform: "ios",
  });

  expect(result?.code).toBe(
    'const lazyModule = Promise.resolve().then(() => { const requiredModule = require("./detail.js"); return requiredModule; });\n',
  );
});

test("transformDynamicImport reports non-literal specifiers with their location", () => {
  let caught: unknown;
  try {
    transformDynamicImport({
      code: ['const name = "./detail.js";', "const promise = import(name);", ""].join("\n"),
      filePath: "/project/src/lazy.js",
      resolvePlatform: "ios",
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(VifxError);
  const vifxError = caught as VifxError;
  expect(vifxError.code).toBe("VIFX_DYNAMIC_IMPORT_NOT_STATIC");
  expect(vifxError.details).toEqual({ column: 24, file: "/project/src/lazy.js", line: 2 });
  expect(vifxError.message).toContain("/project/src/lazy.js");
});

test("transformRequireContext ignores files outside the project source tree", () => {
  const insideNodeModules = transformRequireContext({
    code: 'const ctx = require.context("./pages", true, /\\.ts$/u);\n',
    filePath: "/project/node_modules/some-dep/index.js",
    projectRoot: "/project",
  });
  const outsideProject = transformRequireContext({
    code: 'const ctx = require.context("./pages", true, /\\.ts$/u);\n',
    filePath: "/elsewhere/index.js",
    projectRoot: "/project",
  });

  expect(insideNodeModules).toBeNull();
  expect(outsideProject).toBeNull();
});

test("transformRequireContext reports non-literal arguments with their location", () => {
  let caught: unknown;
  try {
    transformRequireContext({
      code: ['const dir = "./pages";', "const ctx = require.context(dir);", ""].join("\n"),
      filePath: "/project/index.js",
      projectRoot: "/project",
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(VifxError);
  const vifxError = caught as VifxError;
  expect(vifxError.code).toBe("VIFX_DYNAMIC_CONTEXT_NOT_STATIC");
  expect(vifxError.details).toEqual({ column: 29, file: "/project/index.js", line: 2 });
});

test("transformRequireContext rejects unsupported context modes", () => {
  let caught: unknown;
  try {
    transformRequireContext({
      code: 'const ctx = require.context("./pages", true, /\\.ts$/u, "lazy");\n',
      filePath: "/project/index.js",
      projectRoot: "/project",
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(VifxError);
  const vifxError = caught as VifxError;
  expect(vifxError.code).toBe("VIFX_DYNAMIC_CONTEXT_MODE_UNSUPPORTED");
  expect(vifxError.message).toContain('"lazy"');
  expect(vifxError.details).toEqual({ column: 56, file: "/project/index.js", line: 1 });
});
