# Error Codes

These codes describe the public diagnostic vocabulary currently emitted by Vifx packages and CLI commands.

| Code                                     | Meaning                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `VIFX_INTERNAL_ERROR`                    | An unexpected failure was normalized into a structured Vifx error.                                                |
| `VIFX_ASSET_INVALID_SCALE`               | An asset scale group was malformed or inconsistent.                                                               |
| `VIFX_ASSET_NOT_FOUND`                   | The requested asset file or asset group does not exist.                                                           |
| `VIFX_ASSET_UNSUPPORTED_TYPE`            | The requested asset type is outside the supported asset registry extensions.                                      |
| `VIFX_BUILD_INVALID_PLATFORM`            | A build command received an unsupported platform value.                                                           |
| `VIFX_BUILD_TARGET_NOT_FOUND`            | No configured build target matched the requested platform.                                                        |
| `VIFX_BUILD_TARGETS_MISSING`             | The config does not contain any Vite bundle targets.                                                              |
| `VIFX_CONFIG_INVALID`                    | A Vifx config value failed schema or shape validation.                                                            |
| `VIFX_CONFIG_LOAD_FAILED`                | A config file existed but could not be imported or evaluated.                                                     |
| `VIFX_CONFIG_MISSING`                    | Project inspection did not find a `vifx.config.*` file.                                                           |
| `VIFX_CONFIG_NOT_FOUND`                  | A required or explicitly requested config file was missing.                                                       |
| `VIFX_CORE_MISSING_PRIMITIVE`            | A lazy core primitive could not be loaded from its package.                                                       |
| `VIFX_DYNAMIC_CONTEXT_MODE_UNSUPPORTED`  | A `require.context` call requested a context mode other than the supported `sync` mode.                           |
| `VIFX_DYNAMIC_CONTEXT_NOT_STATIC`        | A `require.context` call used arguments that cannot be statically analyzed at build time.                         |
| `VIFX_DYNAMIC_IMPORT_NOT_STATIC`         | A native bundle contains a dynamic `import()` whose specifier is not a string literal.                            |
| `VIFX_EXPERIMENTAL_EXPO`                 | Expo support falls outside the current supported corridor for the inspected workflow.                             |
| `VIFX_EXPO_CONFIG_NOT_FOUND`             | The Expo layer could not find or read app config metadata.                                                        |
| `VIFX_EXPO_DEV_INVALID_PLATFORM`         | An Expo dev command received an unsupported platform value.                                                       |
| `VIFX_EXPO_DEV_INVALID_PORT`             | An Expo dev command received a malformed port value.                                                              |
| `VIFX_EXPO_DEV_PLATFORM_REQUIRED`        | Multiple Expo dev targets exist and the command needs an explicit platform.                                       |
| `VIFX_EXPO_DEV_REQUIRES_EXPO_MODE`       | Expo dev serving was run without `vite.mode = "expo"`.                                                            |
| `VIFX_EXPO_DEV_REQUIRES_WEB_COMPAT`      | An Expo dev target must opt into `reactNativeCompat: "web"` before browser serving.                               |
| `VIFX_EXPO_DEV_TARGET_NOT_FOUND`         | No configured Expo dev target matched the requested platform.                                                     |
| `VIFX_EXPO_DEV_TARGETS_MISSING`          | The config does not contain any Expo dev targets.                                                                 |
| `VIFX_EXPO_EXPORT_DUPLICATE_PLATFORM`    | Expo export generation received more than one bundle for the same platform.                                       |
| `VIFX_EXPO_EXPORT_INVALID_PLATFORM`      | An Expo export command received an unsupported platform value.                                                    |
| `VIFX_EXPO_EXPORT_NOT_FOUND`             | The Expo export inspector could not find the requested export root.                                               |
| `VIFX_EXPO_EXPORT_REQUIRES_EXPO_MODE`    | Expo export generation was run without `vite.mode = "expo"`.                                                      |
| `VIFX_EXPO_EXPORT_TARGET_NOT_FOUND`      | No configured Expo export target matched the requested platform.                                                  |
| `VIFX_EXPO_EXPORT_TARGETS_MISSING`       | Expo export generation did not receive any Vifx bundle artifacts.                                                 |
| `VIFX_EXPO_SMOKE_INVALID_ASSET_LIMIT`    | An Expo smoke command received a malformed asset sampling limit.                                                  |
| `VIFX_EXPO_SMOKE_REQUIRES_EXPO_MODE`     | Expo Go smoke validation was run without `vite.mode = "expo"`.                                                    |
| `VIFX_EXPO_SMOKE_WEBSOCKET_UNAVAILABLE`  | The current Node.js runtime cannot open the WebSocket loop required by Expo Go smoke validation.                  |
| `VIFX_HERMES_COMPILE_FAILED`             | Hermes compiler execution failed.                                                                                 |
| `VIFX_HERMES_INPUT_MISSING`              | The requested Hermes input bundle does not exist.                                                                 |
| `VIFX_HERMES_OUTPUT_MISSING`             | Hermes completed without creating the requested bytecode output.                                                  |
| `VIFX_HERMES_UNAVAILABLE`                | No Hermes compiler was found through explicit path, env, workspace, or PATH.                                      |
| `VIFX_MIGRATION_UNSAFE_CHANGE`           | A requested migration step was too risky or targeted the wrong project type.                                      |
| `VIFX_MONOREPO_EXPERIMENTAL`             | Project inspection detected a workspace path that still depends on the current monorepo-limited support corridor. |
| `VIFX_NO_ISSUES`                         | Project inspection completed without finding actionable issues.                                                   |
| `VIFX_PROJECT_INVALID_PACKAGE_JSON`      | Project detection could not parse or use a package manifest.                                                      |
| `VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION`  | The project's Expo version falls outside the current experiment range.                                            |
| `VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE`   | Multiple platform candidates matched and Vifx could not pick one safely.                                          |
| `VIFX_RESOLVE_INVALID_PACKAGE_JSON`      | Resolver could not parse or use a package manifest.                                                               |
| `VIFX_RESOLVE_INVALID_SPECIFIER`         | Resolver received a malformed package specifier.                                                                  |
| `VIFX_RESOLVE_NOT_FOUND`                 | Resolver could not find a matching module for the requested platform.                                             |
| `VIFX_RUN_INVALID_PLATFORM`              | A run command received an unsupported platform value.                                                             |
| `VIFX_RUN_INVALID_PORT`                  | A run command received a malformed port value.                                                                    |
| `VIFX_RUN_PLATFORM_REQUIRED`             | Multiple runnable targets exist and the run command needs an explicit platform.                                   |
| `VIFX_RUN_REQUIRES_WEB_COMPAT`           | A target must opt into `reactNativeCompat: "web"` before it can be served.                                        |
| `VIFX_RUN_RUNTIME_MISSING`               | Runtime preview artifacts were not found after a build attempt.                                                   |
| `VIFX_RUN_RUNTIME_NOT_FOUND`             | Runtime preview artifacts were missing when running with `--no-build`.                                            |
| `VIFX_RUN_TARGET_NOT_FOUND`              | No configured runtime target matched the requested platform.                                                      |
| `VIFX_RUN_TARGETS_MISSING`               | The config does not contain any Vite runtime targets.                                                             |
| `VIFX_SOURCEMAP_INVALID`                 | A source map failed validation or comparison.                                                                     |
| `VIFX_SETUP_CONFIRMATION_REQUIRED`       | `vifx setup` was run without `--yes` in a non-interactive session.                                                |
| `VIFX_SETUP_EXPO_ONLY`                   | `vifx setup` was pointed at a non-Expo project even though the v1 flow supports Expo only.                        |
| `VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST` | Project inspection found a custom Metro `resolveRequest` hook outside Vifx scope.                                 |
| `VIFX_UNSUPPORTED_METRO_SERIALIZER`      | Project inspection found a custom Metro serializer outside Vifx scope.                                            |
| `VIFX_VITE_BUNDLE_MISSING`               | A Vite bundle build finished without the expected JavaScript bundle artifact.                                     |

## Direction

- Keep this table aligned with `VIFX_ERROR_CODES` in `@vifx/errors`.
- Link high-volume codes to dedicated troubleshooting pages once the code list is stable enough to split.
