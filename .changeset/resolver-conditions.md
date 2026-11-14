---
"@vifx/cli": patch
"@vifx/codemods": patch
"@vifx/config": patch
"@vifx/types": patch
---

`resolver.conditions` from `vifx.config.ts` now reaches every build and dev server: extra package `exports` conditions, tried after `react-native` and the platform and before `import` and `default`. The conditions the bundler sets itself (`react-native`, `ios`, `android`, `browser`, `web`, `import`, `default`), and `require`, which it never sets, are dropped from the list. The `["react-native", "import", "require", "default"]` that `vifx setup` and `vifx init` used to write therefore changes nothing, and they no longer write it. An empty `conditions` list is now accepted.
