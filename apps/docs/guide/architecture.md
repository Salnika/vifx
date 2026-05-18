# Architecture

The architecture centers on explicit primitives, compatibility cases, and evidence-producing tools. Higher-level CLI and plugin work builds on those surfaces instead of bypassing them.

## Core Concepts

### React Native Bundler Contract

Bundling includes platform resolution, assets, source maps, Hermes, export shape, and development-server expectations.

- Make the contract explicit before trying to replace Metro.
- Test observable behavior instead of copying internals blindly.
- Use docs and fixtures to separate stable expectations from assumptions.

### Platform Resolution

- Resolution order must be explicit and testable.
- Workspace packages and symlinks are part of the core problem.
- Trace output matters because mismatches need explanation.

### Asset Registry

- Scale suffixes and dimensions must normalize into stable descriptors.
- Images, fonts, and other asset types should report in a consistent shape.
- Compatibility requires comparing metadata, not only output file names.

### Hermes Bytecode

- Do not vendor Hermes.
- Focus on detection, orchestration, and helpful errors.
- Keep bytecode workflows distinct from broader plugin parity claims.

### Source Maps And Symbolication

- Validate Metro and Vite-based source maps.
- Normalize paths before comparing reports.
- Use symbolication helpers to turn mismatches into actionable diagnostics.

### Expo Export Artifacts

- Inspect first and generate later.
- Generate bundle artifacts without Metro.
- Keep Expo Updates runtime, serving, signing, and EAS outside this package.

### Metro Compatibility

- Metro is a reference adapter, not the hidden implementation source of truth.
- Warn and todo states are useful because they show unfinished work honestly.
- Failures should include fixture, expected output, actual output, and docs links.

## Package Relationships

```text
apps/docs
  -> @vifx/cli
  -> @vifx/compat
      -> @vifx/compat-runner
  -> @vifx/metro-inspect
  -> @vifx/core
      -> @vifx/platform-resolver
      -> @vifx/asset-registry
      -> @vifx/source-map-tools
      -> @vifx/hermes-tools
  -> @vifx/expo-export
  -> @vifx/vite-plugin-react-native
      -> @vifx/vite-plugin-expo
```

## Architecture Sketch

```mermaid
flowchart TD
  docs[apps/docs]
  compat[@vifx/compat]
  runner[@vifx/compat-runner]
  metro[@vifx/metro-inspect]
  core[@vifx/core]
  resolver[@vifx/platform-resolver]
  assets[@vifx/asset-registry]
  maps[@vifx/source-map-tools]
  hermes[@vifx/hermes-tools]
  expoExport[@vifx/expo-export]
  cli[@vifx/cli]
  pluginRn[@vifx/vite-plugin-react-native]
  pluginExpo[@vifx/vite-plugin-expo]

  compat --> runner
  core --> runner
  core --> cli
  runner --> cli
  metro --> cli
  resolver --> core
  assets --> core
  maps --> core
  hermes --> cli
  expoExport --> pluginExpo
  core --> pluginRn
  resolver --> pluginRn
  assets --> pluginRn
  pluginRn --> pluginExpo
  docs --> cli
```
