import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
  clearProjectRequireChainCache,
  resolveFromProject,
  resolveProjectImportSpecifier,
  resolveReactNativeModule,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("resolves relative imports with platform and native fallbacks", async () => {
  const projectRoot = await createTempProject();
  const sourceDirectory = path.join(projectRoot, "src");

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
    "src/Button.native.tsx": "export const Button = 'native';",
    "src/Button.tsx": "export const Button = 'base';",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(sourceDirectory, "App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "./Button",
  });

  expect(result.filePath).toBe(path.join(sourceDirectory, "Button.native.tsx"));
  expect(result.resolvedVia).toBe("relative");
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidate: path.join(sourceDirectory, "Button.ios.tsx"),
        exists: false,
      }),
      expect.objectContaining({
        candidate: path.join(sourceDirectory, "Button.native.tsx"),
        exists: true,
        type: "resolved",
      }),
    ]),
  );
});

test("rejects case-ambiguous platform candidates", async () => {
  const projectRoot = await createTempProject();
  const sourceDirectory = path.join(projectRoot, "src");

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
    "src/Button.ios.tsx": "export const Button = 'ios';",
    "src/button.ios.tsx": "export const Button = 'lower-ios';",
  });

  if ((await readFile(path.join(sourceDirectory, "Button.ios.tsx"), "utf8")).includes("lower")) {
    return;
  }

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(sourceDirectory, "App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "./Button",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE",
    details: {
      filePaths: [
        path.join(sourceDirectory, "Button.ios.tsx"),
        path.join(sourceDirectory, "button.ios.tsx"),
      ],
    },
  });
});

test("resolves bare packages through exports with react-native conditions", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/fancy-button/package.json": JSON.stringify(
      {
        exports: {
          ".": {
            "react-native": "./src/index.native",
            default: "./src/index.js",
          },
        },
        name: "fancy-button",
      },
      null,
      2,
    ),
    "node_modules/fancy-button/src/index.native.tsx": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "android",
    projectRoot,
    specifier: "fancy-button",
  });

  expect(result.filePath).toBe(
    path.join(projectRoot, "node_modules/fancy-button/src/index.native.tsx"),
  );
  expect(result.packageName).toBe("fancy-button");
  expect(result.packageRoot).toBe(path.join(projectRoot, "node_modules/fancy-button"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Matched package export condition "react-native"'),
        type: "condition",
      }),
    ]),
  );
});

test("resolves legacy react-native package fields when exports are absent", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/legacy-button/package.json": JSON.stringify(
      {
        main: "./dist/index.js",
        name: "legacy-button",
        "react-native": "./src/native-entry",
      },
      null,
      2,
    ),
    "node_modules/legacy-button/src/native-entry.ts": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "legacy-button",
  });

  expect(result.filePath).toBe(
    path.join(projectRoot, "node_modules/legacy-button/src/native-entry.ts"),
  );
  expect(result.packageName).toBe("legacy-button");
});

test("respects configured package main field order", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/ordered-button/dist/index.ts": "export const mode = 'module';",
    "node_modules/ordered-button/package.json": JSON.stringify(
      {
        main: "./src/main",
        module: "./dist/index",
        name: "ordered-button",
        "react-native": "./src/native",
      },
      null,
      2,
    ),
    "node_modules/ordered-button/src/main.ts": "export const mode = 'main';",
    "node_modules/ordered-button/src/native.ts": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    mainFields: ["module", "react-native", "main"],
    platform: "ios",
    projectRoot,
    specifier: "ordered-button",
  });

  expect(result.filePath).toBe(path.join(projectRoot, "node_modules/ordered-button/dist/index.ts"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: 'Matched package main field "module".',
      }),
    ]),
  );
});

test("rejects malformed package specifiers with structured diagnostics", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
  });

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(projectRoot, "src/App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "@scope",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_INVALID_SPECIFIER",
    details: {
      specifier: "@scope",
    },
    name: "VifxError",
  });
});

test("rejects invalid package manifests with structured diagnostics", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/broken-package/package.json": "{",
    "src/App.tsx": "export {};",
  });

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(projectRoot, "src/App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "broken-package",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
    details: {
      packageJsonPath: path.join(projectRoot, "node_modules/broken-package/package.json"),
    },
    name: "VifxError",
  });
});

