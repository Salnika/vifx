import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, type InlineConfig, type Plugin } from "vite";
import { VifxError } from "@vifx/errors";
import { planMetroEntryModule, type MetroEntryPlan } from "./ordering.ts";
import {
  serializeModuleRegistryBundle,
  type SerializedModule,
  type StagedChunk,
  type StagedChunkSourceMap,
} from "./serializer.ts";

export { MODULE_REGISTRY_PRELUDE, buildModuleRegistryPrelude } from "./runtime.ts";
export type { BuildModuleRegistryPreludeOptions } from "./runtime.ts";
export {
  assignModuleIds,
  INITIALIZE_CORE_SPECIFIER,
  MODULE_REGISTRY_POLYFILL_SPECIFIERS,
  orderModules,
  planMetroEntryModule,
} from "./ordering.ts";
export type { MetroEntryPlan, MetroEntryPlanOptions, OrderableModule } from "./ordering.ts";
export { collectModuleGraph, serializeModuleRegistryBundle } from "./serializer.ts";
export type {
  ComposedSourceMap,
  SerializedModule,
  SerializedModuleRegistryBundle,
  SerializeModuleRegistryOptions,
  StagedChunk,
  StagedChunkSourceMap,
} from "./serializer.ts";
export { computeHmrUpdate } from "./hmr-delta.ts";
export type { ComputeHmrUpdateOptions, HmrUpdate, HmrUpdateModule } from "./hmr-delta.ts";

const BUNDLE_FILE_NAME = "index.bundle";
const STAGING_DIR_NAME = ".module-registry-staging";

export interface BuildModuleRegistryBundleOptions {
  /** Absolute path of the final bundle output directory. */
  absoluteOutDir: string;
  /** User entry as configured (path-like or bare specifier). */
  entry: string;
  /**
   * Module id map from the previous build, so ids stay stable across rebuilds
   * (required for Fast Refresh deltas to target the right module).
   */
  existingModuleIds?: ReadonlyMap<string, number>;
  /** Emit the Fast Refresh runtime prelude (development bundles only). */
  hmr?: boolean;
  /** Called for non-fatal setup notices (defaults to `console.warn`). */
  onWarn?: (message: string) => void;
  /** Vite plugins for the staging build (React Native or Expo pipeline). */
  plugins: Plugin[];
  /** Absolute project root. */
  projectRoot: string;
}

export interface ModuleRegistryBundleResult {
  /** Absolute path of the emitted `index.bundle`. */
  bundlePath: string;
  /** Entry module id executed by the trailing `__r(...)`. */
  entryModuleId: number;
  /** Number of `__d` module factories in the bundle. */
  moduleCount: number;
  /** Stable module id map for this build (feed back as `existingModuleIds`). */
  moduleIds: Map<string, number>;
  /** Per-module factory blocks, for diffing into Fast Refresh deltas. */
  modules: SerializedModule[];
  /** Entry planning outcome (polyfills, InitializeCore availability). */
  plan: MetroEntryPlan;
  /** Absolute path of the emitted `index.bundle.map`. */
  sourceMapPath: string;
}

interface RawOutputItem {
  code?: unknown;
  fileName?: unknown;
  isEntry?: unknown;
  map?: unknown;
  type?: unknown;
}

