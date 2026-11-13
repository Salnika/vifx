import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  createTransformCache,
  defaultTransformCacheDir,
  stableStringify,
  type TransformCache,
} from "../src/index.ts";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "vifx-transform-cache-test-"));
});

afterEach(async () => {
  await rm(cacheDir, { force: true, recursive: true });
});

function newCache(version = "1"): TransformCache {
  return createTransformCache({ cacheDir, version });
}

test("getOrCompute computes on a miss and serves from cache on a hit", async () => {
  const cache = newCache();
  let computeCount = 0;
  const compute = async () => {
    computeCount += 1;
    return `transformed:${computeCount}`;
  };

  const first = await cache.getOrCompute(["a.ts", "oxc", { lang: "ts" }], compute);
  const second = await cache.getOrCompute(["a.ts", "oxc", { lang: "ts" }], compute);

  expect(first).toBe("transformed:1");
  expect(second).toBe("transformed:1");
  expect(computeCount).toBe(1);
  expect(cache.stats()).toEqual({ hits: 1, misses: 1, writes: 1, errors: 0 });
});

test("a warm cache instance reads entries written by an earlier instance", async () => {
  const writer = newCache();
  await writer.getOrCompute(["warm.ts", "oxc"], async () => "warm-code");

  const reader = newCache();
  let recomputed = false;
  const value = await reader.getOrCompute(["warm.ts", "oxc"], async () => {
    recomputed = true;
    return "should-not-run";
  });

  expect(value).toBe("warm-code");
  expect(recomputed).toBe(false);
  expect(reader.stats()).toEqual({ hits: 1, misses: 0, writes: 0, errors: 0 });
});

test("getOrCompute round-trips a code-plus-map result", async () => {
  const cache = newCache();
  const map = { version: 3, sources: ["a.ts"], mappings: "AAAA" };

  const produced = await cache.getOrCompute(["with-map.ts"], async () => ({
    code: "code-with-map",
    map,
  }));
  expect(produced).toEqual({ code: "code-with-map", map });

  const reader = newCache();
  const cached = await reader.getOrCompute(["with-map.ts"], async () => "unused");
  expect(cached).toEqual({ code: "code-with-map", map });
});

test("each key part is significant: changing any part forces a miss", async () => {
  const base = ["file.ts", "oxc", { lang: "ts", jsx: false }, "1.0.0"] as const;
  const variants: readonly unknown[][] = [
    ["file.tsx", "oxc", { lang: "ts", jsx: false }, "1.0.0"], // content
    ["file.ts", "babel", { lang: "ts", jsx: false }, "1.0.0"], // transformer id
    ["file.ts", "oxc", { lang: "tsx", jsx: false }, "1.0.0"], // options value
    ["file.ts", "oxc", { lang: "ts", jsx: true }, "1.0.0"], // nested option
    ["file.ts", "oxc", { lang: "ts", jsx: false }, "2.0.0"], // version part
    ["file.ts", "oxc", { lang: "ts" }, "1.0.0"], // dropped option key
  ];

  const cache = newCache();
  let computeCount = 0;
  const compute = async () => {
    computeCount += 1;
    return `v${computeCount}`;
  };

  await cache.getOrCompute([...base], compute);
  for (const variant of variants) {
    await cache.getOrCompute(variant, compute);
  }

  // Base + every variant computed; nothing collided.
  expect(computeCount).toBe(1 + variants.length);
  expect(cache.stats().misses).toBe(1 + variants.length);
  expect(cache.stats().hits).toBe(0);
});

test("object key order does not affect the cache key", async () => {
  const cache = newCache();
  let computeCount = 0;
  const compute = async () => {
    computeCount += 1;
    return `v${computeCount}`;
  };

  await cache.getOrCompute([{ a: 1, b: 2, nested: { x: 1, y: 2 } }], compute);
  const second = await cache.getOrCompute([{ b: 2, a: 1, nested: { y: 2, x: 1 } }], compute);

  expect(second).toBe("v1");
  expect(computeCount).toBe(1);
  expect(cache.stats().hits).toBe(1);
});

test("the cache version invalidates every entry", async () => {
  const v1 = newCache("1");
  await v1.getOrCompute(["shared.ts"], async () => "from-v1");

  const v2 = newCache("2");
  let recomputed = false;
  const value = await v2.getOrCompute(["shared.ts"], async () => {
    recomputed = true;
    return "from-v2";
  });

  expect(value).toBe("from-v2");
  expect(recomputed).toBe(true);
  expect(v2.stats().misses).toBe(1);
});

