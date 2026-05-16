# Packages

This page replaces the previous custom package directory with VitePress markdown. Each package keeps its current state, intended install surface, limitations, and roadmap notes.

## Package Snapshot

| Package                          | Status                 | Milestone                                | Summary                                                                                                     |
| -------------------------------- | ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@vifx/types`                    | Implemented first pass | Milestone 0 foundation                   | Shared public TypeScript contracts for platforms, assets, configs, diagnostics, and compatibility reports.  |
| `@vifx/errors`                   | Implemented first pass | Milestone 0 foundation                   | Structured Vifx errors with stable codes, hints, and docs-link-friendly metadata.                           |
| `@vifx/logger`                   | Implemented first pass | Milestone 0 foundation                   | Compact terminal and JSON logging helpers for CLI flows and automation.                                     |
| `@vifx/config`                   | Implemented first pass | Milestone 0 foundation                   | Config definition, defaults, discovery, and loading for `vifx.config.*` files.                              |
| `@vifx/core`                     | Implemented first pass | Milestone 0-2 foundation                 | Project discovery, config loading, and orchestration glue for higher-level workflows.                       |
| `@vifx/platform-resolver`        | Implemented first pass | Milestone 2 resolver and assets          | React Native style platform resolution with structured traces and Metro-oriented proof points.              |
| `@vifx/asset-registry`           | Implemented first pass | Milestone 2 resolver and assets          | Asset grouping, scale detection, dimensions, hashes, and normalized descriptors for React Native and Expo.  |
| `@vifx/source-map-tools`         | Implemented first pass | Milestone 4 source maps and Hermes       | Validation, normalization, comparison, and symbolication helpers for Metro and Vite-based experiments.      |
| `@vifx/hermes-tools`             | Implemented first pass | Milestone 4 source maps and Hermes       | Hermes compiler detection, orchestration, and useful failure modes without vendoring Hermes.                |
| `@vifx/expo-export`              | Inspect-first package  | Milestone 7 Expo export inspection       | Expo export artifact inspection, manifest normalization, and report generation before output generation.    |
| `@vifx/compat`                   | Implemented first pass | Milestone 1 compatibility and inspection | Fixture manifests, implementation-agnostic compatibility cases, and reusable assertions.                    |
| `@vifx/compat-runner`            | Implemented first pass | Milestone 1 compatibility and inspection | Compatibility execution and report generation for Metro, Vifx, and future adapters.                         |
| `@vifx/metro-inspect`            | Implemented first pass | Milestone 1 compatibility and inspection | Metro reference inspection for captured bundle output, assets, source maps, and deterministic JSON reports. |
| `@vifx/codemods`                 | Implemented first pass | Milestone 3 migration assistant          | Conservative file planning and patch helpers for init and migration workflows.                              |
| `@vifx/cli`                      | Implemented first pass | Milestone 3 migration assistant          | User-facing CLI for doctor, inspect, compatibility, migration, and Hermes flows.                            |
| `@vifx/vite-plugin-react-native` | Experimental           | Milestone 5 Vite RN experimental plugin  | Experimental Vite plugin shell for React Native bundles built on Vifx primitives.                           |
| `@vifx/vite-plugin-expo`         | Experimental           | Milestone 6 Expo experimental plugin     | Experimental Expo-specific layer on top of the React Native Vite plugin.                                    |

## `@vifx/types`

Status: Implemented first pass.

Shared public TypeScript contracts for platforms, assets, configs, diagnostics, and compatibility reports.

### Current State

Implemented and used as the shared contract layer for the first-pass packages in this monorepo.

### Purpose

- Define platform, project, asset, config, and compatibility report types.
- Keep shared public contracts out of runtime-heavy packages.
- Give the CLI, primitives, and reports a consistent vocabulary.

### Installation

```sh
pnpm add -D @vifx/types
```

In this repository the package already exists as a workspace dependency. The command above is the intended external install surface once publishing starts.

### API Sketch

```ts
import type { VifxAssetDescriptor, VifxCompatibilityReport, VifxPlatform } from "@vifx/types";
```

### Example

```ts
export type VifxPlatform = "ios" | "android" | "native" | "web";
```

### Limitations

- The package intentionally avoids runtime behavior.
- Type additions should stay compatibility-oriented and conservative.

### Roadmap

- Stabilize shared report and config contracts.
- Expand source-map and Hermes types when those packages land.

## `@vifx/errors`

Status: Implemented first pass.

Structured Vifx errors with stable codes, hints, and docs-link-friendly metadata.

### Current State

Implemented and used to convert user-facing failures into typed diagnostics instead of loose thrown strings.

### Purpose

- Provide typed error classes and stable error codes.
- Attach hints, details, and docs paths to operational failures.
- Normalize unknown failures into Vifx-shaped errors where needed.

### Installation

```sh
pnpm add -D @vifx/errors
```

In this repository the package already exists as a workspace dependency. The command above is the intended external install surface once publishing starts.

### API Sketch

```ts
throw new VifxError({
  code: "VIFX_RESOLVE_NOT_FOUND",
  message: 'Unable to resolve "./Button" for platform "ios".',
  hint: "Check Button.ios.tsx, Button.native.tsx, or Button.tsx.",
});
```

### Example

```text
VIFX_CONFIG_INVALID
VIFX_CONFIG_LOAD_FAILED
VIFX_RESOLVE_NOT_FOUND
VIFX_ASSET_UNSUPPORTED_TYPE
```

### Limitations

- The current code list covers the first-pass foundations, not the full roadmap.
- Docs pages for every error code are still a follow-up task.

### Roadmap

- Expand error coverage with Metro inspection, Hermes, and migration codemods.
- Link every stable error code to a docs reference page.

## `@vifx/logger`

Status: Implemented first pass.

Compact terminal and JSON logging helpers for CLI flows and automation.

### Current State

Implemented as the lightweight logging layer for machine-readable and human-readable first-pass workflows.

### Purpose

- Emit plain terminal logs without noisy defaults.
- Emit JSON lines for automation-friendly workflows.
- Respect debug, info, warn, error, and silent modes.

### Installation

```sh
pnpm add -D @vifx/logger
```

In this repository the package already exists as a workspace dependency. The command above is the intended external install surface once publishing starts.

### API Sketch

```ts
const logger = createLogger({ json: true });
logger.error("Vifx config is invalid.", { code: "VIFX_CONFIG_INVALID" });
```

### Example

```json
{
  "level": "error",
  "message": "Vifx config is invalid.",
  "fields": { "code": "VIFX_CONFIG_INVALID" }
}
```

### Limitations

- The first pass focuses on CLI and automation output, not transport plugins or observability backends.

### Roadmap

- Adopt the logger consistently across more CLI command surfaces.
- Extend structured fields when CI and report flows become richer.

## `@vifx/config`

Status: Implemented first pass.

Config definition, defaults, discovery, and loading for `vifx.config.*` files.

### Current State

Implemented with config templates, defaults, filesystem discovery, and load-time normalization for the first pass.

### Purpose

- Expose `defineVifxConfig` as the shared config entrypoint.
- Find and load `vifx.config.ts`, `.mts`, `.js`, or `.mjs` files.
- Apply conservative defaults for targets, resolver options, and experimental flags.

### Installation

```sh
pnpm add -D @vifx/config
```

In this repository the package already exists as a workspace dependency. The command above is the intended external install surface once publishing starts.

### API Sketch

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  targets: [{ platform: "ios", entry: "./index.js" }],
});
```

