# Expo (Metro) vs vifx — full benchmark, November 2026

> Date: 2026-11-12. vifx `master` + the fixes listed in §4 (found by this run).
> Machine: Apple M4 Pro (14 cores), 24 GB, macOS (Darwin 25.5), Node 26.13.
> Harness: [`scripts/bench/expo-vs-vifx.mjs`](../../scripts/bench/expo-vs-vifx.mjs)
> (`pnpm bench:expo`). Every figure below was measured in this run.

## Update — 2026-11-13, after the Expo Go validation

The second pass below was then run in Expo Go on a simulator, which found
eight defects (see the [project status](../../apps/docs/guide/status.md), "Expo Go validation"). Their fixes change what
is bundled — React Native's `console` polyfill is included again, the dev
bundle runs in a function scope, module ids are project-relative — so the
whole benchmark was run again on the fixed code (same app, iOS, 3 warm runs,
median):

| Metric                                         |     Metro |      vifx |   Delta |
| ---------------------------------------------- | --------: | --------: | ------: |
| `export:embed` release, cold                   |   15.18 s |    4.55 s | −70.0 % |
| `export:embed` release, warm                   |    8.71 s |    1.57 s | −82.0 % |
| `export:embed` dev, cold                       |   12.78 s |    4.73 s | −63.0 % |
| `export:embed` dev, warm                       |    9.05 s |    1.43 s | −84.2 % |
| Peak memory, release cold (process tree)       |  3,823 MB |  2,959 MB | −22.6 % |
| Peak memory, release warm (process tree)       |  1,070 MB |  1,229 MB | +14.9 % |
| Peak memory, dev cold (process tree)           |  3,511 MB |  2,911 MB | −17.1 % |
| Peak memory, dev warm (process tree)           |  1,346 MB |  1,033 MB | −23.3 % |
| Release JS bundle                              |   3.54 MB |   3.37 MB |  −4.9 % |
| Hermes bytecode                                |   4.96 MB |   5.15 MB |  +3.9 % |
| Hermes compile                                 |    1.35 s |    1.53 s | +13.4 % |
| Dev server, cold: server answering             |    1.46 s |    0.63 s | −56.6 % |
| Dev server, cold: first bundle served          |    9.03 s |    4.58 s | −49.2 % |
| Dev server, warm: first bundle served          |    5.59 s |    1.66 s | −70.3 % |
| Repeat bundle fetch                            |    0.14 s |    0.01 s | −93.3 % |
| Edit → Fast Refresh update received by the app |    0.14 s |    0.05 s | −63.6 % |
| Edit → new full bundle available               |    0.18 s |    0.18 s |  +3.9 % |
| Dev bundle served                              |  11.47 MB |  10.83 MB |  −5.6 % |
| Dev bundle and update accepted by Hermes       | yes / yes | yes / yes |         |

Same picture as the second pass. Still behind Metro: **Hermes bytecode size
(+3.9 %) and compile time (+13 %)**, **peak memory of a warm release build
(+15 %)**, and the full bundle after an edit, level to within 4 %. In Expo Go
itself, a save was on screen 33–87 ms after it was written (time until the app
acknowledged the patch, as printed by `vifx expo dev`); no such on-device
figure was taken for Metro.

## Update — 2026-11-13, second pass

The first pass (everything from "Scope" down, dated 2026-11-12) left vifx
behind Metro on the edit loop, the cold dev-server start, memory and Hermes
bytecode. Three changes later, same app (iOS), same machine, 3 warm
runs per cell, median reported:

| Metric                                         |     Metro |      vifx |   Delta |
| ---------------------------------------------- | --------: | --------: | ------: |
| `export:embed` release, cold                   |   14.32 s |    4.35 s | −69.6 % |
| `export:embed` release, warm                   |    8.78 s |    1.58 s | −82.0 % |
| `export:embed` dev, cold                       |   12.39 s |    4.46 s | −64.0 % |
| `export:embed` dev, warm                       |    9.02 s |    1.44 s | −84.1 % |
| Peak memory, release cold (process tree)       |  3,543 MB |  3,425 MB |  −3.3 % |
| Peak memory, release warm (process tree)       |  1,030 MB |  1,236 MB | +20.0 % |
| Peak memory, dev cold (process tree)           |  3,821 MB |  3,278 MB | −14.2 % |
| Peak memory, dev warm (process tree)           |  1,315 MB |    995 MB | −24.3 % |
| Release JS bundle                              |   3.54 MB |   3.36 MB |  −5.1 % |
| Hermes bytecode                                |   4.96 MB |   5.14 MB |  +3.7 % |
| Dev server, cold: server answering             |    1.35 s |    0.72 s | −46.5 % |
| Dev server, cold: first bundle served          |    8.77 s |    4.39 s | −49.9 % |
| Dev server, warm: first bundle served          |    5.40 s |    1.58 s | −70.8 % |
| Repeat bundle fetch                            |    0.13 s |    0.01 s | −91.8 % |
| Edit → Fast Refresh update received by the app |    0.14 s |    0.06 s | −57.8 % |
| Edit → new full bundle available               |    0.18 s |    0.18 s |     tie |
| Dev bundle and update accepted by Hermes       | yes / yes | yes / yes |         |

