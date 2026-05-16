# Vifx — React Native / Expo bundler research monorepo

## 0. Goal for Codex

Build the first production-quality foundation of **Vifx**, a monorepo for researching and implementing a modern React Native / Expo bundling toolchain.

Vifx is **not** initially a full Metro replacement. The project must first provide the missing foundations that make a future Metro replacement possible:

1. A compatibility test suite that defines observable Metro / React Native / Expo bundler behavior.
2. Inspection tools that compare Metro output against Vifx primitives.
3. Reusable packages for platform resolution, asset handling, source maps, Hermes integration, and Expo export metadata.
4. A CLI that can analyze and prepare existing Expo / React Native projects for Vifx.
5. A documentation website explaining every package and workflow.
6. An experimental Vite plugin that can eventually serve React Native bundles through a Metro-compatible surface.

The key philosophy is:

> Do not start by replacing Metro. Start by making the implicit React Native bundler contract explicit, testable, documented, and reusable.

---

## 1. Product positioning

### Name

**Vifx**

### Tagline

A compatibility toolkit and experimental modern bundling layer for React Native and Expo.

### Longer description

Vifx is a monorepo containing tools, packages, fixtures, and documentation for building modern React Native / Expo bundlers. It starts with compatibility testing and Metro behavior inspection, then gradually introduces reusable bundler primitives and a Vite-powered experimental adapter.

### What Vifx is

- A research-grade but well-engineered monorepo.
- A compatibility suite for React Native bundlers.
- A set of reusable bundler primitives.
- A documentation-first open source project.
- A migration assistant for Expo / React Native projects.
- A future foundation for `vite-plugin-react-native` and `vite-plugin-expo`.

### What Vifx is not yet

- Not a production-ready Metro replacement in version 0.
- Not a fork of Metro.
- Not a wrapper that hides Metro forever.
- Not a React Native framework.
- Not a replacement for Expo CLI or EAS in the first milestone.

---

## 2. External context and assumptions

These assumptions must guide the implementation:

1. Expo CLI currently uses Metro for `expo start` and `expo export` to bundle JavaScript and assets.
2. Metro is optimized for React Native and deeply integrated with the React Native ecosystem.
3. React Native / Expo bundling includes more than JavaScript bundling: platform file resolution, asset metadata, source maps, Fast Refresh behavior, symbolication, Hermes output, Expo Updates output, and development server endpoints.
4. Vite is interesting because of its plugin model, dev server, dependency pre-bundling, Rollup/Rolldown ecosystem, and DX.
5. Re.Pack already exists as a serious alternative approach based on Webpack/Rspack; Vifx should not duplicate it blindly.
6. The most valuable initial contribution is a compatibility and primitives layer.

---

## 3. High-level architecture

The monorepo must be package-based and documentation-first.

```txt
vifx/
  apps/
    docs/
    playground-expo/
    playground-rn-bare/

  packages/
    compat/
    compat-runner/
    metro-inspect/
    core/
    platform-resolver/
    asset-registry/
    source-map-tools/
    hermes-tools/
    expo-export/
    cli/
    vite-plugin-react-native/
    vite-plugin-expo/
    codemods/
    config/
    logger/
    errors/
    types/

  fixtures/
    rn-bare-basic/
    rn-bare-platform-files/
    rn-bare-assets/
    expo-basic/
    expo-router-basic/
    expo-assets-fonts/
    monorepo-yarn-workspaces/
    monorepo-pnpm-workspaces/

  docs/
    concepts/
    packages/
    guides/
    reference/
    migration/
    comparisons/

  scripts/
  .changeset/
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  README.md
  CONTRIBUTING.md
  LICENSE
```

---

## 4. Technical stack

Use the following stack unless there is a strong reason not to:

```txt
Package manager: pnpm
Monorepo orchestration: Turborepo
Language: TypeScript
Runtime: Node.js >= 20
Build: tsup or unbuild
Tests: Vitest
CLI framework: CAC or Commander
Schema validation: Zod
Docs site: VitePress or Docusaurus
Linting: ESLint flat config
Formatting: Prettier
Release management: Changesets
```

Preferred package style:

- ESM-first packages.
- Typed public APIs.
- Small packages with clear boundaries.
- No circular dependencies between packages.
- No implicit dependency on Metro except inside `metro-inspect` and Metro reference test adapters.

---

## 5. Package list and responsibilities

### 5.1 `@vifx/types`

Shared public types used across the monorepo.

Responsibilities:

