# Features

Status: Current.

This page gives a compact repository snapshot for the no-Metro Vite bundling corridor.

## Snapshot

- Date: `2026-05-19`
- Current state: `V2 recentered toward Expo Go replacement, with first protocol server slice`
- Evidence: compatibility fixtures, Metro inspection, Vifx bundle builds, Expo dev-server proof, Expo Go manifest-server proof, and Expo export artifact generation
- Scope: bundle production, comparison, and early Expo Go protocol serving

## Feature Table

| Feature Area                    | Status                 | Metro/Vifx Evidence                        | Notes                                                                                                                                       |
| ------------------------------- | ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Project detection and `doctor`  | Implemented first pass | project and config inspection tests        | Detects Expo, React Native, workspace root, configs, Hermes path, and plugin mode.                                                          |
| Metro reference inspection      | Implemented first pass | captured `metro-output` artifacts          | Uses fixture artifacts, not a live Metro execution pipeline.                                                                                |
| Compatibility reports           | Implemented first pass | shared Metro and Vifx adapter cases        | Coverage is intentionally narrow and should expand with bundle parity work.                                                                 |
| Platform file resolution        | Implemented first pass | resolver fixture tests                     | Covers platform files, package main fields, and package exports.                                                                            |
| Asset scale groups and metadata | Implemented first pass | asset fixture tests                        | Normalizes scales, dimensions, hashes, and asset metadata.                                                                                  |
| Source map validation           | Implemented first pass | Metro and Vifx source-map fixtures         | Used by build and export inspection.                                                                                                        |
| Hermes compile workflow         | Implemented first pass | controlled post-build command tests        | Useful for bundle artifacts, not a native runtime claim.                                                                                    |
| Vite React Native plugin        | Available              | `vifx build`, plugin tests, playground     | Core path for replacing Metro bundle output.                                                                                                |
| Vite Expo plugin                | Available              | Expo plugin tests and playground           | Adds Expo config/env behavior above the RN plugin.                                                                                          |
| Expo Vite dev server            | Partial                | `vifx expo dev`                            | Browser preview plus fixture-backed `--expo-go` manifest, bundle, asset, source-map, and symbolication server; no full Fast Refresh parity. |
| Expo export artifacts           | Available              | `vifx expo export`, `inspectExpoExport`    | Generates bundles, source maps, assets, `manifest.json`, and `metadata.json`.                                                               |
| Metro bundle parity indicator   | In progress            | `metro inspect` plus Vifx bundle artifacts | Next milestone compares Vifx/Vite output to `fixtures/rn-bare-basic/metro-output/ios`.                                                      |

## Removed From Product Scope

Native lifecycle commands, native artifact manifests, local Expo Updates serving, Updates signing, and EAS Update parity are not part of the current Vifx product corridor.
