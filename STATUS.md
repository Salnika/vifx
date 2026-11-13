# Vifx Status

> Living status snapshot. Last updated: **2026-11-13**.
> Authoritative roadmap: [`PLAN.md`](./PLAN.md) + [`docs/adr/`](./docs/adr/).
> Product corridor & acceptance gate: [`SPECS.md`](./SPECS.md).
> What shipped / what's next: [`NEXT.md`](./NEXT.md).

## Headline

Vifx has crossed the bootable-bundle line and is building out the full Metro
replacement. A real Expo SDK 54 app (HNewsPro) loads in Expo Go from a
Vifx/Vite-built bundle on iOS and Android, with manifest, bundle, source map,
assets, symbolication, and reload messaging served **without Metro**
(`PLAN.md` §2.1). The roadmap (`PLAN.md` §4, phases 0–6) has been executed as a
**20-unit parallel batch**; see `NEXT.md` for the unit list.

The November 2026 resume moved the toolchain to its current majors and closed
the Expo parity gaps a fresh, **pnpm-isolated** install of the acceptance app
exposed (see below).

## Toolchain (2026-11-12)

| Tool                           | Version                                     |
| ------------------------------ | ------------------------------------------- |
| Vite+ (`vp`)                   | 1.6.0 (Vite 8.3, Vitest 5.1, Oxlint 1.93)   |
| pnpm                           | 12.18                                       |
| Node                           | 26 (engines `^22.18 \|\| ^24.11 \|\| >=26`) |
| TypeScript                     | 7.0 (emit); `tsrs` for `pnpm typecheck`     |
| `@react-native/dev-middleware` | 0.88 (what Expo CLI 58 ships)               |

`@babel/core` and `react-refresh` deliberately stay on Babel 7 / 0.14: those are
the majors Expo SDK 58 itself depends on, and the app's own copies run the
transforms.

## Corridor state (per `PLAN.md` §2.1)

Demonstrably working:

- **Expo Go corridor (V2):** `startExpoGoDevServer` serves `/`, `/manifest`,
  `/index.exp`, bundle + source-map routes, `/assets/*` (with path-traversal
  guards), `/status`, POST `/symbolicate`, and `/message` + `/events`
  WebSockets.
- **Resolution engine** (`@vifx/platform-resolver`): platform extension
  ordering, `exports` conditions, native-safe `mainFields`, workspace
  discovery, case-ambiguity detection — and now real-path package lookup
  (isolated installs), exact-file `exports` targets, and subpath-directory
  `package.json` entries.
- **Expo project semantics:** `.env` files with Expo CLI's precedence; static
  and dynamic app configs (`app.config.js` / `.ts`) through the project's own
  `@expo/config`.
- **Asset pipeline** (`@vifx/asset-registry`): scale variants, binary dimension
  parsing, deterministic hashing, manifest asset mutation.
- **Hermes & source maps:** `hermesc` discovery + bytecode compilation, source
  map validation/comparison/symbolication.
- **CLI & evidence culture:** `--json` everywhere, setup/codemods touching only
  Vifx-owned files, captured-Metro fixtures + a metro-vs-vifx compat runner in
  CI.

### Acceptance evidence (2026-11-12, HNewsPro, SDK 54, pnpm isolated install)

Run against a fresh copy of the app installed with pnpm's default isolated
layout, no Metro process:

| Check                                                                                  | iOS                   | Android               |
| -------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| `vifx expo smoke` (manifest, bundle, map, assets, `/status`, symbolication, WS reload) | pass                  | pass                  |
| Dev bundle                                                                             | 9.91 MB, 2096 sources | 9.89 MB, 2091 sources |
| `export:embed --dev false`                                                             | 3.8 MB JS, 4.5 s      | not re-measured       |
| Hermes bytecode (`hermesc -O`)                                                         | 5.6 MB, compiles      | not re-measured       |

Single copies of `react` / `react-native` in the bundle; `scheduler` resolves to
its `.native` entry.

**Not verified in this pass:** loading the app on a device or simulator. The
smoke proves the server protocol and that the bundle builds and compiles to
bytecode; it does not prove the app renders. The last device validation is the
June 2026 one recorded in `SPECS.md`.

## Expo SDK tiers

| SDK | React Native | Tier         |
| --- | ------------ | ------------ |
| 54  | 0.81         | validated    |
| 55  | 0.83         | experimental |
| 56  | 0.85         | experimental |
| 57  | 0.86         | experimental |
| 58  | 0.88         | experimental |

