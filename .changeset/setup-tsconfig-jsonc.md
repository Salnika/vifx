---
"@vifx/cli": patch
"@vifx/codemods": patch
---

`vifx setup` reads `tsconfig.json` the way TypeScript does, with comments and trailing commas. Before, a trailing comma made the file unreadable and its `paths` were ignored without a word, so no aliases were written. Like Expo CLI, setup skips a `paths` target that is a declaration file (`.d.ts`): it only exists for type checking, and as an alias it would replace a module with its types.