### Example

```text
vifx.config.ts
vifx.config.mts
vifx.config.js
vifx.config.mjs
```

### Limitations

- Validation is intentionally first-pass conservative and does not yet expose a full schema-doc pipeline.

### Roadmap

- Stabilize config defaults alongside CLI and primitive evolution.
- Generate richer config reference docs once the schema surface settles.

## `@vifx/core`

Status: Implemented first pass.

Project discovery, config loading, and orchestration glue for every higher-level Vifx workflow.

### Current State

Implemented with project detection, workspace discovery, config loading, and lazy primitive orchestration for the first-pass CLI workflows.

### Purpose

- Detect Expo, bare React Native, workspace, or unknown projects.
- Load and validate `vifx.config.*` before any inspection or migration flow runs.
- Coordinate resolver, assets, maps, and reports as shared primitives rather than ad hoc plugin logic.

### Installation

```sh
pnpm add -D @vifx/core
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { defineVifxConfig } from "@vifx/core";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  platforms: ["ios", "android"],
  expo: true,
  resolver: {
    extensions: ["tsx", "ts", "jsx", "js", "json"],
  },
});
```

### Example

```ts
import { defineVifxConfig } from "@vifx/core";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  targets: [
    { platform: "ios", entry: "./index.js", hermes: true },
    { platform: "android", entry: "./index.js", hermes: true },
  ],
});
```

