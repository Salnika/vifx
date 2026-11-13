import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { build, type InlineConfig, type Plugin } from "vite";
import { dev } from "vite/rolldown/experimental";
import { VifxError } from "@vifx/errors";
import { buildVifxDevRuntimeSource } from "@vifx/vite-plugin-react-native";

/**
 * The Expo Go dev server's incremental engine: Rolldown's native dev engine
 * (`dev()` from `rolldown/experimental`), driven with the exact options Vite
 * resolves for the regular development build.
 *
 * A classic rebuild re-runs the whole bundle on every save. The engine keeps
 * the module graph alive instead: a save recompiles only the changed modules
 * into a patch that the app applies in place (Fast Refresh), and the full
 * bundle is brought up to date in the background for the next reload.
 *
 * Nothing here is required for correctness of the served bundle: every failure
 * to set the engine up is reported to the caller, which falls back to the
 * classic rebuild loop.
 */

/**
 * Function scope around a development bundle. The app evaluates the bundle as
 * a script, where every top-level declaration of a scope-hoisted bundle would
 * otherwise become a property of the global object: tens of thousands of them,
 * any of which can collide with a real global (React Native's console polyfill
 * defines `globalThis.originalConsole`, for one). Production output is an IIFE
 * already.
 */
export const DEV_BUNDLE_SCOPE = { banner: "(function(){", footer: "})();" } as const;

const SERVER_CLIENT_ID = "vifx:server";
/** Where the React Native plugin emits asset files, relative to the output. */
const ASSETS_DIRECTORY = "assets";

type DevEngine = Awaited<ReturnType<typeof dev>>;
type DevInputOptions = Parameters<typeof dev>[0];
type DevOutputOptions = NonNullable<Parameters<typeof dev>[1]>;

/** One Fast Refresh patch, addressed to the app that must apply it. */
export interface ExpoDevEnginePatch {
  /** Ids of the modules the save changed; the app walks its graph from these. */
  changedIds: string[];
  /** The app (`vifx:hello` client id) this patch was compiled for. */
  clientId: string;
  /** Script registering the re-runnable module factories. */
  code: string;
  /** Unique payload name; reported back once the app has evaluated it. */
  filename: string;
}

export interface ExpoDevEngineBundle {
  /** Changes whenever an asset file was added to, or replaced in, `assetsRoot`. */
  assetsVersion: number;
  /** Entry bundle code (scope-hoisted, with the dev runtime prelude). */
  code: string;
  /** Monotonic build counter; changes whenever `code` does. */
  version: number;
}

export interface StartExpoDevEngineOptions {
  /**
   * Absolute directory the engine keeps emitted assets in, as
   * `<assetsRoot>/assets/<file>`. Must not be inside `outputDir`: Rolldown
   * empties that directory on every build, and an incremental build only
   * re-emits the assets of the modules it loaded again.
   */
  assetsRoot: string;
  /** File name of the entry bundle inside `outputDir`. */
  bundleFileName: string;
  /** Called after every save the engine processed, with the changed files. */
  onChange?: (changedFiles: string[]) => void;
  /** A build or patch failed. The last good bundle keeps being served. */
  onError: (error: Error) => void;
  onPatch: (patch: ExpoDevEnginePatch) => void;
  /** The edit cannot be applied in place for this app; it must reload. */
  onReloadRequired: (clientId: string, reason: string) => void;
  /** Absolute output directory (bundle, source map); emptied on every build. */
  outputDir: string;
  /** Absolute, real path of the project: the root module ids are relative to. */
  projectRoot: string;
  /**
   * The development build's Vite config, exactly as the classic build would
   * run it (vifx plugins, user config already merged).
   */
  viteConfig: InlineConfig;
}

export interface ExpoDevEngine {
  close(): Promise<void>;
  /** The bundle for the current state of the sources (rebuilds if stale). */
  getBundle(): Promise<ExpoDevEngineBundle>;
  notifyPatchDelivered(filename: string): void;
  registerClient(clientId: string): void;
  removeClient(clientId: string): void;
  /** Rebuilds from the sources (e.g. after a non-module file changed). */
  requestFullBuild(): Promise<void>;
}

/**
 * Resolves the Rolldown input options of a Vite build without running it: a
 * last-in-line plugin reads them from the `options` hook, then stops the build.
 * This is what keeps the engine on the same plugins, defines, resolution and
 * transforms as `vite build`, instead of a hand-maintained copy.
 */
