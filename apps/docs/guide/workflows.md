# Workflows

## Analyze An Expo Project

Audience: Expo maintainers and tool authors.

Start with inspection and support reporting before any migration step.

1. Run doctor to inspect Expo, Metro, and config readiness.
2. Capture reference behavior before adding experimental Vifx layers.
3. Record inspect-only gaps in the support matrix instead of burying them in code.

```sh
vifx doctor
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
vifx migrate expo --dry-run
```

## Analyze A React Native Project

Audience: bare React Native maintainers.

Use Metro inspection and primitive-focused comparison before any plugin experiment.

1. Confirm the project type and current Metro assumptions.
2. Inspect bundle, assets, and maps on the target platform.
3. Only then evaluate migration scaffolding or future Vite plugin work.

```sh
vifx doctor
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx migrate react-native --dry-run
```

## Run Compatibility Tests

Audience: package authors and CI maintainers.

Treat compatibility as a report with context, not a single boolean.

1. Choose the adapter you want to measure.
2. Run the shared cases and keep the generated report reviewable.
3. Use warn and todo states honestly when support is still incomplete.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

## Inspect Metro Output

Audience: bundler researchers.

Use Metro as a reference adapter, not as an invisible implementation dependency.

1. Choose a fixture or project and run the Metro inspector.
2. Capture bundle, asset, map, and warning output deterministically.
3. Use the report to inform support claims and docs updates.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

## Use The Vite Plugin Experimentally

Audience: bundler experimenters.

Bound the experiment tightly and keep support gaps visible.

1. Start with the React Native plugin before layering Expo behavior.
2. Keep Metro workflows available while comparing results.
3. Document unsupported features in the support matrix and docs.

```sh
pnpm add -D @vifx/vite-plugin-react-native
pnpm add -D @vifx/vite-plugin-expo
vifx doctor
```