### Limitations

- The exact runtime APIs still depend on the primitive packages settling first.
- This page is a contract draft, not proof that the package is already feature-complete.

### Roadmap

- Reliable project-type detection.
- Config loading and schema validation.
- Shared graph primitives for CLI and plugin work.

## `@vifx/platform-resolver`

Status: Implemented first pass.

React Native style platform resolution with structured traces and Metro-oriented proof points.

### Current State

Implemented with relative, package, and workspace-aware React Native-style resolution plus structured trace output.

### Purpose

- Resolve `.ios`, `.android`, `.native`, and default file variants with explicit traces.
- Handle package `react-native` fields, exports where possible, and monorepo workspace layouts.
- Make resolution order configurable and testable instead of inheriting Metro behavior implicitly.

### Installation

```sh
pnpm add -D @vifx/platform-resolver
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

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

### Example

```text
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

### Limitations

- The exact order must be fixture-driven; it should not be guessed once package work begins.
- Exports and symlink behavior need Metro comparisons before they can be treated as stable.

### Roadmap

- Relative import and package import tests.
- Workspace resolution fixtures.
- Metro comparison coverage for selected cases.

## `@vifx/asset-registry`

Status: Implemented first pass.

Asset grouping, scale detection, dimensions, hashes, and normalized descriptors for React Native and Expo.

### Current State

Implemented with scale grouping, deterministic hashes, normalized descriptors, and lightweight image metadata extraction.

### Purpose

- Group `@2x` and `@3x` variants into stable asset sets.
- Extract dimensions and hashes for common image and font workflows.
- Provide helpers for dev-server-facing asset URLs later on.

### Installation

```sh
pnpm add -D @vifx/asset-registry
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { collectAssetGroup } from "@vifx/asset-registry";

const asset = await collectAssetGroup({
  filePath: "/app/assets/icon.png",
  projectRoot: "/app",
});
```

### Example

```text
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

### Limitations

- Supported formats are still a target list until fixture coverage exists.
- Compatibility claims should wait for Metro comparisons on asset metadata output.

### Roadmap

- Stable scale grouping.
- Image and font fixture coverage.
- Deterministic hashes and descriptor output.

## `@vifx/source-map-tools`

Status: Implemented first pass.

Validation, normalization, and symbolication helpers for Metro and Vite-based experiments.

### Current State

Implemented with validation, normalization, comparison, and symbolication helpers backed by fixture source maps.

### Purpose

- Validate Metro and Vite or Rollup source maps.
- Normalize paths so reports can compare output meaningfully.
- Expose symbolication helpers that explain mismatches rather than only surfacing them.

### Installation

```sh
pnpm add -D @vifx/source-map-tools
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { validateSourceMap, symbolicateStackFrame } from "@vifx/source-map-tools";
```

### Example

```ts
const validity = await validateSourceMap({
  sourceMapPath: "dist/index.android.map",
});

const frame = await symbolicateStackFrame({
  line: 122,
  column: 18,
});
```

### Limitations

- The exact comparison schema still depends on fixture bundles from multiple adapters.
- Source-map composition should stay experimental until it is backed by real bundle fixtures.

### Roadmap

- Metro fixture validation.
- Vite or Rollup fixture validation.
- High-level source and mapping comparisons.

## `@vifx/hermes-tools`

Status: Implemented first pass.

Hermes compiler detection, orchestration, and useful failure modes without vendoring Hermes.

### Current State

Implemented with Hermes compiler detection, bytecode orchestration, graceful failure modes, and CLI integration.

### Purpose

- Detect Hermes compiler availability on the host.
- Compile bundle output to Hermes bytecode when the toolchain is available.
- Fail with actionable diagnostics instead of opaque compiler messages.

### Installation

```sh
pnpm add -D @vifx/hermes-tools
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { compileHermesBytecode } from "@vifx/hermes-tools";

await compileHermesBytecode({
  inputBundlePath: "dist/index.android.bundle",
  outputBytecodePath: "dist/index.android.hbc",
  sourceMapPath: "dist/index.android.map",
});
```

### Example

```sh
vifx hermes compile
```

### Limitations

- The package should orchestrate Hermes, not vendor it.
- Bytecode support should stay clearly separated from plugin parity claims.

### Roadmap

- Broaden real-world compiler coverage beyond the current fixture-backed test harness.
- Preserve graceful failures when Hermes tooling is not installed.
- Keep the bytecode workflow clearly separated from plugin parity claims.

## `@vifx/expo-export`

Status: Inspect-first package.

Expo export artifact inspection, manifest normalization, and report generation before output generation.

### Current State

This page is intentionally explicit that Expo export understanding comes before any attempt to generate equivalent output.

### Purpose

- Inspect Expo config and `expo export` artifacts.
- Normalize update manifests and bundle or asset reports.
- Explain what Vifx understands versus what remains unsupported.

### Installation

```sh
pnpm add -D @vifx/expo-export
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { inspectExpoExport } from "@vifx/expo-export";

