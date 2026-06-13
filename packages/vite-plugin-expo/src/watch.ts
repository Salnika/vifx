import { stat, watch } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_IGNORED_SEGMENTS = new Set(["node_modules", ".git", ".vifx", "dist"]);

export type VifxBundleWatcherEvent =
  | { changedPaths: string[]; durationMs: number; type: "rebuild-done" }
  | { changedPaths: string[]; type: "rebuild-start" }
  | { error: unknown; type: "rebuild-error" }
  | { error: unknown; type: "watch-error" }
  | { filePath: string; type: "change" };

export interface CreateBundleWatcherOptions {
  /** Debounce window applied to change bursts before a rebuild. Default: 150ms. */
  debounceMs?: number;
  /**
   * Extra project-root-relative paths to ignore (for example the bundle
   * outDir). `node_modules`, `.git`, `.vifx`, `dist`, and dotfile segments are
   * always ignored.
   */
  ignore?: string[];
  onEvent?: (event: VifxBundleWatcherEvent) => void;
  projectRoot: string;
  rebuild: () => Promise<void> | void;
}

export interface VifxBundleWatcher {
  close: () => Promise<void>;
  /**
   * Feeds one change notification into the debounce/rebuild pipeline. The
   * filesystem watch loop calls this internally; synthetic drivers (tests,
   * other watch sources) may call it directly.
   */
  notify: (filePath: string) => void;
  /** Whether the recursive filesystem watch is active. */
  readonly watching: boolean;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function normalizeIgnoreEntry(projectRoot: string, entry: string) {
  const relativePath = toPosixPath(path.relative(projectRoot, path.resolve(projectRoot, entry)));
  return relativePath === "" ? null : relativePath;
}

function createIgnoredPathMatcher(projectRoot: string, ignore: string[]) {
  const ignoredPrefixes = ignore
    .map((entry) => normalizeIgnoreEntry(projectRoot, entry))
    .filter((entry): entry is string => entry !== null);

  return (filePath: string) => {
    const relativePath = toPosixPath(
      path.relative(projectRoot, path.resolve(projectRoot, filePath)),
    );
    if (relativePath === "" || relativePath.startsWith("../")) {
      return true;
    }

    const segments = relativePath.split("/");
    if (
      segments.some((segment) => segment.startsWith(".") || DEFAULT_IGNORED_SEGMENTS.has(segment))
    ) {
      return true;
    }

    return ignoredPrefixes.some(
      (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
    );
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Watches a project tree with `node:fs/promises` `watch({ recursive: true })`
 * and drives debounced, serialized rebuilds:
 *
 * - change bursts inside the debounce window trigger exactly one rebuild;
 * - rebuilds never overlap — changes observed while a rebuild is in flight
 *   coalesce into exactly one trailing rebuild;
 * - rebuild rejections are reported through `onEvent` and never escape.
 *
 * When recursive watching is unavailable (missing directory or unsupported
 * platform) the watcher degrades gracefully: `watching` is `false`, a
 * `watch-error` event is emitted, and `notify()` keeps working for synthetic
 * drivers.
 */
export async function createBundleWatcher(
  options: CreateBundleWatcherOptions,
): Promise<VifxBundleWatcher> {
  const projectRoot = path.resolve(options.projectRoot);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const isIgnoredPath = createIgnoredPathMatcher(projectRoot, options.ignore ?? []);
  const abortController = new AbortController();
  const pendingPaths = new Set<string>();
  let debounceTimer: NodeJS.Timeout | null = null;
  let activeRebuild: Promise<void> | null = null;
  let rerunRequested = false;
  let closed = false;
  let watching = false;
  let watchLoop: Promise<void> = Promise.resolve();

  const emitEvent = (event: VifxBundleWatcherEvent) => {
    options.onEvent?.(event);
  };

  const runSerializedRebuilds = async () => {
    do {
      rerunRequested = false;
      const changedPaths = [...pendingPaths];
      pendingPaths.clear();
      emitEvent({ changedPaths, type: "rebuild-start" });
      const startedAt = Date.now();

      try {
        // Defer one microtask so `activeRebuild` is assigned before any user
        // code runs; a synchronously-throwing rebuild would otherwise finish
        // this whole function (including `activeRebuild = null`) before the
        // scheduling assignment, stranding a stale non-null `activeRebuild`
        // that swallows every future change notification.
        await Promise.resolve().then(() => options.rebuild());
        emitEvent({ changedPaths, durationMs: Date.now() - startedAt, type: "rebuild-done" });
      } catch (error) {
        emitEvent({ error, type: "rebuild-error" });
      }
    } while (rerunRequested && !closed);

    activeRebuild = null;
  };

  const scheduleRebuild = () => {
    debounceTimer = null;
    activeRebuild = runSerializedRebuilds();
  };

  const notify = (filePath: string) => {
    if (closed || isIgnoredPath(filePath)) {
      return;
    }

    emitEvent({ filePath, type: "change" });
    pendingPaths.add(filePath);

    if (activeRebuild) {
      rerunRequested = true;
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(scheduleRebuild, debounceMs);
  };

  const consumeWatchEvents = async () => {
    try {
      const events = watch(projectRoot, { recursive: true, signal: abortController.signal });
      for await (const event of events) {
        if (event.filename) {
          notify(event.filename);
        }
      }
    } catch (error) {
      if (!isAbortError(error) && !closed) {
        emitEvent({ error, type: "watch-error" });
      }
    } finally {
      watching = false;
    }
  };

  const projectRootStats = await stat(projectRoot).catch((error: unknown) => {
    emitEvent({ error, type: "watch-error" });
    return null;
  });
  if (projectRootStats?.isDirectory()) {
    watching = true;
    watchLoop = consumeWatchEvents();
    // Give the recursive watch one event-loop turn to fail fast (for example
    // on platforms without recursive watch support) so callers observing
    // `watching` right after creation see the degraded state.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  } else if (projectRootStats) {
    emitEvent({
      error: new VifxError({
        code: "VIFX_EXPO_DEV_WATCH_UNAVAILABLE",
        message: `Watch root "${projectRoot}" is not a directory.`,
        hint: "Point the Expo dev server at the project directory that contains your app source.",
      }),
      type: "watch-error",
    });
  }

  return {
    close: async () => {
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingPaths.clear();
      abortController.abort();
      await watchLoop;
      await activeRebuild;
    },
    notify,
    get watching() {
      return watching;
    },
  };
}
