# Roadmap

## Snapshot

- Date: `2026-05-18`
- Current phase: `No-Metro Vite bundling corridor`
- Summary: Vifx is being recentered on replacing Metro bundle production with Vite for React Native and Expo. The maintained public corridor is `setup -> build -> audit -> dev/export`.

## Milestone 1 - Cleanup And Recentering

Status: In progress.

- Remove native lifecycle commands and `@vifx/native-artifacts`.
- Remove local Expo Updates server, Updates manifests, and response signing.
- Rewrite docs and CLI help around Vite bundling.
- Keep validation scripts focused on bundle artifacts and Metro comparison.

## Milestone 2 - React Native Bundle Parity

Status: Next.

- Compare Vifx/Vite bundles against `fixtures/rn-bare-basic/metro-output/ios`.
- Track bundle, source-map, asset, and resolver differences.
- Add focused tests and CLI evidence for parity reports.

## Milestone 3 - Expo Vite Bundling

Status: Next.

- Produce Expo iOS and Android bundles through Vite config.
- Keep Expo public env, app config, resolver behavior, and assets explicit.
- Avoid claiming Expo CLI, Expo Go, EAS, or app runtime replacement.

## Milestone 4 - Export Artifacts Without Metro

Status: Current first pass.

- Generate bundles, source maps, assets, `manifest.json`, and `metadata.json`.
- Inspect generated output through `inspectExpoExport`.
- Keep Expo Updates runtime and serving outside scope.

## Milestone 5 - Dev Server Proof

Status: Partial.

- Keep `vifx expo dev` useful as a Vite bundle/dev server.
- Document limits around Expo CLI, Expo Go, native dev-client protocol, and Fast Refresh.
- Validate configured targets with explicit tests.

## Acceptance Gates

Every milestone needs:

- focused tests
- fixture coverage
- at least one CLI command surface
- docs updates
- Metro comparison when the milestone changes bundle behavior
