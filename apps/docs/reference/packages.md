# Packages

This page replaces the previous custom package directory with VitePress markdown. Each package keeps its current state, intended install surface, limitations, and roadmap notes.

## Package Snapshot

| Package                          | Status                 | Milestone                                                | Summary                                                                                                                                  |
| -------------------------------- | ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@vifx/types`                    | Implemented first pass | Milestone 0 foundation                                   | Shared public TypeScript contracts for platforms, assets, configs, diagnostics, and compatibility reports.                               |
| `@vifx/errors`                   | Implemented first pass | Milestone 0 foundation                                   | Structured Vifx errors with stable codes, hints, and docs-link-friendly metadata.                                                        |
| `@vifx/logger`                   | Implemented first pass | Milestone 0 foundation                                   | Compact terminal and JSON logging helpers for CLI flows and automation.                                                                  |
| `@vifx/config`                   | Implemented first pass | Milestone 0 foundation plus Milestone 5 contracts        | Config definition, defaults, discovery, loading, and normalized Vite or Expo options for `vifx.config.*` files.                          |
| `@vifx/core`                     | Implemented first pass | Milestone 0-2 foundation                                 | Project discovery, compatibility config re-exports, and orchestration glue for higher-level workflows.                                   |
| `@vifx/platform-resolver`        | Implemented first pass | Milestone 2 resolver and assets                          | React Native style platform resolution with structured traces and Metro-oriented proof points.                                           |
| `@vifx/asset-registry`           | Implemented first pass | Milestone 2 resolver and assets                          | Asset grouping, scale detection, dimensions, hashes, and normalized descriptors for React Native and Expo.                               |
| `@vifx/source-map-tools`         | Implemented first pass | Milestone 4 source maps and Hermes                       | Validation, normalization, comparison, and symbolication helpers for Metro and Vite-based experiments.                                   |
| `@vifx/hermes-tools`             | Implemented first pass | Milestone 4 source maps and Hermes                       | Hermes compiler detection, orchestration, and useful failure modes without vendoring Hermes.                                             |
| `@vifx/native-artifacts`         | Implemented first pass | Native artifact contract                                 | Native-ready iOS and Android artifact directories, manifests, host diagnostics, and lifecycle plans for Vifx bundles.                    |
| `@vifx/expo-export`              | Partial generation     | Milestone 7 plus current Expo export work                | Expo export inspection plus Vifx-generated bundles, source maps, manifests, metadata, assets, Updates v1 manifests, and local serving.   |
| `@vifx/compat`                   | Implemented first pass | Milestone 1 compatibility and inspection                 | Fixture manifests, implementation-agnostic compatibility cases, and reusable assertions.                                                 |
| `@vifx/compat-runner`            | Implemented first pass | Milestone 1 compatibility and inspection                 | Compatibility execution and report generation for Metro, Vifx, and future adapters.                                                      |
| `@vifx/metro-inspect`            | Implemented first pass | Milestone 1 compatibility and inspection                 | Metro reference inspection for captured bundle output, assets, source maps, and deterministic JSON reports.                              |
| `@vifx/codemods`                 | Implemented first pass | Milestone 3 migration assistant                          | Conservative file planning and patch helpers for init and migration workflows.                                                           |
| `@vifx/cli`                      | Implemented first pass | Milestone 3 migration assistant plus Milestone 5 support | User-facing CLI for doctor, inspect, build, run, Expo dev/audit/export/serve, compatibility, migration, Hermes, native, and `vite init`. |
| `@vifx/vite-plugin-react-native` | Available              | Milestone 5 Vite RN plugin                               | Controlled React Native Vite bundle builds plus browser runtime previews built on Vifx primitives.                                       |
| `@vifx/vite-plugin-expo`         | Available              | Milestone 6 Expo plugin plus current Expo dev work       | Expo layer with app config detection, public env injection, browser dev serving, and preview support.                                    |

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

- The current code list is aligned with emitted package and CLI diagnostics, but individual troubleshooting pages are not split out yet.
- Docs pages for every error code are still a follow-up task.

### Roadmap

- Keep the registry covered by source-level drift tests as packages add diagnostics.
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

Implemented with config templates, defaults, filesystem discovery, load-time normalization, and explicit `vite.mode` plus `vite.targets` support for the current first pass.

### Purpose

- Expose `defineVifxConfig` as the shared config entrypoint.
- Find and load `vifx.config.ts`, `.mts`, `.js`, or `.mjs` files.
- Apply conservative defaults for platforms, resolver options, logging, Vite targets, and Expo public env handling.

### Installation

```sh
pnpm add -D @vifx/config
```

In this repository the package already exists as a workspace dependency. The command above is the intended external install surface once publishing starts.

### API Sketch

```ts
import { defineVifxConfig, loadVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  projectType: "expo",
  vite: {
    mode: "expo",
    targets: [{ platform: "ios", entry: "./index.js", hermes: false }],
  },
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
});

