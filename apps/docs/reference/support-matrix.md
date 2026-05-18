# Support Matrix

The support matrix is product-facing. It distinguishes what is supported now, what is available for maintainers, and what is not supported yet.

For a faster percentage-style snapshot, see [Features](/reference/features).

## Versions And Scope

The current supported Expo corridor is fixture-backed against Expo SDK 54. `vifx doctor` warns with `VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION` when an Expo dependency falls outside that SDK major range.

| Surface                                    | Supported now | Available for maintainers                                            | Not supported yet                                              | Notes                                                                                                                |
| ------------------------------------------ | ------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `vifx setup` for Expo projects             | yes           | `--with-vite-config`, `--dry-run`, and JSON preview remain available | non-Expo onboarding through `setup`                            | Generates Vifx-owned config without editing Expo-owned app files.                                                    |
| `vifx expo audit`                          | yes           | export-root inspection and JSON reporting                            | parity claims by itself                                        | Use it to verify the supported corridor and the missing pieces.                                                      |
| `vifx expo dev` browser preview            | yes           | platform-specific preview and JSON output                            | Expo Go, native dev-client protocol, Fast Refresh parity       | Requires `reactNativeCompat: "web"` and currently depends on Expo Router plus `app/` for the recommended setup path. |
| `vifx native run` on Expo iOS simulator    | yes           | `native doctor`, lifecycle `--dry-run`, and explicit overrides       | Android native execution, device execution, release parity     | The executed repo proof is Expo SDK 54 Debug simulator on iOS.                                                       |
| `vifx expo export` and `vifx expo serve`   | yes           | Updates signing and multipart responses                              | EAS parity, native client execution, directive handling parity | Export and local serving are supported as repo-local workflows.                                                      |
| React Native bundle build through Vifx     | yes           | direct `vite.config.vifx.ts` work and manual config authoring        | full runtime/device parity                                     | `vifx build` and `vifx run` work for configured targets.                                                             |
| Metro comparison and compatibility reports | yes           | deeper fixture expansion                                             | live Metro replacement by comparison alone                     | Metro remains the reference surface and Vifx keeps comparison artifacts explicit.                                    |
| Manual migration surfaces                  | no            | `vifx migrate`, `vifx init`, and `vifx vite init`                    | product-facing onboarding                                      | These remain available as legacy or advanced maintainer surfaces.                                                    |
| Expo Go                                    | no            | no                                                                   | yes                                                            | Continue to use Expo CLI directly.                                                                                   |
| Fast Refresh parity                        | no            | no                                                                   | yes                                                            | Not implemented in the current corridor.                                                                             |
| Android native execution parity            | no            | host diagnostics and planning                                        | yes                                                            | Build, install, and launch proof is still missing.                                                                   |
| EAS integration                            | no            | no                                                                   | yes                                                            | Not implemented in the current corridor.                                                                             |

## Interpretation

- `Supported now` means the repository has a maintained command surface and validation story for that flow.
- `Available for maintainers` means the surface exists and is useful, but it is no longer part of the primary onboarding or product messaging.
- `Not supported yet` means the repository does not currently claim that capability.