(vifx's two warm-memory rows come from a vifx-only re-run made right after the
last change of this pass — the transform cache no longer keeps a copy of every
entry in memory for one-shot builds; the full run just before it read 1,278 MB
and 1,038 MB.)

Still behind Metro: **Hermes bytecode size (+3.7 %)** and **peak memory of a
warm release build (+20 %)**. The full bundle after an edit is a tie. Everything
else measured is ahead.

What changed:

1. **Rolldown's dev engine drives the Expo Go dev server** (development, default
   `hoisted` format). The module graph stays alive between saves; a save
   compiles only the changed modules into a patch that the app applies in place.
   The in-app side is a small ES5 runtime that applies Metro's Fast Refresh
   rules (component-only modules are boundaries, anything else propagates to
   its importers, no boundary means a reload) on top of Rolldown's module
   store. The full bundle is brought up to date in the background for the next
   reload. If the engine cannot start, the server falls back to the previous
   rebuild-and-reload loop by itself; `VIFX_DEV_ENGINE=0` forces that loop.
2. **Babel runs on worker threads** under load (the project's own
   `@babel/core`, up to 8 threads, `VIFX_BABEL_WORKERS` to override). A lone
   transform stays on the main thread, so a save never pays for a thread start.
3. **The dev server listens before it bundles**, like `expo start`: `/status`
   answers at once and the first request waits for the bundle.

Measurement changes, so the two tools are compared like for like:

- **Memory is the sum over the process tree**, sampled every 100 ms.
  `/usr/bin/time` reports only the largest process, which counts vifx's worker
  threads in full and none of Metro's worker processes (first pass: "496 MB vs
  1,506 MB"). The largest-process figure is still in the generated report.
- **Fast Refresh latency is measured on the `/hot` socket**, as the app
  receives it, for both tools. "New full bundle available" (polling the bundle
  URL) is kept, but it only matters for a reload.
- The harness compiles the served dev bundle and one update with the project's
  `hermesc`. This caught a real defect during development: Rolldown's stock dev
  runtime uses `class`, which this Hermes rejects.

Not verified: the dev engine's Fast Refresh has been exercised against real
Rolldown patches with the real `react-refresh` runtime in a JS sandbox
(`packages/vite-plugin-react-native/tests/dev-runtime.test.ts`) and its output
parses in Hermes, but **it has not been run inside Expo Go on a device or
simulator** in this pass.

## Scope — read this first

The goal was to benchmark a well-known **open-source** Expo app. The app picked
is `bluesky-social/social-app` v1.138.0 (Expo SDK 58, React Native 0.88, pnpm).
It was cloned and installed, but **it has not been built or measured**: the
agent session that ran this benchmark was not permitted to execute the cloned
project's code (its codegen scripts, its Metro config, its Babel plugins), and
building an app is exactly that. See §5 for where it stands and how to finish.

What _was_ measured, end to end, is **a real but private Expo SDK 54 app**
(React Native 0.81.5, expo-router 6, Reanimated 4, ~2,000 modules),
installed with pnpm's default isolated layout. Treat the numbers as "one real
mid-size app on one machine", not as a general claim.

## 1. Method

Same checkout, same machine, tools run one after the other.

