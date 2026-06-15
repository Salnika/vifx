# Proof: native + web from one unified define/env table

This proof shows a single Vifx config and a single `App.tsx` producing a native
(iOS) bundle and a web (react-native-web) bundle that share **one define/env
table** (`resolveDefines`), with **no `__VIFX_WEB_RUNTIME__` shim** on either
side. It is the side-by-side artifact for the native+web unification work
(`PLAN-DIFFERENTIATION.md` §A3, bounded by ADR-005).

It is deliberately honest: web is a **secondary, dev-only** target (ADR-005).
There is no production web build path, and several native-only libraries are
rerouted or degraded on web. Those are listed at the bottom.

## App under test — `apps/playground-universal`

`src/App.tsx` reads the same public env var two ways and resolves a
platform-specific message:

```ts
import { message } from "./message"; // message.ios.ts vs message.web.ts

const fromImportMeta = import.meta.env.EXPO_PUBLIC_VIFX_DEMO;
const fromProcessEnv = process.env.EXPO_PUBLIC_VIFX_DEMO;

console.log("universal:message", message);
console.log("universal:import.meta.env.EXPO_PUBLIC_VIFX_DEMO", fromImportMeta);
console.log("universal:process.env.EXPO_PUBLIC_VIFX_DEMO", fromProcessEnv);
console.log("universal:both-match", fromImportMeta === fromProcessEnv);
```

## Commands (same env, two platforms)

```sh
cd apps/playground-universal

# native (iOS) — react-native files, EXPO_OS injected
EXPO_PUBLIC_VIFX_DEMO=hello VIFX_PLATFORM=ios vp build --config vite.config.vifx.ts

# web — react-native-web, NO EXPO_OS
EXPO_PUBLIC_VIFX_DEMO=hello VIFX_PLATFORM=web vp build --config vite.config.vifx.ts
```

(`pnpm --filter playground-universal run validate` runs `vifx doctor`/`inspect`,
the native `vifx build`, and the web `vp build` together.)

## Result — the same env inlined on both sides

Both bundles fold the public env var to `"hello"` via the **single**
`resolveDefines` table — `import.meta.env.<k>` **and** `process.env.<k>`, native
and web:

`dist/vite/ios/index.bundle`:

```js
var message = "universal playground ios native bundle";
var fromImportMeta = "hello";
var fromProcessEnv = "hello";
console.log("universal:import.meta.env.EXPO_PUBLIC_VIFX_DEMO", fromImportMeta);
console.log("universal:process.env.EXPO_PUBLIC_VIFX_DEMO", fromProcessEnv);
console.log("universal:both-match", true);
```

`dist/vite/web/index.bundle`:

```js
var message = "universal playground web (react-native-web) bundle";
var fromImportMeta = "hello";
var fromProcessEnv = "hello";
console.log("universal:import.meta.env.EXPO_PUBLIC_VIFX_DEMO", fromImportMeta);
console.log("universal:process.env.EXPO_PUBLIC_VIFX_DEMO", fromProcessEnv);
console.log("universal:both-match", true);
```

The only difference between the two bundles in this region is the platform file
resolution (`message.ios.ts` vs `message.web.ts`):

```diff
- var message = "universal playground ios native bundle";
+ var message = "universal playground web (react-native-web) bundle";
```

Invariants verified on the emitted bundles:

| Check                                                  | iOS (native) | web         |
| ------------------------------------------------------ | ------------ | ----------- |
| `import.meta.env.EXPO_PUBLIC_VIFX_DEMO` → `"hello"`    | yes          | yes         |
| `process.env.EXPO_PUBLIC_VIFX_DEMO` → `"hello"`        | yes          | yes         |
| `both-match` folds to `true` (same value both ways)    | yes          | yes         |
| `EXPO_OS` define present                               | yes (native) | **no** (web invariant) |
| `__VIFX_WEB_RUNTIME__` shim in output                  | **no**       | **no**      |
| platform file resolved                                 | `message.ios.ts` | `message.web.ts` |

The web define table keeps its existing shape with no `EXPO_OS` (web detects the
platform through `Platform.OS`); the public-env keys are emitted in a stable
**sorted** order for byte-identity.

## What replaced the shim

The dev web target now mounts through the **real react-native-web
`AppRegistry.runApplication`** instead of `globalThis.__VIFX_WEB_RUNTIME__`:

- RN `renderCompat` keeps a module-local memo of the registered/mounted app keys
  (no global runtime object), wrapping the real RNW `AppRegistry`.
- Expo's dev client (`renderExpoDevClient`) dynamically imports
  `react-native` (→ RNW) and calls `AppRegistry.runApplication("main", { rootTag })`.
- `writeWebRuntimeArtifacts` (the ~324-line static browser-preview emitter) and
  its `runtime` build artifact were removed; `buildReactNativeBundle` now returns
  `runtime: null`.

## Honest degradations (web is secondary, dev-only — ADR-005)

| Area                          | Native (iOS/Android)        | Web                                                                 |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------- |
| Production build path         | yes (Hermes/hoisted)        | **none** — web is a dev/preview target only (ADR-005)               |
| `react-native` core           | real RN                     | rerouted to `react-native-web` (`WEB_COMPAT_SPECIFIERS`)            |
| Native module bridge          | real TurboModules/bridge    | `NativeModules`/`TurboModuleRegistry`/`NativeEventEmitter` rerouted to RNW/browser shims |
| `react-native-reanimated`     | native-compat shim (preview)| not shimmed by vifx — resolves to the library's own web build (may no-op/lag) |
| `expo-sqlite`                 | rerouted compat module      | no native SQLite; behavior diverges from device                    |
| `react-native-skia`, `react-native-gesture-handler` | as-shipped | **not** brought to parity by vifx — use each library's own web support, if any |
| Networking globals            | RN polyfills                | browser `fetch`/`FormData`/`URL` re-exported from `window`         |

These are intentional non-goals for this unit: no production web path, no
reanimated/skia parity. Web faithfulness is a separate, sequenced effort
(ADR-005, `PLAN.md` §4 Phase 6). The native critical path is unaffected — with
**no** `EXPO_PUBLIC_*` var set, the native (Expo Go) bundle is byte-identical to
before this change.
