---
layout: home

hero:
  name: Vifx
  text: Vite bundling for React Native and Expo
  tagline: A no-Metro corridor focused on producing, inspecting, and comparing bundle artifacts without replacing Expo CLI, EAS, or native app workflows.
  actions:
    - theme: brand
      text: Getting Started
      link: /guide/getting-started
    - theme: alt
      text: CLI Reference
      link: /reference/cli
    - theme: alt
      text: Roadmap
      link: /roadmap

features:
  - title: No-Metro bundling
    details: The public corridor is `setup -> build -> audit -> dev/export`.
  - title: Metro as evidence
    details: Captured Metro artifacts remain the comparison baseline for Vifx/Vite output.
  - title: Narrow by design
    details: Expo CLI, Expo Go, EAS, native build/run, and Updates runtime stay outside the product scope.
---

## Snapshot

- Date: `2026-05-18`
- Current phase: `No-Metro Vite bundling corridor`
- Current note: Vifx keeps the React Native and Expo Vite plugin work, `vifx build`, `vifx expo audit`, `vifx expo dev`, `vifx expo export`, Metro inspection, and compatibility tooling. Native lifecycle commands and Expo Updates serving/signing have been removed from the public scope.

## Start Here

1. Read the [Getting Started guide](/guide/getting-started) for the supported Vite bundling flow.
2. Review the [Architecture page](/guide/architecture) to understand package boundaries.
3. Use the [CLI reference](/reference/cli) and [Support Matrix](/reference/support-matrix) before widening support claims.

## Current Focus

::: info Repository posture
Vifx currently targets Metro-free bundle production and comparison. It does not replace Expo CLI, Expo Go, EAS, app build/run workflows, Expo Updates runtime, or full React Native Fast Refresh.
:::

## Key Surfaces

- [Packages](/reference/packages): package-by-package status, scope, and limitations.
- [Config](/reference/config): the current config contract draft and sample `vifx.config.ts`.
- [Workflows](/guide/workflows): guided flows for RN/Expo analysis, Metro references, Vifx builds, and Expo dev/export.
- [Roadmap](/roadmap): milestone-by-milestone deliverables and priorities.