test("resolves workspace packages without a node_modules install", async () => {
  const workspaceRoot = await createTempProject();
  const projectRoot = path.join(workspaceRoot, "apps/mobile");

  await writeFiles(workspaceRoot, {
    "apps/mobile/package.json": JSON.stringify(
      {
        name: "mobile",
      },
      null,
      2,
    ),
    "apps/mobile/src/App.tsx": "export {};",
    "packages/ui/package.json": JSON.stringify(
      {
        name: "@acme/ui",
        "react-native": "./src/index",
      },
      null,
      2,
    ),
    "packages/ui/src/index.native.tsx": "export const mode = 'workspace-native';",
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "@acme/ui",
  });

  expect(result.filePath).toBe(path.join(workspaceRoot, "packages/ui/src/index.native.tsx"));
  expect(result.packageRoot).toBe(path.join(workspaceRoot, "packages/ui"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidate: path.join(workspaceRoot, "pnpm-workspace.yaml"),
        exists: true,
        type: "workspace",
      }),
      expect.objectContaining({
        candidate: path.join(workspaceRoot, "packages/ui"),
        exists: true,
        type: "workspace",
      }),
    ]),
  );
});

/**
 * Lays out an isolated (pnpm-style) install: `node_modules/<name>` is a symlink
 * into a virtual store where each package sits next to its own dependencies.
 */
async function linkStorePackage(projectRoot: string, storeEntry: string, packageName: string) {
  const linkPath = path.join(projectRoot, "node_modules", packageName);
  await ensureParentDirectory(linkPath);
  await symlink(
    path.join(projectRoot, "node_modules/.store", storeEntry, "node_modules", packageName),
    linkPath,
    "dir",
  );
}

test("resolves a symlinked package's dependencies from its real location", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    // `host` and its dependency live side by side in the virtual store...
    "node_modules/.store/host@1/node_modules/host/package.json":
      '{"name":"host","main":"index.js"}',
    "node_modules/.store/host@1/node_modules/host/index.js": "export {};",
    "node_modules/.store/host@1/node_modules/dep/package.json": '{"name":"dep","main":"v1.js"}',
    "node_modules/.store/host@1/node_modules/dep/v1.js": "export const version = 1;",
    "node_modules/.store/host@1/node_modules/inner/package.json":
      '{"name":"inner","main":"index.js"}',
    "node_modules/.store/host@1/node_modules/inner/index.js": "export {};",
    // ...while the project root carries a DIFFERENT version of `dep`.
    "node_modules/dep/package.json": '{"name":"dep","main":"v2.js"}',
    "node_modules/dep/v2.js": "export const version = 2;",
  });
  await linkStorePackage(projectRoot, "host@1", "host");

  const hostEntry = path.join(projectRoot, "node_modules/host/index.js");
  const storeModules = path.join(projectRoot, "node_modules/.store/host@1/node_modules");

  // One identity per file: the package entry is the same module whether it is
  // reached through the project's symlink or by its real location.
  const viaSymlink = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "index.js"),
    platform: "ios",
    projectRoot,
    specifier: "host",
  });
  const viaRealPath = await resolveReactNativeModule({
    fromFile: path.join(storeModules, "inner/index.js"),
    platform: "ios",
    projectRoot,
    specifier: "host",
  });
  expect(viaSymlink.filePath).toBe(path.join(storeModules, "host/index.js"));
  expect(viaRealPath.filePath).toBe(viaSymlink.filePath);

  // Only reachable next to the real directory: not at the project root.
  const inner = await resolveReactNativeModule({
    fromFile: hostEntry,
    platform: "ios",
    projectRoot,
    specifier: "inner",
  });
  expect(inner.filePath).toBe(path.join(storeModules, "inner/index.js"));

  // The sibling wins over the same-named package at the project root.
  const dep = await resolveReactNativeModule({
    fromFile: hostEntry,
    platform: "ios",
    projectRoot,
    specifier: "dep",
  });
  expect(dep.filePath).toBe(path.join(storeModules, "dep/v1.js"));

  // The project itself still gets its own version.
  const rootDep = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "index.js"),
    platform: "ios",
    projectRoot,
    specifier: "dep",
  });
  expect(rootDep.filePath).toBe(path.join(projectRoot, "node_modules/dep/v2.js"));
});

test("resolves an exports target whose extension is outside the configured list", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/dual/package.json": JSON.stringify({
      exports: { ".": { default: "./lib/index.js", import: "./esm.mjs" } },
      main: "./lib/index.js",
      name: "dual",
    }),
    "node_modules/dual/esm.mjs": "export default 1;",
    "node_modules/dual/lib/index.js": "module.exports = 1;",
  });

  const result = await resolveReactNativeModule({
    conditions: ["react-native", "import", "default"],
    fromFile: path.join(projectRoot, "index.js"),
    platform: "ios",
    projectRoot,
    specifier: "dual",
  });

  // `.mjs` is not a configured source extension, but the target names a real file.
  expect(result.filePath).toBe(path.join(projectRoot, "node_modules/dual/esm.mjs"));
});