async function captureRolldownInputOptions(viteConfig: InlineConfig): Promise<DevInputOptions> {
  const capture: { armed: boolean; options: DevInputOptions | null } = {
    armed: true,
    options: null,
  };
  const capturePlugin: Plugin = {
    name: "vifx:capture-rolldown-options",
    enforce: "post",
    options(inputOptions) {
      // Inert once it has fired: the engine runs this hook again.
      if (!capture.armed) {
        return null;
      }
      capture.armed = false;
      capture.options = inputOptions as DevInputOptions;
      throw new Error("vifx: Rolldown options captured");
    },
  };

  let buildError: unknown = null;
  try {
    await build({ ...viteConfig, plugins: [...(viteConfig.plugins ?? []), capturePlugin] });
  } catch (error) {
    buildError = error;
  }

  if (capture.options === null) {
    throw new VifxError({
      code: "VIFX_INTERNAL_ERROR",
      message: "The development build options could not be resolved for the dev engine.",
      cause: buildError,
    });
  }
  return capture.options;
}

export async function startExpoDevEngine(
  options: StartExpoDevEngineOptions,
): Promise<ExpoDevEngine> {
  const capturedOptions = await captureRolldownInputOptions(options.viteConfig);

  const inputOptions: DevInputOptions = {
    ...capturedOptions,
    // Module ids in patches are relative to Rolldown's working directory, and
    // the Fast Refresh wrapper keys each module by its project-relative path:
    // the two only agree when the engine works from the project root, wherever
    // the dev server itself was started from.
    cwd: options.projectRoot,
    experimental: {
      ...capturedOptions.experimental,
      // The in-app runtime replaces Rolldown's browser-oriented one entirely.
      devMode: { implement: buildVifxDevRuntimeSource(), skipCommonRuntimeInjection: true },
    },
    // A constant inlined into its importers would survive an edit of the
    // module that defines it.
    optimization: { ...capturedOptions.optimization, inlineConst: false },
  };
  const outputOptions: DevOutputOptions = {
    assetFileNames: "assets/[name][extname]",
    chunkFileNames: "chunks/[name].js",
    dir: options.outputDir,
    entryFileNames: options.bundleFileName,
    format: "es",
    ...DEV_BUNDLE_SCOPE,
    minify: false,
    sourcemap: true,
  };

  // Assets of a previous session must not be listed in this one's manifest.
  await rm(path.join(options.assetsRoot, ASSETS_DIRECTORY), { force: true, recursive: true });

  // Mutated from the engine's callbacks, hence a holder rather than locals.
  const state: {
    assetsVersion: number;
    assetWrites: Promise<void>;
    closed: boolean;
    current: ExpoDevEngineBundle | null;
    lastError: Error | null;
    saveReported: boolean;
    started: boolean;
  } = {
    assetsVersion: 0,
    assetWrites: Promise.resolve(),
    closed: false,
    current: null,
    lastError: null,
    saveReported: false,
    started: false,
  };

  /**
   * Copies the assets one build emitted into `assetsRoot`. A build emits an
   * asset when it loads the module that requires it, so the first build
   * brings them all and later ones only what is new or changed.
   */
  const keepAssets = (assets: { fileName: string; source: string | Uint8Array }[]): void => {
    if (assets.length === 0) {
      return;
    }
    state.assetsVersion += 1;
    state.assetWrites = state.assetWrites
      .then(async () => {
        await Promise.all(
          assets.map(async (asset) => {
            const target = path.join(options.assetsRoot, asset.fileName);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, asset.source);
          }),
        );
      })
      .catch((error: unknown) => {
        reportError(error instanceof Error ? error : new Error(String(error)));
      });
  };

  // A failure of the very first build is this function's own rejection; only
  // what breaks once the engine is running goes to `onError`.
  const reportError = (error: Error): void => {
    state.lastError = error;
    if (state.started) {
      options.onError(error);
    }
  };

  const engine: DevEngine = await dev(inputOptions, outputOptions, {
    onHmrUpdates(result) {
      if (state.closed) {
        return;
      }
      if (result instanceof Error) {
        reportError(result);
        return;
      }
      const { changedFiles, updates } = result;
      // A touched file whose module is unchanged (or that is no module at
      // all) is no update: nothing to patch, nothing to rebuild.
      if (changedFiles.length === 0 || updates.every(({ update }) => update.type === "Noop")) {
        return;
      }
      for (const { clientId, update } of updates) {
        if (clientId === SERVER_CLIENT_ID) {
          // Acknowledged at once, so its next patch stays small.
          if (update.type === "Patch") {
            void engine.notifyPayloadDelivered(update.filename).catch(() => undefined);
          }
          continue;
        }
        if (update.type === "Patch") {
          options.onPatch({
            changedIds: update.changedIds,
            clientId,
            code: update.code,
            filename: update.filename,
          });
        } else if (update.type === "FullReload") {
          options.onReloadRequired(clientId, update.reason ?? "The edit requires a reload");
        }
      }
      state.saveReported = true;
      options.onChange?.(changedFiles);
      // Bring the full bundle up to date now, so a reload does not wait for it.
      void refresh().catch(() => undefined);
    },
    onOutput(result) {
      if (state.closed) {
        return;
      }
      if (result instanceof Error) {
        reportError(result);
        return;
      }
      const entry = result.output.find((item) => item.type === "chunk" && item.isEntry);
      if (!entry || entry.type !== "chunk") {
        return;
      }
      state.lastError = null;
      const assets: { fileName: string; source: string | Uint8Array }[] = [];
      for (const item of result.output) {
        if (item.type === "asset" && item.fileName.startsWith(`${ASSETS_DIRECTORY}/`)) {
          assets.push({ fileName: item.fileName, source: item.source });
        }
      }
      keepAssets(assets);
      state.current = {
        assetsVersion: state.assetsVersion,
        code: entry.code,
        version: (state.current?.version ?? 0) + 1,
      };
    },
    rebuildStrategy: "never",
    watch: { skipWrite: false },
  });

  /**
   * Waits until a build newer than `afterVersion` has been delivered. The
   * engine resolves its promises when the native build ends, which can be a
   * moment before `onOutput` has run on this thread.
   */
  const waitForOutput = async (afterVersion: number): Promise<void> => {
    const deadline = performance.now() + 60_000;
    while (
      !state.closed &&
      (state.current?.version ?? 0) <= afterVersion &&
      performance.now() < deadline
    ) {
      const bundleState = await engine.getBundleState();
      if (bundleState.lastBuildErrored) {
        return;
      }
      await sleep(2);
    }
  };

  // One refresh at a time; a save that lands meanwhile is picked up by the
  // caller that queued behind it.
  let refreshing: Promise<void> = Promise.resolve();
  function refresh(): Promise<void> {
    const run = refreshing.then(async () => {
      // A save was just reported: the engine flags its output stale a moment
      // later, so "not stale" is not yet an answer.
      const saveReported = state.saveReported;
      state.saveReported = false;
      for (let attempt = 0; attempt < 5 && !state.closed; attempt += 1) {
        let bundleState = await engine.getBundleState();
        const settleDeadline = performance.now() + (saveReported && attempt === 0 ? 300 : 0);
        while (
          !bundleState.hasStaleOutput &&
          !bundleState.lastBuildErrored &&
          performance.now() < settleDeadline
        ) {
          await sleep(2);
          bundleState = await engine.getBundleState();
        }
        if (bundleState.lastBuildErrored && bundleState.lastErrorStage === "Hmr") {
          // Patch generation failed: only a build from the sources is trusted.
          engine.triggerFullBuild();
        } else if (!bundleState.hasStaleOutput) {
          return;
        }
        const version = state.current?.version ?? 0;
        await engine.ensureLatestBuildOutput();
        await waitForOutput(version);
        // A build that fails is not retried: it fails the same way until the
        // sources change, and the last good bundle stays in place meanwhile.
        if ((await engine.getBundleState()).lastBuildErrored) {
          return;
        }
      }
    });
    refreshing = run.catch(() => undefined);
    return run;
  }

  await engine.run();
  await engine.ensureCurrentBuildFinish();
  await waitForOutput(0);
  // The engine reports a save through the updates it compiles for its
  // clients. This client is the server itself: it guarantees a report (and a
  // compile error, if any) for every save, whether or not an app is connected.
  await engine.registerClient(SERVER_CLIENT_ID);
  if (state.current === null) {
    const cause = state.lastError;
    state.closed = true;
    await engine.close().catch(() => undefined);
    throw (
      cause ??
      new VifxError({
        code: "VIFX_INTERNAL_ERROR",
        message: "The dev engine produced no bundle.",
      })
    );
  }
  state.started = true;

  return {
    async close() {
      state.closed = true;
      await engine.close();
    },
    async getBundle() {
      await refresh();
      // The bundle refers to its assets by URL: they must be on disk first.
      await state.assetWrites;
      if (state.current === null) {
        throw (
          state.lastError ??
          new VifxError({ code: "VIFX_INTERNAL_ERROR", message: "No bundle is available." })
        );
      }
      return state.current;
    },
    notifyPatchDelivered(filename) {
      void engine.notifyPayloadDelivered(filename).catch(() => undefined);
    },
    registerClient(clientId) {
      void engine.registerClient(clientId).catch(() => undefined);
    },
    removeClient(clientId) {
      void engine.removeClient(clientId).catch(() => undefined);
    },
    async requestFullBuild() {
      const version = state.current?.version ?? 0;
      engine.triggerFullBuild();
      await engine.ensureLatestBuildOutput();
      await waitForOutput(version);
    },
  };
}
