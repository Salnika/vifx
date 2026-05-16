# Vifx

> Status: experimental research toolkit. Not a production Metro replacement yet.

A compatibility toolkit and experimental modern bundling layer for React Native and Expo.

## Why Vifx exists

React Native bundling is more than JavaScript bundling. Platform file resolution, asset metadata, source maps, Hermes workflows, and Expo-specific output shape are all part of the contract. Vifx starts by making that contract observable, testable, and reusable before attempting a full Metro replacement.

## Current status

The current repository pass focuses on the first useful foundation:

- monorepo package scaffolds for Vifx primitives and CLI
- a documentation app in `apps/docs`
- fixtures for Expo, bare React Native, assets, workspace resolution, and captured Metro artifacts
- compatibility runners and reference inspection for Metro and Vifx
- codemods, source-map tools, and Hermes workflows for the first four milestones

Metro replacement, Expo replacement, and advanced runtime parity remain out of scope for this pass.

## Packages

- `@vifx/types`: shared public types
- `@vifx/errors`: structured errors and diagnostics
- `@vifx/logger`: terminal and JSON logging helpers
- `@vifx/config`: config definition and loading
- `@vifx/platform-resolver`: React Native-style platform resolution
- `@vifx/asset-registry`: asset grouping and normalization
- `@vifx/core`: project discovery and orchestration
- `@vifx/compat`: compatibility cases and fixture metadata
- `@vifx/compat-runner`: report generation for adapters
- `@vifx/metro-inspect`: captured Metro artifact inspection
- `@vifx/codemods`: safe init and migration file planning
- `@vifx/source-map-tools`: source map validation and symbolication
- `@vifx/hermes-tools`: Hermes compiler detection and bytecode orchestration
- `@vifx/cli`: `vifx` command surface

## Quick start

```bash
vp install
vp run build
vp run test
vp run docs#dev
```

## Analyze a project

```bash
pnpm --filter @vifx/cli vifx doctor ./fixtures/expo-basic
pnpm --filter @vifx/cli vifx inspect ./fixtures/rn-bare-basic
```

## Run compatibility tests

```bash
pnpm --filter @vifx/cli vifx compat run --adapter vifx
```

## Migrate an Expo project experimentally

```bash
pnpm --filter @vifx/cli vifx migrate expo ./fixtures/expo-basic --dry-run
```

## Documentation

The documentation app lives in `apps/docs`.

## Roadmap

The full staged roadmap is tracked in `SPECS.md`, with the current implementation status recorded directly in that file.

## Contributing

See `CONTRIBUTING.md` for repository conventions and validation commands.

## License

MIT