- **Metro** = the project's own `expo` CLI: `expo export:embed` and `expo start`.
- **vifx** = `vifx export:embed` and `vifx expo dev --expo-go` from the built CLI.
- **Cold** = caches emptied first (`--reset-cache` / `--clear` for Metro, the
  project's `.vifx/` directory removed for vifx). One cold run per cell.
- **Warm** = immediate re-run with caches in place. Three runs, median reported.
- **Hermes** = the same `hermesc -O` from the project's `react-native` for both.
- **Peak RSS** comes from `/usr/bin/time -l`: it is the largest _single process_
  of the tree. Metro spreads transforms over worker processes and vifx works in
  one, so this column understates Metro's total footprint. It is not a like-for-like
  total-memory comparison.
- **Dev server**: time from process start to the first bundle fully downloaded
  (the manifest is fetched first, as a device would), then three "append a line
  to `app/_layout.tsx` → the served bundle contains it" cycles on the warm server.

Not measured (needs a device): startup time, TTI, memory and frame rate of the
running app. No app was launched; "builds and compiles to bytecode" is the
strongest claim made here about the bundles.

## 2. Results

Delta is vifx relative to Metro; negative is better for vifx except where noted.

### Release bundle (`export:embed --dev false`)

| Metric              | iOS Metro | iOS vifx | Delta     | Android Metro | Android vifx | Delta     |
| ------------------- | --------- | -------- | --------- | ------------- | ------------ | --------- |
| Cold build          | 16.23 s   | 11.81 s  | **−27 %** | 14.13 s       | 11.85 s      | **−16 %** |
| Warm build (median) | 9.12 s    | 3.26 s   | **−64 %** | 9.28 s        | 3.26 s       | **−65 %** |
| JS bundle           | 3.54 MB   | 3.36 MB  | −5.1 %    | 3.54 MB       | 3.36 MB      | −5.1 %    |
| JS bundle, gzip     | 0.88 MB   | 0.88 MB  | tie       | 0.88 MB       | 0.88 MB      | tie       |
| Hermes bytecode     | 4.96 MB   | 5.14 MB  | +3.7 %    | 4.95 MB       | 5.13 MB      | +3.6 %    |
| Hermes compile      | 1.46 s    | 1.56 s   | +6.9 %    | 1.47 s        | 1.52 s       | +3.3 %    |
| Source map          | 11.66 MB  | 9.64 MB  | see §3    | 11.65 MB      | 9.66 MB      | see §3    |
| Asset files         | 39        | 38       | −1        | 44            | 38           | −6        |
| Peak RSS, cold      | 496 MB    | 1,506 MB | +204 %    | 557 MB        | 1,461 MB     | +162 %    |
| Peak RSS, warm      | 565 MB    | 1,297 MB | +130 %    | 568 MB        | 1,261 MB     | +122 %    |

### Development bundle (`export:embed --dev true`)

| Metric              | iOS Metro | iOS vifx | Delta     | Android Metro | Android vifx | Delta     |
| ------------------- | --------- | -------- | --------- | ------------- | ------------ | --------- |
| Cold build          | 12.71 s   | 12.87 s  | tie       | 12.64 s       | 13.05 s      | +3 %      |
| Warm build (median) | 9.44 s    | 3.14 s   | **−67 %** | 9.46 s        | 3.18 s       | **−66 %** |
| JS bundle           | 11.47 MB  | 8.36 MB  | −27 %     | 11.46 MB      | 8.36 MB      | −27 %     |
| Peak RSS, cold      | 774 MB    | 1,227 MB | +58 %     | 766 MB        | 1,250 MB     | +63 %     |
| Peak RSS, warm      | 758 MB    | 1,090 MB | +44 %     | 764 MB        | 1,073 MB     | +40 %     |

### Dev server (`expo start` vs `vifx expo dev --expo-go`)

| Metric                           | iOS Metro | iOS vifx | Delta          | Android Metro | Android vifx | Delta          |
| -------------------------------- | --------- | -------- | -------------- | ------------- | ------------ | -------------- |
| Cold start → server answering    | 1.34 s    | 12.78 s  | +11.4 s        | 1.52 s        | 13.21 s      | +11.7 s        |
| Cold start → first bundle served | 8.98 s    | 12.79 s  | +42 %          | 10.24 s       | 13.23 s      | +29 %          |
| Warm start → first bundle served | 5.53 s    | 3.26 s   | **−41 %**      | 6.38 s        | 3.50 s       | **−45 %**      |
| Repeat bundle fetch              | 0.14 s    | 0.01 s   | —              | 0.15 s        | 0.01 s       | —              |
| **Edit → new bundle available**  | 0.19 s    | 3.60 s   | **19× slower** | 0.20 s        | 3.50 s       | **18× slower** |

## 3. Reading the numbers

**Where vifx is ahead**

- **Warm builds are ~2.8–3× faster** (3.2 s vs 9.1–9.5 s), release and dev,
  both platforms. This is the most robust result of the run: every warm sample
  agrees, and it is what CI and repeated local exports pay for.
- **Cold release builds are 16–27 % faster.** Cold dev builds are a tie.
- **Restarting the dev server with a warm cache is ~40–45 % faster** to a first
  bundle (3.3–3.5 s vs 5.5–6.4 s).
- **Release JS is 5 % smaller**, largely from tree-shaking: Metro ships all of
  `@expo/vector-icons`' glyph maps (64 modules, 578 kB of source); vifx keeps the
  28 modules the app uses (32 kB). Gzipped, the two bundles are the same size.

**Where Metro is ahead**

- **The edit loop, by a wide margin: 0.2 s vs 3.5 s.** Metro rebuilds
  incrementally; vifx re-bundles the whole graph on every save. This is the
  number a developer feels all day, and it is the single biggest gap between the
  two tools. It was measured on vifx's default reload path; `--fast-refresh` was
  not re-measured here (June: ~9 s per save, same root cause).
- **Cold dev-server start: 9–10 s vs 13 s.** Metro answers in about a second and
  bundles on the first request; vifx builds the whole bundle before it listens.
- **Hermes bytecode is 3.7 % smaller** with Metro (4.96 vs 5.14 MB) — what
  actually ships in a release build. The gap was +5.8 % in June; the cause
  (Rolldown's lazy `__esm` / `__export` wrappers on a CommonJS-heavy graph) is
  unchanged.
- **Peak process memory**: vifx's single process peaks at 1.1–1.5 GB against
  0.5–0.8 GB for Metro's largest process (with the caveat in §1).

**Not comparable as measured**

- **Module count / source map.** Metro's map lists 2,001 modules, vifx's 1,626.
  Only part of that is tree-shaking. `expo-router` (108 modules) and
  `@react-navigation/*` (~170) have **no entry at all** in vifx's source map
  although their code is in the bundle. Stack frames inside those packages
  cannot be symbolicated. Cause not established yet; this is an open vifx bug.
- **Asset files** on Android (44 vs 38) differ and have not been diffed.

## 4. Bugs this benchmark found in vifx

The first full run looked much worse for vifx on size (release JS **+12 %**,
bytecode **+18 %**). Tracing that with
[`scripts/bench/compare-sources.mjs`](../../scripts/bench/compare-sources.mjs)
turned up two real defects, both fixed before the run reported above:

| Bug                                                                                                                                                                                | Effect                                                                                                                                                   | Fix                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Modules bundled twice on isolated installs.** A package reached through several `node_modules/<name>` symlinks was returned under each path, so one file became several modules. | 198 duplicated modules (`react-native-screens` ×47, `expo-modules-core` ×26, `expo` ×23…) — two live instances of the same module, not just extra bytes. | The resolver now answers with the real path (Node / Metro semantics). 198 → 0. |
| **Release builds transformed as development.** Babel was always called with `isDev: true`, whatever the bundle mode.                                                               | Production bundles carried the dev JSX runtime (`jsxDEV` + source locations) and skipped `api.env("production")` plugins.                                | `isDev` and Babel's `envName` follow the bundle mode; covered by a test.       |

Effect on the iOS release bundle: JS 3.97 → 3.36 MB, bytecode 5.84 → 5.14 MB,
cold build 15.5 → 11.8 s.

Two more findings are **not** fixed:

- the source-map hole described in §3;
- Metro could not run at all in the benchmark machine's shell until the harness
  put the system `find` first on `PATH` — Metro shells out to `find` to crawl the
  project, and a wrapper shadowing it made the crawl come back empty. That is an
  environment issue, not a vifx or Metro bug, but it cost time and the harness
  now guards against it.

## 5. Bluesky (`bluesky-social/social-app`) — not measured

> Measured since, on 1.137.0: see [the Bluesky report](./bluesky-social-app-2026-11.md). vifx builds the app, but
> its bundle is not expected to run it.

State of the open-source target:

- Cloned at v1.138.0 and installed with `--ignore-scripts` (so nothing from the
  repository has been executed).
- Its `postinstall` steps have **not** run: `pnpm lexicons:generate` (AT Protocol
  lexicon sources under `src/lexicons`, absent from git) and `pnpm intl:compile`
  (Lingui catalogs). Neither bundler can build the app without them.
- Neither Metro nor vifx has been run on it.

To finish, from a shell allowed to run the project's code:

```bash
BSKY=/path/to/social-app
pnpm --dir "$BSKY" run lexicons:generate
pnpm --dir "$BSKY" run intl:compile
pnpm bench:expo --project "$BSKY" --entry ./index.ts --edit-file index.ts
```

Expect vifx to need work before it builds. A June attempt on this app (SDK 54 at
the time) stopped on a static class block in one of its dependencies, which is
still open. Since then the app moved to SDK 58 and relies on three things vifx
has never been run against: `react-native-worklets` **bundle mode** (a
Metro-config integration), a custom Sentry Metro serializer, and
`react-native-nano-icons`' Metro plugin.

## 6. Reproduce

```bash
vp run build                     # the harness runs the built vifx CLI
pnpm bench:expo --project /path/to/expo-app --runs 3 --edit-file app/_layout.tsx
# options: --platforms ios,android  --flavors release,dev  --phases embed,server
#          --tools metro,vifx  --entry <file>  --out <dir>
node scripts/bench/compare-sources.mjs \
  .bench/<app>/embed/ios-release/metro/main.jsbundle.map \
  .bench/<app>/embed/ios-release/vifx/main.jsbundle.map
```

Raw results (`results.json`, `report.md`, the bundles and maps) are written to
`.bench/<app>/`, which is git-ignored.
