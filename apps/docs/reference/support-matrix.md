# Support Matrix

The support matrix is product-facing. It distinguishes the no-Metro Vite bundling corridor from workflows Vifx intentionally does not replace.

## Versions And Scope

The current Expo work is fixture-backed against Expo SDK 54. `vifx doctor` warns when an Expo dependency falls outside that SDK major range.

| Surface                                    | Supported now | Available for maintainers                         | Out of scope                                       | Notes                                                                                     |
| ------------------------------------------ | ------------- | ------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `vifx setup` for Expo projects             | yes           | `--with-vite-config`, `--dry-run`, JSON preview   | non-Expo onboarding through `setup`                | Generates Vifx-owned config without editing Expo-owned app files.                         |
| `vifx build`                               | yes           | platform filtering and JSON output                | native app builds                                  | Central production bundle command for configured Vite targets.                            |
| `vifx expo audit`                          | yes           | export-root inspection and JSON reporting         | parity claims by itself                            | Reports config, Vite build, Metro parity, dev-server, and export-artifact workflows only. |
| `vifx expo dev`                            | partial       | platform-specific Vite server and JSON output     | Expo CLI, Expo Go, native dev-client, Fast Refresh | Requires a web-compatible configured target.                                              |
| `vifx expo export`                         | yes           | platform filtering and JSON output                | Expo Updates runtime, serving, signing, EAS        | Writes bundles, source maps, assets, `manifest.json`, and `metadata.json`.                |
| Metro comparison and compatibility reports | yes           | deeper fixture expansion                          | live Metro replacement by comparison alone         | Metro remains the reference surface for bundle parity evidence.                           |
| Legacy migration surfaces                  | no            | `vifx migrate`, `vifx init`, and `vifx vite init` | product-facing onboarding                          | These remain available as legacy or advanced maintainer surfaces.                         |

## Non-Goals

- Expo CLI replacement
- Expo Go replacement
- EAS integration
- app build/run orchestration
- Expo Updates runtime or local Updates server
- full React Native Fast Refresh parity