test("entries are stored under <hash[0..2]>/<hash>.json", async () => {
  const cache = newCache();
  await cache.getOrCompute(["layout.ts"], async () => "layout-code");

  const shardDirs = await readdir(cacheDir);
  expect(shardDirs).toHaveLength(1);
  expect(shardDirs[0]).toMatch(/^[0-9a-f]{2}$/u);

  const entries = await readdir(path.join(cacheDir, shardDirs[0]!));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/u);
  expect(entries[0]!.startsWith(shardDirs[0]!)).toBe(true);
});

test("corrupted entries are treated as a miss and counted under errors", async () => {
  const cache = newCache();
  await cache.getOrCompute(["corrupt.ts"], async () => "original");

  // Overwrite the on-disk entry with non-JSON garbage.
  const shardDirs = await readdir(cacheDir);
  const shardPath = path.join(cacheDir, shardDirs[0]!);
  const entries = await readdir(shardPath);
  await writeFile(path.join(shardPath, entries[0]!), "{not valid json", "utf8");

  // A process that produced the entry keeps it in memory; corruption is met by
  // the next process that opens the cache directory.
  const reopened = newCache();
  let recomputed = false;
  const value = await reopened.getOrCompute(["corrupt.ts"], async () => {
    recomputed = true;
    return "recomputed";
  });

  expect(value).toBe("recomputed");
  expect(recomputed).toBe(true);
  expect(reopened.stats().errors).toBe(1);
});

test("without the memory option every request goes back to disk", async () => {
  const cache = newCache();
  await cache.getOrCompute(["disk-only.ts"], async () => "first");
  await rm(cacheDir, { force: true, recursive: true });

  const value = await cache.getOrCompute(["disk-only.ts"], async () => "second");

  // Nothing was kept in memory: the entry is gone with the directory.
  expect(value).toBe("second");
});

test("with memory: true a second request is answered from memory, not disk", async () => {
  const cache = createTransformCache({ cacheDir, memory: true, version: "1" });
  await cache.getOrCompute(["memory.ts"], async () => "first");

  // Remove the on-disk entries: only the in-memory copy can answer now.
  await rm(cacheDir, { force: true, recursive: true });

  let recomputed = false;
  const value = await cache.getOrCompute(["memory.ts"], async () => {
    recomputed = true;
    return "second";
  });

  expect(value).toBe("first");
  expect(recomputed).toBe(false);
  expect(cache.stats().hits).toBe(1);
});

test("entries with a missing code field are treated as a miss", async () => {
  const cache = newCache();
  await cache.getOrCompute(["bad-shape.ts"], async () => "original");

  const shardDirs = await readdir(cacheDir);
  const shardPath = path.join(cacheDir, shardDirs[0]!);
  const entries = await readdir(shardPath);
  await writeFile(path.join(shardPath, entries[0]!), JSON.stringify({ hasMap: false }), "utf8");

  const reopened = newCache();
  let recomputed = false;
  await reopened.getOrCompute(["bad-shape.ts"], async () => {
    recomputed = true;
    return "recomputed";
  });

  expect(recomputed).toBe(true);
  expect(reopened.stats().errors).toBe(1);
});

test("compute errors propagate and are not written to disk", async () => {
  const cache = newCache();

  await expect(
    cache.getOrCompute(["throws.ts"], async () => {
      throw new Error("boom");
    }),
  ).rejects.toMatchObject({ code: "VIFX_INTERNAL_ERROR" });

  // Nothing persisted; a subsequent successful compute is a fresh miss.
  let computed = false;
  const value = await cache.getOrCompute(["throws.ts"], async () => {
    computed = true;
    return "recovered";
  });
  expect(computed).toBe(true);
  expect(value).toBe("recovered");
  expect(cache.stats().writes).toBe(1);
});

test("stats accumulate across hits, misses, writes", async () => {
  const cache = newCache();
  await cache.getOrCompute(["one.ts"], async () => "1");
  await cache.getOrCompute(["two.ts"], async () => "2");
  await cache.getOrCompute(["one.ts"], async () => "1");
  await cache.getOrCompute(["one.ts"], async () => "1");

  expect(cache.stats()).toEqual({ hits: 2, misses: 2, writes: 2, errors: 0 });
});

