# Spike A4 — Incremental Fast Refresh HMR PoC: **NO-GO**

**Date:** 2026-06-15 · **Rolldown:** 1.0.1 · **Unit:** `batch/04-hmr-incremental-poc`
**Verdict:** **NO-GO** (measured). No implementation code written. The spike gate
(STEP 0 of the plan) was the whole job; it failed, so per the plan we STOP before
`incremental-serializer.ts` / `warm-graph.ts` / `buildModuleRegistryBundleIncremental`.

This was an explicit **high-risk / low-expectation bet**. The plan
(`PLAN-DIFFERENTIATION.md` §A4, §5, §6) flagged the Rolldown 1.0.1 types as
likely a clean NO-GO. The spike confirms that, and adds the empirical timing the
plan demanded for Variant A. **A measured NO-GO with evidence is the valid
outcome here** — not a forced GO.

---

## What we had to prove (plan §A4 / §5)

GO required, on the "easy case" (edit that changes neither the import graph nor
the touched module's line height, preserving its rank):

> median `t_save→t_paint` **< 300 ms** AND **≥ 2×** faster than the full-graph
> rebuild AND delta **byte-identical** to the full-graph oracle, **without** a
> `@hidden`/experimental unstable API.

The PoC depends on a single load-bearing assumption: that vifx can keep a **warm
build graph** and **re-serialize only the touched subgraph**, so the dominant
cost (re-transforming the whole graph) is avoided on each save. The spike tests
exactly that assumption against the two candidate Rolldown surfaces.

---

## Variant B (`DevEngine` → `__d`/`__r`): clean NO-GO by the types

`rolldown/experimental` exposes `DevEngine`. Its HMR entry point:

```ts
// node_modules/.pnpm/rolldown@1.0.1/.../rolldown/dist/experimental-index.d.mts:75
invalidate(file: string, firstInvalidatedBy?: string): Promise<BindingClientHmrUpdate[]>;
```

and the update payload (`dist/shared/binding-zH1vcmbM.d.mts:1424,1591`):

```ts
interface BindingClientHmrUpdate {
  clientId: string;
  update: BindingHmrUpdate;
}

type BindingHmrUpdate =
  | {
      type: "Patch";
      code: string;
      filename: string;
      sourcemap?: string;
      sourcemapFilename?: string;
      hmrBoundaries: Array<BindingHmrBoundaryOutput>;
    }
  | { type: "FullReload"; reason?: string }
  | { type: "Noop" };
```

This is the **Vite module-runner / `import.meta.hot`** patch format (`type:'Patch'`

- `hmrBoundaries`/`acceptedVia`). It is **never** the Metro `__d(...)` / `__r(...)`
  / `module.hot.accept` envelope that vifx's device runtime (FR-A..D) consumes via
  `computeHmrUpdate` + the injected HMR client. Bridging would mean re-deriving a
  Metro delta from a Vite patch — i.e. re-implementing the serializer anyway, on
  top of an experimental API. **Not coded**, exactly as the plan instructed.

## Variant A (warm `RolldownBuild` + re-call `generate()`): measured NO-GO

### Type surface (no incremental hook)

`RolldownBuild` (`dist/shared/define-config-CeKzMIcs.d.mts:1255`) exposes only:

```
closed (getter) · generate() · write() · close() · [Symbol.asyncDispose] · watchFiles (@hidden)
```

No public `invalidate` / `rebuild` / `hotUpdate`. The spike's runtime prototype
probe agrees:

```
all handle methods: ["closed","generate","write","close","watchFiles"]
handle methods matching invalidate/rebuild/hot/update/patch: []
```

There **is** an `experimental.incrementalBuild?: boolean` input option — but its
own docs say _"Required to be used with `watch` mode."_ It does not add any
re-callable incremental method to the warm `RolldownBuild` handle; the only way to
drive it is Rolldown's own `watch()` (a **second watcher** — forbidden by the
plan's "no second watcher: fs vs Rolldown" interdict) or `DevEngine` (Variant B,
the `Patch` format). The spike re-ran the warm-generate probe with
`incrementalBuild:true` and observed **no behavioral difference**.

### The decisive measurement: `generate()` has no transform cache

`spike-cache-isolation.mjs` — 400-leaf graph, a `transform`-hook counter, repeated
`generate()` on one warm handle:

```
generate#1 (cold):          25.1ms  transforms=401   files=401
generate#2 (NO edit):       17.5ms  transforms=401   files=401   <-- if cache, transforms≈0
generate#3 (1 leaf edited): 19.2ms  transforms=401   files=401   <-- if incremental, transforms≈1
generate#4 (1 leaf edited): 19.8ms  transforms=401   files=401
```

**`generate#2`, with no edit at all, re-transforms all 401 modules.** A warm
`RolldownBuild.generate()` re-runs the **entire** scan+transform pipeline on every
call — there is **no internal transform cache** to reuse, and no way to scope the
work to a changed subgraph. The "warm graph" buys nothing on the dominant phase.

(The small wall-clock drop 25→17ms across calls is pure V8 JIT / allocator warmup,
not caching — the transform count proves it: it stays pinned at 401.)

`spike-reread.mjs` confirms edits _are_ reflected (`generate()` re-reads from
disk every call), so this isn't a stale-output artifact — it is genuinely a full
re-transform each time:

```
after writing V0..V4 then generate(): bundle shows ["V0"]..["V4"]   (each edit reflected)
```

### Why this kills the GO criterion

