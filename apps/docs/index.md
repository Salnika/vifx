---
layout: home

hero:
  name: Vifx
  text: React Native and Expo compatibility, inspected before it is claimed
  tagline: A docs-first toolkit for understanding Metro behavior, validating compatibility, and running bounded Vite experiments.
  actions:
    - theme: brand
      text: Getting Started
      link: /guide/getting-started
    - theme: alt
      text: Package Reference
      link: /reference/packages
    - theme: alt
      text: Roadmap
      link: /roadmap

features:
  - title: Inspect first
    details: Start from evidence, reports, and fixture-backed comparisons before any migration or plugin work.
  - title: Compatibility as a product
    details: Treat parity as a long-lived contract with pass, warn, and todo states instead of a marketing checkbox.
  - title: Experimental by default
    details: Vite-facing work stays explicitly bounded until resolver, assets, source maps, Hermes, and Expo export understanding are proven.
---

## Snapshot

- Date: `2026-05-16`
- Current phase: `Milestone 7 Expo export inspection landed`
- Current note: Milestones 0 through 7 are implemented here as bounded first-pass surfaces: shared packages, captured Metro inspection, resolver and asset primitives, compatibility reports, codemods, source-map tooling, Hermes compile support, `vifx build`, `vifx run`, `vifx vite init`, experimental React Native and Expo Vite plugins, a bounded `expo-router/entry` browser preview path, and inspect-only Expo export analysis. The controlled bundle smoke target remains `fixtures/rn-bare-basic`.

## Start Here

1. Read the [Getting Started guide](/guide/getting-started) for the inspect-first workflow.
2. Review the [Architecture page](/guide/architecture) to understand the package boundaries.
3. Use the [CLI reference](/reference/cli) and [Support Matrix](/reference/support-matrix) before evaluating experiments.

## Current Focus

::: info Repository posture
Vifx is not presented here as a production Metro replacement. The current repository ships controlled bundle builds, a browser runtime preview for targets that opt into `reactNativeCompat: "web"`, and inspect-first Expo export understanding. Fast Refresh, HMR, Expo Go, device runtime parity, full Expo Router parity, Updates generation, and EAS remain out of scope.
:::

## Key Surfaces

- [Packages](/reference/packages): package-by-package status, scope, limitations, and roadmap items.
- [Config](/reference/config): the current config contract draft and a sample `vifx.config.ts`.
- [Workflows](/guide/workflows): guided flows for Expo analysis, React Native analysis, compatibility runs, and experimental migration.
- [Roadmap](/roadmap): milestone-by-milestone deliverables and priorities.