function collectStagedChunks(buildResult: unknown): StagedChunk[] {
  const outputs = (Array.isArray(buildResult) ? buildResult : [buildResult]).flatMap((result) =>
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { output?: unknown }).output)
      ? ((result as { output: RawOutputItem[] }).output ?? [])
      : [],
  );

  const chunks: StagedChunk[] = [];
  for (const item of outputs) {
    if (
      item.type !== "chunk" ||
      typeof item.fileName !== "string" ||
      typeof item.code !== "string"
    ) {
      continue;
    }
    const rawMap = item.map;
    const map =
      rawMap !== null &&
      typeof rawMap === "object" &&
      typeof (rawMap as { mappings?: unknown }).mappings === "string"
        ? (rawMap as unknown as StagedChunkSourceMap)
        : null;
    chunks.push({
      code: item.code,
      fileName: item.fileName,
      isEntry: item.isEntry === true,
      map,
    });
  }
  return chunks;
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a Metro-compatible module-registry bundle (`moduleFormat: "metro"`).
 *
 * The target project is first built as per-module CommonJS chunks
 * (`format: "cjs"`, `preserveModules: true`, `exports: "named"`) into a
 * staging directory, then serialized into a single plain-script
 * `index.bundle`: runtime prelude (`__d`/`__r`), `__d`-wrapped module
 * factories with stable numeric ids and rewritten `require(<id>)` calls, and
 * a trailing `__r(<entryId>)`. Emitted assets are moved next to the bundle so
 * the output directory layout matches the default `"hoisted"` format.
 */
export async function buildModuleRegistryBundle(
  options: BuildModuleRegistryBundleOptions,
): Promise<ModuleRegistryBundleResult> {
  const stagingDir = path.join(options.absoluteOutDir, STAGING_DIR_NAME);
  await rm(options.absoluteOutDir, { force: true, recursive: true });

  const plan = await planMetroEntryModule({
    absoluteOutDir: options.absoluteOutDir,
    dev: options.hmr === true,
    entry: options.entry,
    onWarn: options.onWarn,
    projectRoot: options.projectRoot,
  });

  const stagingConfig: InlineConfig = {
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      emptyOutDir: false,
      minify: false,
      outDir: stagingDir,
      rollupOptions: {
        input: plan.inputEntryPath,
        output: {
          assetFileNames: "assets/[name][extname]",
          chunkFileNames: "[name].js",
          entryFileNames: "[name].js",
          exports: "named",
          format: "cjs",
          preserveModules: true,
          preserveModulesRoot: options.projectRoot,
        },
      },
      sourcemap: true,
      target: "es2020",
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: options.plugins,
    publicDir: false,
    root: options.projectRoot,
  };

  const buildResult = await build(stagingConfig);
  const chunks = collectStagedChunks(buildResult);
  if (chunks.length === 0) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_ENTRY_MISSING",
      message: "The module-registry staging build produced no module chunks.",
      hint: "Ensure the entry file exists and the Vifx React Native plugin is installed in the Vite build.",
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  const serialized = serializeModuleRegistryBundle({
    absoluteOutDir: options.absoluteOutDir,
    chunks,
    existingModuleIds: options.existingModuleIds,
    hmr: options.hmr,
    outputFileName: BUNDLE_FILE_NAME,
    stagingDir,
  });
  if (serialized.unresolvedModules.length > 0) {
    const warn = options.onWarn ?? ((message: string) => console.warn(message));
    warn(
      `[vifx] ${serialized.unresolvedModules.length} module(s) could not be resolved and were stubbed (they throw if required at runtime): ${serialized.unresolvedModules.join(
        ", ",
      )}. Install them if a feature needs them.`,
    );
  }

  const bundlePath = path.join(options.absoluteOutDir, BUNDLE_FILE_NAME);
  const sourceMapPath = `${bundlePath}.map`;
  await mkdir(options.absoluteOutDir, { recursive: true });
  await writeFile(bundlePath, serialized.code, "utf8");
  await writeFile(sourceMapPath, JSON.stringify(serialized.map), "utf8");

  const stagedAssetsDir = path.join(stagingDir, "assets");
  if (await pathExists(stagedAssetsDir)) {
    await rename(stagedAssetsDir, path.join(options.absoluteOutDir, "assets"));
  }
  await rm(stagingDir, { force: true, recursive: true });

  return {
    bundlePath,
    entryModuleId: serialized.entryModuleId,
    moduleCount: serialized.moduleIds.size,
    moduleIds: serialized.moduleIds,
    modules: serialized.modules,
    plan,
    sourceMapPath,
  };
}
