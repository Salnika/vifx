# Getting Started

Vifx is a React Native and Expo toolchain alternative built around explicit compatibility, deterministic artifacts, and a repo-local onboarding flow.

## Why Vifx Exists

- Bundling behavior for React Native and Expo is broader than module resolution alone.
- Metro is the current reference behavior, but much of that contract is implicit.
- Trust has to be earned through reports, docs, tests, and executed validation.

## Supported Expo Workflow

1. Run `vifx setup` to generate the Vifx-owned config without editing Expo-owned app files.
2. Run `vifx expo audit` to verify the supported corridor and the missing pieces.
3. Use `vifx expo dev` when you want the browser preview path.
4. Use `vifx native run` when you want the maintained iOS simulator path.
5. Use `vifx expo export` and `vifx expo serve` when you want local export and Updates validation.

## Recommended Expo Path

For an existing Expo project, start with the dedicated [Expo Migration](/guide/expo-migration) guide.

The recommended repository-local flow is:

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx native run <expo-project-path> --platform ios
```

For local export and Updates validation, continue with:

```sh
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo serve <expo-project-path> --export-root dist/expo
```

## First Commands

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx native run <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo serve <expo-project-path> --export-root dist/expo
```

## Validate The Maintained Playgrounds

The repository keeps two formal playgrounds for the current Vifx paths:

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

Each playground runs `vifx doctor`, `vifx inspect`, iOS and Android `vifx build`, and a direct Vite build through
`vite.config.vifx.ts`.

## Advanced Manual Surfaces

Use these only when you intentionally leave the main Expo onboarding corridor:

- `vifx init`
- `vifx vite init`
- `vifx migrate expo`
- `vifx migrate react-native`
- native lifecycle `--dry-run` commands

## Config Contract Draft

The current docs describe the config surface that the supported corridor relies on.

```ts
export default {
  projectRoot: process.cwd(),
  projectType: "expo",
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
};
```

- The recommended Expo setup writes a plain default-export object so the target project does not need `@vifx/config` installed.
- Low-level config authors can still use `defineVifxConfig(...)` when they control the target dependencies.
- Add `reactNativeCompat: "web"` on a target when you want `vifx run` to serve a browser preview.
- Expo Router projects with an `app/` directory scaffold `expo-router/entry` automatically through `vifx setup`, `vifx init`, and `vifx vite init`.

## Report Shape

Compatibility is reported as evidence with context, not as a single green or red bit.

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

Warn and todo states remain part of the reporting design as the suite grows. The current shared suite is still smaller than the long-term contract.

## Read Next

- [Expo Migration](/guide/expo-migration)
- [Architecture](/guide/architecture)
- [Workflows](/guide/workflows)
- [Packages](/reference/packages)