- Define platform types.
- Define bundler target types.
- Define asset metadata types.
- Define source map types.
- Define compatibility test result types.
- Define normalized project metadata types.

Example API:

```ts
export type VifxPlatform = "ios" | "android" | "native" | "web";

export interface VifxResolveOptions {
  platform: VifxPlatform;
  projectRoot: string;
  extensions?: string[];
  conditions?: string[];
}

export interface VifxAssetDescriptor {
  filePath: string;
  httpServerLocation: string;
  name: string;
  type: string;
  scales: number[];
  width?: number;
  height?: number;
  hash?: string;
}
```

Acceptance criteria:

- Exports only stable shared types.
- Has generated API docs.
- Has no runtime dependencies unless absolutely necessary.

---

### 5.2 `@vifx/errors`

Shared structured errors.

Responsibilities:

- Provide typed error classes.
- Provide actionable error messages.
- Provide error codes for CLI and docs linking.

Example error codes:

```txt
VIFX_RESOLVE_NOT_FOUND
VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE
VIFX_ASSET_INVALID_SCALE
VIFX_SOURCEMAP_INVALID
VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION
VIFX_MIGRATION_UNSAFE_CHANGE
```

Example API:

```ts
throw new VifxError({
  code: "VIFX_RESOLVE_NOT_FOUND",
  message: 'Unable to resolve module "./Button" for platform "ios".',
  hint: "Check that Button.ios.tsx, Button.native.tsx, or Button.tsx exists.",
  docsPath: "/errors/VIFX_RESOLVE_NOT_FOUND",
});
```

Acceptance criteria:

- All user-facing packages use structured errors.
- CLI renders errors with code, summary, hint, and docs URL.

---

### 5.3 `@vifx/logger`

Small logging utility for CLI and packages.

Responsibilities:

- Pretty logs in CLI.
- JSON logs for automation.
- Verbose and debug modes.
- No noisy output by default.

Acceptance criteria:

- `--json` output is machine-readable.
- `--verbose` prints diagnostic details.
- `--silent` suppresses non-critical logs.

---

### 5.4 `@vifx/platform-resolver`

A standalone resolver that implements React Native-style platform resolution.

Responsibilities:

- Resolve files by platform.
- Support extensions such as `.ios.tsx`, `.android.tsx`, `.native.tsx`, `.tsx`, `.ts`, `.jsx`, `.js`, `.json`.
- Support package `react-native` field.
- Support package `exports` where possible.
- Support monorepo workspaces.
- Support symlinks predictably.
- Return structured resolution traces.

Resolution order example for `platform: ios`:

```txt
Button.ios.tsx
Button.native.tsx
Button.tsx
Button.ios.ts
Button.native.ts
Button.ts
Button.ios.jsx
Button.native.jsx
Button.jsx
Button.ios.js
Button.native.js
Button.js
```

The exact order must be configurable and tested against Metro output.

Example API:

```ts
import { resolveReactNativeModule } from "@vifx/platform-resolver";

const result = await resolveReactNativeModule({
  fromFile: "/app/src/App.tsx",
  specifier: "./Button",
  platform: "ios",
  projectRoot: "/app",
});

console.log(result.filePath);
console.log(result.trace);
```

Acceptance criteria:

- Unit tests for relative imports.
- Unit tests for package imports.
- Unit tests for platform extensions.
- Unit tests for workspace packages.
- Compatibility tests comparing selected cases against Metro.
- Public API documented in docs site.

---

### 5.5 `@vifx/asset-registry`

A package that models React Native / Expo asset handling.

Responsibilities:

- Detect supported asset files.
- Parse scale suffixes like `@2x` and `@3x`.
- Group scaled assets.
- Extract dimensions for common image formats.
- Generate normalized asset descriptors.
- Generate deterministic asset hashes.
- Provide helpers for dev server asset URLs.

Supported initial asset types:

```txt
png
jpg
jpeg
webp
gif
svg
ttf
otf
mp4
json
```

Example API:

```ts
import { collectAssetGroup } from "@vifx/asset-registry";

const asset = await collectAssetGroup({
  filePath: "/app/assets/icon.png",
  projectRoot: "/app",
});
```

Acceptance criteria:

- Handles `icon.png`, `icon@2x.png`, `icon@3x.png`.
- Produces stable metadata.
- Includes tests for images and fonts.
- Includes compatibility tests against Metro where possible.

---

### 5.6 `@vifx/source-map-tools`

Utilities for source maps and symbolication experiments.

Responsibilities:

- Validate source maps.
- Normalize paths.
- Compose source maps where possible.
- Provide symbolication helpers.
- Provide sourcemap comparison tools.

