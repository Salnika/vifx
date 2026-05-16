# Error Codes

These codes describe the first-pass diagnostic vocabulary currently documented for Vifx.

| Code                                    | Meaning                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `VIFX_RESOLVE_NOT_FOUND`                | Resolver could not find a matching module for the requested platform.    |
| `VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE`  | Multiple platform candidates matched and Vifx could not pick one safely. |
| `VIFX_ASSET_INVALID_SCALE`              | An asset scale group was malformed or inconsistent.                      |
| `VIFX_SOURCEMAP_INVALID`                | A source map failed validation or comparison.                            |
| `VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION` | The project's Expo version falls outside the current experiment range.   |
| `VIFX_MIGRATION_UNSAFE_CHANGE`          | A requested migration step was too risky without confirmation.           |
| `VIFX_CONFIG_MISSING`                   | No `vifx.config.*` file was found.                                       |
| `VIFX_EXPERIMENTAL_EXPO`                | Expo support is currently experimental.                                  |

## Direction

- Expand coverage as Metro inspection, Hermes tooling, and migration codemods land.
- Link every stable error code to a dedicated reference page once the code list settles.