The PoC's whole premise is "keep the graph warm, pay only the touched subgraph."
With `generate()` re-transforming the full graph unconditionally, the warm handle
saves **nothing** on transform — the single most expensive phase. On a real app
(HNewsPro-scale) the per-save cost stays **O(full graph)**, identical to the
current from-scratch `vite build()` path. There is no ≥2× win and no sub-subgraph
path to even attempt byte-identical partial re-serialization against. This matches
the plan's NO-GO clause: _"latency dominated by a non-compressible phase
(re-transform full because `generate()` has no cache)."_

---

## Secondary finding (plan asked to record it): hbc is OUT of the dev budget

The dev metro Fast Refresh rebuild closure (`runExpoGoRebuild`, `vite-plugin-expo/src/index.ts`)
runs `buildExpoBundle → computeHmrUpdate` over **plain JS module factories**.
There is **no `compileHermesBytecode` / hbc step** on the dev save path (hbc/
`transform.bytecode` only appears as a manifest URL query param, the export path,
not the served dev bundle). So hbc would _not_ have been in the latency budget —
the one favorable data point — but it does not rescue Variant A, since the
transform phase alone is already non-incremental.

---

## Conclusion

- **Variant B:** NO-GO — `DevEngine.invalidate()` yields a Vite `Patch`, never a
  Metro `__d`/`__r` delta. (types)
- **Variant A:** NO-GO — warm `RolldownBuild.generate()` re-transforms the entire
  graph every call; no transform cache, no public incremental method. (measured)
- **Net:** the warm-graph + partial-reserialize premise is not reachable on
  Rolldown 1.0.1 without an experimental, unstable, wrong-format path. **STOP.**

**GO-CONDITIONAL re-entry trigger (when to revisit, per plan §5):** a _public,
stable_ Rolldown incremental API on `RolldownBuild` (an `invalidate(file) →
re-transform only the changed subgraph` that does **not** require `watch()`), OR a
`DevEngine` update variant that can emit a Metro-format (`__d`/`__r`) delta. Until
then, A1 (instrumentation) already surfaces `serializeMs` so the moment the
transform phase becomes compressible, the serializer cost is the next thing to
measure. Nothing here blocks A1/A2/A3.

---

## Reproduce

From any checkout where `vp install` has populated `node_modules`:

```sh
node docs/spikes/a4-hmr-incremental/spike-warm-generate.mjs    # warm handle, method probe, incrementalBuild flag
node docs/spikes/a4-hmr-incremental/spike-cache-isolation.mjs  # 400-leaf transform-count proof (the decisive one)
node docs/spikes/a4-hmr-incremental/spike-reread.mjs           # confirms generate() re-reads disk each call
```

`resolve-rolldown.mjs` locates the transitively-installed `rolldown` package.
These scripts are **throwaway evidence**, kept here for auditability; they import
nothing from `src/` and touch no production code.

---

## Independent re-verification (resume pass, 2026-06-15)

The spike was re-run on a fresh checkout against `rolldown@1.0.1` to confirm the
NO-GO is reproducible and not an artifact of the original session. All three
pillars hold, plus the two type-surface claims were re-read straight from the
installed `.d.mts`:

- **Cache isolation (the decisive proof) — reproduced.** No-edit control
  `generate#2` re-transforms **all 401 modules** (`transforms=401`); the
  single-leaf edits at `generate#3/#4` also stay pinned at `401`. No transform
  cache. (Wall-clock 47→13 ms is JIT warmup; the transform count is the evidence.)
- **Method probe — reproduced.** `all handle methods: ["closed","generate",
  "write","close","watchFiles"]`; matches for `invalidate|rebuild|hot|update|patch`
  = `[]`, identical with `experimental.incrementalBuild:true` (still re-transforms
  every module after a single-file edit).
- **Re-read — reproduced.** Each of V0..V4 is reflected, so `generate()` genuinely
  re-reads disk and re-transforms each call (not stale output).
- **Types — re-read from installed `rolldown@1.0.1`.**
  `RolldownBuild` (`dist/shared/define-config-*.d.mts`) = `{ closed, generate(),
  write(), close(), [Symbol.asyncDispose] }` + `get watchFiles()` marked
  `@hidden not ready for public usage yet` — no public `invalidate`/`rebuild`/
  `hotUpdate`. `DevEngine.invalidate(file, firstInvalidatedBy?)`
  (`dist/experimental-index.d.mts:75`) → `Promise<BindingClientHmrUpdate[]>`, with
  `BindingHmrUpdate = {type:'Patch', code, filename, sourcemap?, hmrBoundaries} |
  {type:'FullReload'} | {type:'Noop'}` — Vite module-runner format, never
  `__d`/`__r`.
- **Secondary (hbc) — reconfirmed in source.** `runExpoGoRebuild`
  (`vite-plugin-expo/src/index.ts:1347`) runs `buildExpoBundle → computeHmrUpdate`
  with no hbc step; `transform.bytecode=1` is set only in a manifest-URL builder
  gated on `options.hermes` (l.344), off the dev save path. hbc is out of the dev
  budget — but does not rescue Variant A, whose transform phase is already
  non-incremental.

**Verdict unchanged: NO-GO.** No implementation code written (the gate failed, so
per plan §A4/§5 we stop before `incremental-serializer.ts` / `warm-graph.ts` /
`buildModuleRegistryBundleIncremental`). The GO-CONDITIONAL re-entry trigger above
still stands.
