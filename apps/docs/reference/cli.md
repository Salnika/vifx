# CLI

The CLI is the main user-facing surface for inspection, compatibility, and experimental migration flows.

## `vifx init`

Status: Current.

Bootstrap a `vifx.config.*` file and point the project toward the documented workflow.

- Use it when no Vifx config exists yet.
- Use it after doctor reports a missing config.

```sh
vifx init
vifx init --help
```

- The current first pass generates a conservative config template.
- It should never overwrite user files silently.

## `vifx doctor`

Status: Current.

Inspect readiness, versions, config presence, and experimental support boundaries.

- Use it before migration or plugin experiments.
- Use it after changing config or adding experimental packages.

```sh
vifx doctor
vifx doctor --json
```

- JSON mode should emit valid JSON with no extra logs.
- Doctor is the safest first command in the flow.

## `vifx inspect`

Status: Current.

Umbrella inspection entrypoint before choosing Metro-specific or compatibility-specific workflows.

- Use it when you want an inspection-oriented entrypoint.
- Use it when docs need to reinforce inspect-first behavior.

```sh
vifx inspect
vifx inspect --help
```

- The current first pass reports project primitives, platform files, asset groups, and diagnostics.
- Use `vifx metro inspect` for dedicated captured Metro reference inspection.

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
- Warn and todo states are part of the design.
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
vifx migrate react-native --dry-run
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
```

- Never replace `expo start` automatically.
- Rollback instructions should always be printed.

## `vifx migrate react-native`

Status: Experimental workflow.

Prepare a bare React Native project for bounded experiments.

- Use it when evaluating Vifx in a bare app without losing Metro.
- Use it after a reference report already exists.

```sh
vifx migrate react-native --dry-run
vifx migrate react-native --write
```

- Preserve Metro config and scripts.
- Keep rollback guidance prominent.

## `vifx vite init`

Status: Experimental workflow.

Scaffold experimental Vite-facing setup once the team intentionally enters plugin experimentation.

- Use it after config and primitive work exist.
- Use it when you want a bounded Vite experiment rather than a replacement claim.

```sh
vifx vite init
vifx vite init --help
```

- Exact flags remain TBD.
- Generated output should keep experimental status obvious.

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
Platform: ios

resolver.platformExtensions       PASS  12/12
assets.scaleGroups                PASS   8/8
sourcemaps.validity               WARN   2/3
expo.exportShape                  TODO   0/5
```
