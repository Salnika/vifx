import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toVifxError } from "@vifx/errors";
import type { VifxCycleCacheStats, VifxTransformCacheStats } from "@vifx/types";

/**
 * A transform result that carries both code and an optional source map.
 */
export interface TransformCacheResultWithMap {
  code: string;
  map?: unknown;
}

/**
 * The value a {@link TransformCacheCompute} function may return: either a bare
 * code string, or a {@link TransformCacheResultWithMap} carrying a source map.
 */
export type TransformCacheValue = string | TransformCacheResultWithMap;

/**
 * The expensive computation whose result should be cached on disk.
 */
export type TransformCacheCompute = () => Promise<TransformCacheValue>;

export interface CreateTransformCacheOptions {
  /**
   * Absolute (or process-cwd relative) directory where cache entries are
   * stored. Created on demand. Entries live at
   * `<cacheDir>/<hash[0..2]>/<hash>.json`.
   */
  cacheDir: string;
  /**
   * A cache-format/tooling version string mixed into every key. Bump this to
   * invalidate every entry at once (e.g. when the on-disk schema changes).
   */
  version: string;
}

export interface TransformCache {
  /**
   * Returns the cached transform for `keyParts`, computing and persisting it on
   * a miss. The key is the SHA-256 of a stable stringify of `keyParts` (object
   * keys sorted) combined with the cache `version`. Any change to any key part
   * yields a different key and therefore a miss.
   *
   * Cache reads never throw on corrupted or unreadable entries: such entries are
   * treated as a miss and counted under {@link TransformCacheStatsSnapshot.errors}.
   * If `compute` throws, the error propagates and nothing is written.
   */
  getOrCompute(
    keyParts: readonly unknown[],
    compute: TransformCacheCompute,
  ): Promise<TransformCacheValue>;
  /** Returns a snapshot of cache counters since creation (or last {@link clear}). */
  stats(): TransformCacheStatsSnapshot;
  /**
   * Returns hit/miss activity for the SINGLE cycle since the previous
   * `snapshotDelta()` call (or since creation/{@link clear} for the first call),
   * then advances the baseline so the next call observes only the next cycle.
   *
   * This is what instrumentation surfaces as the per-cycle hit-rate: unlike
   * {@link stats} (cumulative, which converges toward ~100% on a warm cache and
   * hides per-save behavior), the delta reflects exactly what one rebuild looked
   * up. `computed` counts entries written this cycle (cache-filling misses);
   * `hitRate` is `hits / (hits + misses)` for the cycle, or 0 when nothing was
   * looked up.
   */
  snapshotDelta(): VifxCycleCacheStats;
  /** Removes the entire cache directory and resets counters. Never throws. */
  clear(): Promise<void>;
}

/**
 * Snapshot of cache activity. Mirrors {@link VifxTransformCacheStats} so callers
 * can surface it on build artifacts without an extra mapping.
 */
export type TransformCacheStatsSnapshot = VifxTransformCacheStats;

interface DiskEntry {
  code: string;
  map?: unknown;
  hasMap: boolean;
}

/**
 * Deterministically serialize a value so that semantically equal inputs produce
 * byte-identical strings regardless of object key insertion order. Used as the
 * pre-image of the cache key hash.
 */
export function stableStringify(value: unknown): string {
  return serializeStable(value);
}