SDK 58 is the current Expo release. "Experimental" means fixtures, audits and
doctor detection only — no real SDK 55+ app has been bundled or run through Vifx
yet.

## Decisions

The architecture decisions behind the batch are recorded as ADRs (all Accepted,
2026-06-10):

- [ADR-001](./docs/adr/ADR-001-bundle-format.md) — Metro module-registry dev
  bundle, scope-hoisted IIFE in prod.
- [ADR-002](./docs/adr/ADR-002-transform-strategy.md) — real Babel where
  required, OXC fast path, persistent transform cache, `compatPreview`-gated
  mocks.
- [ADR-003](./docs/adr/ADR-003-client-targets.md) — Expo Go SDK 54 gate,
  expo-dev-client primary from SDK 55.
- [ADR-004](./docs/adr/ADR-004-sdk-matrix.md) — SDK 54 validated, 55+
  experimental, benchmarks track latest Metro.
- [ADR-005](./docs/adr/ADR-005-web-platform.md) — web via real
  react-native-web + Vite, secondary, not a native blocker.

## Known gaps vs Expo CLI

Ordered by how much they block "use Vifx instead of `expo start`":

1. **No real SDK 55–58 app validated.** The acceptance app is on SDK 54, four
   majors behind. Bundling a real SDK 58 app is the next gate.
2. **One platform per dev server.** Expo serves iOS and Android from one server
   (`expo-platform` header / `?platform=`); Vifx starts one server per platform.
3. **`/symbolicate` returns frames only** — no `codeFrame`, no `collapse` flags,
   so LogBox shows no source snippet and does not dim library frames.
4. **Manifest asset fields are rewritten in place** (`icon` becomes a URL);
   Expo keeps the path and adds `iconUrl` / `splash.imageUrl`.
5. **`runtimeVersion` policies** (`appVersion`, `nativeVersion`,
   `fingerprint`) are not evaluated; a policy object falls back to
   `exposdk:<sdk>`.
6. **Export layout differs from `npx expo export`** (`dist/expo/<platform>/index.bundle`
   vs `dist/_expo/static/js/<platform>/entry-<hash>.hbc` + Expo's
   `metadata.json`), so `eas update --skip-bundler` cannot consume it.
7. **`exports` conditions ignore the import kind** (`import` is always
   preferred over `require`); Metro picks by `import` vs `require()`.
8. No tunnel (`--tunnel`), no `i` / `a` keys to open a simulator, no typed-routes
   generation, no API routes / server rendering.

Still tracked from `PLAN.md` §4 Phases 6–7: library long-tail compat
(Reanimated-on-native worklets as the canary), benchmarks vs latest Metro,
device E2E in CI, and adoption.

## Dev engine, Babel workers, lazy start (2026-11-13)

Second pass on the Metro comparison (`docs/benchmarks/expo-vs-vifx-2026-11.md`,
"Update — 2026-11-13"). On HNewsPro / iOS, re-measured after the Expo Go
validation fixes below, vifx is ahead of Metro on every measured point except
Hermes bytecode (size +3.9 %, compile time +13 %) and the peak memory of a
warm release build (+15 %); "new full bundle after an edit" is level to within
4 %.

- **Expo Go dev server runs Rolldown's dev engine** by default (development,
  `hoisted` format): `packages/vite-plugin-expo/src/dev-engine.ts`. A save is
  compiled into a Fast Refresh patch (~60 ms to the app, Metro ~140 ms); the
  full bundle is refreshed in the background. In-app runtime:
  `packages/vite-plugin-react-native/src/dev-runtime.ts` (ES5 port of
  Rolldown's `DevRuntime` + Metro's Fast Refresh rules). Falls back to the
  rebuild-and-reload loop if the engine cannot start; `VIFX_DEV_ENGINE=0` or
  `devEngine: false` forces that loop. `--fast-refresh` (Metro module registry)
  is unchanged.
- **Babel worker threads** for cache misses under load
  (`src/babel/worker-pool.ts`, `VIFX_BABEL_WORKERS`, `0` disables).
- **`vifx expo dev --expo-go` listens before it bundles** (`lazyStart`).
- The transform cache's in-memory layer is now opt-in (`memory: true`), used
  only by the rebuild loop.

Stack frames inside a hot-patched module are not symbolicated against the
patch's own source map yet. The source-map gap noted on 2026-11-12
(`expo-router`, `@react-navigation/*`) is still open.

