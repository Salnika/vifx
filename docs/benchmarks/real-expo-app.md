# Vifx vs Metro on a real OSS Expo app + warm-rebuild breakdown

> Date: 2026-06-16. Toolchain: vifx `master` (global `vifx` rebuilt from
> `packages/cli/dist/bin.mjs` after a full dependency-ordered `pnpm build`).
> Machine: darwin (single host, single runs unless noted). Network used only to
> clone/install the marquee app into `/tmp` (never committed).

This run does two things:

1. **Marquee attempt** — try to build a well-known OSS Expo app
   (`bluesky-social/social-app`) with vifx and **honestly report what does not
   build and why**. This is the roadmap-driving part.
2. **Validated reference** — re-confirm the HNewsPro numbers (build time, JS,
   Hermes `.hbc`, module count) on `master`, and add the **per-save warm-rebuild
   phase breakdown** measured live from the instrumented dev server.

No invented numbers. Every figure below was measured in this run.

---

## 1. Marquee app: `bluesky-social/social-app` (bsky.app v1.125.0)

- Repo: `github.com/bluesky-social/social-app` @ `9dc73d2` (depth-1 clone into `/tmp`).
- Expo SDK 54.0.34, React Native 0.81.5, React 19.1 — **same SDK/RN line as the
  validated HNewsPro reference**, so the platform tier is "validated".
- Install: `pnpm install --prefer-offline --ignore-scripts` → succeeded
  (1.3 GB `node_modules`, 1m36s). `--ignore-scripts` skips native prebuilds and
  the Lingui catalog compile step (relevant below).

**Result: it does NOT build with vifx.** The build reaches the real bundler and
fails with **44 errors** spanning four distinct, concrete blocker classes. This
is the expected and valuable outcome — each class is a real gap in vifx.

### What `vifx doctor` flags up front (before any build)

```
WARN  VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST
      metro.config.js:resolver.resolveRequest
UNSUP VIFX_UNSUPPORTED_METRO_SERIALIZER
      metro.config.js:serializer        (via @sentry/react-native/metro getSentryExpoConfig)
ACTION metro.config.js:resolver.assetExts   (xml, heic, avif, woff2 → vifx.config assetExtensions)
ACTION metro.config.js:resolver.sourceExts  (scss, sass, css → vifx.config resolver.extensions)
```

bsky's `metro.config.js` wraps `getSentryExpoConfig(__dirname)` (a custom
**serializer**), installs a custom **`resolver.resolveRequest`** (profiling-build
renderer swap), and pushes extra `assetExts`/`sourceExts`. The doctor surfaces
all of these as unsupported/manual before a single module is transformed.

### What actually blocks the build (the 44 errors)

| #   | Blocker class                             | Concrete instance                                                                                                                                               | Root cause                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **Babel preset gap: static class blocks** | `@atproto/api/dist/agent.js` → `SyntaxError: Static class blocks are not enabled. Please add @babel/plugin-transform-class-static-block`                        | vifx transforms this `node_modules` file through the project's Babel config with `caller.isNodeModule:true` / `supportsStaticESM:false`; the resulting plugin set omits `@babel/plugin-transform-class-static-block`, so modern `static { ... }` blocks in `@atproto/api` throw. Metro's preset handles it.                                                                |
| B2  | **Asset registry: duplicate 1x scale**    | `@react-navigation/elements/.../assets/clear-icon.png` and `close-icon.png` → `VifxError: Multiple asset variants declare scale 1x`                             | `assertUniqueAssetScales` (in `@vifx/asset-registry`) hard-fails when it groups two files it reads as the same `1x` variant. Metro tolerates the duplicate; vifx is stricter and aborts the build.                                                                                                                                                                         |
| B3  | **Unresolved generated catalogs**         | `Could not resolve './locales/ast/messages'`, `'./locales/an/messages'` in `src/locale/i18n.ts`                                                                 | bsky ships only Lingui **source** catalogs (50× `messages.po`); the imported `messages.ts` are produced by a `lingui compile` build step that `--ignore-scripts` (and any plain install) skips. This is a "needs a project build step vifx didn't run" gap, not a vifx bug per se — but vifx hard-fails on the missing module rather than degrading.                       |
| B4  | **Workspace-package config import**       | `vifx init` writes `import { defineVifxConfig } from "@vifx/config"`, which is **not resolvable from a fresh app's `node_modules`** → `VIFX_CONFIG_LOAD_FAILED` | `@vifx/config` is a monorepo workspace package, not published/linked into target projects. A user who runs the global `vifx` against any external app cannot load the config the CLI itself just generated. Worked around here by replacing it with a plain default-exported object (`defineVifxConfig` is an identity function), which is what let the build reach B1–B3. |

