import { expect, test } from "vite-plus/test";
import type { VifxBundleArtifacts } from "@vifx/types";
import { composeRebuildReport } from "../src/index.ts";

function metroArtifacts(overrides: Partial<VifxBundleArtifacts> = {}): VifxBundleArtifacts {
  return {
    assets: [],
    bundle: { path: "index.bundle", sizeBytes: 1 },
    entry: "./index.js",
    mode: "expo",
    platform: "ios",
    projectRoot: "/tmp/app",
    runtime: null,
    sourceMap: null,
    rebuildTimings: { transformMs: 120, serializeMs: 35, writeMs: 40, totalMs: 195 },
    moduleGraph: {
      moduleIds: new Map([["a.ts", 0]]),
      modules: [
        { dependencyIds: [], factory: "f0", fileName: "a.ts", id: 0 },
        { dependencyIds: [], factory: "f1", fileName: "b.ts", id: 1 },
      ],
    },
    ...overrides,
  };
}

test("composeRebuildReport sums the phase timings and attributes applyMs distinctly", () => {
  const report = composeRebuildReport({
    artifacts: metroArtifacts(),
    applyMs: 15,
    cycle: 3,
    hmr: "fast-refresh",
  });

  expect(report.cycle).toBe(3);
  expect(report.hmr).toBe("fast-refresh");
  expect(report.phases).toEqual({
    transformMs: 120,
    serializeMs: 35,
    writeMs: 40,
    applyMs: 15,
    // total is recomputed from the metro phases + applyMs, not copied from
    // rebuildTimings.totalMs (which excludes apply).
    totalMs: 210,
  });
  expect(report.moduleCount).toBe(2);
  // changedPaths is omitted by design (the watcher does not propagate it).
  expect(report.changedPaths).toBeUndefined();
});

test("composeRebuildReport re-derives the per-cycle hitRate from the cache delta", () => {
  // On the dev metro path buildExpoBundle stuffs the PER-CYCLE delta into
  // cacheStats (hits/misses/writes); the report layer turns it back into a
  // VifxCycleCacheStats with the computed hitRate.
  const report = composeRebuildReport({
    artifacts: metroArtifacts({
      cacheStats: { hits: 11, misses: 1, writes: 1, errors: 0 },
    }),
    applyMs: 5,
    cycle: 1,
    hmr: "fast-refresh",
  });

  expect(report.cache).toEqual({
    hits: 11,
    misses: 1,
    computed: 1,
    hitRate: 11 / 12,
  });
});

test("composeRebuildReport reports a 0 hitRate (not NaN) when nothing was looked up", () => {
  const report = composeRebuildReport({
    artifacts: metroArtifacts({
      cacheStats: { hits: 0, misses: 0, writes: 0, errors: 0 },
    }),
    applyMs: 0,
    cycle: 1,
    hmr: "reload",
  });

  expect(report.cache).toEqual({ hits: 0, misses: 0, computed: 0, hitRate: 0 });
});

test("composeRebuildReport omits cache when the artifacts carry no delta", () => {
  const report = composeRebuildReport({
    artifacts: metroArtifacts({ cacheStats: undefined }),
    applyMs: 2,
    cycle: 1,
    hmr: "fast-refresh",
  });

  expect(report.cache).toBeUndefined();
});

test("composeRebuildReport tolerates artifacts without rebuildTimings (phases read as 0)", () => {
  const report = composeRebuildReport({
    artifacts: metroArtifacts({ rebuildTimings: undefined }),
    applyMs: 7,
    cycle: 1,
    hmr: "reload",
  });

  expect(report.phases).toEqual({
    transformMs: 0,
    serializeMs: 0,
    writeMs: 0,
    applyMs: 7,
    totalMs: 7,
  });
});