test("resolves a subpath directory through its own package.json", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/counter/package.json": '{"name":"counter","main":"lib/cjs/index.js"}',
    "node_modules/counter/lib/cjs/index.js": "module.exports = {};",
    "node_modules/counter/lib/cjs/presets/decimal.js": "module.exports = 'cjs';",
    "node_modules/counter/lib/es/presets/decimal.js": "export default 'es';",
    // No `exports` map: the subpath is a directory that declares its own entry.
    "node_modules/counter/presets/decimal/package.json": JSON.stringify({
      main: "../../lib/cjs/presets/decimal.js",
      "react-native": "../../lib/es/presets/decimal.js",
    }),
  });

  const resolve = (mainFields: string[]) =>
    resolveReactNativeModule({
      fromFile: path.join(projectRoot, "index.js"),
      mainFields,
      platform: "ios",
      projectRoot,
      specifier: "counter/presets/decimal",
    });

  // The nested package.json is read with the same main-field order as a package root.
  expect((await resolve(["react-native", "main"])).filePath).toBe(
    path.join(projectRoot, "node_modules/counter/lib/es/presets/decimal.js"),
  );
  expect((await resolve(["main"])).filePath).toBe(
    path.join(projectRoot, "node_modules/counter/lib/cjs/presets/decimal.js"),
  );
});

// What React Native's and Expo's Metro configs resolve on iOS and Android.
const NATIVE_MAIN_FIELDS = ["react-native", "browser", "main"];

function resolveNative(projectRoot: string, fromFile: string, specifier: string) {
  return resolveReactNativeModule({
    fromFile: path.join(projectRoot, fromFile),
    mainFields: NATIVE_MAIN_FIELDS,
    platform: "ios",
    projectRoot,
    specifier,
  });
}

test("a string browser field is the entry when browser is one of the main fields", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/isomorphic/package.json": JSON.stringify({
      browser: "./browser.js",
      main: "./node.js",
      name: "isomorphic",
    }),
    "node_modules/isomorphic/browser.js": "module.exports = 'browser';",
    "node_modules/isomorphic/node.js": "module.exports = 'node';",
  });

  expect((await resolveNative(projectRoot, "index.js", "isomorphic")).filePath).toBe(
    path.join(projectRoot, "node_modules/isomorphic/browser.js"),
  );
  const withoutBrowser = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "index.js"),
    mainFields: ["react-native", "main"],
    platform: "ios",
    projectRoot,
    specifier: "isomorphic",
  });
  expect(withoutBrowser.filePath).toBe(path.join(projectRoot, "node_modules/isomorphic/node.js"));
});

test("a browser map replaces the main entry, as qrcode's does", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    // qrcode 1.5's own fields: its main entry is the Node.js one.
    "node_modules/qrcode/package.json": JSON.stringify({
      browser: { "./lib/index.js": "./lib/browser.js", fs: false },
      main: "./lib/index.js",
      name: "qrcode",
    }),
    "node_modules/qrcode/lib/browser.js": "exports.toCanvas = () => {};",
    "node_modules/qrcode/lib/index.js": "module.exports = require('./server');",
    // The same map matches a main written without `./` or its extension.
    "node_modules/short-main/package.json": JSON.stringify({
      browser: { "./lib/index.js": "./lib/browser.js" },
      main: "lib/index",
      name: "short-main",
    }),
    "node_modules/short-main/lib/browser.js": "module.exports = 'browser';",
    "node_modules/short-main/lib/index.js": "module.exports = 'node';",
  });

  const qrcode = await resolveNative(projectRoot, "index.js", "qrcode");
  expect(qrcode.filePath).toBe(path.join(projectRoot, "node_modules/qrcode/lib/browser.js"));
  expect(qrcode.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: 'Replaced the entry "./lib/index.js" with "./lib/browser.js".',
      }),
    ]),
  );
  expect((await resolveNative(projectRoot, "index.js", "short-main")).filePath).toBe(
    path.join(projectRoot, "node_modules/short-main/lib/browser.js"),
  );

  // Without `browser` among the main fields, its map is not read either.
  const nodeEntry = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "index.js"),
    mainFields: ["react-native", "main"],
    platform: "ios",
    projectRoot,
    specifier: "qrcode",
  });
  expect(nodeEntry.filePath).toBe(path.join(projectRoot, "node_modules/qrcode/lib/index.js"));
});