const loaded = await loadVifxConfig({ cwd: process.cwd() });
console.log(loaded.config.vite.mode);
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
- `@vifx/core` keeps compatibility re-exports, but `@vifx/config` is the source of truth for config helpers.
- `loadVifxConfig()` imports the target config directly, so external projects must have the referenced Vifx packages installed where the config resolves them.

### Roadmap

- Stabilize config defaults alongside CLI and primitive evolution.
- Generate richer config reference docs once the schema surface settles.

## `@vifx/core`

Status: Implemented first pass.

Project discovery, compatibility config re-exports, and orchestration glue for every higher-level Vifx workflow.

### Current State

Implemented with project detection, workspace discovery, config loading, lazy primitive orchestration, and compatibility re-exports for the first-pass CLI workflows.

### Purpose

- Detect Expo, bare React Native, workspace, or unknown projects.
- Load and validate `vifx.config.*` before any inspection or migration flow runs.
- Coordinate resolver, assets, maps, and reports as shared primitives rather than ad hoc plugin logic.
- Keep `defineVifxConfig` and `loadVifxConfig` available for compatibility while `@vifx/config` stays the config source of truth.

### Installation

```sh
pnpm add -D @vifx/core
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import { createVifxContext } from "@vifx/core";

const context = await createVifxContext({
  cwd: process.cwd(),
});

console.log(context.project.projectType);
console.log(context.config.vite.mode);
```

### Example

```ts
const resolution = await context.resolveModule({
  fromFile: "src/App.tsx",
  platform: "ios",
  specifier: "./Button",
});

const assets = await context.collectAssetGroup({
  filePath: "src/assets/icon.png",
});
```

### Limitations

- The exact runtime APIs still depend on the primitive packages settling first.
- New config authors should prefer `@vifx/config` instead of treating `@vifx/core` as the primary config package.

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
- Respect configured package main-field order such as `react-native`, `module`, and `main`.
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
  mainFields: ["react-native", "module", "main"],
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

- The exact order must stay fixture-driven; it should not be guessed as package coverage expands.
- Symlink behavior needs broader Metro comparisons before it can be treated as stable.

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
- Throw structured `VIFX_SOURCEMAP_INVALID` diagnostics when callers require a valid map.
- Normalize paths so reports can compare output meaningfully.
- Expose symbolication helpers that explain mismatches rather than only surfacing them.

### Installation

```sh
pnpm add -D @vifx/source-map-tools
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import {
  assertValidSourceMap,
  symbolicateStackFrame,
  validateSourceMap,
} from "@vifx/source-map-tools";
```

### Example

```ts
const validity = await validateSourceMap({
  sourceMapPath: "dist/index.android.map",
});

await assertValidSourceMap({
  sourceMapPath: "dist/index.android.map",
});

const frame = await symbolicateStackFrame({
  line: 122,
  column: 18,
});
```

### Limitations

- The exact comparison schema still depends on fixture bundles from multiple adapters.
- Source-map composition should stay conservative until it is backed by real bundle fixtures.

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

## `@vifx/native-artifacts`

Status: Current native foundation.

