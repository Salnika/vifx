---
"@vifx/cli": minor
"@vifx/config": minor
"@vifx/types": minor
---

`vifx doctor --fix` writes the settings it maps from `metro.config.js` into `vifx.config.ts`: source extensions (`resolver.extensions`), asset extensions (the new `resolver.assetExtensions` key) and module aliases (each `vite.targets` entry's `aliases`). The file is edited in place, so its comments and other keys are kept.

`vifx doctor` now compares `metro.config.js` with the config `expo/metro-config` or `@react-native/metro-config` builds on its own, so Expo's and React Native's defaults (CSS source extensions, extra asset extensions, the default Babel transformer and serializer) are no longer reported as settings to port. It names Sentry's Metro serializer when it finds one. Its report, and `vifx setup`'s, are colored on a color terminal.

`resolver.extensions` and `resolver.assetExtensions` from `vifx.config.ts` now reach every build and dev server; before, only `resolver.mainFields` did.