test("a browser map replaces files of its package, imported from inside or by subpath", async () => {
  const projectRoot = await createTempProject();
  const lib = path.join(projectRoot, "node_modules/hybrid/lib");

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/hybrid/package.json": JSON.stringify({
      browser: { "./lib/node-only.js": "./lib/browser-only.js", "./lib/server": false },
      main: "./lib/index.js",
      name: "hybrid",
    }),
    "node_modules/hybrid/lib/browser-only.js": "module.exports = 'browser';",
    "node_modules/hybrid/lib/index.js": "require('./node-only'); require('./server');",
    "node_modules/hybrid/lib/node-only.js": "module.exports = 'node';",
    "node_modules/hybrid/lib/server.js": "module.exports = 'server';",
  });

  // A relative import inside the package; the key carries `.js`, the import does not.
  expect(
    (await resolveNative(projectRoot, "node_modules/hybrid/lib/index.js", "./node-only")).filePath,
  ).toBe(path.join(lib, "browser-only.js"));
  // The same file reached through a subpath of the package.
  expect((await resolveNative(projectRoot, "index.js", "hybrid/lib/node-only")).filePath).toBe(
    path.join(lib, "browser-only.js"),
  );
  // An absolute path is matched against the package it is in.
  expect(
    (await resolveNative(projectRoot, "index.js", path.join(lib, "node-only.js"))).filePath,
  ).toBe(path.join(lib, "browser-only.js"));

  // `false`: an empty module.
  const server = await resolveNative(projectRoot, "node_modules/hybrid/lib/index.js", "./server");
  expect(server.empty).toBe(true);
  expect(server.filePath).toBe(path.join(lib, "server"));
  expect((await resolveNative(projectRoot, "index.js", "hybrid/lib/server")).empty).toBe(true);
});

test("a browser map replaces a subpath before exports is read, as Metro does", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    // multiformats 13's fields for its sha2 hasher: the Node.js file imports `crypto`.
    "node_modules/multiformats/package.json": JSON.stringify({
      browser: {
        "./dist/src/hashes/sha2.js": "./dist/src/hashes/sha2-browser.js",
        "./hashes/sha2": "./dist/src/hashes/sha2-browser.js",
      },
      exports: {
        "./hashes/sha2": {
          browser: "./dist/src/hashes/sha2-browser.js",
          import: "./dist/src/hashes/sha2.js",
        },
      },
      name: "multiformats",
      type: "module",
    }),
    "node_modules/multiformats/dist/src/hashes/sha2-browser.js": "export const web = true;",
    "node_modules/multiformats/dist/src/hashes/sha2.js": "import crypto from 'crypto';",
  });

  expect((await resolveNative(projectRoot, "index.js", "multiformats/hashes/sha2")).filePath).toBe(
    path.join(projectRoot, "node_modules/multiformats/dist/src/hashes/sha2-browser.js"),
  );

  // Without `browser` among the main fields, `exports` decides (its `import` condition).
  const fromExports = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "index.js"),
    mainFields: ["react-native", "main"],
    platform: "ios",
    projectRoot,
    specifier: "multiformats/hashes/sha2",
  });
  expect(fromExports.filePath).toBe(
    path.join(projectRoot, "node_modules/multiformats/dist/src/hashes/sha2.js"),
  );
});

test("a browser map replaces the modules its package imports, false being an empty module", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/needs-node/package.json": JSON.stringify({
      browser: { crypto: "./crypto-shim.js", fs: false, util: "util-polyfill" },
      main: "./index.js",
      name: "needs-node",
    }),
    "node_modules/needs-node/crypto-shim.js": "module.exports = {};",
    "node_modules/needs-node/index.js": "require('fs'); require('crypto'); require('util');",
    "node_modules/util-polyfill/package.json": '{"name":"util-polyfill","main":"./util.js"}',
    "node_modules/util-polyfill/util.js": "module.exports = {};",
  });

  const fromPackage = (specifier: string) =>
    resolveNative(projectRoot, "node_modules/needs-node/index.js", specifier);

  const fs = await fromPackage("fs");
  expect(fs.empty).toBe(true);
  expect(fs.filePath).toBe("fs");
  expect((await fromPackage("crypto")).filePath).toBe(
    path.join(projectRoot, "node_modules/needs-node/crypto-shim.js"),
  );
  expect((await fromPackage("util")).filePath).toBe(
    path.join(projectRoot, "node_modules/util-polyfill/util.js"),
  );

  // The map belongs to the importing package: the app's own imports are not replaced.
  await expect(resolveNative(projectRoot, "index.js", "crypto")).rejects.toMatchObject({
    code: "VIFX_RESOLVE_NOT_FOUND",
  });
});

