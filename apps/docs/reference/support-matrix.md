# Support Matrix

The support matrix is product-facing. It distinguishes the no-Metro Vite bundling corridor from workflows Vifx intentionally does not replace.

## Versions And Scope

The current Expo work is device-validated against Expo SDK 54 and statically analyzed against SDK 55 and 56. See [Expo SDK Support](#expo-sdk-support) for the per-SDK tiers. `vifx doctor` warns when an Expo dependency falls outside the supported SDK majors, and reports the support tier for SDKs inside it.

| Surface                                    | Supported now | Available for maintainers                         | Out of scope                                        | Notes                                                                                     |
| ------------------------------------------ | ------------- | ------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `vifx setup` for Expo projects             | yes           | `--expo-go`, `--with-vite-config`, JSON preview   | non-Expo onboarding through `setup`                 | Generates Vifx-owned config without editing Expo-owned app files.                         |
| `vifx build`                               | yes           | platform filtering and JSON output                | native app builds                                   | Central production bundle command for configured Vite targets.                            |
| `vifx expo audit`                          | yes           | export-root inspection and JSON reporting         | parity claims by itself                             | Reports config, Vite build, Metro parity, dev-server, and export-artifact workflows only. |
| `vifx expo dev`                            | partial       | browser preview plus `--expo-go` protocol server  | full Expo CLI parity, Fast Refresh, native binaries | Browser mode requires `reactNativeCompat: "web"`; Expo Go mode is fixture-backed.         |
| `vifx expo export`                         | yes           | platform filtering and JSON output                | Expo Updates runtime, serving, signing, EAS         | Writes bundles, source maps, assets, `manifest.json`, and `metadata.json`.                |
| Metro comparison and compatibility reports | yes           | deeper fixture expansion                          | live Metro replacement by comparison alone          | Metro remains the reference surface for bundle parity evidence.                           |
| Legacy migration surfaces                  | no            | `vifx migrate`, `vifx init`, and `vifx vite init` | product-facing onboarding                           | These remain available as legacy or advanced maintainer surfaces.                         |

## Expo SDK Support

Vifx tracks Expo SDK majors with explicit support tiers. The tiers are deliberately honest about what evidence backs them:

- **validated** — fixture-backed AND device-validated against Expo Go. This is the current gate.
- **experimental** — static-analysis tier only: fixtures, `vifx expo audit`, `vifx doctor` detection, and compat cases exist, but dev-server protocols and runtime behavior are NOT device-validated.

| Expo SDK | React Native | Tier         | What is covered                                                                  | What is NOT covered                                           |
| -------- | ------------ | ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 54       | 0.81         | validated    | Fixtures, audits, doctor detection, device-validated Expo Go dev-server corridor | EAS, Expo Updates runtime, native binaries (see Non-Goals)    |
| 55       | 0.83         | experimental | Static analysis: fixtures, audits, doctor detection, compat cases                | Device validation; dev-server protocols on real devices       |
| 56       | 0.84         | experimental | Static analysis: fixtures, audits, doctor detection, compat cases                | Device validation; Hermes V1 runtime behavior on real devices |

SDK-specific notes:

- **SDK 55** ships New Architecture only. The `expo-sdk55-basic` fixture sets `newArchEnabled: true` accordingly.
- **SDK 56** defaults to the Hermes V1 engine. Vifx static analysis does not exercise Hermes V1 at runtime.
- Projects on SDK majors outside this table are reported as unsupported by `vifx doctor` and `vifx expo audit`.

`vifx doctor` prints the detected SDK, its tier, and the tier notes for Expo projects, and `vifx doctor --json` exposes the same data under `expoSdkSupport`. `vifx expo audit` accepts SDK 54-56 by default and emits tier-appropriate warnings for the experimental SDKs instead of failing on the SDK version alone; an explicit `--supported-sdk` value overrides the support table and restores strict range reporting.

## Non-Goals

- full Expo CLI replacement
- full Expo Go parity beyond the fixture-backed `--expo-go` server
- EAS integration
- app build/run orchestration
- Expo Updates runtime or local Updates server
- full React Native Fast Refresh parity