Native-ready artifact preparation and lifecycle command planning for Vifx bundle outputs.

### Current State

Implemented as the current native foundation. It prepares deterministic iOS or Android artifact directories from `VifxBundleArtifacts`, writes `vifx-native-manifest.json`, reports native toolchain and runtime target readiness, validates host and signing markers, produces deterministic native build/install/launch command plans, and is exercised by playground host markers.

### Purpose

- Copy JavaScript bundles, source maps, optional Hermes bytecode, and assets into native-ready output directories.
- Write a manifest that an iOS or Android host can consume without guessing bundle paths.
- Surface Xcode, simulator, Android SDK, adb, and Gradle readiness as structured diagnostics.
- Surface booted iOS simulator, adb device, and Android Emulator readiness as structured diagnostics.
- Validate prepared manifest, host, bundle id/application id, provisioning profile readiness, and signing material markers.
- Detect iOS and Android host markers for lifecycle command planning.
- Build command plans for host build, install, and launch workflows.

### Installation

```sh
pnpm add -D @vifx/native-artifacts
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import {
  createNativeCommandPlan,
  diagnoseNativeRuntimeTargets,
  prepareNativeArtifacts,
  validateNativeHost,
} from "@vifx/native-artifacts";

await prepareNativeArtifacts({
  artifacts: buildResult,
  outDir: ".vifx/native/ios",
});

const plan = await createNativeCommandPlan({
  action: "build",
  platform: "ios",
  projectRoot,
});

const validation = await validateNativeHost({
  platform: "ios",
  projectRoot,
});

const runtime = await diagnoseNativeRuntimeTargets({
  platform: "android",
  projectRoot,
});
```

### Example

```sh
vifx native prepare --platform ios
vifx native prepare --platform android --json
vifx native doctor --platform ios --json
vifx native build --platform ios --dry-run
vifx native launch --platform android --application-id dev.vifx.app --dry-run
vifx native run --platform ios --dry-run
pnpm native:validate
```

### Limitations

- This prepares artifacts, validates static host and runtime target readiness, plans native commands, and supports CLI-level preview orchestration; it does not create, sign, or execute native projects end to end.
- Toolchain diagnostics are advisory and do not replace full Xcode or Gradle build validation.

### Roadmap

- Add formal iOS and Android host projects that consume the manifest.
- Execute build, install, and launch against validated native hosts.
- Connect signing, simulator, emulator, and device diagnostics to executed launch workflows.

## `@vifx/expo-export`

Status: Partial generation.

Expo export artifact inspection, export generation, local Updates serving, manifest normalization, and Expo without Metro contract reporting.

### Current State

Implemented against exported directories so the package can normalize bundles, source maps, manifests, Updates manifests, and assets from existing Expo export output. It can also write export output from Vifx bundle artifacts and serve generated Updates JSON or multipart manifest responses plus referenced files locally. The generated output is intentionally limited to bundles, source maps, assets, `manifest.json`, `metadata.json`, optional Expo Updates v1 manifest JSON, local serving, multipart manifest responses, and optional RSA-SHA256 response signing; directives, native validation, and EAS parity remain out of scope.

### Purpose

- Inspect Expo config and `expo export` artifacts.
- Generate export output from Vifx bundle artifacts.
- Generate Expo Updates v1 manifests that reference the exported bundles and assets.
- Serve Expo Updates v1 JSON or multipart manifest responses and referenced bundle or asset files.
- Sign manifest responses with `expo-signature` when a client sends `expo-expect-signature` and signing is configured.
- Normalize update manifests and bundle or asset reports.
- Report Expo without Metro workflow status for dev server, build, export, Router, native iOS, native Android, and Updates.
- Explain what Vifx understands versus what remains unsupported.

### Installation

```sh
pnpm add -D @vifx/expo-export
```

Shown as the intended public install surface once the package is shipped. Treat it as a contract draft in this docs-first phase.

### API Sketch

