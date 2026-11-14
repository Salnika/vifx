---
"@vifx/cli": patch
"@vifx/vite-config-bridge": patch
"@vifx/vite-plugin-expo": patch
"@vifx/vite-plugin-react-native": patch
---

Depend on the Vite+ toolchain as `@voidzero-dev/vite-plus-core` instead of a `vite` alias, so installs with npm, Yarn classic, Bun or pnpm's hoisted linker leave `node_modules/vite` to the app and keep a single copy of the toolchain. A `vite.config.vifx.ts` uses the app's own `vite` (install it as a dev dependency); when it is missing, the load error now says so.
