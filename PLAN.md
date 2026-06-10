# Vifx — Project Review & Full Metro Replacement Plan

> Date: 2026-06-10. Companion to `SPECS.md` (V2 Expo Go corridor). This document widens the target: make Vifx a **complete** Metro replacement for Expo (and later bare RN) projects, covering dev, debugging, and release workflows.

## 1. Executive Summary

Vifx has already crossed the hardest proof-of-concept line: a real Expo SDK 54 app (HNewsPro) loads in Expo Go from a Vifx/Vite-built bundle on iOS and Android, with manifest, bundle, source map, assets, symbolication, and reload messaging served without Metro. The monorepo is clean (17 packages, structured errors, strong CLI, fixture/evidence culture, CI).

But measured against "complete Metro replacement", the project is roughly at the **bootable-bundle stage (~30%)**. Three structural walls remain:

1. **No usable dev loop.** Expo Go mode builds the bundle once at server startup. No file watcher, no rebuild, no Fast Refresh/HMR. This is the #1 reason nobody can develop with Vifx daily yet.
2. **Compat-by-mocking instead of compat-by-transforming.** Reanimated, expo-sqlite hooks, status-bar, winter URL etc. are stubbed with JS shims. Apps boot, but behavior is not real (the in-flight Reanimated "native compat" is a JS mock: no worklets, no UI thread). This strategy cannot scale to the ecosystem; Metro's actual superpower is running each library's real Babel plugins.
3. **No release path.** ESM-formatted dev-flavored bundles only (`__DEV__` hard-coded `true` natively, `minify: false`, `dev=true` in bundle URLs), no `export:embed` integration for Xcode/Gradle release builds, no production asset layout, no EAS Update output parity.

The plan below sequences the work into 8 phases. Phases 1–3 (dev loop, module-format + Fast Refresh, real transforms) are the credibility core. Phases 4–5 (debugging, production) complete the replacement. Phases 6–7 (SDK matrix, hardening/adoption) make it durable.

## 2. Review

### 2.1 What demonstrably works

- **Expo Go corridor (V2)**: `startExpoGoDevServer` serves `/`, `/manifest`, `/index.exp` (with `expo-protocol-version` headers), bundle + source map routes, `/assets/*` (with path-traversal guards), `/status`, POST `/symbolicate`, and `/message` + `/events` WebSockets (hand-rolled RFC 6455 framing, peer routing, `reload` broadcast). Validated by smoke runs against HNewsPro: iOS and Android manifests 200, ~3.2 MB bundles, 700+ source-map sources, sampled assets 200, symbolication resolving, WS reload round-trip.
- **Resolution engine** (`@vifx/platform-resolver`, ~950 lines): platform extension ordering (ios/android/native/base), `exports` conditions (incl. recursion, condition maps), mainFields ordering (incl. the recent `react-native, main, module` native-safe default fixing the punycode dual-entry bug), pnpm/yarn workspace discovery, case-ambiguity detection. This is real Metro-semantics work, well tested.
- **Asset pipeline** (`@vifx/asset-registry`): scale variants (`@2x/@3x`, decimal scales), binary dimension parsing for PNG/JPEG/GIF/WebP/SVG, deterministic hashing, server URL generation; Expo manifest asset mutation + emitted-assets serving wired in.
- **Hermes & source maps**: `hermesc` discovery chain + bytecode compilation (+ source-map move), source map validation/comparison/symbolication on `node:module`'s SourceMap.
- **CLI & evidence culture**: 13 commands (`setup`, `build`, `expo dev/export/audit/smoke`, `doctor`, `compat run`, `metro inspect`, `hermes compile`, …), `--json` everywhere, setup/codemods that only touch Vifx-owned files, captured-Metro fixtures and a metro-vs-vifx compat runner in CI. Uncommitted WIP adds QR code + formatted terminal output for `expo dev`.
- **Engineering hygiene**: strict types, 63 structured error codes, no stray TODOs, per-package tests, CI (lint, typecheck, test, compat, build, docs, CLI smoke).

### 2.2 Structural gaps vs Metro