```ts
import {
  evaluateExpoNoMetroContract,
  inspectExpoExport,
  startExpoUpdatesServer,
  writeExpoExport,
} from "@vifx/expo-export";

const report = await inspectExpoExport({
  projectRoot: "./fixtures/expo-export-basic",
  exportRoot: ".",
});

const contract = await evaluateExpoNoMetroContract({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
});

const generated = await writeExpoExport({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
  bundles: [iosBundle, androidBundle],
  updates: {
    baseUrl: "https://updates.example/app",
    runtimeVersion: "1.0.0",
  },
});

const server = await startExpoUpdatesServer({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
  signing: {
    keyId: "root",
    privateKey: process.env.EXPO_UPDATES_PRIVATE_KEY!,
  },
});

console.log(server.url);
```

### Example

```json
{
  "exportRoot": ".",
  "bundles": [{ "platform": "ios" }],
  "manifests": [{ "kind": "metadata" }],
  "assets": [{ "type": "png" }]
}
```

### Limitations

- The generated export is limited to Vifx bundle artifacts, source maps, assets, `manifest.json`, and `metadata.json`.
- Optional Updates manifests and `startExpoUpdatesServer` are limited to the generated export files and do not provide directive parts, EAS parity, or native runtime proof.
- It does not replace the full `expo export` contract yet.
- The Expo without Metro contract report is an audit surface. It does not make blocked workflows supported.

### Roadmap

- Broaden fixture coverage across more export layouts.
- Keep manifest normalization deterministic and reviewable.
- Surface partial-generation gaps clearly in docs and reports.
- Promote individual Expo without Metro workflows only when they have executed build, dev server, Router, native, or Updates proof.

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
bundler.bundleArtifacts
bundler.sourceMapValidity
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

doctor.projectDetection           PASS   2/2
resolver.platformExtensions       PASS   4/4
resolver.packageMainFields        PASS   1/1
resolver.packageExports           PASS   1/1
assets.scaleGroups                PASS   1/1
assets.metadata                   PASS   1/1
bundler.bundleArtifacts           PASS   1/1
bundler.sourceMapValidity         PASS   1/1
monorepo.workspaceResolution      PASS   2/2
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

Implemented with conservative planning, patch previews, config generation, and safe package script updates for Expo and bare React Native fixtures.

### Purpose

- Detect project config files conservatively.
- Generate `vifx.config.ts` and optional Vifx-owned `vite.config.vifx.ts` templates.
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
- Generated config stays intentionally minimal and focused on the current supported corridor.

### Roadmap

- Add richer patch previews for larger config edits.
- Split more migration-specific transforms into dedicated helpers as the CLI expands.
- Keep writes conservative and reversible.

## `@vifx/cli`

Status: Implemented first pass.

The user-facing CLI surface for doctor, inspect, build, run, compatibility, migration, `vite init`, and Hermes flows.

### Current State

Implemented for doctor, init, inspect, build, run, compat run, metro inspect, setup, legacy migration workflows, `vite init`, and Hermes compile. Doctor and inspect also surface the detected Vite plugin mode.

### Purpose

- Expose a single `vifx` binary for inspection and migration workflows.
- Build configured targets and serve browser runtime previews.
- Render structured errors with codes, hints, and docs links.
- Keep the supported corridor separate from advanced or legacy manual surfaces.

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
vifx build
vifx run
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
WARN  VIFX_CONFIG_NOT_FOUND
  No Vifx config file was found in "<project>".
  Hint: Create one of: vifx.config.ts, vifx.config.mts, vifx.config.js, vifx.config.mjs.

INFO  VIFX_EXPERIMENTAL_EXPO
  Expo support is outside the current supported corridor.
