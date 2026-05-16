# Features

Status: Current.

This page gives a current repository snapshot of the main feature areas in Vifx.

The percentages below are intentionally approximate. They are not benchmark scores. They are first-pass product estimates based on the current fixtures, commands, tests, and docs coverage in this repository.

The current shared compatibility suite is still small: 11 cases across 6 categories. It currently passes for both `metro` and `vifx`, but those green results should be read as proof for the covered slice, not as proof of overall parity.

## Snapshot

- Date: `2026-05-16`
- Milestone state: `Milestones 0 through 7 implemented first pass`
- Evidence: `vifx compat run --adapter all --report json` currently passes `22/22` adapter-case results total (`11/11` per adapter) across doctor, resolver, assets, bundler, and monorepo coverage
- Scope: compatibility foundations, inspection, resolver and asset primitives, migration prep, source maps, Hermes workflows, bounded Vite builds, browser runtime previews, and inspect-only Expo export analysis

## Feature Table

| Feature Area                    | Done | Metro Compatibility | Expo Compatibility | Status                  | Notes                                                                                                                                |
| ------------------------------- | ---- | ------------------- | ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Project detection and `doctor`  | yes  | n/a                 | 90%                | Implemented first pass  | Detects Expo, React Native, workspace root, configs, Hermes path, and current Vite plugin mode; current doctor cases pass `2/2`.     |
| Metro reference inspection      | yes  | 80%                 | 70%                | Reference inspection    | Uses captured Metro artifacts, not a live Metro execution pipeline.                                                                  |
| Compatibility reports           | yes  | 80%                 | 45%                | Implemented first pass  | Shared suite currently passes `11/11` cases per adapter, but coverage is still narrow compared to Metro and Expo surface area.       |
| Platform file resolution        | yes  | 85%                 | 70%                | Implemented first pass  | Current resolver cases pass `4/4`; the same resolver is reused by the controlled Vite build path and browser previews.               |
| Asset scale groups and metadata | yes  | 75%                 | 65%                | Implemented first pass  | `@2x/@3x` grouping is proven on fixtures and flows through the RN bundle path; broader asset parity is still incomplete.             |
| Source map validation           | yes  | 80%                 | 60%                | Implemented first pass  | Validation exists for Metro references, controlled Vite builds, and Expo export inspection.                                          |
| Hermes compile workflow         | yes  | 70%                 | 35%                | Implemented first pass  | Compiler detection and HBC output work when Hermes is available, but this is still a controlled post-build path.                     |
| Expo migration prep             | yes  | n/a                 | 65%                | Experimental workflow   | Safe dry-run and write flows exist, including optional `--with-vite` setup, but generated configs are intentionally conservative.    |
| Config bootstrap and loading    | yes  | n/a                 | 50%                | Implemented first pass  | Loader supports `ts/mts/js/mjs`, but `vifx init` is not runtime-ready by default and external projects still rely on config imports. |
| Vifx build and browser runtime  | yes  | n/a                 | 20%                | Experimental preview    | `vifx build` and `vifx run` are real commands for targets with `reactNativeCompat: "web"`; preview only, not native runtime parity.  |
| Vite React Native plugin        | yes  | 50%                 | 20%                | Experimental first pass | Real plugin plus controlled build helper, source maps, optional Hermes, aliases, package entries, and web runtime preview support.   |
| Vite Expo plugin                | yes  | 25%                 | 40%                | Experimental first pass | Expo app config detection, `EXPO_PUBLIC_*` injection, and safe shims exist on top of the RN plugin.                                  |
| Expo Router browser preview     | yes  | 10%                 | 25%                | Experimental preview    | Bounded `expo-router/entry` support exists only for browser runtime previews with generated route context and platform route picks.  |
| Expo export inspection          | yes  | n/a                 | 50%                | Inspect-first package   | Walks existing Expo export output and normalizes bundles, source maps, manifests, and assets without generation claims.              |

## How To Read It

- `Done` means the repository contains a working first-pass implementation, not full parity.
- `Metro Compatibility` is an estimate of how much of the relevant Metro behavior is currently covered or mirrored by Vifx for that feature area.
- `Expo Compatibility` is an estimate of how safely and usefully that feature currently applies to Expo projects.
- `Status` is the qualitative interpretation you should trust before the percentages.
- `Experimental preview` means the repository can prove a bounded browser preview workflow, but not native, Expo Go, or production parity.

## Interpretation

Use this page for fast product-level scanning.

Use the following pages for deeper detail:

- [Packages](/reference/packages) for package-by-package implementation state
- [CLI](/reference/cli) for command surfaces and current workflows
- [Support Matrix](/reference/support-matrix) for qualitative support language
- [Roadmap](/roadmap) for the milestone sequence