> The build printer truncates after the first few detailed frames, but the
> header is `Build failed with 44 errors`. The four classes above are the
> distinct categories observed; the bulk of the 44 are repeats of B1 (atproto
> packages lean on static blocks) and B3 (per-locale catalog imports).

### Honest read on the marquee app

bsky is a **legitimately hard** target: a custom Sentry Metro serializer, a
custom `resolveRequest`, a code-generated i18n catalog layer, and dependencies
(`@atproto/*`) using current-era JS syntax. **None of these is a vague "doesn't
work"** — each is a specific, fixable line item:

- **B4 is the cheapest and highest-leverage**: ship `@vifx/config` (or make
  `vifx init` emit a zero-import plain object) so any external project can even
  load its config. Today the CLI generates a config it cannot itself load.
- **B1 is a transform-preset fix**: ensure the node_modules Babel path enables
  `@babel/plugin-transform-class-static-block` (and, by extension, the rest of
  the current-syntax plugin set Metro applies to deps).
- **B2 is a strictness decision**: match Metro and tolerate duplicate-scale
  asset variants (warn, don't abort), or de-dupe before `assertUniqueAssetScales`.
- **B3 / serializer / resolveRequest** are larger: code-gen build steps,
  custom serializers, and `resolveRequest` hooks remain explicitly unsupported
  (the doctor says so). These gate any app that depends on them.

---

## 2. Validated reference: HNewsPro (re-confirmed on `master`)

App: HNewsPro — Expo SDK 54.0.33, RN 0.81.5, React 19.1, expo-router 6.
Method (apples-to-apples release path): same app, iOS, `--dev false`, the **same
`hermesc -O`** from `react-native/sdks/hermesc` for both bundlers.

- Metro: `expo export:embed --platform ios --dev false`
- Vifx: `vifx export:embed . --platform ios --dev false`
- Cold = transform cache cleared (`rm -rf .vifx` for vifx); warm = immediate
  re-run with a hot cache.

| Metric                          | Metro       | Vifx        | Delta                 |
| ------------------------------- | ----------- | ----------- | --------------------- |
| Build cold (JS bundle)          | 19.9 s      | **15.0 s**  | vifx −25%             |
| Rebuild warm (hot cache)        | 12.4 s      | **3.6 s**   | **vifx ~3.4× faster** |
| Hermes compile (.bundle→.hbc)   | 1.7 s       | ~1.7 s      | ~tie                  |
| Bundle JS (release)             | 3.54 MB     | **3.46 MB** | **vifx −2.2%**        |
| Bytecode Hermes (`.hbc`, ships) | **4.96 MB** | 5.24 MB     | metro −5.8%           |
| Modules / sources (sourcemap)   | 2007        | **1680**    | vifx −16%             |
| Assets emitted                  | 39          | 38          | ~tie                  |

Raw bytes measured this run: Metro JS 3,541,154 / hbc 4,956,093; vifx JS
3,463,833 / hbc 5,243,062. These match the prior `BENCHMARKS.md` figures within
run-to-run noise (warm vifx measured 3.6 / 3.9 / 3.4 s across three clean
isolated runs). The JS-smaller / hbc-larger split is unchanged: vifx's JS now
beats Metro (indirect-eval unblocks global mangling), but Hermes bytecode is
still +5.8% — driven by ~8k lazy `__esm`/`__export` getter-thunks Rolldown emits
for the CJS-heavy RN graph (see `BENCHMARKS.md` §Taille for the disassembler
diagnosis; not re-derived here).

> **Build-time caveat.** The headline warm/cold gap is real and reproducible
> (cold cache → 15.0 s, hot cache → 3.6 s = a true ~4× cache speedup for a
> _full from-scratch export_). But that 3.6 s is a **full hoisted export**, which
> is **not** the same code path as a per-save dev rebuild — see §3, where the
> warm per-save number is much higher.

---

## 3. Warm-rebuild phase breakdown (instrumented dev server, HNewsPro)

Captured live: `vifx expo dev . --platform ios --expo-go --fast-refresh --json`
running in the background, source files touched 7 times, NDJSON aggregated. Each
save emits one `VifxRebuildReport` line (`phases`, `cache`, `moduleCount`, `hmr`).

**7 fast-refresh rebuild cycles, median across saves:**

| Phase       | Median      | p95     | What it is                                                        |
| ----------- | ----------- | ------- | ----------------------------------------------------------------- |
| `transform` | **7340 ms** | 7740 ms | the single `await build()` (Babel transform + Rolldown re-bundle) |
| `serialize` | 428 ms      | 577 ms  | assemble the `__d`/`__r` registry + sourcemap                     |
| `write`     | 1295 ms     | 1455 ms | write bundle + map, asset rename, staging cleanup                 |
| `apply`     | **6.6 ms**  | 23.5 ms | HMR diff + `/hot` broadcast                                       |
| **total**   | **9069 ms** | 9626 ms |                                                                   |

- **Cache hit-rate per cycle = 1.00** every single save (1971 hits / 0 misses /
  0 computed). The content-addressed transform cache is doing its job perfectly.
- **`hmr` = `fast-refresh` on all 7 cycles** (state-preserving delta over `/hot`,
  not a full reload), `moduleCount = 2105`.

### Where warm-rebuild time actually goes — the honest finding

**~81% of every warm save is the `transform` phase (~7.3 s), and it is NOT the
transform cache's fault** — the cache is 100% hit. The cost is that the
`--fast-refresh` (metro-format) dev path runs a **full Rolldown re-bundle of all
2105 modules on every save**. The Babel transforms are all served from cache
(0 recomputed), but Rolldown still re-links the entire graph from scratch each
time. The actual HMR application (diff + broadcast) is essentially free at 6.6 ms.

This is the single clearest roadmap signal from this run: the warm DX bottleneck
is **incremental bundling**, not transform. A 100%-warm cache does not help once
the bottleneck is the full re-link. To make per-save rebuilds fast, vifx needs
**incremental/partial bundling** on the dev path (rebuild only the changed module
subgraph), not a faster transform cache. The `apply` phase being ~6 ms shows the
HMR wiring itself is already cheap.

> Note the asymmetry vs §2: the **hoisted full export** warms to ~3.6 s, but the
> **metro-format per-save dev rebuild** is ~9 s. Different code paths — the dev
> path pays for the metro module registry + HMR machinery + a full re-bundle.
> Reporting both honestly: the "3.4× faster" headline is the export path; the
> lived per-save dev experience on `--fast-refresh` is currently ~9 s/save and
> dominated by re-bundling.

---

## What didn't build, in one list (roadmap)

1. **`@vifx/config` not resolvable in external apps** — `vifx init` emits a
   config the global CLI can't load. (cheap fix, blocks every fresh project)
2. **node_modules Babel preset omits `@babel/plugin-transform-class-static-block`**
   (and likely sibling current-syntax plugins) → modern deps like `@atproto/api`
   fail to transform.
3. **Asset registry aborts on duplicate-scale variants** (`assertUniqueAssetScales`)
   where Metro tolerates them (`@react-navigation/elements` icons).
4. **Custom Metro `serializer` unsupported** (bsky uses `@sentry/react-native`'s).
5. **Custom Metro `resolver.resolveRequest` unsupported** (flagged by doctor).
6. **No graceful handling of code-gen'd imports** (Lingui `messages.ts`): vifx
   hard-fails on the unresolved module instead of degrading.
7. **Warm per-save dev rebuild is re-bundle-bound (~7.3 s of ~9 s)** despite a
   100% transform-cache hit → needs incremental bundling, not a faster cache.

## Reproduce

```bash
HN=/path/to/HNewsPro ; B=/tmp/vifx-bench ; mkdir -p $B/metro $B/vifx
# Metro (cold then warm = run twice)
( cd "$HN" && node_modules/.bin/expo export:embed --platform ios --dev false \
  --bundle-output $B/metro/ios.bundle --sourcemap-output $B/metro/ios.map --assets-dest $B/metro/assets )
# Vifx (rm -rf "$HN/.vifx" first for a true cold run)
( cd "$HN" && vifx export:embed . --platform ios --dev false \
  --bundle-output $B/vifx/ios.bundle --sourcemap-output $B/vifx/ios.map --assets-dest $B/vifx/assets )
# Hermes (both, same compiler)
HERMESC="$HN/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
"$HERMESC" -emit-binary -O -out X.hbc X.bundle

# Warm per-save breakdown (background dev server, touch files, aggregate):
( cd "$HN" && vifx expo dev . --platform ios --expo-go --fast-refresh --json > $B/rebuilds.ndjson 2>&1 & )
# …edit >=5 source files with pauses, then kill the server…
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(x=>x&&typeof x.cycle==="number");const med=x=>x.slice().sort((a,b)=>a-b)[x.length>>1];for(const k of["transformMs","serializeMs","writeMs","applyMs","totalMs"])console.log(k,med(r.map(x=>x.phases?.[k]??0)));console.log("hitRate",r.map(x=>x.cache?.hitRate))' $B/rebuilds.ndjson

# Marquee attempt (expected to fail — capture the errors):
git clone --depth 1 https://github.com/bluesky-social/social-app.git /tmp/social-app
( cd /tmp/social-app && pnpm install --prefer-offline --ignore-scripts && vifx doctor . )
# (replace the @vifx/config import in vifx.config.ts with a plain object to reach the bundler)
( cd /tmp/social-app && vifx export:embed . --platform ios --dev false \
  --bundle-output /tmp/bsky.bundle --sourcemap-output /tmp/bsky.map --assets-dest /tmp/bsky-assets )
```
