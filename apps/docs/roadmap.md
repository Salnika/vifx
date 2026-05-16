# Roadmap

## Snapshot

- Date: `2026-05-16`
- Current phase: `Milestone 4 source maps and Hermes complete`
- Summary: Milestones 0 through 4 are implemented in this repository: foundations, compatibility and inspection, resolver and assets, migration codemods, Metro inspection, source-map tooling, and Hermes bytecode workflows. The next major work starts at the Vite plugins and Expo export milestones.

## Milestones

### Milestone 0 - Repository Foundation

Status: Complete.

Monorepo setup, docs, empty scaffolds, and CI basics.

- Monorepo setup
- TypeScript config
- Basic docs site
- Empty package scaffolds
- CI scripts

### Milestone 1 - Compatibility And Inspection

Status: Complete.

Compatibility cases, Metro inspection, and initial fixtures.

- `@vifx/compat`
- `@vifx/compat-runner`
- `@vifx/metro-inspect`
- Initial fixtures

### Milestone 2 - Resolver And Assets

Status: Complete.

Platform resolution and asset normalization with fixture coverage.

- `@vifx/platform-resolver`
- `@vifx/asset-registry`
- CLI commands using these packages

### Milestone 3 - CLI Migration Assistant

Status: Complete.

Doctor, init, migrate, and conservative codemods.

- `vifx doctor`
- `vifx init`
- `vifx migrate expo`
- `vifx migrate react-native`
- `@vifx/codemods`

### Milestone 4 - Source Maps And Hermes

Status: Complete.

Source-map validation and Hermes compile workflows.

- `@vifx/source-map-tools`
- `@vifx/hermes-tools`
- Source map validation
- Hermes compile command

### Milestone 5 - Vite RN Experimental Plugin

Status: Experimental horizon.

A Vite plugin shell for React Native experiments after the primitives exist.

- `@vifx/vite-plugin-react-native`
- Playground React Native app
- Resolver integration
- Basic asset integration

### Milestone 6 - Expo Experimental Plugin

Status: Experimental horizon.

An Expo-specific layer that stays honest about support boundaries.

- `@vifx/vite-plugin-expo`
- Expo fixture integration
- Expo config detection
- Env support

### Milestone 7 - Expo Export Inspection

Status: Queued.

Inspect Expo export output and compare it to Vifx understanding.

- `@vifx/expo-export`
- Inspect Expo export output
- Compare against Vifx understanding