## Expo Go validation (2026-11-13)

The dev engine was run in Expo Go 54.0.7 on an iPhone 17 simulator (iOS 26.4)
with HNewsPro, through `vifx expo dev --expo-go`. Seen on the device, with the
final code:

- **Fast Refresh.** Editing a screen updates it in place and keeps its local
  state (the selected feed tab). The terminal prints one line per save, once
  the app has acknowledged it: `fast refresh  app/(tabs)/index.tsx  36ms`
  (33–87 ms from save to applied over the session).
- **An edit that is not a component** (`src/hn/hnEndpoints.ts`) is applied
  without a reload and re-runs its importers up to the first boundary (32
  modules here). State below the contexts those modules re-create is lost, as
  Metro's Fast Refresh rules imply; the same edit was not timed or observed
  under Metro on a device.
- **Compile error.** React Native's own "Failed to compile / Syntax Error"
  screen, with the code frame; it goes away when the file is fixed and the
  screen's state is still there.
- **App logs.** `console.*` output is printed in the terminal (` LOG  …`).
- **Server restart.** A running app reconnects, is told its bundle is stale
  and reloads itself.

Running on a device found eight defects that no sandbox test had; each is
fixed and now has a test:

1. **Assets disappeared after the first save.** The engine empties its output
   directory on every build and only re-emits assets of modules it loaded
   again, so fonts and images returned 404 for any app started later. Assets
   are now kept beside the output (`<outDir>.assets`).
2. **`require("./image.png")` returned a namespace object** instead of the
   asset id. React Native's LogBox requires its images that way, so its UI
   crashed while rendering and errors never appeared in the app.
3. **The dev bundle declared its top-level bindings on the global object**
   (a scope-hoisted bundle evaluated as a script). It now runs in a function
   scope, like production. This collision is what had kept React Native's
   `console` polyfill out of vifx bundles; it is included again, which routes
   logs to the native log and to the dev server.
4. **Module ids were relative to the server's working directory**, not the
   project, so the Fast Refresh keys only matched when the server was started
   from the project root (and a server started elsewhere produced a dev
   bundle 1.1 MB larger, all of it path prefixes).
5. **An app never re-attached after a server restart**, and an app that
   reconnected while the first bundle was still building was ignored.
6. **A server started while the project does not compile answered 500 for
   good.** The first build is now retried on the next save.
7. **A build error was printed three or four times**, each with dozens of
   stack frames; it is printed once, as the cause and its code frame.
8. The `SQLiteProvider` compat kept handing a closed database to its children
   after its effect re-ran.

Still open after this pass:

- **Expo Go crashes on some reloads of this app** (seven crash reports in the
  session; the five examined are four segfaults in expo-sqlite's native
  `closeDatabase` — FTS5 statement finalization on
  `expo.module.sqlite.AsyncQueue` — and one in React Native's
  `Scheduler::uiManagerDidFinishTransaction`). HNewsPro opens an FTS5 database
  through `SQLiteProvider`, which closes it when the tree unmounts. Whether
  the same reload crashes when Metro serves the app is **not known**: the
  control run could not be started from this session. `scripts/dev/` has the
  two helpers used (`send-message.mjs` to trigger a reload,
  `crash-frames.mjs` to read a crash report).
- Android was not exercised, and the registry format (`--fast-refresh`) was
  not re-validated — `require()` of an asset included.

## Benchmark vs Metro (2026-11-12)

Full results: [`docs/benchmarks/expo-vs-vifx-2026-11.md`](./docs/benchmarks/expo-vs-vifx-2026-11.md)
(HNewsPro, iOS + Android, `pnpm bench:expo`). In short: warm builds ~3× faster,
cold release builds 16–27 % faster, release JS 5 % smaller — but the edit loop is
~18× slower (3.5 s vs 0.2 s per save, full re-bundle), cold dev-server start is
slower, and Hermes bytecode is 3.7 % larger.

The run found and fixed two bugs: modules bundled twice on isolated installs
(198 duplicates, fixed by resolving to real paths) and release builds transformed
by Babel in development mode. Still open from it:

- `expo-router` and `@react-navigation/*` modules have no entry in vifx's source
  map, so their stack frames cannot be symbolicated.
- The open-source target (`bluesky-social/social-app`, SDK 58) is cloned and
  installed but has not been built by either bundler.

## History

This file previously contained a pasted assistant-session transcript; it was
replaced with this living status doc per `PLAN.md` §2.3.