Example API:

```ts
import { validateSourceMap, symbolicateStackFrame } from "@vifx/source-map-tools";
```

Acceptance criteria:

- Can validate a source map generated by Metro.
- Can validate a source map generated by Vite/Rollup.
- Can compare sources and mappings at a high level.
- Has tests using fixture bundles.

---

### 5.7 `@vifx/hermes-tools`

Thin wrapper around Hermes-related workflows.

Responsibilities:

- Detect Hermes compiler availability.
- Compile JS bundle to Hermes bytecode when possible.
- Validate Hermes bytecode output exists.
- Provide helpful installation errors.
- Do not vendor Hermes.

Example API:

```ts
import { compileHermesBytecode } from "@vifx/hermes-tools";

await compileHermesBytecode({
  inputBundlePath: "dist/index.android.bundle",
  outputBytecodePath: "dist/index.android.hbc",
  sourceMapPath: "dist/index.android.map",
});
```

Acceptance criteria:

- Works when Hermes compiler is available.
- Fails gracefully when unavailable.
- CLI command exists: `vifx hermes compile`.

---

### 5.8 `@vifx/expo-export`

Utilities for understanding and eventually producing Expo-compatible export artifacts.

Responsibilities:

- Inspect Expo project config.
- Inspect `expo export` output.
- Normalize update manifests.
- Compare Metro/Expo export output with expected Vifx output.
- Initially read and validate only; generation can come later.

Acceptance criteria:

- Can run against `fixtures/expo-basic`.
- Can detect assets and bundle output from an Expo export.
- Can produce a report explaining what Vifx understands and what remains unsupported.

---

### 5.9 `@vifx/core`

Core orchestration package.

Responsibilities:

- Provide shared project discovery.
- Detect project type: Expo, React Native bare, monorepo package, unknown.
- Load Vifx config.
- Re-export config helpers for compatibility while `@vifx/config` stays the source of truth.
- Provide common graph primitives.
- Coordinate resolver, assets, source maps, and reports.

Config file names:

```txt
vifx.config.ts
vifx.config.mts
vifx.config.js
vifx.config.mjs
```

Example usage:

```ts
import { createVifxContext } from "@vifx/core";

const context = await createVifxContext({
  cwd: process.cwd(),
});

console.log(context.project.projectType);
console.log(context.config.vite.mode);
```

Acceptance criteria:

- Can detect Expo project by `expo` dependency and app config.
- Can detect RN bare project by `react-native` dependency.
- Can detect workspace root.
- Can load and validate config.

---

### 5.10 `@vifx/metro-inspect`

A Metro reference behavior inspection tool.

Responsibilities:

- Run Metro against fixtures.
- Collect bundle output.
- Collect asset metadata where available.
- Collect source maps.
- Collect resolution traces where possible.
- Generate JSON reports.
- Use Metro only as a reference adapter.

CLI examples:

```bash
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

Output shape:

```json
{
  "projectRoot": "...",
  "platform": "ios",
  "entry": "index.js",
  "bundle": {
    "path": "...",
    "sizeBytes": 123456
  },
  "sourceMap": {
    "path": "...",
    "valid": true
  },
  "assets": [],
  "warnings": []
}
```

Acceptance criteria:

- Can inspect at least one RN bare fixture.
- Can inspect at least one Expo fixture.
- Does not crash if Metro internals change; emits unsupported diagnostic instead.
- Reports are deterministic enough for snapshot tests.

---

### 5.11 `@vifx/compat`

Defines compatibility tests and fixtures metadata.

Responsibilities:

- Define test cases independent of any bundler implementation.
- Define expected behavior.
- Provide fixture manifests.
- Provide reusable assertions.

Example compatibility test categories:

```txt
resolver.platformExtensions
resolver.packageMainFields
resolver.packageExports
assets.scaleGroups
assets.metadata
bundler.bundleArtifacts
bundler.sourceMapValidity
monorepo.workspaceResolution
```

Example API:

```ts
export const resolverPlatformCases = [
  {
    name: "ios file wins over native file",
    fixture: "rn-bare-platform-files",
    specifier: "./Button",
    platform: "ios",
    expectedFile: "Button.ios.tsx",
  },
];
```

Acceptance criteria:

- Tests are implementation-agnostic.
- Metro can be used as a reference implementation.
- Vifx primitives can be tested against the same cases.

---

### 5.12 `@vifx/compat-runner`

Runs compatibility tests against adapters.

Responsibilities:

- Run compatibility suite against Metro.
- Run compatibility suite against Vifx primitives.
- Later run against Re.Pack or other adapters if available.
- Generate Markdown, JSON, and terminal reports.

CLI examples:

```bash
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

