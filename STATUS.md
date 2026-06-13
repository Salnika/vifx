# Vifx Status

> Living status snapshot. Last updated: **2026-06-13**.
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

## Corridor state (per `PLAN.md` §2.1)

Demonstrably working:

- **Expo Go corridor (V2):** `startExpoGoDevServer` serves `/`, `/manifest`,
  `/index.exp`, bundle + source-map routes, `/assets/*` (with path-traversal
  guards), `/status`, POST `/symbolicate`, and `/message` + `/events`
  WebSockets, validated by HNewsPro smoke runs (iOS & Android manifests 200,
  ~3.2 MB bundles, 700+ source-map sources, sampled assets 200, symbolication
  resolving, WS reload round-trip).
- **Resolution engine** (`@vifx/platform-resolver`): platform extension
  ordering, `exports` conditions, native-safe `mainFields`, workspace
  discovery, case-ambiguity detection.
- **Asset pipeline** (`@vifx/asset-registry`): scale variants, binary dimension
  parsing, deterministic hashing, manifest asset mutation.
- **Hermes & source maps:** `hermesc` discovery + bytecode compilation, source
  map validation/comparison/symbolication.
- **CLI & evidence culture:** `--json` everywhere, setup/codemods touching only
  Vifx-owned files, captured-Metro fixtures + a metro-vs-vifx compat runner in
  CI.

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
- [ADR-004](./docs/adr/ADR-004-sdk-matrix.md) — SDK 54 validated, 55/56
  experimental, benchmarks track latest Metro.
- [ADR-005](./docs/adr/ADR-005-web-platform.md) — web via real
  react-native-web + Vite, secondary, not a native blocker.

## Known gaps / next

Tracked in `NEXT.md` and `PLAN.md` §4 Phases 6–7: SDK 55→validated cadence,
library long-tail compat (Reanimated-on-native worklets as the canary),
benchmarks vs latest Metro, device E2E in CI, and adoption (support matrix,
migration guides, public beta).

## History

This file previously contained a pasted assistant-session transcript; it was
replaced with this living status doc per `PLAN.md` §2.3.
