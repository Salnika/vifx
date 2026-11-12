# NEXT

The authoritative roadmap is now **`PLAN.md`** (full Metro replacement, phases
0–6) plus the architecture decision records in **`docs/adr/`**. `SPECS.md` still
defines the V2 Expo Go corridor and its HNewsPro acceptance gate; `STATUS.md`
tracks live progress.

## What shipped: phases 0–6 as a 20-unit parallel batch

The roadmap in `PLAN.md` (originally sequenced as phases 0–7) was executed as a
**20-unit parallel batch** off a shared `batch/base`, each unit a focused PR.
The decisions behind the work are recorded in ADR-001…005. Units, briefly:

| Unit | Scope                                                                              |
| ---- | ---------------------------------------------------------------------------------- |
| 01   | CLI split — break the `expo-audit.ts` monolith into `dev`/`export`/`smoke`/`audit` |
| 02   | WebSocket layer — adopt/extract `ws` for the message + `/events` channels          |
| 04   | `compatPreview` gate — demote JS mocks to explicit opt-in (ADR-002)                |
| 05   | Watch + rebuild + `/hot` — file watcher driving incremental rebuilds               |
| 06   | Persistent content-addressed transform cache (ADR-002)                             |
| 07   | Metro module-registry dev bundle format (`__d`/`__r`) (ADR-001)                    |
| 08   | `react-refresh/babel` wiring for state-preserving Fast Refresh                     |
| 09   | Real Babel pipeline auto-configured from the project `babel.config.js` (ADR-002)   |
| 10   | Library compat matrix (fixtures + compat-runner + support docs)                    |
| 11   | Generalized `require.context` and `import()` async-module support                  |
| 12   | DevTools / inspector proxy via `@react-native/dev-middleware`                      |
| 13   | expo-dev-client support on a New-Arch SDK 55 app (ADR-003)                         |
| 14   | Scope-hoisted IIFE production format + bundle modes (ADR-001)                      |
| 15   | `vifx export:embed` for Xcode/Gradle release builds                                |
| 16   | Expo config plugin to persist the embed patch across `expo prebuild`               |
| 17   | SDK 55 / 56 experimental tiers + per-SDK fixtures (ADR-004)                        |
| 18   | `metro.config.js` interop (migration hints from resolver fields)                   |
| 19   | Bare React Native dev server (`vifx start` / `vifx bundle`)                        |
| 20   | Dev-loop harness / E2E coverage for the watch→rebuild→reload loop                  |

(Units 01, 02, 03 are the Phase-0 cleanup; unit 03 is this governance/docs
refresh.)

## What shipped: November 2026 resume

Toolchain moved to current majors (Vite+ 1.6 / Vite 8.3 / Vitest 5, pnpm 12,
TypeScript 7 + `tsrs` for type checking, dev-middleware 0.88), and the Expo
parity gaps found by re-running the acceptance app on a fresh pnpm-isolated
install were closed:

| Area           | Change                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Resolution     | Package lookup from the importer's real path (Node/Metro semantics) — isolated installs now bundle        |
| Resolution     | Exact-file `exports` targets (`./esm.mjs`), subpath-directory `package.json` entries                      |
| Resolution     | Fallback through `expo` / `react-native` for tooling-injected imports (`@babel/runtime`, asset registry…) |
| Transforms     | `@babel/core` + `babel-preset-expo` found through `expo` when the project does not declare them           |
| Expo semantics | `.env` / `.env.local` / `.env.<mode>` loading with Expo CLI precedence and `${VAR}` expansion             |
| Expo semantics | Dynamic `app.config.js` / `.ts` resolved through the project's own `@expo/config`                         |
| SDK matrix     | SDK 57 (RN 0.86) and 58 (RN 0.88) added as experimental tiers; SDK 56 corrected to RN 0.85                |
| Regressions    | B3 no longer rejects `./global.css` or Vite's `/@fs/` URLs; CLI launcher runs on Node 26                  |

Evidence and the remaining gap list are in `STATUS.md`.

## Next

With the batch landed, ongoing work is the durable cadence from `PLAN.md`
§4 Phases 6–7:

0. **Bundle a real SDK 58 app** — the acceptance app is on SDK 54; nothing on
   SDK 55+ has been bundled or run yet. Then the Expo CLI gaps listed in
   `STATUS.md` (one dev server for both platforms, `/symbolicate` code frames,
   manifest `*Url` asset fields, `runtimeVersion` policies, `expo export` layout).
1. **SDK cadence** — promote SDK 55 toward validated and keep SDK 56 (Hermes V1)
   tracking, with per-SDK fixtures and CI matrix (ADR-004).
2. **Library long tail** — grow the compat matrix with evidence per library;
   Reanimated-on-native worklets fidelity stays the canary (`PLAN.md` §5 risk 2).
3. **Benchmarks vs latest Metro** — cold start, warm rebuild, HMR latency, bundle
   size, app TTI, always against current Metro (ADR-004).
4. **Device E2E in CI** — simulator + maestro flows (boot, navigate, Fast
   Refresh, error recovery).
5. **Adoption** — versioned support matrix from compat-runner output, per-library
   migration guides, public beta (`PLAN.md` §4 Phase 7).