Report example:

```txt
Compatibility report

Adapter: vifx
Platform: ios

resolver.platformExtensions       PASS  12/12
assets.scaleGroups                PASS   8/8
bundler.bundleArtifacts           PASS   1/1
bundler.sourceMapValidity         PASS   1/1
```

Acceptance criteria:

- Produces useful reports.
- CI runs compatibility tests.
- Failing tests include fixture path, expected output, actual output, and docs link.

---

### 5.13 `@vifx/codemods`

Code modification utilities used by the CLI migration command.

Responsibilities:

- Detect config files.
- Modify package scripts safely.
- Add Vifx config file.
- Add Vite config when requested.
- Add docs comments to generated files.
- Never overwrite user files without backup or explicit flag.

Codemods must be conservative.

Acceptance criteria:

- Dry-run mode by default for risky operations.
- Generates patch previews.
- Unit tests using temporary fixture projects.

---

### 5.14 `@vifx/cli`

Main user-facing CLI.

Binary name:

```bash
vifx
```

Commands:

```bash
vifx init
vifx doctor
vifx inspect
vifx compat run
vifx metro inspect
vifx migrate
vifx migrate expo
vifx migrate react-native
vifx vite init
vifx hermes compile
```

#### `vifx doctor`

Checks project readiness.

Must detect:

- Node version.
- Package manager.
- Expo version if present.
- React Native version.
- Metro config presence.
- Vite config presence.
- Workspace root.
- Hermes availability.
- Unsupported patterns.

#### `vifx migrate expo`

Prepares an Expo project for Vifx experiments.

Must:

- Detect Expo app.
- Read package manager.
- Add Vifx dev dependencies.
- Generate `vifx.config.ts`.
- Optionally generate `vite.config.ts` with Vifx plugin.
- Add scripts without removing existing scripts.
- Preserve Metro config.
- Print clear next steps.

Suggested scripts:

```json
{
  "scripts": {
    "vifx:doctor": "vifx doctor",
    "vifx:compat": "vifx compat run --adapter vifx",
    "vifx:inspect": "vifx inspect",
    "vifx:vite": "vite --config vite.config.ts"
  }
}
```

#### `vifx migrate react-native`

Same idea for RN bare projects.

Acceptance criteria:

- Works in dry-run mode.
- Works in write mode with `--write`.
- Does not break existing Expo/Metro workflow.
- Always prints rollback instructions.

---

### 5.15 `@vifx/vite-plugin-react-native`

Experimental Vite plugin for React Native.

Important: this package is experimental and must be clearly documented as such.

Responsibilities for first milestone:

- Provide a Vite plugin shell.
- Support platform option.
- Inject RN-related defines.
- Use `@vifx/platform-resolver` for platform files.
- Use `@vifx/asset-registry` for basic asset metadata.
- Provide a dev server endpoint compatible enough for experiments.
- Document unsupported features clearly.

Example usage:

```ts
import { defineConfig } from "vite";
import { reactNative } from "@vifx/vite-plugin-react-native";

export default defineConfig({
  plugins: [
    reactNative({
      platform: "ios",
      entry: "./index.js",
      hermes: true,
    }),
  ],
});
```

Initial non-goals:

- Full Expo Router support.
- Full Fast Refresh parity.
- Full Expo Updates export.
- Production-ready app store builds.

Acceptance criteria:

- Plugin loads in Vite.
- Can resolve platform files through Vifx resolver.
- Has at least one playground command.
- Has docs clearly explaining limitations.

---

### 5.16 `@vifx/vite-plugin-expo`

Experimental Expo layer on top of `@vifx/vite-plugin-react-native`.

Responsibilities for first milestone:

- Detect Expo config.
- Inject `EXPO_PUBLIC_*` env variables.
- Prepare Expo-specific aliases where safe.
- Document Expo limitations.
- Provide migration scaffolding.

Non-goals for first milestone:

- Full Expo Router support.
- Full Expo Updates output generation.
- Full EAS integration.
- Replacement for `expo start`.

Acceptance criteria:

- Can be installed and loaded in an Expo fixture.
- `vifx doctor` detects it.
- Docs explain exactly what works and what does not.

---

### 5.17 `@vifx/config`

Shared config loader and schema.

Responsibilities:

- Provide `defineVifxConfig`.
- Provide `loadVifxConfig`.
- Load config files.
- Validate with readable structured errors.
- Provide defaults for resolver, logging, Vite targets, and Expo public env handling.

Acceptance criteria:

- Config docs stay aligned with the implemented shape.
- Invalid config errors are readable.

---

## 6. Documentation site

Create `apps/docs` as a polished documentation website.

Preferred: VitePress for simplicity, unless Docusaurus is easier for versioned docs.

The docs site must include:

```txt
Home
Getting Started
Why Vifx exists
Architecture
Compatibility philosophy
Packages
  @vifx/core
  @vifx/platform-resolver
  @vifx/asset-registry
  @vifx/source-map-tools
  @vifx/hermes-tools
  @vifx/expo-export
  @vifx/compat
  @vifx/compat-runner
  @vifx/metro-inspect
  @vifx/cli
  @vifx/vite-plugin-react-native
  @vifx/vite-plugin-expo
Guides
  Analyze an Expo project
  Analyze a React Native project
  Run compatibility tests
  Inspect Metro output
  Migrate an Expo project experimentally
  Migrate a React Native project experimentally
  Use the Vite plugin experimentally
Concepts
  React Native bundler contract
  Platform resolution
  Asset registry
  Hermes bytecode
  Source maps and symbolication
  Expo export and updates
  Metro compatibility
Comparisons
  Metro
  Re.Pack
  Vite
  Vifx
Reference
  CLI
  Config
  Error codes
  Compatibility report format
```

Docs requirements:

- Every package must have a page with purpose, installation, API, examples, limitations, and roadmap.
- Every CLI command must have a page with examples.
- Experimental packages must be explicitly labeled experimental.
- Include diagrams as Mermaid where useful.
- Include a “Current support matrix” page.

Support matrix example:

```md
| Feature         | Metro reference | Vifx primitive | Vite RN plugin |  Expo plugin |
| --------------- | --------------: | -------------: | -------------: | -----------: |
| Platform files  |             yes |        partial |        partial |      partial |
| Assets @2x/@3x  |             yes |        partial |        partial |      partial |
| Hermes bytecode |             yes |        planned |        planned |      planned |
| Fast Refresh    |             yes |            n/a |        planned |      planned |
| Expo Router     |             yes |            n/a |             no |      planned |
| Expo Updates    |             yes |   inspect only |             no | inspect only |
```

---

## 7. CLI migration workflow

The migration tool must be careful. Its job is not to replace Metro immediately. Its job is to prepare a project for Vifx analysis and experiments.

### Command

```bash
vifx migrate expo --dry-run
vifx migrate expo --write
vifx migrate react-native --dry-run
vifx migrate react-native --write
```

### Required behavior

1. Detect project root.
2. Detect package manager.
3. Detect Expo or RN bare.
4. Read `package.json`.
5. Detect existing `metro.config.js`.
6. Detect existing `vite.config.*`.
7. Generate a migration plan.
8. Print risk level for each change.
9. Apply only when `--write` is passed.
10. Create backups or show patches.

### Generated files for Expo

```txt
vifx.config.ts
vite.config.vifx.ts
```

### Generated files for RN bare

```txt
vifx.config.ts
vite.config.vifx.ts
```

### Package scripts to add

```json
{
  "vifx:doctor": "vifx doctor",
  "vifx:inspect": "vifx inspect",
  "vifx:compat": "vifx compat run --adapter vifx",
  "vifx:metro": "vifx metro inspect . --platform ios",
  "vifx:vite": "vite --config vite.config.vifx.ts"
}
```

### Safety rules

- Never remove Metro config.
- Never replace `expo start` script automatically.
- Never remove dependencies automatically.
- Never modify native iOS/Android files in the first milestone.
- Always explain that Vifx is experimental.

---

## 8. Fixtures

Fixtures are essential. They must be small, explicit, and version-controlled.

### Required fixtures

#### `fixtures/rn-bare-basic`

Minimal RN app.

Tests:

- Entry resolution.
- Basic TS/JSX transform.
- Basic bundle inspection.

#### `fixtures/rn-bare-platform-files`

Contains:

```txt
Button.tsx
Button.native.tsx
Button.ios.tsx
Button.android.tsx
```

Tests platform resolution.

#### `fixtures/rn-bare-assets`

Contains:

```txt
icon.png
icon@2x.png
icon@3x.png
font.ttf
```

Tests asset grouping.

#### `fixtures/expo-basic`

Minimal Expo app.

Tests project detection and Expo config inspection.

#### `fixtures/expo-router-basic`