test("snapshotDelta reports only the activity since the previous call", async () => {
  const cache = newCache();

  // First cycle: two distinct keys → two misses, both filled.
  await cache.getOrCompute(["a.ts"], async () => "a");
  await cache.getOrCompute(["b.ts"], async () => "b");
  expect(cache.snapshotDelta()).toEqual({
    hits: 0,
    misses: 2,
    computed: 2,
    hitRate: 0,
  });

  // Second cycle: one warm hit + one new miss → the delta reflects THIS cycle,
  // it does not accumulate the previous misses.
  await cache.getOrCompute(["a.ts"], async () => "a");
  await cache.getOrCompute(["c.ts"], async () => "c");
  expect(cache.snapshotDelta()).toEqual({
    hits: 1,
    misses: 1,
    computed: 1,
    hitRate: 0.5,
  });

  // Third cycle: nothing looked up → hitRate is 0, not NaN.
  expect(cache.snapshotDelta()).toEqual({
    hits: 0,
    misses: 0,
    computed: 0,
    hitRate: 0,
  });

  // A fully-warm cycle reports a 100% hit-rate, where cumulative stats would
  // already be diluted by the earlier misses.
  await cache.getOrCompute(["a.ts"], async () => "a");
  await cache.getOrCompute(["c.ts"], async () => "c");
  expect(cache.snapshotDelta()).toEqual({
    hits: 2,
    misses: 0,
    computed: 0,
    hitRate: 1,
  });
  // The cumulative stats meanwhile show the diluted lifetime view.
  expect(cache.stats()).toEqual({ hits: 3, misses: 3, writes: 3, errors: 0 });
});

test("snapshotDelta resets its baseline after clear", async () => {
  const cache = newCache();
  await cache.getOrCompute(["pre.ts"], async () => "pre");
  cache.snapshotDelta();

  await cache.clear();
  await cache.getOrCompute(["post.ts"], async () => "post");

  expect(cache.snapshotDelta()).toEqual({
    hits: 0,
    misses: 1,
    computed: 1,
    hitRate: 0,
  });
});

test("clear removes entries and resets counters", async () => {
  const cache = newCache();
  await cache.getOrCompute(["cleared.ts"], async () => "value");
  expect(cache.stats().writes).toBe(1);

  await cache.clear();
  expect(cache.stats()).toEqual({ hits: 0, misses: 0, writes: 0, errors: 0 });
  await expect(readdir(cacheDir)).rejects.toMatchObject({ code: "ENOENT" });

  let recomputed = false;
  await cache.getOrCompute(["cleared.ts"], async () => {
    recomputed = true;
    return "value";
  });
  expect(recomputed).toBe(true);
});

test("concurrent getOrCompute of the same key computes once", async () => {
  const cache = newCache();
  let computeCount = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const compute = async () => {
    computeCount += 1;
    await gate;
    return "shared";
  };

  const pending = Promise.all([
    cache.getOrCompute(["concurrent.ts"], compute),
    cache.getOrCompute(["concurrent.ts"], compute),
    cache.getOrCompute(["concurrent.ts"], compute),
  ]);
  release();
  const results = await pending;

  expect(results).toEqual(["shared", "shared", "shared"]);
  expect(computeCount).toBe(1);
  // One miss recorded; the duplicate callers coalesced onto the same in-flight job.
  expect(cache.stats().misses).toBe(1);
  expect(cache.stats().writes).toBe(1);

  // After settling, the same key is a hit.
  const after = await cache.getOrCompute(["concurrent.ts"], async () => "unused");
  expect(after).toBe("shared");
  expect(cache.stats().hits).toBe(1);
});

test("concurrent getOrCompute of distinct keys computes each once", async () => {
  const cache = newCache();
  const computed = new Set<string>();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_unused, index) =>
      cache.getOrCompute([`k${index}.ts`], async () => {
        computed.add(`k${index}`);
        return `code-${index}`;
      }),
    ),
  );

  expect(results).toEqual(Array.from({ length: 8 }, (_unused, index) => `code-${index}`));
  expect(computed.size).toBe(8);
  expect(cache.stats()).toEqual({ hits: 0, misses: 8, writes: 8, errors: 0 });
});

test("on-disk entries are valid JSON with the expected shape", async () => {
  const cache = newCache();
  await cache.getOrCompute(["json.ts"], async () => ({ code: "c", map: { mappings: "AAAA" } }));

  const shardDirs = await readdir(cacheDir);
  const shardPath = path.join(cacheDir, shardDirs[0]!);
  const entries = await readdir(shardPath);
  const raw = await readFile(path.join(shardPath, entries[0]!), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  expect(parsed.code).toBe("c");
  expect(parsed.hasMap).toBe(true);
  expect(parsed.map).toEqual({ mappings: "AAAA" });
});

test("stableStringify sorts object keys deterministically", () => {
  expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  expect(stableStringify([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  expect(stableStringify(undefined)).toBe("undefined");
  expect(stableStringify(null)).toBe("null");
});

test("defaultTransformCacheDir resolves under the project .vifx cache", () => {
  const dir = defaultTransformCacheDir("/projects/app");
  expect(dir).toBe(path.join("/projects/app", ".vifx", "cache", "transforms"));
});
