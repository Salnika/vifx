# Expo Migration

The recommended onboarding path for an existing Expo project is now a single setup command followed by explicit validation.

This guide assumes you are running Vifx from this repository, not from published npm packages:

```sh
pnpm vifx <command> ...
```

## Prerequisites

- Node `>=22.12.0`
- An existing Expo project with `expo` and `react-native` dependencies
- Run commands from this Vifx repository and point them at your Expo project path

## 1. Run Setup

Apply the setup:

```sh
pnpm vifx setup <expo-project-path> --yes
```

Optional advanced direct-Vite config:

```sh
pnpm vifx setup <expo-project-path> --yes --with-vite-config
```

## What Setup Creates

By default, `vifx setup` creates only `vifx.config.ts`.

- It does not edit `vite.config.ts`.
- It does not edit `app.json`.
- It does not edit existing Expo scripts or EAS scripts.
- It does not add `@vifx/*` dependencies to the target project's `package.json`.

The generated config keeps the current Expo defaults used by the repository today:

- `vite.mode = "expo"`
- iOS and Android targets
- `entry: "expo-router/entry"` when both `expo-router` and `app/` are detected
- `entry: "./index.js"` otherwise
- `reactNativeCompat: "web"` only for the Expo Router browser-preview path
- `expoOptions.publicEnvPrefix = "EXPO_PUBLIC_"`
- conservative `hermes: false` and `dist/vite/<platform>` output directories

`--with-vite-config` adds `vite.config.vifx.ts` as an opt-in advanced surface. It is not required for the main guide flow.

## 2. Audit The Current Contract

```sh
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo audit <expo-project-path> --json
```

Use this to confirm that the setup removed the missing-config blockers for the supported workflows.

## 3. Start Browser Preview When Configured

If setup detected Expo Router and an `app/` directory, it configures a browser-preview target:

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
```

This is a Vite browser dev server only. It does not replace `expo start`, Expo Go, native device runtime parity, or React Native Fast Refresh parity.

## 4. Run The Minimal iOS Native Path

```sh
pnpm vifx native run <expo-project-path> --platform ios
```

For Expo iOS, this is currently a maintained Debug simulator workflow:

- Expo prebuild when needed
- CocoaPods when needed
- local Vifx bundle server
- `xcodebuild` + `simctl`

## Continue With Export And Updates

```sh
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo serve <expo-project-path> --export-root dist/expo
```

Use this when you want local export and Expo Updates validation from the same Vifx config.

## Not Supported Yet

The recommended setup path does not currently provide:

- Expo Go parity
- native dev-client protocol parity
- React Native Fast Refresh parity
- EAS parity
- Android runtime parity
- broad Expo production parity outside the current iOS simulator path

## Related Docs

- [Getting Started](/guide/getting-started)
- [Workflows](/guide/workflows)
- [CLI Reference](/reference/cli)
