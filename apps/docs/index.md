---
layout: home

hero:
  name: Vifx
  text: React Native and Expo bundling without guesswork
  tagline: A serious Vite-based alternative with a repo-local Expo onboarding corridor, compatibility evidence, and native iOS execution.
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
  - title: One corridor
    details: The primary flow is `setup -> expo audit -> expo dev -> native run -> expo export/serve`.
  - title: Compatibility as evidence
    details: Metro comparison, fixtures, and executed validation remain visible so support claims stay tied to real artifacts.
  - title: Explicit boundaries
    details: Unsupported surfaces are called out as `not supported yet` instead of being buried behind vague wording.
---

## Snapshot

- Date: `2026-05-18`
- Current phase: `Repo-local Expo onboarding and iOS simulator execution corridor`
- Current note: Milestones 0 through 7 now land as current surfaces in this repository: shared packages, captured Metro inspection, resolver and asset primitives, compatibility reports, codemods, source-map tooling, Hermes compile support, `vifx build`, `vifx run`, `vifx setup`, React Native and Expo Vite plugins, `expo-router/entry` browser preview support, Expo export generation, local Updates serving, and an executed Expo SDK 54 iOS simulator path through `vifx native run`.

## Start Here

1. Read the [Getting Started guide](/guide/getting-started) for the supported Expo flow.
2. Review the [Architecture page](/guide/architecture) to understand the package boundaries.
3. Use the [CLI reference](/reference/cli) and [Support Matrix](/reference/support-matrix) before widening support claims.

## Current Focus

::: info Repository posture
Vifx currently supports a repo-local Expo flow built around `vifx setup`, `vifx expo audit`, `vifx expo dev`, `vifx native run`, `vifx expo export`, and `vifx expo serve`. Expo Go, native dev-client protocol parity, Fast Refresh parity, Android native execution parity, and EAS remain not supported yet.
:::

## Key Surfaces

- [Packages](/reference/packages): package-by-package status, scope, limitations, and rollout notes.
- [Config](/reference/config): the current config contract draft and a sample `vifx.config.ts`.
- [Workflows](/guide/workflows): guided flows for Expo onboarding, React Native analysis, compatibility runs, and advanced manual surfaces.
- [Roadmap](/roadmap): milestone-by-milestone deliverables and priorities.