test("react-native maps win over browser maps, as earlier main fields do with Metro", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/both/package.json": JSON.stringify({
      browser: { "./impl.js": "./impl.browser.js", "./other.js": "./other.browser.js" },
      main: "./index.js",
      name: "both",
      "react-native": { "./impl.js": "./impl.rn.js" },
    }),
    "node_modules/both/impl.browser.js": "module.exports = 'browser';",
    "node_modules/both/impl.js": "module.exports = 'node';",
    "node_modules/both/impl.rn.js": "module.exports = 'react-native';",
    "node_modules/both/index.js": "require('./impl'); require('./other');",
    "node_modules/both/other.browser.js": "module.exports = 'browser';",
    "node_modules/both/other.js": "module.exports = 'node';",
  });

  const fromPackage = (specifier: string) =>
    resolveNative(projectRoot, "node_modules/both/index.js", specifier);

  expect((await fromPackage("./impl")).filePath).toBe(
    path.join(projectRoot, "node_modules/both/impl.rn.js"),
  );
  // Both maps apply: a key only the browser map has is still replaced.
  expect((await fromPackage("./other")).filePath).toBe(
    path.join(projectRoot, "node_modules/both/other.browser.js"),
  );
});

test("a Node.js built-in name resolves to the package of that name when one is installed", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "index.js": "export {};",
    "node_modules/png-thing/index.js": "require('util');",
    "node_modules/png-thing/package.json": '{"name":"png-thing","main":"./index.js"}',
    "node_modules/util/package.json": '{"name":"util","main":"./util.js"}',
    "node_modules/util/util.js": "module.exports = {};",
  });

  // As with Metro: `util` is looked up like any package (npm's `util` polyfill here).
  expect(
    (await resolveNative(projectRoot, "node_modules/png-thing/index.js", "util")).filePath,
  ).toBe(path.join(projectRoot, "node_modules/util/util.js"));
  // Not installed: not found (the bundler decides what to do with it).
  await expect(
    resolveNative(projectRoot, "node_modules/png-thing/index.js", "zlib"),
  ).rejects.toMatchObject({ code: "VIFX_RESOLVE_NOT_FOUND" });
});

test("finds framework internals through their host package on isolated installs", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "package.json": '{"name":"app"}',
    "node_modules/.store/react-native@1/node_modules/react-native/package.json":
      '{"name":"react-native","main":"index.js"}',
    "node_modules/.store/react-native@1/node_modules/react-native/index.js": "module.exports = {};",
    "node_modules/.store/react-native@1/node_modules/@react-native/js-polyfills/package.json":
      '{"name":"@react-native/js-polyfills"}',
    "node_modules/.store/react-native@1/node_modules/@react-native/js-polyfills/error-guard.js":
      "module.exports = {};",
    "node_modules/direct/package.json": '{"name":"direct","main":"index.js"}',
    "node_modules/direct/index.js": "module.exports = {};",
  });
  await linkStorePackage(projectRoot, "react-native@1", "react-native");
  clearProjectRequireChainCache();

  const polyfill = "@react-native/js-polyfills/error-guard";
  const realPolyfillPath = await realpath(
    path.join(
      projectRoot,
      "node_modules/.store/react-native@1/node_modules/@react-native/js-polyfills/error-guard.js",
    ),
  );

  // Not a dependency of the project, but of react-native: found through it and
  // imported by absolute path, since a generated module has no location.
  expect(resolveFromProject(projectRoot, polyfill)).toBe(realPolyfillPath);
  expect(resolveProjectImportSpecifier(projectRoot, polyfill)).toBe(
    realPolyfillPath.split(path.sep).join("/"),
  );

  // Resolvable from the project root: the bare specifier is kept as written.
  expect(resolveProjectImportSpecifier(projectRoot, "direct")).toBe("direct");
  expect(resolveProjectImportSpecifier(projectRoot, "not-installed")).toBeNull();
  expect(resolveFromProject(projectRoot, "not-installed")).toBeNull();
});

async function createTempProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "vifx-platform-resolver-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeFiles(rootDirectory: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    await ensureParentDirectory(filePath);
    await writeFile(filePath, source, "utf8");
  }
}
