import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
import { expect, test } from "vite-plus/test";
import type {
  VifxMetroResolution,
  VifxMetroResolutionContext,
  VifxMetroResolveRequest,
} from "@vifx/types";
import { buildReactNativeBundle, reactNative } from "../src/index.ts";

type HookFn = (...args: unknown[]) => unknown;

/**
 * Extracts a plugin hook handler whether it is declared as a bare function or
 * the `{ handler }` object form, without depending on rollup's `ObjectHook`
 * type (not re-exported by vite). vifx declares these as bare functions.
 */
function getHookHandler(hook: unknown): HookFn {
  if (typeof hook === "function") {
    return hook as HookFn;
  }
  const handler = (hook as { handler?: unknown } | undefined)?.handler;
  if (typeof handler !== "function") {
    throw new Error("plugin hook is missing or not callable");
  }
  return handler as HookFn;
}

/**
 * Builds a synthetic project on disk with a real `node_modules` so the platform
 * resolver has something to resolve against (no mocking — the recursive
 * `context.resolveRequest` runs vifx's real resolver).
 */
async function createProject(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-resolve-request-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
  return projectRoot;
}

/** Invokes a plugin's `resolveId` hook with a bare PluginContext. */
async function callResolveId(
  plugin: Plugin,
  source: string,
  importer: string | undefined,
): Promise<string | null> {
  const handler = getHookHandler(plugin.resolveId);
  // The resolveId hook here reads no PluginContext members, so a bare `this` is
  // sufficient for a direct unit-level invocation.
  const result = await handler.call({}, source, importer, {});
  if (result === null || result === undefined) {
    return null;
  }
  return typeof result === "string" ? result : ((result as { id: string }).id ?? null);
}

function makePlugin(projectRoot: string, userResolveRequest: VifxMetroResolveRequest): Plugin {
  return reactNative({
    entry: "./index.js",
    platform: "ios",
    projectRoot,
    userResolveRequest,
  });
}

test("(a) delegate-to-default with modified args resolves the swapped module", async () => {
  // `crypto` does not exist on disk; the hook delegates to the default resolver
  // with a different module name, exactly like Metro's
  // `context.resolveRequest(context, 'expo-crypto', platform)` pattern.
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "node_modules/expo-crypto/package.json": JSON.stringify({
      name: "expo-crypto",
      main: "index.js",
    }),
    "node_modules/expo-crypto/index.js": "export const digest = () => 'expo-crypto';\n",
  });

  const calls: Array<{ name: string; platform: string | null }> = [];
  const plugin = makePlugin(projectRoot, (context, moduleName, platform) => {
    calls.push({ name: moduleName, platform });
    const next = moduleName === "crypto" ? "expo-crypto" : moduleName;
    return context.resolveRequest(context, next, platform);
  });

  const resolved = await callResolveId(plugin, "crypto", path.join(projectRoot, "index.js"));

  expect(typeof resolved).toBe("string");
  expect(resolved).toContain(path.join("node_modules", "expo-crypto", "index.js"));
  // The hook saw the raw specifier and the real platform (Metro surface).
  expect(calls).toEqual([{ name: "crypto", platform: "ios" }]);
});

test("(b) a conditional swap returns a fabricated sourceFile resolution", async () => {
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "src/real.ts": "export const real = true;\n",
    "src/override.ts": "export const real = 'override';\n",
  });

  const overridePath = path.join(projectRoot, "src/override.ts");
  const plugin = makePlugin(
    projectRoot,
    async (context, moduleName, platform): Promise<VifxMetroResolution> => {
      if (moduleName === "./real") {
        return { type: "sourceFile", filePath: overridePath };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  );

  const resolved = await callResolveId(plugin, "./real", path.join(projectRoot, "index.js"));

  // A bare .ts file with no jsx is returned as a plain resolved path (no
  // transform wrapper), so the swap target is exactly what we returned.
  expect(resolved).toBe(overridePath);
});

test("(c) an svg-transformer-style delegating hook keeps the resolved file", async () => {
  // Mirrors react-native-svg-transformer's resolver shape: it inspects the
  // resolved file and, for svg, would route it to its own transform. Here we
  // assert the delegating path resolves the platform-correct file and the hook
  // gets vifx's default resolution to build on.
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "src/Logo.ios.tsx": "export const Logo = 'ios';\n",
    "src/Logo.tsx": "export const Logo = 'base';\n",
  });

  let delegatedResolution: VifxMetroResolution | undefined;
  const plugin = makePlugin(
    projectRoot,
    async (context, moduleName, platform): Promise<VifxMetroResolution> => {
      const resolution = await context.resolveRequest(context, moduleName, platform);
      // svg-transformer pattern: branch on the resolved file's extension.
      delegatedResolution = resolution;
      return resolution;
    },
  );

  const resolved = await callResolveId(plugin, "./Logo", path.join(projectRoot, "src/index.js"));

  // .tsx files get a transform-id wrapper, but the underlying file is the
  // platform-specific .ios.tsx (the default resolver applied platform priority).
  expect(typeof resolved).toBe("string");
  expect(resolved).toContain("Logo.ios.tsx");
  expect(delegatedResolution).toEqual({
    type: "sourceFile",
    filePath: path.join(projectRoot, "src/Logo.ios.tsx"),
  });
});

