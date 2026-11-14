---
layout: home

hero:
  name: Vifx
  text: One Vite engine for React Native and Expo
  tagline: Vite and Rolldown bundling for React Native and Expo, without Metro — native and web from one engine, any Vite or Rollup plugin, and an Expo Go dev server with Fast Refresh.
  image:
    src: /logo.png
    alt: Vifx logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Vifx vs Metro
      link: /reference/comparisons
    - theme: alt
      text: Project Status
      link: /guide/status

features:
  - title: One engine, native and web
    details: A single Vite/Rolldown plugin pair builds your iOS and Android bundles and a react-native-web companion preview, with one config, one define table, and one platform resolver for .ios / .android / .native / .web.
  - title: Open Vite/Rollup plugin graph
    details: Drop a vite.config.vifx.ts next to your app and run any Vite or Rollup plugin — svgr, unplugin-icons, mdx, virtual modules — against a React Native bundle. Vifx loads and merges it through Vite's own config loader.
  - title: Expo Go dev server with Fast Refresh
    details: vifx expo dev --expo-go serves the Expo Go manifest, bundle, source maps, /symbolicate, and React Native DevTools, with a QR code and interactive keys. Rolldown's dev engine compiles each save into a patch that the running app applies with Metro's Fast Refresh rules.
  - title: One line per save
    details: Each save prints what changed, whether the app applied it in place or reloaded (and why), and how long it took. Compile errors show in the app and in the terminal, and the app's console output is printed in the terminal. Add --json for NDJSON reports.
  - title: Content-addressed transform cache
    details: Entries are keyed by a SHA-256 of their inputs and a tool-version stamp, so an unchanged file is always a cache hit. On the benchmark app, a warm release build took 1.57 s against 8.71 s for Metro.
  - title: Scope-hoisted release bundles
    details: Production native bundles are a single scope-hoisted IIFE minified by Oxc, keeping Rolldown's cross-module tree-shaking. Compile to Hermes bytecode with hermes&#58; true on the target.
  - title: Drop-in production export
    details: vifx export:embed speaks the npx expo export:embed and npx react-native bundle flag surface, so the Xcode bundle phase and the Gradle bundle task call Vifx instead of Metro. vifx expo export writes the full Expo artifact directory.
  - title: Unified define and env
    details: One table feeds native and web. __DEV__, NODE_ENV, global, and EXPO_OS are resolved for you, and every EXPO_PUBLIC_* variable is inlined as both import.meta.env.* and process.env.*.
  - title: Onboard without rewrites
    details: vifx setup writes a Vifx-owned config beside your Expo app without touching app.json, Expo scripts, or source. It reads your metro.config.js and prints which settings to mirror.
---

## Why Vifx

Vifx swaps Metro for a single Vite/Rolldown engine across your whole React Native or Expo app. You keep Expo CLI, EAS, and your native projects; you replace the bundler underneath them. You get the standard Vite plugin ecosystem on a native app, an Expo Go dev server with Fast Refresh, a content-addressed cache for warm rebuilds, and scope-hoisted, Oxc-minified release bundles that compile to Hermes bytecode.

Native is the primary target and web is a companion preview built from the same engine. See [Vifx vs Metro](/reference/comparisons) for the structural differences and the measured numbers.

## Status

Vifx is pre-1.0 and experimental. It is validated on one Expo SDK 54 app (about 2,000 modules) and on the Expo SDK 58 default template, on iOS and Android; Expo SDK 55 to 57 are experimental. Keep Metro available for anything Vifx does not cover yet. See [Project Status](/guide/status) for what has been verified and what is still open.

## Quick start

```sh
# Install the CLI, which provides the vifx command
npm install --save-dev @vifx/cli

# Onboard an existing Expo app — writes vifx.config.ts, edits nothing Expo owns
npx vifx setup . --yes --expo-go

# Serve the app to Expo Go, with Fast Refresh
npx vifx expo dev . --expo-go --platform ios

# Build the release bundle + assets for the Xcode / Gradle bundle phase
npx vifx export:embed . --platform ios --dev false \
  --bundle-output ios.bundle --sourcemap-output ios.map --assets-dest ./assets
```

Bare React Native projects start with `vifx init` and serve through [`vifx dev`](/reference/cli#vifx-dev). See the [Getting Started guide](/guide/getting-started) for the full walkthrough.

## Extend the build with any Vite plugin

Add a `vite.config.vifx.ts` and Vifx merges it after its own plugins, so platform resolution stays correct while your plugins run against the React Native bundle.

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

Vifx owns the keys it must — platform resolution, the define table, and the native output format — and warns when a user override is neutralized. Everything else is yours. See [Config](/reference/config) for the merge contract.

## Explore

- [Getting Started](/guide/getting-started) — install, onboard, run, and ship a build.
- [Dev Server and Fast Refresh](/guide/dev-server) — how saves reach the app, and what the terminal prints.
- [Features](/reference/features) — the full capability inventory.
- [CLI Reference](/reference/cli) — every command, flag, and default.
- [Config](/reference/config) — the `vifx.config.ts` and `vite.config.vifx.ts` contracts.
- [Vifx vs Metro](/reference/comparisons) — structural differences and benchmarks.
- [Migration](/guide/migration) — move an Expo or React Native app off Metro.
- [Project Status](/guide/status) — what is validated, known gaps, and open issues.
