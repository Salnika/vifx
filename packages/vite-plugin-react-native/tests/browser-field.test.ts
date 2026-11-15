import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "@voidzero-dev/vite-plus-core";
import { expect, test } from "vite-plus/test";
import { buildReactNativeBundle, reactNative } from "../src/index.ts";

// On iOS and Android, vifx resolves packages the way React Native's and Expo's
// Metro configs do: main fields `react-native`, `browser`, `main`, with the
// object form of those fields (file and module replacements, `false` for an
// empty module) applied too.

type HookFn = (...args: unknown[]) => unknown;

async function createProject(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-browser-field-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
  return projectRoot;
}

async function callResolveId(
  plugin: Plugin,
  source: string,
  importer: string,
): Promise<string | null> {
  const hook = plugin.resolveId as HookFn | { handler: HookFn };
  const handler = typeof hook === "function" ? hook : hook.handler;
  const result = await handler.call({}, source, importer, {});
  if (result === null || result === undefined) {
    return null;
  }
  return typeof result === "string" ? result : ((result as { id: string }).id ?? null);
}

/** Runs `run` with `console.warn` captured. */
async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

// qrcode 1.5's fields: `main` is its Node.js entry, `browser` swaps it.
const QRCODE_FILES = {
  "node_modules/qrcode/package.json": JSON.stringify({
    browser: { "./lib/index.js": "./lib/browser.js", fs: false },
    main: "./lib/index.js",
    name: "qrcode",
  }),
  "node_modules/qrcode/lib/browser.js":
    "exports.render = () => 'browser-entry-marker';\nrequire('fs');\n",
  "node_modules/qrcode/lib/index.js": "module.exports = require('./server');\n",
  "node_modules/qrcode/lib/server.js": [
    "const util = require('util');",
    "function PNG() {}",
    "util.inherits(PNG, Object);",
    "exports.render = () => 'node-entry-marker';",
    "",
  ].join("\n"),
};

test("a native build resolves a package's browser entry, as Metro does", async () => {
  const projectRoot = await createProject({ "index.js": "export {};\n", ...QRCODE_FILES });

  for (const platform of ["ios", "android"] as const) {
    const plugin = reactNative({ entry: "./index.js", platform, projectRoot }) as Plugin;
    expect(await callResolveId(plugin, "qrcode", path.join(projectRoot, "index.js"))).toBe(
      path.join(projectRoot, "node_modules/qrcode/lib/browser.js"),
    );
  }
});

test("a module a package maps to false is an empty module", async () => {
  const projectRoot = await createProject({ "index.js": "export {};\n", ...QRCODE_FILES });
  const plugin = reactNative({ entry: "./index.js", platform: "ios", projectRoot }) as Plugin;

  expect(
    await callResolveId(plugin, "fs", path.join(projectRoot, "node_modules/qrcode/lib/browser.js")),
  ).toBe("\0vifx:empty:module");
});

test("an installed polyfill answers for a Node.js built-in; a missing one is reported", async () => {
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "node_modules/png-thing/index.js": "require('util'); require('zlib');\n",
    "node_modules/png-thing/package.json": '{"name":"png-thing","main":"./index.js"}',
    "node_modules/util/package.json": '{"name":"util","main":"./util.js"}',
    "node_modules/util/util.js": "exports.inherits = () => {};\n",
  });
  const plugin = reactNative({ entry: "./index.js", platform: "ios", projectRoot }) as Plugin;
  const importer = path.join(projectRoot, "node_modules/png-thing/index.js");

  const warnings = await captureWarnings(async () => {
    // Like Metro: npm's `util` package, not an empty module.
    expect(await callResolveId(plugin, "util", importer)).toBe(
      path.join(projectRoot, "node_modules/util/util.js"),
    );
    // Not installed: left to Vite, which bundles an empty module, and reported once.
    expect(await callResolveId(plugin, "zlib", importer)).toBeNull();
    expect(await callResolveId(plugin, "zlib", importer)).toBeNull();
  });

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('"zlib", imported by "node_modules/png-thing/index.js"');
  expect(warnings[0]).toContain("Metro does not resolve it on iOS and Android");
});

test("end-to-end: the release bundle carries qrcode's browser entry, not its Node.js one", async () => {
  const projectRoot = await createProject({
    "index.js": [
      'import { render } from "qrcode";',
      "globalThis.__qrcodeResult = render();",
      "",
    ].join("\n"),
    ...QRCODE_FILES,
  });

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    mode: "production",
    outDir: ".vifx/browser-field-e2e",
    platform: "ios",
    projectRoot,
  });

  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  expect(bundleSource).toContain("browser-entry-marker");
  expect(bundleSource).not.toContain("node-entry-marker");
});