| Area                    | Metro / Expo CLI                                                                                       | Vifx today                                                                                                                                                                                          | Severity                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Watch + rebuild         | Incremental, cached, instant                                                                           | None (single build at server start)                                                                                                                                                                 | Blocker                        |
| Fast Refresh / HMR      | `/hot` WS, React Refresh, granular updates                                                             | None (`hot=false`, full reload protocol only, no trigger)                                                                                                                                           | Blocker                        |
| Bundle format           | Module registry (`__d`/`__r`), polyfills, InitializeCore first                                         | Scope-hoisted ESM evaluated as a Hermes script; works by accident of no residual `import`/`export`; `import()`/`import.meta` would break; no module registry → native HMR impossible in this format | Blocker (dev) / Asset (prod)   |
| Ecosystem transforms    | Real Babel pipeline per library (worklets, NativeWind, react-compiler…)                                | Shims/mocks for Reanimated & friends; Babel applied via manual `babelInPackages` lists; no persistent transform cache                                                                               | Blocker                        |
| Debugging               | Inspector proxy → React Native DevTools, `/open-stack-frame`, LogBox                                   | `/symbolicate` only; no inspector proxy, no `/reload`, `/open-url`, `/logs`                                                                                                                         | Major                          |
| Production mode         | `--dev false`, minify, inline requires, Hermes bytecode in release builds via `export:embed`           | `__DEV__` always `true` natively, `minify: false`, no embed integration, no prod asset layout (Android drawable-\*, iOS catalogs)                                                                   | Major                          |
| expo-dev-client         | Supported (primary direction for SDK 55+, New Arch only)                                               | Expo Go only                                                                                                                                                                                        | Major (grows over time)        |
| SDK matrix              | SDK 55 (RN 0.83) stable, SDK 56 beta (RN 0.84, Hermes V1, Metro 0.84)                                  | SDK 54 / RN 0.81 only                                                                                                                                                                               | Major (moving target)          |
| Dynamic features        | `require.context` (generalized), `import()` async modules (SDK 55.0.9 added named async metro require) | Static expo-router context generation only                                                                                                                                                          | Medium                         |
| Web platform            | Metro bundles web for Expo (RNW, static rendering)                                                     | Shim-based browser preview only (`__VIFX_WEB_RUNTIME__`)                                                                                                                                            | Medium (scope decision)        |
| metro.config.js interop | n/a                                                                                                    | None (`VIFX_UNSUPPORTED_METRO_*` errors exist)                                                                                                                                                      | Medium                         |
| EAS Updates / signing   | Manifest signing, multipart negotiation                                                                | Plain JSON manifest, no signing                                                                                                                                                                     | Low (explicit non-goal so far) |

### 2.3 Code health notes

- `packages/cli/src/commands/expo-audit.ts` is a 44.8 KB monolith holding four commands (`audit`, `dev`, `export`, `smoke`) — split it.
- `STATUS.md` is a pasted assistant-session transcript, not a status document — replace with generated status or delete.
- Hand-rolled WebSocket framing in `vite-plugin-expo` duplicates `ws`; either adopt `ws` or extract + fuzz-test the implementation (fragmentation, ping/pong, large payloads, masking edge cases).
- The Reanimated native mock (~480 uncommitted lines) should land behind an explicit `compatPreview` flag, not as default native behavior, to avoid hard-to-diagnose "animations silently don't animate" reports.
- Test depth is thin where it matters most: no dev-loop tests, no real-device E2E in CI, 4 network-gated tests for the entire Expo Go server.

### 2.4 Ecosystem reality check (June 2026)

- Expo SDK 55 (Jan 2026) = RN 0.83 + React 19.2, **New Architecture only**. SDK 56 beta (May 2026) = RN 0.84, Hermes V1 default, Metro 0.84, faster bundler warmup, Node-watcher default. The SDK 54 gate is already one major behind, two by SDK 56 stable.
- Prior art warning: vxrn/One — a multi-year, funded effort — still labels its Vite-native bundling "experimental" and recommends Metro mode for production. The wall is the ecosystem's Metro-flavored publishing (Flow in shipped JS, JSX in `.js`, CJS/ESM dual entries, RN-specific fields). Vifx's resolver work and evidence culture are the right response, but the transform strategy must move from mocks to real Babel.
- Release-build integration points are documented and patchable: Xcode "Bundle React Native code and images" (`CLI_PATH`, `BUNDLE_COMMAND`), Android `react { cliFile, bundleCommand = "export:embed" }`; an Expo config plugin can persist the patch across `expo prebuild` (proven by the Re.Pack + Expo Router community work).

## 3. Definition of "Complete Metro Replacement (Expo-compatible)"

A project can delete Metro from every workflow:

1. **Dev**: `vifx expo dev` replaces `expo start` for Expo Go _and_ dev-client targets — Fast Refresh with state preservation, error overlay/LogBox symbolication, React Native DevTools debugging, asset serving, reload/dev-menu messaging.
2. **Release**: `vifx export:embed` replaces Metro in Xcode/Gradle release builds (minified, `__DEV__=false`, Hermes bytecode, prod asset layout); `vifx expo export` matches `npx expo export` artifacts.
3. **Ecosystem**: top Expo libraries work without Vifx-specific shims (real Reanimated worklets first); monorepos/symlinks; `require.context`; `import()`.
4. **Migration**: `vifx setup` onboards a stock Expo app in minutes; per-library recipes replace `metro.config.js` customizations; evidence reports prove parity.

