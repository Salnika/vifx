# Features

Status: Current.

This page gives a current repository snapshot of the main feature areas in Vifx.

The percentages below are intentionally approximate. They are not benchmark scores. They are first-pass product estimates based on the current fixtures, commands, tests, and docs coverage in this repository.

The current shared compatibility suite is still small: 15 cases across 9 categories. It currently passes for both `metro` and `vifx`, but those green results should be read as proof for the covered slice, not as proof of overall parity.

## Snapshot

- Date: `2026-05-18`
- Milestone state: `Milestones 0 through 7 implemented first pass`
- Evidence: `vifx compat run --adapter all --report json` currently passes `30/30` adapter-case results total (`15/15` per adapter) across doctor, resolver, assets, bundler, and monorepo coverage
- Scope: compatibility foundations, inspection, resolver and asset primitives, migration prep, source maps, Hermes workflows, Vite builds, native artifact preparation, formal playground native host markers, native host diagnostics, native lifecycle planning and execution, maintained bare React Native and Expo playground validation, browser runtime previews, Expo browser dev serving with Vite HMR, Expo export generation, Expo Updates v1 manifest generation, and local Updates serving

## Feature Table

| Feature Area                           | Done | Metro Compatibility | Expo Compatibility | Status                 | Notes                                                                                                                                                                                      |
| -------------------------------------- | ---- | ------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project detection and `doctor`         | yes  | n/a                 | 90%                | Implemented first pass | Detects Expo, Expo Router, React Native, workspace root, configs, Hermes path, and current Vite plugin mode; current doctor cases pass `3/3`.                                              |
| Metro reference inspection             | yes  | 80%                 | 70%                | Reference inspection   | Uses captured Metro artifacts, not a live Metro execution pipeline.                                                                                                                        |
| Compatibility reports                  | yes  | 80%                 | 45%                | Implemented first pass | Shared suite currently passes `15/15` cases per adapter, but coverage is still narrow compared to Metro and Expo surface area.                                                             |
| Platform file resolution               | yes  | 85%                 | 70%                | Implemented first pass | Current resolver cases pass `6/6` across platform files, package main fields, and package exports.                                                                                         |
| Asset scale groups and metadata        | yes  | 75%                 | 65%                | Implemented first pass | Current asset cases pass `2/2` for scale groups plus normalized metadata; broader asset parity is still incomplete.                                                                        |
| Source map validation                  | yes  | 80%                 | 60%                | Implemented first pass | Validation exists for Metro references, controlled Vite builds, and Expo export inspection.                                                                                                |
| Hermes compile workflow                | yes  | 70%                 | 35%                | Implemented first pass | Compiler detection and HBC output work when Hermes is available, but this is still a controlled post-build path.                                                                           |
| Native artifact and lifecycle planning | yes  | n/a                 | 35%                | Current iOS corridor   | `vifx native prepare` writes bundle directories and manifests; `native doctor` checks playground host and signing markers; `native run` now has one executed Expo iOS simulator path.      |
| Expo migration prep                    | yes  | n/a                 | 65%                | Supported now          | `vifx setup` is the current onboarding path; legacy migrate surfaces remain available for maintainers.                                                                                     |
| Config bootstrap and loading           | yes  | n/a                 | 50%                | Implemented first pass | Loader supports `ts/mts/js/mjs`, but `vifx init` is not runtime-ready by default and external projects still rely on config imports.                                                       |
| Vifx build and browser runtime         | yes  | n/a                 | 20%                | Available              | `vifx build` and `vifx run` are real commands for targets with `reactNativeCompat: "web"`; preview only, not native runtime parity.                                                        |
| Vite React Native plugin               | yes  | 50%                 | 20%                | Available              | Real plugin plus controlled build helper, source maps, optional Hermes, aliases, package entries, web runtime preview support, and playground validation.                                  |
| Vite Expo plugin                       | yes  | 25%                 | 40%                | Available              | Expo app config detection, `EXPO_PUBLIC_*` injection, safe shims, and playground validation exist on top of the RN plugin.                                                                 |
| Expo Router browser preview            | yes  | 10%                 | 25%                | Available              | `expo-router/entry` support currently covers browser runtime previews with generated route context and platform route picks.                                                               |
| Expo export inspection/generation      | yes  | n/a                 | 58%                | Partial generation     | Walks existing Expo export output and can generate Vifx bundle, source-map, asset, manifest, metadata, optional Updates v1 manifests, and local Updates responses without full EAS parity. |

## How To Read It

- `Done` means the repository contains a working first-pass implementation, not full parity.
- `Metro Compatibility` is an estimate of how much of the relevant Metro behavior is currently covered or mirrored by Vifx for that feature area.
- `Expo Compatibility` is an estimate of how safely and usefully that feature currently applies to Expo projects.
- `Status` is the qualitative interpretation you should trust before the percentages.
- `Available` means the repository ships that surface today, but it is not part of the primary onboarding corridor.

## Interpretation

Use this page for fast product-level scanning.

Use the following pages for deeper detail:

- [Packages](/reference/packages) for package-by-package implementation state
- [CLI](/reference/cli) for command surfaces and current workflows
- [Support Matrix](/reference/support-matrix) for qualitative support language
- [Roadmap](/roadmap) for the milestone sequence
