# @vifx/vite-config-bridge

## 0.2.2

### Patch Changes

- @vifx/errors@0.2.2
  - @vifx/types@0.2.2

## 0.2.1

### Patch Changes

- @vifx/errors@0.2.1
  - @vifx/types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [f104cb2]
- Updated dependencies [8b79fef]
  - @vifx/types@0.2.0
  - @vifx/errors@0.2.0

## 0.1.0

### Patch Changes

- a5f6b2e: Depend on the Vite+ toolchain as `@voidzero-dev/vite-plus-core` instead of a `vite` alias, so installs with npm, Yarn classic, Bun or pnpm's hoisted linker leave `node_modules/vite` to the app and keep a single copy of the toolchain. A `vite.config.vifx.ts` uses the app's own `vite` (install it as a dev dependency); when it is missing, the load error now says so.
- Updated dependencies [4e715b5]
  - @vifx/types@0.1.0
  - @vifx/errors@0.1.0
