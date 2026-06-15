import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InlineConfig, Plugin, UserConfig } from "vite";
import { expect, test } from "vite-plus/test";
import {
  allowedViteKeys,
  detectNativeResolutionConflicts,
  extractMetroStagingUserSlices,
  type LoadedUserViteConfig,
  loadUserViteConfig,
  mergeWithVifx,
  prepareUserViteConfig,
  reservedViteKeys,
} from "../src/index.ts";

function userResult(config: UserConfig): LoadedUserViteConfig {
  return { path: "/virtual/vite.config.vifx.ts", config };
}

function vifxBase(): InlineConfig {
  return {
    appType: "custom",
    build: {
      rollupOptions: {
        output: { entryFileNames: "index.bundle", format: "iife", name: "__vifx" },
      },
    },
    configFile: false,
    define: {
      __DEV__: "false",
      "process.env.NODE_ENV": '"production"',
      "process.env.EXPO_OS": '"ios"',
    },
    plugins: [{ name: "vifx:react-native" }],
    resolve: {
      conditions: ["react-native", "ios"],
      dedupe: ["react", "react-native"],
    },
    root: "/project",
  };
}

test("vifx plugins stay physically first; user plugins are appended after", () => {
  const userPlugin: Plugin = { name: "user-banner" };
  const merged = mergeWithVifx(userResult({ plugins: [userPlugin] }), vifxBase(), {
    resolvePlatform: "ios",
  });
  const names = (merged.plugins as Plugin[]).map((plugin) => plugin.name);
  expect(names).toEqual(["vifx:react-native", "user-banner"]);
});