const report = await inspectExpoExport({
  projectRoot: "./fixtures/expo-basic",
});
```

### Example

```text
Understand assets, bundles, and update manifests from expo export
before attempting any output generation.
```

### Limitations

- Generation is intentionally out of scope in the first pass.
- Expo Router and full Updates generation remain separate future work.

### Roadmap

- Inspect config and export output.
- Normalize manifests and asset reports.
- Surface inspect-only gaps clearly in docs and reports.

## `@vifx/compat`

Status: Implemented first pass.

Fixture manifests, implementation-agnostic compatibility cases, and reusable assertions.

### Current State

Implemented with reusable fixture manifests, shared compatibility cases, and assertion helpers for the first Vifx adapter.

### Purpose

- Capture expected behavior independent of Metro or Vifx internals.
- Define categories such as platform files, assets, source maps, Hermes, Expo export shape, and workspace resolution.
- Give every adapter the same contract.

### Installation

```sh
pnpm add -D @vifx/compat
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

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

### Example

```text
resolver.platformExtensions
resolver.packageMainFields
resolver.packageExports
assets.scaleGroups
assets.metadata
sourcemaps.validity
hermes.compile
expo.exportShape
monorepo.workspaceResolution
```

### Limitations

- The contract is only useful if it stays implementation-agnostic.
- Real value depends on fixture coverage and adapters landing behind it.

### Roadmap

- Fixture manifests and shared assertions.
- Metro as one reference adapter.
- Stable case naming for long-lived reports.

## `@vifx/compat-runner`

Status: Implemented first pass.

Compatibility execution and report generation for Metro, Vifx, and future adapters.

### Current State

Implemented with `metro` and `vifx` adapters, fixture-backed suite execution, and terminal or JSON or Markdown report output.

### Purpose

- Run the shared compatibility suite against Metro, Vifx, and future adapters.
- Produce Markdown, JSON, and terminal reports.
- Keep failures actionable with fixture context and docs links.

### Installation

```sh
pnpm add -D @vifx/compat-runner
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

### Example

```text
Compatibility report

Adapter: vifx
Platform: ios

resolver.platformExtensions       PASS  12/12
assets.scaleGroups                PASS   8/8
sourcemaps.validity               WARN   2/3
expo.exportShape                  TODO   0/5
```

### Limitations

- The report schema should not be treated as final until fixture-backed adapters exist.
- Meaningful CI use depends on compatibility cases and Metro inspection landing first.

### Roadmap

- Terminal, Markdown, and JSON reports.
- Fixture path plus expected and actual output on failures.
- CI workflows that can tolerate todo states honestly.

## `@vifx/metro-inspect`

Status: Implemented first pass.

Metro reference inspection for bundle output, assets, source maps, and deterministic JSON reports.

### Current State

Implemented as a captured-artifact reference inspector for Metro-compatible fixture outputs. It stays explicit that Metro is evidence, not a hidden runtime dependency.

### Purpose

- Run Metro against fixtures and collect output artifacts.
- Produce deterministic JSON that can be compared against Vifx primitives.
- Isolate Metro usage to reference behavior rather than hiding it behind plugins.

### Installation

```sh
pnpm add -D @vifx/metro-inspect
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

### Example

```json
{
  "projectRoot": "...",
  "platform": "ios",
  "entry": "index.js",
  "bundle": { "path": "...", "sizeBytes": 123456 },
  "sourceMap": { "path": "...", "valid": true },
  "assets": [],
  "warnings": []
}
```

### Limitations

- Metro internals may shift, so this package must degrade gracefully.
- The package should explain behavior, not become a hidden runtime dependency.

### Roadmap

- Broaden artifact capture beyond the current fixture set.
- Add deeper asset and warning extraction when reference fixtures include it.
- Preserve deterministic report snapshots.

## `@vifx/codemods`

Status: Implemented first pass.

Conservative file planning and patch helpers for `vifx init` and migration flows.