Minimal Expo Router app.

Tests future Expo Router support.

#### `fixtures/monorepo-yarn-workspaces`

Workspace with app and shared package.

#### `fixtures/monorepo-pnpm-workspaces`

Same but pnpm-style.

---

## 9. Testing strategy

### Unit tests

Every package must have unit tests.

### Integration tests

Use fixtures and temporary directories.

### Compatibility tests

Run through `@vifx/compat-runner`.

### Snapshot tests

Allowed for reports, but avoid brittle snapshots for full bundles.

### CI commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
pnpm compat:metro
pnpm compat:vifx
```

---

## 10. Public CLI UX

CLI must feel like a serious developer tool.

Example:

```bash
$ vifx doctor

Vifx Doctor

Project type: Expo
Package manager: pnpm
React Native: 0.xx.x
Expo: xx.x.x
Metro config: found
Vifx config: missing
Hermes compiler: unavailable

Issues:
  WARN  VIFX_CONFIG_MISSING
        No vifx.config.ts found.
        Run: vifx init

  INFO  VIFX_EXPERIMENTAL_EXPO
        Expo support is currently experimental.
```

JSON mode:

```bash
vifx doctor --json
```

Must output valid JSON with no extra logs.

---

## 11. Config design

Example:

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  projectType: "expo",
  platforms: ["ios", "android"],
  expo: true,
  reactNative: true,
  vite: {
    mode: "expo",
    targets: [
      {
        platform: "ios",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vite/ios",
      },
      {
        platform: "android",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vite/android",
      },
    ],
  },
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
  resolver: {
    conditions: ["react-native", "import", "require", "default"],
  },
});
```

---

## 12. Roadmap

### Milestone 0 — Repository foundation

Deliver:

- Monorepo setup.
- TypeScript config.
- ESLint / Prettier.
- Changesets.
- Basic docs site.
- Empty package scaffolds.
- CI scripts.

### Milestone 1 — Compatibility and inspection

Deliver:

- `@vifx/compat`.
- `@vifx/compat-runner`.
- `@vifx/metro-inspect`.
- Initial fixtures.
- Docs for compatibility philosophy.

### Milestone 2 — Resolver and assets

Deliver:

- `@vifx/platform-resolver`.
- `@vifx/asset-registry`.
- Tests against fixtures.
- CLI commands using these packages.

### Milestone 3 — CLI migration assistant

Deliver:

- `vifx doctor`.
- `vifx init`.
- `vifx migrate expo`.
- `vifx migrate react-native`.
- `@vifx/codemods`.

### Milestone 4 — Source maps and Hermes

Deliver:

- `@vifx/source-map-tools`.
- `@vifx/hermes-tools`.
- Source map validation.
- Hermes compile command.

### Milestone 5 — Vite RN experimental plugin

Deliver:

- `@vifx/vite-plugin-react-native`.
- `buildReactNativeBundle`.
- `fixtures/rn-bare-basic` as the smoke fixture.
- Resolver and asset integration.
- Valid source maps plus optional Hermes compile on the controlled build path.

### Milestone 6 — Expo experimental plugin

Deliver:

- `@vifx/vite-plugin-expo`.
- Expo fixture integration.
- Expo app config detection.
- `EXPO_PUBLIC_*` env support.
- Safe `expo` and `registerRootComponent` shim.

### Milestone 7 — Expo export inspection

Deliver:

- `@vifx/expo-export`.
- `fixtures/expo-export-basic`.
- Inspect existing Expo export output.
- Normalize bundles, source maps, manifests, and assets.

---

## 13. Non-goals for the first version

Do not implement these in the first milestone:

- Full Metro replacement.
- Full Expo CLI replacement.
- Full Fast Refresh parity.
- Full Expo Router support.
- Full Expo Updates generation.
- Native iOS/Android project modification.
- Module Federation.
- Advanced code splitting.
- Production app store builds.

These can be future goals, but the first version must stay focused.

---

## 14. Quality bar

The project must feel serious from day one.

Required:

- Clear README.
- Clear docs site.
- Strong TypeScript types.
- Helpful errors.
- Tests for every package.
- No huge untyped blobs.
- No hidden magic.
- No overpromising.
- Experimental features clearly labeled.

---

## 15. README outline

The root README must include:

````md
# Vifx

A compatibility toolkit and experimental modern bundling layer for React Native and Expo.

## Why Vifx exists

## Current status

### Snapshot (2026-05-16)

> Status: experimental research toolkit. Not a production Metro replacement yet.

