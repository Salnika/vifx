# Support Matrix

The support matrix is intentionally honest about planned, inspect-only, and non-goal areas.

| Feature                                  | Metro | Primitive    | Vite RN       | Expo          | Note                                                  |
| ---------------------------------------- | ----- | ------------ | ------------- | ------------- | ----------------------------------------------------- |
| Platform files                           | yes   | planned      | planned       | planned       | Resolver milestone first.                             |
| Package `react-native` field and exports | yes   | planned      | planned       | planned       | Needs fixture-driven proof.                           |
| Assets `@2x/@3x`                         | yes   | planned      | planned       | planned       | Asset registry before plugins.                        |
| Source map validation                    | yes   | planned      | inspect first | inspect first | Validation matters before parity claims.              |
| Hermes bytecode                          | yes   | planned      | no            | no            | Handled as a dedicated primitive first.               |
| Fast Refresh parity                      | yes   | n/a          | non-goal      | non-goal      | Explicitly out of scope early on.                     |
| Expo Router                              | yes   | n/a          | no            | planned       | Must stay clearly documented as unsupported early on. |
| Expo export and updates                  | yes   | inspect only | no            | inspect only  | Inspection comes before generation.                   |

## Interpretation

- `yes` means known reference behavior today.
- `planned` means not yet proven in this repository.
- `inspect first` means documentation and evidence should land before broader claims.
- `non-goal` means intentionally out of scope in early milestones.