```

### Limitations

- The CLI should preserve existing Metro and Expo workflows instead of masking them.
- `vifx init` and `vifx vite init` preserve non-Vifx Vite configs and keep browser-preview claims explicit.
- Expo Router projects with an `app/` directory now scaffold `expo-router/entry` browser-preview targets, but this remains a web preview only.

### Roadmap

- Preserve inspect-first doctor and inspect flows.
- Keep legacy manual migration and preview modes available without making them the primary onboarding path.
- Expand plugin-facing workflows only when the bundle contract is better proven.

## `@vifx/vite-plugin-react-native`

Status: Available.

A Vite plugin for controlled React Native bundle builds on top of Vifx primitives.

### Current State

Implemented as a real plugin plus a `buildReactNativeBundle()` helper for controlled builds. This page stays intentionally blunt: it is a current controlled-build surface, not a parity claim.

### Purpose

- Load as a Vite plugin and use Vifx resolver plus asset primitives.
- Build bundle, source-map, and asset artifacts through a controlled Vite path.
- Optionally run Hermes compile after bundle generation.
- Document unsupported features clearly.

### Installation

```sh
pnpm add -D @vifx/vite-plugin-react-native
```

Planned install surface only. The current supported usage remains repo-local.

### API Sketch

```ts
import { defineConfig } from "vite";
import { buildReactNativeBundle, reactNative } from "@vifx/vite-plugin-react-native";

export default defineConfig({
  plugins: [
    reactNative({
      platform: "ios",
      entry: "./index.js",
      hermes: false,
    }),
  ],
});

const artifacts = await buildReactNativeBundle({
  platform: "ios",
  entry: "./index.js",
});

console.log(artifacts.bundle.path);
```

### Example

```text
Controlled build path:
- platform files resolve through Vifx
- assets are normalized through @vifx/asset-registry
- source maps are validated
- fixtures/rn-bare-basic is the smoke target
```

### Limitations

- Controlled build only. No Fast Refresh, HMR, or device runtime parity.
- Fast Refresh parity is not a first-pass goal.
- Full Expo Router parity, Updates runtime/service parity, and production builds stay out of scope.
- An `expo-router/entry` browser preview exists, but it is not an Expo Go or native runtime claim.

### Roadmap

- Broaden fixture-backed evidence beyond the smoke target.
- Keep runtime claims narrower than build-artifact claims.
- Expand only when the support matrix has real proof to support it.

## `@vifx/vite-plugin-expo`

Status: Available.

An Expo-specific layer on top of the React Native Vite plugin.

### Current State

Implemented as a careful Expo layer on top of the RN plugin, with a browser dev server helper. It must not pretend to replace `expo start`.

### Purpose

- Detect Expo config and inject `EXPO_PUBLIC_*` variables where safe.
- Layer the RN plugin behind Expo-specific config detection and safe shims.
- Start a Vite browser dev server for configured Expo web-compat targets.
- State exactly what is inspect-only, unsupported, or still planned.

### Installation

```sh
pnpm add -D @vifx/vite-plugin-expo
```

Planned install surface only. The current supported usage remains repo-local.

### API Sketch

```ts
import { defineConfig } from "vite";
import { expo, findExpoAppConfig, startExpoDevServer } from "@vifx/vite-plugin-expo";

export default defineConfig({
  plugins: [expo({ platform: "ios", entry: "./index.js" })],
});

const appConfigPath = await findExpoAppConfig(process.cwd());
console.log(appConfigPath);

const server = await startExpoDevServer({
  platform: "ios",
  projectRoot: process.cwd(),
});
console.log(server.url);
```

### Example

```text
Implemented first-pass scope:
- Expo config detection
- EXPO_PUBLIC_* env injection
- safe expo/registerRootComponent shim
- browser dev serving with Vite HMR
- explicit documentation for Router, Updates, and EAS gaps
```

### Limitations

- Full Expo Router parity is not a first-pass goal.
- An `expo-router/entry` browser preview exists on the web runtime path, but it is not native or Expo Go support.
- `startExpoDevServer` and `vifx expo dev` provide Vite browser HMR only, not React Native Fast Refresh parity.
- Expo Updates runtime/native validation and EAS integration remain future work.
- This package does not replace `expo start` or `expo export`.

### Roadmap

- Broaden fixture-backed proof for Expo config edge cases.
- Keep safe shims minimal and explicit.
- Expand only with support-matrix evidence for each new claim.
