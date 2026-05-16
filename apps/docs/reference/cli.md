# CLI

The CLI is the main user-facing surface for inspection, compatibility, and bounded build or runtime experiments.

## `vifx init`

Status: Current.

Bootstrap a conservative `vifx.config.*` file and point the project toward the documented workflow.

- Use it when no Vifx config exists yet.
- Use it after doctor reports a missing config.

```sh
vifx init
vifx init --help
```

- The current first pass writes `vifx.config.ts` and should never overwrite user files silently.
- For Expo projects, generated targets still default to `entry: "./index.js"` and do not enable `reactNativeCompat: "web"`.
- That means `vifx init` is a starting point, not a runtime-ready setup for browser previews or Expo Router previews.

## `vifx doctor`

Status: Current.

Inspect readiness, versions, config presence, detected Vite plugin mode, and experimental support boundaries.

- Use it before migration or plugin experiments.
- Use it after changing config or adding experimental packages.

```sh
vifx doctor
vifx doctor --json
```

- JSON mode should emit valid JSON with no extra logs.
- Doctor is the safest first command in the flow.
- It reports `none`, `react-native`, or `expo` when a Vifx Vite plugin import is detected in `vite.config.*`.

## `vifx inspect`

Status: Current.

Umbrella inspection entrypoint before choosing Metro-specific or compatibility-specific workflows.

- Use it when you want an inspection-oriented entrypoint.
- Use it when docs need to reinforce inspect-first behavior.

```sh
vifx inspect
vifx inspect --help
```

- The current first pass reports project primitives, Vite mode, platform files, asset groups, and diagnostics.
- Use `vifx metro inspect` for dedicated captured Metro reference inspection.

## `vifx build`

Status: Current.

Build the configured Vifx bundle targets from `vifx.config.*`.

- Use it once `vite.mode` and `vite.targets` are defined.
- Use it before browser runtime previews or artifact comparisons.

```sh
vifx build
vifx build --platform ios
vifx build --platform all --json
```

- `--platform` supports `ios`, `android`, or `all`.
- Targets with `reactNativeCompat: "web"` emit runtime HTML and JS alongside the bundle artifacts.
- This is still a controlled build path, not a Metro replacement or native runtime claim.

## `vifx run`

Status: Current.

Serve one configured target as a local browser runtime preview.

- Use it after a target is configured for browser preview.
- Use it to validate the bounded runtime path without replacing native workflows.

```sh
vifx run --platform ios
vifx run --platform ios --no-build
vifx run --platform android --json
```

- `vifx run` requires `vite.targets[].reactNativeCompat = "web"`.
- If multiple targets exist, pass `--platform`.
- `--no-build` reuses the existing runtime artifacts instead of rebuilding first.
- Bounded `expo-router/entry` previews work on this path, but only as browser previews. Expo Go, device runtime parity, Fast Refresh, and HMR remain out of scope.

## `vifx compat run`

Status: Current.

Run shared compatibility cases and produce reviewable reports.

- Use it in CI to measure adapters against the same contract.
- Use it locally when validating a primitive or adapter change.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

- `metro`, `vifx`, and `all` are supported.
- The current shared suite covers `11` cases across `6` categories and passes for both adapters today.
- Failures should carry fixture and docs context.

## `vifx metro inspect`

Status: Current.

Capture Metro reference behavior as structured evidence from captured fixture artifacts.

- Use it before claiming support.
- Use it when the support matrix needs evidence for a feature row.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

- Metro is a reference adapter here.
- Reports should be deterministic enough for snapshots.

## `vifx migrate`

Status: Experimental workflow.

Umbrella migration command that points to the Expo and bare React Native flows.

- Use it to discover migration subcommands.
- Use it to reinforce that migration is experimental and reversible.

```sh
vifx migrate --help
vifx migrate expo --dry-run
vifx migrate expo --dry-run --with-vite
vifx migrate react-native --dry-run
vifx migrate react-native --dry-run --with-vite
```

- Dry-run should be the default mental model.
- Existing Metro and Expo workflows must remain visible.

## `vifx migrate expo`

Status: Experimental workflow.

Prepare an Expo project for experiments without breaking existing workflows.

- Use it only after doctor and reference inspection.
- Use it when you want config and helper scripts, not replacement behavior.

```sh
vifx migrate expo --dry-run
vifx migrate expo --write
vifx migrate expo --dry-run --with-vite
```

- Never replace `expo start` automatically.
- `--with-vite` reuses the same minimal plugin-backed Vite init plan as `vifx vite init`.
- Browser-preview or Expo Router entries still require manual target edits after migration.
- Rollback instructions should always be printed.

## `vifx migrate react-native`

Status: Experimental workflow.

Prepare a bare React Native project for bounded experiments.

- Use it when evaluating Vifx in a bare app without losing Metro.
- Use it after a reference report already exists.

```sh
vifx migrate react-native --dry-run
vifx migrate react-native --write
vifx migrate react-native --dry-run --with-vite
```

- Preserve Metro config and scripts.
- `--with-vite` adds the bounded Vite config without claiming runtime parity.
- Browser previews still require manual `reactNativeCompat: "web"` target edits.
- Keep rollback guidance prominent.

## `vifx vite init`

Status: Experimental workflow.

Scaffold a plugin-backed `vite.config.ts` once the team intentionally enters bounded Vite experimentation.

- Use it after config and primitive work exist.
- Use it when you want a bounded Vite experiment rather than a replacement claim.

```sh
vifx vite init
vifx vite init --help
vifx vite init --write
vifx vite init --force --write
```

- The current command supports `--write` and `--force`.
- Generated output imports the real Vifx plugin and keeps experimental status obvious.
- It still scaffolds `entry: "./index.js"` and does not automatically enable `reactNativeCompat: "web"` or `expo-router/entry`.

## `vifx hermes compile`

Status: Current.

Expose Hermes bytecode compilation through the CLI when Hermes tooling is available.

- Use it after bundle output exists.
- Use it when Hermes readiness is in scope for the target app.

```sh
vifx hermes compile
vifx hermes compile --help
```

- It should fail gracefully if Hermes is unavailable.
- It must align with the package behavior in `@vifx/hermes-tools`.

## Example Report

```text
Compatibility report

Adapter: vifx

doctor.projectDetection           PASS   2/2
resolver.platformExtensions       PASS   4/4
assets.scaleGroups                PASS   1/1
bundler.bundleArtifacts           PASS   1/1
bundler.sourceMapValidity         PASS   1/1
monorepo.workspaceResolution      PASS   2/2
```