function serializeStable(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  const valueType = typeof value;

  if (valueType === "number") {
    const numeric = value as number;
    return Number.isFinite(numeric) ? JSON.stringify(numeric) : `"${numeric.toString()}"`;
  }

  if (valueType === "bigint") {
    return `"${(value as bigint).toString()}n"`;
  }

  if (valueType === "boolean" || valueType === "string") {
    return JSON.stringify(value);
  }

  if (valueType === "function" || valueType === "symbol") {
    return JSON.stringify(`[${valueType}]`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeStable(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${serializeStable(record[key])}`);
  return `{${entries.join(",")}}`;
}

function computeKey(version: string, keyParts: readonly unknown[]): string {
  const hash = createHash("sha256");
  hash.update("vifx-transform-cache ");
  hash.update(version);
  hash.update(" ");
  hash.update(serializeStable(keyParts));
  return hash.digest("hex");
}

function entryPathForKey(cacheDir: string, key: string): string {
  return path.join(cacheDir, key.slice(0, 2), `${key}.json`);
}

function toCacheValue(entry: DiskEntry): TransformCacheValue {
  if (entry.hasMap) {
    return { code: entry.code, map: entry.map };
  }

  return entry.code;
}

function toDiskEntry(value: TransformCacheValue): DiskEntry {
  if (typeof value === "string") {
    return { code: value, hasMap: false };
  }

  if ("map" in value && value.map !== undefined) {
    return { code: value.code, hasMap: true, map: value.map };
  }

  return { code: value.code, hasMap: false };
}

function isValidDiskEntry(value: unknown): value is DiskEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.hasMap === "boolean";
}

/**
 * Create a persistent, content-addressed transform cache backed by the
 * filesystem. Safe to share across concurrent transforms in a single process;
 * cross-process safety is best-effort via atomic temp-file renames.
 */
export function createTransformCache(options: CreateTransformCacheOptions): TransformCache {
  const cacheDir = path.resolve(options.cacheDir);
  const { version } = options;

  let hits = 0;
  let misses = 0;
  let writes = 0;
  let errors = 0;

  // Baselines captured at the last `snapshotDelta()` (or creation/`clear()`), so
  // each call reports only the activity of the cycle that elapsed since.
  let deltaHitsBaseline = 0;
  let deltaMissesBaseline = 0;
  let deltaWritesBaseline = 0;

  const inFlight = new Map<string, Promise<TransformCacheValue>>();

  async function readEntry(key: string): Promise<TransformCacheValue | null> {
    const entryPath = entryPathForKey(cacheDir, key);

    let raw: string;
    try {
      raw = await readFile(entryPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      errors += 1;
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidDiskEntry(parsed)) {
        errors += 1;
        return null;
      }

      return toCacheValue(parsed);
    } catch {
      errors += 1;
      return null;
    }
  }

  async function writeEntry(key: string, value: TransformCacheValue): Promise<void> {
    const entryPath = entryPathForKey(cacheDir, key);
    const serialized = JSON.stringify(toDiskEntry(value));

    try {
      await mkdir(path.dirname(entryPath), { recursive: true });
      const tmpPath = path.join(
        path.dirname(entryPath),
        `.${key}.${process.pid.toString(36)}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      await writeFile(tmpPath, serialized, "utf8");
      try {
        await rename(tmpPath, entryPath);
      } catch (renameError) {
        await rm(tmpPath, { force: true }).catch(() => undefined);
        throw renameError;
      }
      writes += 1;
    } catch {
      errors += 1;
    }
  }

  async function compute(
    key: string,
    keyParts: readonly unknown[],
    computeFn: TransformCacheCompute,
  ): Promise<TransformCacheValue> {
    const cached = await readEntry(key);
    if (cached !== null) {
      hits += 1;
      return cached;
    }

    misses += 1;

    let produced: TransformCacheValue;
    try {
      produced = await computeFn();
    } catch (error) {
      throw toVifxError(error, {
        code: "VIFX_INTERNAL_ERROR",
        message: "Transform cache compute callback failed.",
        details: { keyPartCount: keyParts.length },
      });
    }

    await writeEntry(key, produced);
    return produced;
  }

  return {
    async getOrCompute(keyParts, computeFn) {
      const key = computeKey(version, keyParts);

      const existing = inFlight.get(key);
      if (existing) {
        return existing;
      }

      const pending = compute(key, keyParts, computeFn).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
      return pending;
    },
    stats() {
      return { hits, misses, writes, errors } satisfies TransformCacheStatsSnapshot;
    },
    snapshotDelta() {
      const cycleHits = hits - deltaHitsBaseline;
      const cycleMisses = misses - deltaMissesBaseline;
      const cycleComputed = writes - deltaWritesBaseline;
      deltaHitsBaseline = hits;
      deltaMissesBaseline = misses;
      deltaWritesBaseline = writes;

      const lookups = cycleHits + cycleMisses;
      return {
        hits: cycleHits,
        misses: cycleMisses,
        computed: cycleComputed,
        hitRate: lookups === 0 ? 0 : cycleHits / lookups,
      } satisfies VifxCycleCacheStats;
    },
    async clear() {
      inFlight.clear();
      hits = 0;
      misses = 0;
      writes = 0;
      errors = 0;
      deltaHitsBaseline = 0;
      deltaMissesBaseline = 0;
      deltaWritesBaseline = 0;
      try {
        await rm(cacheDir, { force: true, recursive: true });
      } catch {
        errors += 1;
      }
    },
  } satisfies TransformCache;
}

/**
 * Default on-disk location for the transform cache within a project root.
 */
export function defaultTransformCacheDir(projectRoot: string): string {
  return path.join(projectRoot, ".vifx", "cache", "transforms");
}

/**
 * Fallback cache directory under the OS temp dir, used when no project root is
 * available.
 */
export function temporaryTransformCacheDir(namespace: string): string {
  return path.join(tmpdir(), "vifx-transform-cache", namespace);
}
