# Getting Started

Vifx is a Vite bundling engine for React Native and Expo projects. The current goal is to produce and compare bundle artifacts without Metro.

## Why Vifx Exists

- React Native bundling includes platform resolution, assets, source maps, Hermes output, and export shape.
- Metro is the reference behavior, but much of that contract is implicit.
- Vifx makes the contract observable through fixtures, reports, docs, and executable commands.

## Supported Flow

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

- `setup` creates the Vifx-owned config for an Expo project.
- `build` produces configured Vite bundle artifacts.
- `expo audit` reports only bundling workflows: config, Vite build, Metro parity, dev server, and export artifacts.
- `expo dev` starts a bounded Vite bundle/dev server for a configured target.
- `expo export` writes bundles, source maps, assets, `manifest.json`, and `metadata.json`.

## Validate The Maintained Playgrounds

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

Each playground runs `vifx doctor`, `vifx inspect`, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.

## Config Contract Draft

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
};
```

- Add `reactNativeCompat: "web"` on a target when you want `vifx run` or `vifx expo dev` to serve a browser-compatible preview.
- Expo Router projects with an `app/` directory scaffold `expo-router/entry` automatically through `vifx setup`, `vifx init`, and `vifx vite init`.

## Boundaries

Vifx does not replace Expo CLI, Expo Go, EAS, app build/run workflows, Expo Updates runtime, or full Fast Refresh. Keep those tools in place while comparing Vifx bundle output against Metro.

## Read Next

- [Expo Migration](/guide/expo-migration)
- [Architecture](/guide/architecture)
- [Workflows](/guide/workflows)
- [Packages](/reference/packages)