Implemented in the current repository pass:

- `apps/docs`
- `packages/types`
- `packages/errors`
- `packages/logger`
- `packages/config`
- `packages/platform-resolver`
- `packages/asset-registry`
- `packages/core`
- `packages/compat`
- `packages/compat-runner`
- `packages/metro-inspect`
- `packages/codemods`
- `packages/source-map-tools`
- `packages/hermes-tools`
- `packages/cli`
- `packages/expo-export`
- `packages/vite-plugin-react-native`
- `packages/vite-plugin-expo`
- first-pass fixtures under `fixtures/`

Validated in this repository:

```bash
vp install
vp check
pnpm test
pnpm build
pnpm --filter @vifx/cli vifx doctor ./fixtures/rn-bare-basic
pnpm --filter @vifx/cli vifx inspect ./fixtures/rn-bare-basic
pnpm --filter @vifx/cli vifx compat run --adapter vifx
pnpm --filter @vifx/cli vifx migrate expo ./fixtures/expo-basic --dry-run
pnpm --filter @vifx/cli vifx vite init ./fixtures/rn-bare-basic
```
````

Current command availability:

- Implemented: `vifx doctor`, `vifx init`, `vifx inspect`, `vifx compat run`, `vifx metro inspect`, `vifx migrate expo`, `vifx migrate react-native`, `vifx vite init`, `vifx hermes compile`
- Doctor and inspect surface the detected Vite plugin mode as `none`, `react-native`, or `expo`

### Milestone status

#### Milestone 0 — Repository foundation

Status: **complete**

Completed:

- monorepo package structure
- root README, CONTRIBUTING, LICENSE, tsconfig base, and workspace scripts
- docs app under `apps/docs`
- shared packages for types, errors, logger, and config
- future experimental package slots for Expo export and Vite plugins, now implemented in later milestones
- tested primitives for resolver, assets, and core project detection
- fixtures for Expo, bare React Native, assets, and monorepo layouts
- CI workflow under `.github/workflows/ci.yml`

#### Milestone 1 — Compatibility and inspection

Status: **complete**

Completed:

- `@vifx/compat`
- `@vifx/compat-runner`
- `@vifx/metro-inspect`
- fixture-backed `metro` and `vifx` adapters with terminal, JSON, and Markdown reporting
- compatibility philosophy docs in `apps/docs`

#### Milestone 2 — Resolver and assets

Status: **complete**

Completed:

- `@vifx/platform-resolver`
- `@vifx/asset-registry`
- tests for platform precedence, workspace resolution, asset scale groups, descriptor normalization, and hashes
- CLI inspection flows that surface platform files and asset groups

#### Milestone 3 — CLI migration assistant

Status: **complete**

Completed:

- `vifx doctor`
- `vifx init`
- `vifx inspect`
- `vifx compat run`
- `vifx metro inspect`
- `vifx migrate expo`
- `vifx migrate react-native`
- `@vifx/codemods`

#### Milestone 4 — Source maps and Hermes

Status: **complete**

- `@vifx/source-map-tools`
- `@vifx/hermes-tools`
- fixture-backed source map validation and symbolication helpers
- `vifx hermes compile`

#### Milestone 5 — Vite RN experimental plugin

Status: **implemented first pass**

Completed:

- `@vifx/vite-plugin-react-native`
- `buildReactNativeBundle`
- `fixtures/rn-bare-basic` as the smoke target
- resolver, asset, source-map, and optional Hermes integration on the controlled bundle path
- compatibility cases for bundle artifact shape and source-map validity

#### Milestone 6 — Expo experimental plugin

Status: **implemented first pass**

Completed:

- `@vifx/vite-plugin-expo`
- Expo fixture integration
- Expo app config detection
- `EXPO_PUBLIC_*` env injection
- safe `expo` and `registerRootComponent` shim

#### Milestone 7 — Expo export inspection

Status: **implemented inspect first**

Completed:

- `@vifx/expo-export`
- `fixtures/expo-export-basic`
- existing export inspection for bundles, source maps, manifests, and assets
- inspect-only posture with no output generation claims

### Notes for next agents

- The current repo is intentionally evidence-first. Do not turn the bounded Vite path into a Metro replacement claim without broader compatibility proof.
- When changing an implemented experimental surface, update both the runtime code and the status here in `SPECS.md`.
- Treat the validated commands above as the current regression smoke suite.

---

## 16. Example docs page: “Why Vifx exists”

The docs should explain:

