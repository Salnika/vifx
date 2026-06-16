import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ObjectHook, Plugin, ResolveIdResult } from "rollup";
import { expect, test } from "vite-plus/test";
import type {
  VifxMetroResolution,
  VifxMetroResolutionContext,
  VifxMetroResolveRequest,
} from "@vifx/types";
import { reactNative } from "../src/index.ts";

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

/** Invokes a Vite/Rollup plugin's `resolveId` hook (function or object form). */
async function callResolveId(
  plugin: Plugin,
  source: string,
  importer: string | undefined,
): Promise<ResolveIdResult> {
  const hook = plugin.resolveId as ObjectHook<NonNullable<Plugin["resolveId"]>> | undefined;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (handler === undefined) {
    throw new Error("plugin has no resolveId hook");
  }
  // The resolveId hook here reads no PluginContext members, so a bare `this` is
  // sufficient for a direct unit-level invocation.
  return (await handler.call({} as never, source, importer, {} as never)) as ResolveIdResult;
}

function makePlugin(projectRoot: string, userResolveRequest: VifxMetroResolveRequest): Plugin {
  return reactNative({
    entry: "./index.js",
    platform: "ios",
    projectRoot,
    userResolveRequest,
  }) as Plugin;
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
  const plugin = makePlugin(projectRoot, (context, moduleName, platform): VifxMetroResolution => {
    if (moduleName === "./real") {
      return { type: "sourceFile", filePath: overridePath };
    }
    return context.resolveRequest(context, moduleName, platform);
  });

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

  expect(typeof resolved).toBe("string");
  expect(resolved as string).toContain("vifx:empty:");

  // The empty id loads as an empty module so `import x from 'server-only'` works.
  const loadHook = plugin.load as ObjectHook<NonNullable<Plugin["load"]>> | undefined;
  const loadHandler = typeof loadHook === "function" ? loadHook : loadHook?.handler;
  const loaded = await loadHandler?.call({} as never, resolved as string);
  const loadedCode = typeof loaded === "string" ? loaded : loaded?.code;
  expect(loadedCode).toContain("module.exports = {}");
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
