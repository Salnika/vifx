# Support Matrix

The support matrix is intentionally honest about implemented, reference-only, experimental, and queued areas.

For a faster percentage-style snapshot, see [Features](/reference/features).

| Feature                                           | Metro reference | Primitive surface      | Vite RN plugin          | Expo layer              | Note                                                                                                                                  |
| ------------------------------------------------- | --------------- | ---------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Platform files                                    | yes             | implemented first pass | experimental first pass | experimental first pass | Resolver exists and both Vite layers use it on the bounded build path.                                                                |
| Package `react-native` field and exports          | yes             | implemented first pass | experimental first pass | experimental first pass | Proof is still narrow and fixture-backed, but it is no longer scaffold-only.                                                          |
| Assets `@2x/@3x`                                  | yes             | implemented first pass | experimental first pass | experimental first pass | Asset grouping is wired through the RN bundle path and reused by the Expo layer.                                                      |
| Source map validation                             | yes             | implemented first pass | experimental first pass | experimental first pass | Valid source maps are checked on the controlled Vite build path; runtime parity is not claimed.                                       |
| Hermes bytecode                                   | yes             | implemented first pass | experimental first pass | experimental first pass | Optional Hermes compile is available on the controlled bundle path when tooling is installed.                                         |
| Compatibility reports                             | yes             | implemented first pass | n/a                     | n/a                     | Current shared suite is `11` cases across `6` categories and passes for both adapters today; it is still much smaller than Metro.     |
| Metro artifact inspection                         | yes             | reference only         | n/a                     | n/a                     | Captured-artifact inspection exists for RN and Expo fixtures.                                                                         |
| Browser runtime preview (`vifx build`/`run`)      | n/a             | n/a                    | experimental preview    | experimental preview    | Requires `vite.targets[].reactNativeCompat = "web"` and serves built artifacts locally; no device, Expo Go, Fast Refresh, or HMR.     |
| Config bootstrap (`vifx init`, `vifx vite init`)  | n/a             | implemented first pass | experimental workflow   | experimental workflow   | Scaffolds conservative configs, but generated targets still need manual edits for browser previews and Expo Router entries.           |
| Expo migration prep                               | n/a             | n/a                    | n/a                     | experimental workflow   | Prepares experiments without replacing Expo or Metro.                                                                                 |
| Fast Refresh parity                               | yes             | n/a                    | non-goal                | non-goal                | Explicitly out of scope in the current milestone range.                                                                               |
| Expo Router browser preview (`expo-router/entry`) | yes             | n/a                    | experimental preview    | experimental preview    | Bounded web-preview support exists with generated route context and platform route resolution; no Expo Go, device runtime, or parity. |
| Expo export inspection                            | yes             | inspect first          | no                      | inspect first           | Existing Expo export output can be inspected and normalized, but generation claims are still out of scope.                            |
| Expo Updates generation                           | yes             | n/a                    | no                      | no                      | Not implemented in the current milestone range.                                                                                       |
| EAS integration                                   | yes             | n/a                    | no                      | no                      | Not implemented in the current milestone range.                                                                                       |

## Interpretation

- `yes` means known reference behavior today.
- `implemented first pass` means present and tested in this repository, without claiming full parity.
- `experimental first pass` means present and usable for bounded experiments, without any replacement claim.
- `experimental preview` means present for bounded browser-preview workflows only.
- `reference only` means the repo can inspect or compare the behavior without replacing it.
- `inspect first` means the repo can read and normalize the surface before attempting generation or parity claims.
- `planned` means not yet proven in this repository.
- `experimental workflow` means usable for bounded experiments, not for replacement claims.
- `queued` means the work is intentionally later in the roadmap.
- `non-goal` means intentionally out of scope in early milestones.