### Current State

Implemented with dry-run-first planning, patch previews, config generation, and safe package script updates for Expo and bare React Native fixtures.

### Purpose

- Detect project config files conservatively.
- Generate `vifx.config.ts` and optional Vite config templates.
- Preview `package.json` and config changes before writing files.
- Avoid silent overwrites unless the caller explicitly requests writes.

### Installation

```sh
pnpm add -D @vifx/codemods
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { applyPlannedChanges, formatPlannedChanges, planMigration } from "@vifx/codemods";

const plan = await planMigration("./fixtures/expo-basic", "expo", {
  withVite: true,
});

console.log(formatPlannedChanges(plan.changes));
await applyPlannedChanges("./fixtures/expo-basic", plan.changes);
```

### Example

```text
[update] package.json

--- before
+++ after
{
  "scripts": {
    "vifx:doctor": "vifx doctor"
  }
}
```

### Limitations

- The first pass focuses on conservative file planning, not large-scale codemod transforms.
- Generated config stays intentionally minimal and experimental.

### Roadmap

- Add richer patch previews for larger config edits.
- Split more migration-specific transforms into dedicated helpers as the CLI expands.
- Keep writes conservative and reversible.

## `@vifx/cli`

Status: Implemented first pass.

The user-facing CLI surface for doctor, inspect, compatibility, migration, and Hermes flows.

### Current State

Implemented for doctor, init, inspect, compat run, metro inspect, dry-run or write migration workflows, and Hermes compile. `vite init` remains planned.

### Purpose

- Expose a single `vifx` binary for inspection and migration workflows.
- Render structured errors with codes, hints, and docs links.
- Keep experimental workflows visibly experimental.

### Installation

```sh
pnpm add -D @vifx/cli
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```sh
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

### Example

```text
WARN  VIFX_CONFIG_MISSING
  No vifx.config.ts found.
  Run: vifx init

INFO  VIFX_EXPERIMENTAL_EXPO
  Expo support is currently experimental.
```

### Limitations

- `vite init` and broader plugin-facing workflows remain planned.
- The CLI should preserve existing Metro and Expo workflows instead of masking them.

### Roadmap

- Doctor and init.
- Inspect and compatibility flows.
- Dry-run-first migration plus structured errors.

## `@vifx/vite-plugin-react-native`

Status: Experimental.

An experimental Vite plugin shell for React Native bundles built on Vifx primitives.

### Current State

This page is intentionally blunt: it is a bounded experiment, not a parity claim.

### Purpose

- Load as a Vite plugin and use Vifx resolver plus asset primitives.
- Expose an experimental dev-server surface for React Native bundle experiments.
- Document unsupported features clearly.

### Installation

```sh
pnpm add -D @vifx/vite-plugin-react-native
```

Planned install surface only. This package must stay clearly labeled experimental even after it lands.

### API Sketch

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

### Example

```text
First-pass goals:
- plugin shell loads
- platform files resolve through Vifx
- assets expose basic metadata
- docs explain limits in plain language
```

### Limitations

- Fast Refresh parity is not a first-pass goal.
- Expo Router, Updates output, and production builds stay out of scope.

### Roadmap

- Plugin shell and platform option support.
- Resolver plus asset integration.
- At least one playground command and honest limitation docs.

## `@vifx/vite-plugin-expo`

Status: Experimental.

An experimental Expo-specific layer on top of the React Native Vite plugin.

### Current State

The page documents a careful Expo layer that must not pretend to replace `expo start`.

### Purpose

- Detect Expo config and inject `EXPO_PUBLIC_*` variables where safe.
- Prepare aliases and scaffolding for bounded Expo experiments.
- State exactly what is inspect-only, unsupported, or still planned.

### Installation

```sh
pnpm add -D @vifx/vite-plugin-expo
```

Planned install surface only. It stays experimental by design.

### API Sketch

```ts
import { defineConfig } from "vite";
import { expo } from "@vifx/vite-plugin-expo";

export default defineConfig({
  plugins: [expo()],
});
```

### Example

```text
First-pass scope:
- Expo config detection
- EXPO_PUBLIC_* env injection
- migration scaffolding
- explicit documentation for Router and EAS gaps
```

### Limitations

- Expo Router is not a first-pass goal.
- Expo Updates generation and EAS integration remain future work.

### Roadmap

- Config detection and env handling.
- Safe aliases and scaffolding.
- Docs that stay explicit about support boundaries.
