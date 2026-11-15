---
"@vifx/cli": patch
---

`vifx doctor` and `vifx setup` read `metro.config.ts`, `metro.config.cts` and `metro.config.mts`, which Metro also loads. Before, a project with a TypeScript Metro config got no Metro config migration notes at all. Like Metro, the config is required first and imported when that fails; TypeScript loads through Node's type stripping.

They also report react-native-worklets bundle mode (`getBundleModeMetroConfig`) by name. Vifx does not implement it, so worklets in such a bundle are not expected to run. Sentry's Metro integration is still reported when bundle mode is present.