```md
React Native bundling is not only JavaScript bundling.

A React Native bundler must understand:

- platform-specific resolution
- native asset metadata
- source maps and symbolication
- Hermes output
- Fast Refresh behavior
- development server contracts
- Expo export/update shape

Metro currently provides this implicitly. Vifx starts by making those implicit contracts observable and testable.
```

---

## 17. Example command implementation priorities

Implement commands in this order:

1. `vifx doctor`
2. `vifx init`
3. `vifx inspect`
4. `vifx compat run`
5. `vifx metro inspect`
6. `vifx migrate expo`
7. `vifx migrate react-native`
8. `vifx hermes compile`
9. `vifx vite init`

---

## 18. Implementation constraints for Codex

Codex must follow these rules:

1. Build the monorepo structure first.
2. Do not implement a fake full bundler.
3. Prefer small, tested packages.
4. Keep public APIs stable and typed.
5. Use fixtures for realistic behavior.
6. Generate docs pages alongside packages.
7. Add TODOs only when paired with a documented roadmap item.
8. Do not silently catch errors; convert them into structured Vifx errors.
9. Do not overwrite user project files in migration commands unless `--write` is passed.
10. Keep all experimental features explicitly marked experimental.

---

## 19. Success criteria for the first complete pass

The first useful version is complete when all of this works:

```bash
pnpm install
pnpm build
pnpm test
pnpm docs:build
pnpm --filter @vifx/cli vifx doctor --help
pnpm --filter @vifx/cli vifx compat run --adapter vifx
pnpm --filter @vifx/cli vifx migrate expo ./fixtures/expo-basic --dry-run
```

And the docs site contains:

- Home page.
- Package pages for all packages.
- CLI reference.
- Migration guide.
- Compatibility philosophy.
- Roadmap.

---

## 20. Suggested initial package dependency graph

```txt
@vifx/types
  no internal dependencies

@vifx/errors
  depends on @vifx/types

@vifx/logger
  depends on @vifx/errors

@vifx/config
  depends on @vifx/types, @vifx/errors

@vifx/platform-resolver
  depends on @vifx/types, @vifx/errors

@vifx/asset-registry
  depends on @vifx/types, @vifx/errors

@vifx/source-map-tools
  depends on @vifx/types, @vifx/errors

@vifx/hermes-tools
  depends on @vifx/types, @vifx/errors, @vifx/logger

@vifx/expo-export
  depends on @vifx/types, @vifx/errors, @vifx/config

@vifx/core
  depends on @vifx/types, @vifx/errors, @vifx/config, @vifx/platform-resolver, @vifx/asset-registry

@vifx/compat
  depends on @vifx/types

@vifx/compat-runner
  depends on @vifx/compat, @vifx/core, @vifx/logger

@vifx/metro-inspect
  depends on @vifx/types, @vifx/errors, @vifx/logger

@vifx/codemods
  depends on @vifx/types, @vifx/errors, @vifx/config

@vifx/vite-plugin-react-native
  depends on @vifx/core, @vifx/platform-resolver, @vifx/asset-registry

@vifx/vite-plugin-expo
  depends on @vifx/vite-plugin-react-native, @vifx/expo-export

@vifx/cli
  depends on most packages
```

---

## 21. Suggested root scripts

```json
{
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "docs:dev": "pnpm --filter @vifx/docs dev",
    "docs:build": "pnpm --filter @vifx/docs build",
    "changeset": "changeset",
    "release": "changeset publish"
  }
}
```

---

## 22. Suggested package scripts

Every package should generally expose:

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
}
```

Adjust CLI packages as needed.

---

## 23. Future ideas, not first milestone

Potential future projects:

- Full Metro-compatible dev server.
- Fast Refresh bridge.
- Hermes-first production output.
- Bundle splitting by route.
- Expo Router route-level analysis.
- Bundle visualizer.
- Re.Pack compatibility adapter.
- Metro compatibility dashboard.
- Online docs with interactive compatibility matrix.
- Vifx playground templates.
- `create-vifx-app`.

---

## 24. Final instruction to Codex

Start by generating the monorepo foundation, package scaffolds, documentation site, CLI skeleton, and initial implementations for:

1. `@vifx/types`
2. `@vifx/errors`
3. `@vifx/logger`
4. `@vifx/config`
5. `@vifx/platform-resolver`
6. `@vifx/asset-registry`
7. `@vifx/core`
8. `@vifx/cli`
9. `apps/docs`

Then add fixtures and compatibility runner.

Do not attempt to implement the full Vite React Native bundler before the primitives, docs, fixtures, and compatibility test suite exist.