Non-goals (unchanged): replacing Expo native runtimes, EAS Build/Submit, hosted Updates signing.

## 4. Roadmap

### Phase 0 — Decisions & cleanup (1–2 weeks)

- Land the WIP: QR/spinner UX; Reanimated mock gated behind `compatPreview: true` (explicitly logged), never default.
- Split `expo-audit.ts` into `expo-dev.ts`, `expo-export.ts`, `expo-smoke.ts`, `expo-audit.ts`.
- Replace hand-rolled WS framing with `ws` (or extract + fuzz-test).
- Delete/replace `STATUS.md`; update `SPECS.md`/`NEXT.md` to point at this plan.
- Write ADRs:
  - **ADR-1 Bundle format**: dev = Metro-compatible module registry (`__d`/`__r`, numeric IDs, polyfills + InitializeCore first, entry require last) to unlock the native HMRClient and DevTools; prod = scope-hoisted IIFE (Vifx's size/TTI advantage), `format: "iife"` instead of `"es"` immediately to remove the Hermes-ESM fragility.
  - **ADR-2 Transform strategy**: real Babel where required (auto-derived from the project's `babel.config.js` + per-library detection), OXC for everything else, persistent on-disk transform cache. Mocks demoted to web-preview only.
  - **ADR-3 Client targets**: Expo Go (SDK 54) stays the current gate; expo-dev-client becomes the primary target from SDK 55 (New Arch only).
  - **ADR-4 SDK matrix**: 54 → 55 → 56 with fixture captures per SDK.
  - **ADR-5 Web**: secondary target via real react-native-web + Vite (not shims); not a blocker for native completeness.

### Phase 1 — Minimal viable dev loop (2–4 weeks)

Goal: a developer can actually iterate.

- File watcher (Vite/Rolldown watch API) driving incremental rebuilds of the native bundle in `expo dev --expo-go`; on success, broadcast `reload` on the existing message channel; on failure, surface the build error to the terminal and `/events`.
- Persistent transform cache (content-hash + options key) so warm rebuilds are fast; measure on HNewsPro.
- Switch native output to IIFE; inject `EXPO_OS`, proper `NODE_ENV`; make `__DEV__` mode-dependent.
- Acceptance: edit a HNewsPro screen → app reloads automatically; warm rebuild ≤ ~2 s; build errors visible without restarting.

### Phase 2 — Module format + Fast Refresh (1–2 months, the core engineering bet)

Goal: state-preserving Fast Refresh on a real app.

- Dev serializer producing the Metro module-registry format from the Rolldown module graph: per-module CJS factories wrapped in `__d(factory, id, deps)`, metro-require runtime prelude, polyfills + `InitializeCore` ordering, entry `__r(0)` last. (RN's own `HMRClient` + React Refresh runtime then work as-is — the client side ships inside react-native; we only implement the server.)
- `/hot` WebSocket implementing Metro's HMR protocol (`update-start`, `update` with added/modified module deltas + inline source maps, `update-done`, `error`).
- `react-refresh/babel` applied to project code in dev; verify `setUpReactRefresh` path activates.
- Delta tracking: map watcher events → invalidated module IDs → retransform only those.
- Acceptance: edit component state/style in HNewsPro → update < 1 s, React state preserved; syntax errors show on-device and recover.

### Phase 3 — Real ecosystem transforms (1–2 months, overlaps Phase 2)

Goal: kill the mocks; top libraries run their real code.

- Babel-where-needed pipeline with the persistent cache: run `babel-preset-expo`/library plugins (react-native-worklets plugin first) on packages that require them, auto-configured from the project Babel config; OXC fast-path for plain TS/JSX.
- Real Reanimated/worklets on native (delete the mock path for native targets). This is the credibility test: worklets metadata must survive bundling.
- Library compat matrix as fixtures + compat-runner cases + docs support-matrix: reanimated, gesture-handler, screens, safe-area-context, svg (+ transformer recipe), expo-image, nativewind, flash-list, mmkv, expo-sqlite (remove hook shims), skia, lottie, maps, camera, video/av, webview, sentry, firebase, vector-icons/fonts, zustand/redux.
- Generalized `require.context`; `import()` inlined for native (async-module named require parity where SDK 55+ expects it).
- Acceptance: HNewsPro with **zero Vifx shims** on native; ≥ 15 top libraries green in the matrix with evidence.

### Phase 4 — Debugging & DX parity (3–6 weeks)

- Mount `@react-native/dev-middleware` (official, standalone) on the Vifx server for the inspector proxy → React Native DevTools work out of the box (`/json/list`, device/debugger WS bridging).
- Remaining endpoints: `/reload`, `/open-url`, `/open-stack-frame`, `/logs`; LogBox error round-trip verified.
- expo-dev-client support: manifest negotiation + dev-menu/server protocols on a New-Arch SDK 55 app.
- Terminal UX parity with `expo start` (QR, keybindings: r=reload, j=devtools, m=menu).
- Acceptance: breakpoint + console + network inspection in RN DevTools against a Vifx-served Hermes app; dev-client app loads from Vifx.

### Phase 5 — Production parity (1–2 months)

- True prod mode: `__DEV__=false`, `NODE_ENV=production`, oxc-minify, scope-hoisted IIFE, optional inline-requires equivalent, tree-shaking (measure vs Metro — this should become Vifx's headline advantage), Hermes bytecode + composed source map (hermes-tools already does the mechanics).
- Prod asset layout: Android `drawable-*`/`raw` naming, iOS `.bundle`/catalog conventions, `assetmap.json`.
- `vifx export:embed`: flag-compatible with `expo export:embed` (`--platform`, `--dev`, `--bundle-output`, `--assets-dest`, `--sourcemap-output`, `--entry-file`, `--minify`) + an Expo config plugin patching `CLI_PATH`/`BUNDLE_COMMAND` (Xcode) and `react { cliFile, bundleCommand }` (Gradle) so it survives `expo prebuild`.
- `vifx expo export` byte-level parity audit vs `npx expo export` (metadata.json/manifest field-for-field), multi-platform.
- Acceptance: HNewsPro release IPA/APK built without Metro, runs on device; bundle size/TTI benchmark vs Metro published in docs.

### Phase 6 — SDK matrix & breadth (continuous after P3)

- SDK 55 (RN 0.83, New Arch only) then SDK 56 (RN 0.84, Hermes V1) fixture captures + protocol updates; CI matrix per SDK.
- Bare RN corridor: `vifx start`/`vifx bundle` replacing community-CLI Metro usage.
- Monorepo/symlink (pnpm) E2E fixtures exercised through the full dev loop.
- `metro.config.js` interop: read `resolver.extraNodeModules`/`assetExts`/`sourceExts` for migration hints; documented per-library recipes for transformer-style customizations (e.g., svg-transformer → Vifx SVG plugin).

### Phase 7 — Hardening & adoption (continuous)

- Public benchmarks (cold start, warm rebuild, HMR latency, bundle size, app TTI) vs Metro on HNewsPro + a standard bench app.
- Device E2E in CI (macOS runner + simulator, maestro flows: boot, navigate, Fast Refresh, error recovery).
- npm publication pipeline (changesets exist), versioned support matrix generated from compat-runner output, migration guide per library, public beta.

## 5. Top Risks

1. **Ecosystem long tail** (the vxrn/One lesson): Metro-flavored packages will keep breaking resolution/transform assumptions. Mitigation: real-Babel pipeline (P3), compat-runner evidence per library, a deps-patching escape hatch, loud diagnostics.
2. **Worklets fidelity**: Reanimated's Babel plugin rewrites worklets with location metadata; bundling deviations break the UI-thread runtime silently. Treat Reanimated-on-native as the canary acceptance test for P3.
3. **Moving target**: New-Arch-only SDK 55+, Hermes V1, Metro's own improvements (SDK 56 warmup, onDemandFilesystem) erode the perf pitch. Mitigation: P6 cadence + benchmarks that include Metro's latest.
4. **Solo-maintainer surface area**: the plan is sequenced so each phase ends in a usable, demonstrable increment; resist parallel-starting P4/P5 before P1–P2 land.
5. **Hermes/ESM mismatch**: until ADR-1 lands, any dependency introducing residual ESM syntax or `import.meta` breaks bundles at runtime. The IIFE switch in P1 removes most of this class.

## 6. Immediate Next Actions (this week)

1. Commit the WIP (QR/spinner UX; Reanimated mock behind `compatPreview`).
2. P1 watcher + auto-reload spike on HNewsPro (the reload protocol already exists; wire watch → rebuild → broadcast).
3. Switch native bundle output to IIFE + add `EXPO_OS`/`NODE_ENV`/mode-dependent `__DEV__` defines (small, removes a whole risk class).
4. Write ADR-1/ADR-2 and split `expo-audit.ts` while context is fresh.