test("the user's own vifx plugin instance (from the template) is not duplicated", () => {
  const merged = mergeWithVifx(
    userResult({ plugins: [{ name: "vifx:react-native" }, { name: "user-banner" }] }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  const names = (merged.plugins as Plugin[]).map((plugin) => plugin.name);
  expect(names).toEqual(["vifx:react-native", "user-banner"]);
});

test("RESERVED resolve.conditions / dedupe are re-imposed from vifx, not concatenated", () => {
  const merged = mergeWithVifx(
    userResult({
      resolve: { conditions: ["browser"], dedupe: ["lodash"], mainFields: ["module"] },
    }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  expect(merged.resolve?.conditions).toEqual(["react-native", "ios"]);
  expect(merged.resolve?.dedupe).toEqual(["react", "react-native"]);
  // A non-reserved resolve key the user added survives.
  expect(merged.resolve?.mainFields).toEqual(["module"]);
});

test("RESERVED define keys are re-imposed; allowed user define entries pass through", () => {
  const merged = mergeWithVifx(
    userResult({
      define: {
        __DEV__: "true",
        "process.env.NODE_ENV": '"development"',
        MY_FLAG: "42",
      },
    }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  expect(merged.define?.__DEV__).toBe("false");
  expect(merged.define?.["process.env.NODE_ENV"]).toBe('"production"');
  expect(merged.define?.MY_FLAG).toBe("42");
});

test("reserved top-level keys (build/root/appType) are restored from vifx", () => {
  const merged = mergeWithVifx(
    userResult({
      build: { outDir: "user-dist", minify: true },
      root: "/somewhere-else",
    } as UserConfig),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  // vifx build/root win wholesale.
  expect(merged.root).toBe("/project");
  expect((merged.build as { outDir?: string }).outDir).toBeUndefined();
  expect(merged.build?.rollupOptions?.output).toEqual({
    entryFileNames: "index.bundle",
    format: "iife",
    name: "__vifx",
  });
});

test("user react-native / AssetRegistry aliases are physically stripped (object map)", () => {
  const merged = mergeWithVifx(
    userResult({
      resolve: {
        alias: {
          "react-native": "react-native-web",
          "react-native/Libraries/Image/AssetRegistry": "./shim",
          "@app": "./src",
        },
      },
    }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  // vifx-owned aliases removed; the user's own (@app) survives.
  expect(merged.resolve?.alias).toEqual({ "@app": "./src" });
});

test("user react-native alias is stripped from the array form too", () => {
  const merged = mergeWithVifx(
    userResult({
      resolve: {
        alias: [
          { find: "react-native", replacement: "react-native-web" },
          { find: "@app", replacement: "./src" },
        ],
      },
    }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  expect(merged.resolve?.alias).toEqual([{ find: "@app", replacement: "./src" }]);
});

test("metro staging slices also strip the vifx-owned alias", () => {
  const slices = extractMetroStagingUserSlices(
    userResult({ resolve: { alias: { "react-native": "react-native-web", "@app": "./src" } } }),
    { resolvePlatform: "ios" },
  );
  expect(slices?.resolve?.alias).toEqual({ "@app": "./src" });
});

test("ALLOWED keys (css/esbuild) pass through verbatim", () => {
  const merged = mergeWithVifx(
    userResult({ esbuild: { jsxDev: false }, css: { devSourcemap: true } }),
    vifxBase(),
    { resolvePlatform: "ios" },
  );
  expect(merged.esbuild).toEqual({ jsxDev: false });
  expect(merged.css).toEqual({ devSourcemap: true });
});

test("optimizeDeps / server are reserved on native but allowed on web", () => {
  const nativeReserved = reservedViteKeys("ios");
  expect(nativeReserved.topLevel).toContain("optimizeDeps");
  expect(nativeReserved.topLevel).toContain("server");

  const webReserved = reservedViteKeys("web");
  expect(webReserved.topLevel).not.toContain("optimizeDeps");
  expect(webReserved.topLevel).not.toContain("server");

  expect(allowedViteKeys("web")).toContain("optimizeDeps");
  expect(allowedViteKeys("ios")).not.toContain("optimizeDeps");
});

test("native build drops user optimizeDeps; web build keeps it", () => {
  const native = mergeWithVifx(userResult({ optimizeDeps: { include: ["lodash"] } }), vifxBase(), {
    resolvePlatform: "ios",
  });
  expect(native.optimizeDeps).toBeUndefined();

  const web = mergeWithVifx(
    userResult({ optimizeDeps: { include: ["lodash"] } }),
    { ...vifxBase(), resolve: { conditions: ["browser"], dedupe: [] } },
    { resolvePlatform: "web" },
  );
  expect(web.optimizeDeps?.include).toEqual(["lodash"]);
});

test("a null user result returns the vifx inline config untouched", () => {
  const base = vifxBase();
  expect(mergeWithVifx(null, base, { resolvePlatform: "ios" })).toBe(base);
});

test("warn callback fires for each dropped reserved key", () => {
  const warnings: string[] = [];
  mergeWithVifx(
    userResult({
      build: { outDir: "x" },
      define: { __DEV__: "true" },
      resolve: { conditions: ["browser"] },
    }),
    vifxBase(),
    { resolvePlatform: "ios", warn: (diag) => warnings.push(diag.message) },
  );
  expect(warnings.length).toBeGreaterThanOrEqual(3);
  expect(warnings.some((message) => message.includes("build"))).toBe(true);
  expect(warnings.some((message) => message.includes("resolve.conditions"))).toBe(true);
  expect(warnings.some((message) => message.includes("__DEV__"))).toBe(true);
});

// --- metro staging slices ----------------------------------------------------

test("metro staging slices expose user plugins + filtered resolve/define, never output", () => {
  const userPlugin: Plugin = { name: "user-banner" };
  const slices = extractMetroStagingUserSlices(
    userResult({
      plugins: [{ name: "vifx:expo" }, userPlugin],
      build: { rollupOptions: { output: { format: "es" } } },
      resolve: { conditions: ["browser"], mainFields: ["module"] },
      define: { __DEV__: "true", MY_FLAG: "1" },
    } as UserConfig),
    { resolvePlatform: "ios" },
  );
  expect(slices).not.toBeNull();
  expect(slices?.userPlugins.map((plugin) => plugin.name)).toEqual(["user-banner"]);
  // resolve.conditions (reserved) filtered out; mainFields kept.
  expect(slices?.resolve).toEqual({ mainFields: ["module"] });
  // __DEV__ (reserved) filtered out; MY_FLAG kept.
  expect(slices?.define).toEqual({ MY_FLAG: "1" });
  // No `output` / `build` slice is ever surfaced.
  expect(slices).not.toHaveProperty("build");
  expect(slices).not.toHaveProperty("output");
});

test("metro staging slices are null when there is no user config", () => {
  expect(extractMetroStagingUserSlices(null, { resolvePlatform: "ios" })).toBeNull();
});

// --- conflict detection ------------------------------------------------------

test("detectNativeResolutionConflicts flags a react-native alias", () => {
  const diagnostics = detectNativeResolutionConflicts(
    userResult({ resolve: { alias: { "react-native": "react-native-web" } } }),
    "ios",
  );
  expect(diagnostics.length).toBe(1);
  expect(diagnostics[0]?.code).toBe("VIFX_USER_VITE_CONFIG_CONFLICT");
  expect(diagnostics[0]?.details?.alias).toBe("react-native");
});

test("detectNativeResolutionConflicts flags optimizeDeps.include on native only", () => {
  const native = detectNativeResolutionConflicts(
    userResult({ optimizeDeps: { include: ["lodash"] } }),
    "ios",
  );
  expect(native.some((diag) => diag.message.includes("optimizeDeps.include"))).toBe(true);

  const web = detectNativeResolutionConflicts(
    userResult({ optimizeDeps: { include: ["lodash"] } }),
    "web",
  );
  expect(web.some((diag) => diag.message.includes("optimizeDeps.include"))).toBe(false);
});

test("detectNativeResolutionConflicts flags a pre-enforced resolveId user plugin", () => {
  const diagnostics = detectNativeResolutionConflicts(
    userResult({
      plugins: [{ name: "rogue", enforce: "pre", resolveId: () => null }],
    }),
    "ios",
  );
  expect(diagnostics.some((diag) => diag.message.includes("rogue"))).toBe(true);
});

test("detectNativeResolutionConflicts is empty for a benign user config", () => {
  const diagnostics = detectNativeResolutionConflicts(
    userResult({ plugins: [{ name: "user-banner", transform: () => null }] }),
    "ios",
  );
  expect(diagnostics).toEqual([]);
});

test("detectNativeResolutionConflicts handles a null user result", () => {
  expect(detectNativeResolutionConflicts(null, "ios")).toEqual([]);
});

// --- loader ------------------------------------------------------------------

test("loadUserViteConfig returns null when opted out", async () => {
  const result = await loadUserViteConfig({
    projectRoot: "/anywhere",
    configFile: false,
    command: "build",
    mode: "production",
  });
  expect(result).toBeNull();
});

test("loadUserViteConfig returns null when no config file exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vifx-bridge-"));
  try {
    const result = await loadUserViteConfig({
      projectRoot: dir,
      command: "build",
      mode: "production",
    });
    expect(result).toBeNull();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("loadUserViteConfig auto-detects and loads vite.config.vifx.ts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vifx-bridge-"));
  try {
    await writeFile(
      path.join(dir, "vite.config.vifx.ts"),
      'export default { resolve: { mainFields: ["module"] } };\n',
      "utf8",
    );
    const result = await loadUserViteConfig({
      projectRoot: dir,
      command: "build",
      mode: "production",
    });
    expect(result).not.toBeNull();
    expect(result?.config.resolve?.mainFields).toEqual(["module"]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("loadUserViteConfig wraps a load failure as VIFX_USER_VITE_CONFIG_CONFLICT", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vifx-bridge-"));
  try {
    await writeFile(
      path.join(dir, "vite.config.vifx.ts"),
      "this is not valid typescript !!! <<<\n",
      "utf8",
    );
    await expect(
      loadUserViteConfig({ projectRoot: dir, command: "build", mode: "production" }),
    ).rejects.toMatchObject({ code: "VIFX_USER_VITE_CONFIG_CONFLICT" });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

// --- prepareUserViteConfig (load + detect, one shot) -------------------------

test("prepareUserViteConfig returns null result + empty diagnostics when absent", async () => {
  const prepared = await prepareUserViteConfig({
    projectRoot: "/anywhere",
    configFile: false,
    command: "build",
    mode: "production",
    resolvePlatform: "ios",
  });
  expect(prepared.userResult).toBeNull();
  expect(prepared.diagnostics).toEqual([]);
});

test("prepareUserViteConfig loads the config and surfaces native-resolution conflicts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vifx-bridge-"));
  try {
    await writeFile(
      path.join(dir, "vite.config.vifx.ts"),
      'export default { resolve: { alias: { "react-native": "react-native-web" } } };\n',
      "utf8",
    );
    const prepared = await prepareUserViteConfig({
      projectRoot: dir,
      command: "build",
      mode: "production",
      resolvePlatform: "ios",
    });
    expect(prepared.userResult).not.toBeNull();
    expect(prepared.diagnostics.some((diag) => diag.details?.alias === "react-native")).toBe(true);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
