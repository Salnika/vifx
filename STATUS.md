# Vifx Status

> Living status snapshot. Last updated: **2026-11-12**.
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

## History

This file previously contained a pasted assistant-session transcript; it was
replaced with this living status doc per `PLAN.md` §2.3.