test("(d) returning {type:'empty'} resolves to an empty virtual module", async () => {
  const projectRoot = await createProject({ "index.js": "export {};\n" });

  const plugin = makePlugin(projectRoot, (_context, moduleName): VifxMetroResolution => {
    if (moduleName === "server-only") {
      return { type: "empty" };
    }
    return { type: "sourceFile", filePath: path.join(projectRoot, "index.js") };
  });

  const resolved = await callResolveId(plugin, "server-only", path.join(projectRoot, "index.js"));

  expect(resolved).not.toBeNull();
  expect(resolved).toContain("vifx:empty:");

  // The empty id loads as an ESM module so `import x from 'server-only'` works
  // (default-exports an empty object; named imports are undefined, like Metro).
  const loadHandler = getHookHandler(plugin.load);
  const loaded = await loadHandler.call({}, resolved as string);
  const loadedCode =
    typeof loaded === "string" ? loaded : (loaded as { code?: string } | null)?.code;
  expect(loadedCode).toContain("export default {}");
});

test("a throwing hook falls through to vifx's default resolution", async () => {
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "src/util.ts": "export const util = 1;\n",
  });

  const plugin = makePlugin(projectRoot, () => {
    throw new Error("hook blew up");
  });

  // Despite the hook throwing, vifx still resolves the real file.
  const resolved = await callResolveId(plugin, "./util", path.join(projectRoot, "src/index.js"));
  expect(resolved).toBe(path.join(projectRoot, "src/util.ts"));
});

test("the context exposes Metro-shaped fields (sourceExts/assetExts/projectRoot)", async () => {
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "src/util.ts": "export const util = 1;\n",
  });

  let seen: VifxMetroResolutionContext | undefined;
  const plugin = makePlugin(projectRoot, (context, moduleName, platform) => {
    seen = context;
    return context.resolveRequest(context, moduleName, platform);
  });

  await callResolveId(plugin, "./util", path.join(projectRoot, "src/index.js"));

  expect(seen?.projectRoot).toBe(projectRoot);
  expect(seen?.sourceExts).toContain("tsx");
  expect(seen?.assetExts).toContain("png");
  expect(typeof seen?.resolveRequest).toBe("function");
  expect(seen?.originModulePath).toBe(path.join(projectRoot, "src/index.js"));
});

test("without a hook, resolution is unchanged (the historic default path)", async () => {
  const projectRoot = await createProject({
    "index.js": "export {};\n",
    "src/util.ts": "export const util = 1;\n",
  });

  const plugin = reactNative({
    entry: "./index.js",
    platform: "ios",
    projectRoot,
  }) as Plugin;

  const resolved = await callResolveId(plugin, "./util", path.join(projectRoot, "src/index.js"));
  expect(resolved).toBe(path.join(projectRoot, "src/util.ts"));
});

test("end-to-end: a delegating + empty-stub hook produces a real ESM bundle", async () => {
  // Exercises the full pipeline through Rolldown (not just resolveId), proving
  // the {type:"empty"} stub is valid ESM in the bundle graph (a CJS
  // `module.exports` stub would throw "module is not defined" here). Built in
  // development mode + a side-effecting global write so tree-shaking keeps the
  // swapped module's marker.
  const projectRoot = await createProject({
    "index.js": [
      'import stub from "server-only";',
      'import { value } from "./real";',
      "globalThis.__rrResult = { stub, value };",
      "",
    ].join("\n"),
    "src/override.js": "export const value = 'override-marker';\n",
  });

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    mode: "development",
    outDir: ".vifx/resolve-request-e2e",
    platform: "ios",
    projectRoot,
    userResolveRequest: async (context, moduleName, platform): Promise<VifxMetroResolution> => {
      if (moduleName === "server-only") {
        return { type: "empty" };
      }
      if (moduleName === "./real") {
        return { type: "sourceFile", filePath: path.join(projectRoot, "src/override.js") };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  });

  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");
  // The build succeeded (no "module is not defined" from the empty stub) and the
  // conditional swap pulled in the override file's marker.
  expect(bundleSource.length).toBeGreaterThan(0);
  expect(bundleSource).toContain("override-marker");
});
