---
layout: home

hero:
  name: Vifx
  text: One Vite engine for React Native and Expo
  tagline: A unified, Vite/Rolldown-based toolchain that replaces Metro for React Native and Expo — native and web from a single engine, an open plugin graph, and a Metro-compatible dev server.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Vifx vs Metro
      link: /reference/comparisons
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: One engine, native and web
    details: A single Vite/Rolldown plugin pair builds your iOS and Android bundles and a react-native-web companion preview, with one config, one define table, and one platform resolver for .ios / .android / .native / .web.
  - title: Open Vite/Rollup plugin graph
    details: Drop a vite.config.vifx.ts next to your app and run any Vite or Rollup plugin — svgr, unplugin-icons, mdx, virtual modules — against a React Native bundle. Vifx loads and merges it through Vite's own config loader.
  - title: Metro-compatible dev server
    details: vifx expo dev --expo-go serves the Expo Go manifest, bundle, source maps, /symbolicate, and React Native DevTools, with QR code and interactive keybindings. Opt into state-preserving Fast Refresh over /hot with --fast-refresh.
  - title: Per-save build instrumentation
    details: Every rebuild prints one line ventilated by phase — transform, serialize, write, apply — plus a per-cycle transform-cache hit-rate. Add --json to stream pure NDJSON you can aggregate into median and p95.
  - title: Content-addressed transform cache
    details: Entries are keyed by a SHA-256 of their inputs and a tool-version stamp, so an unchanged file is a guaranteed warm hit. Warm rebuilds land around 3.2x faster than Metro on the same app.
  - title: Scope-hoisted release bundles
    details: Production native bundles are a single scope-hoisted IIFE minified by Oxc, keeping Rolldown's cross-module tree-shaking. Compile to Hermes bytecode with hermes&#58; true on the target.
  - title: Drop-in production export
    details: vifx export:embed speaks the npx expo export:embed and npx react-native bundle flag surface, so the Xcode bundle phase and the Gradle bundle task call Vifx instead of Metro. vifx expo export writes the full Expo artifact directory.
  - title: Unified define and env
    details: One table feeds native and web. __DEV__, NODE_ENV, global, and EXPO_OS are resolved for you, and every EXPO_PUBLIC_* variable is inlined as both import.meta.env.* and process.env.*.
  - title: Onboard without rewrites
    details: vifx setup writes a Vifx-owned config beside your Expo app without touching app.json, Expo scripts, or source. It reads your metro.config.js and prints exactly which settings to mirror.
---

## Why Vifx

Vifx swaps Metro for a single Vite/Rolldown engine across your whole React Native or Expo app. You keep Expo CLI, EAS, and your native projects; you replace the bundler underneath them. The result is the standard Vite plugin ecosystem on a native app, a Metro-compatible dev server with opt-in Fast Refresh, a content-addressed cache for fast warm rebuilds, and scope-hoisted, Oxc-minified release bundles that compile to Hermes bytecode.

Native is the primary target and web is a companion preview built from the same engine. See [Vifx vs Metro](/reference/comparisons) for the structural differences and the measured numbers.

## Start in three commands

```sh
# Onboard an existing Expo app — writes vifx.config.ts, edits nothing Expo owns
pnpm vifx setup . --yes

# Serve the Expo Go dev server with state-preserving Fast Refresh
pnpm vifx expo dev . --expo-go --fast-refresh

# Build the release bundle + assets for the Xcode / Gradle bundle phase
pnpm vifx export:embed . --platform ios --dev false \
  --bundle-output ios.bundle --sourcemap-output ios.map --assets-dest ./assets
```

Bare React Native projects start with `vifx init` and serve through [`vifx dev`](/reference/cli). See the [Getting Started guide](/guide/getting-started) for the full walkthrough.

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
- [Features](/reference/features) — the full capability inventory.
- [CLI Reference](/reference/cli) — every command, flag, and default.
- [Config](/reference/config) — the `vifx.config.ts` and `vite.config.vifx.ts` contracts.
- [Vifx vs Metro](/reference/comparisons) — structural differences and benchmarks.
- [Migration](/guide/migration) — move an Expo or React Native app off Metro.
