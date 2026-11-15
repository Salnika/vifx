# Expo (Metro) vs vifx — Bluesky (`bluesky-social/social-app`), November 2026

> Date: 2026-11-15. vifx 0.2.0, built from the repository at the release (`01004bd`).
> App: [`bluesky-social/social-app`](https://github.com/bluesky-social/social-app) 1.137.0, its latest release
> (2026-10-29): Expo 58.0.19, React Native 0.88.0, React Navigation (no Expo Router), installed with pnpm 11.28.5
> (`nodeLinker: hoisted`, the app's 21 patches applied). Unchanged except for the `vifx.config.ts` that
> `vifx setup` writes.
> Machine: Apple M4 Pro (14 cores), 24 GB, macOS (Darwin 25.5), Node 26.13.1.
> Harness: [`scripts/bench/expo-vs-vifx.mjs`](../../scripts/bench/expo-vs-vifx.mjs)
> (`pnpm bench:expo`), iOS.

Bluesky's app is the open-source target the [main report](./expo-vs-vifx-2026-11.md) could not build (§5 there).
Its release bundle holds about 7,000 modules, and its Metro config stacks Sentry's Expo config on
react-native-worklets bundle mode.

**vifx builds it** with no change to the app: release and development `export:embed`, and the Expo Go dev server
with Fast Refresh. The class static block that stopped the June attempt no longer reaches either bundle, and Hermes
compiles every bundle and patch of both tools.

**vifx's bundle would not run the app, though**, and it is not the same bundle as Metro's. Read from the code, two
defects stop it, the first one at startup (see [below](#why-vifxs-bundle-would-not-run)): a library resolved to its
Node.js entry, and worklets bundle mode, which vifx does not implement. Neither bundle was run: the app ships its own
native modules, so it needs a development build rather than Expo Go, and none was built here. Read the numbers below
as what each tool does with the same sources, not as two working apps.

Same method as the [template report](./expo-template-sdk58-2026-11.md): Metro is the app's own `expo export:embed`
and `expo start`, vifx is `vifx export:embed` and `vifx expo dev --expo-go`. Cold runs start with the caches cleared,
one run per cell; warm figures are the median of 3 runs. Memory is the peak of the sum over the process tree,
sampled every 100 ms. Delta is vifx relative to Metro; negative is better for vifx. The entry is `index.ts`, and the
edits go to `src/view/screens/Home.tsx`, which exports only components, so both tools treat it as a Fast Refresh
boundary.

## Results

### Release bundle (`export:embed --dev false`)

| Metric                         |    Metro |     vifx |   Delta |
| ------------------------------ | -------: | -------: | ------: |
| Cold build                     |  28.28 s |  21.24 s | −24.9 % |
| Warm build                     |   6.08 s |   7.62 s | +25.4 % |
| Peak memory, cold              | 5,794 MB | 4,999 MB | −13.7 % |
| Peak memory, warm              | 3,135 MB | 4,753 MB | +51.6 % |
| JS bundle                      | 32.81 MB | 26.18 MB | −20.2 % |
| JS bundle, gzip                |  8.37 MB |  7.75 MB |  −7.4 % |
| Hermes bytecode (`hermesc -O`) | 37.17 MB | 35.46 MB |  −4.6 % |
| Hermes compile                 |  14.71 s |  12.86 s | −12.6 % |
| Source map                     | 71.34 MB | 72.24 MB |  +1.3 % |
| Modules in the source map      |    7,360 |    6,909 |  −6.1 % |
| Asset files                    |      318 |      319 |      +1 |

vifx's extra asset file is its `assetmap.json`. Its source map does not list every module it bundles (JSON modules
are missing: the app's emoji data is in vifx's bundle but not in its map), so the module counts are not exact.

### Development bundle (`export:embed --dev true`)

| Metric            |    Metro |     vifx |   Delta |
| ----------------- | -------: | -------: | ------: |
| Cold build        |  25.00 s |  18.77 s | −24.9 % |
| Warm build        |   5.77 s |   5.87 s |  +1.7 % |
| Peak memory, cold | 5,153 MB | 4,982 MB |  −3.3 % |
| Peak memory, warm | 2,983 MB | 3,926 MB | +31.6 % |
| JS bundle         | 58.01 MB | 43.86 MB | −24.4 % |

### Dev server (`expo start` vs `vifx expo dev --expo-go`)

| Metric                              |    Metro |     vifx |   Delta |
| ----------------------------------- | -------: | -------: | ------: |
| Cold start → server answering       |   7.58 s |   1.16 s | −84.8 % |
| Cold start → first bundle served    |  22.11 s |  18.34 s | −17.0 % |
| Warm start → server answering       |   3.06 s |   0.93 s | −69.5 % |
| Warm start → first bundle served    |   6.38 s |   6.19 s |  −3.1 % |
| Repeat bundle fetch                 |   0.60 s |   0.05 s | −91.8 % |
| Edit → Fast Refresh update received |   0.17 s |   0.28 s | +59.4 % |
| Edit → new full bundle available    |   0.71 s |   0.81 s | +13.8 % |
| Dev bundle served                   | 43.42 MB | 49.39 MB | +13.7 % |

Fast Refresh is timed on the `/hot` socket as the app receives the update: 0.60, 0.28 and 0.27 s for vifx (the first
edit after a start is the slow one), 0.24, 0.18 and 0.17 s for Metro. A new full bundle took 0.81, 0.78 and 0.84 s
with vifx, 1.32, 0.65 and 0.71 s with Metro.

## Why vifx's bundle would not run

### `qrcode` resolves to its Node.js entry, and throws at startup

`qrcode` (used by `react-native-qrcode-styled`) has `"main": "./lib/index.js"` and a `browser` field that replaces
that file with `./lib/browser.js`. Expo's Metro config resolves `react-native`, then `browser`, then `main`, and
applies the replacement: Metro bundles `lib/browser.js` (27 `qrcode` modules). vifx resolves `react-native`, then
`module`, then `main`, and its resolver reads only string main fields, so it bundles the Node.js entry: `lib/server.js`
with its PNG and terminal renderers (35 `qrcode` modules) and `pngjs` (22 modules, none in Metro's bundle).
`pngjs` requires `util`, `stream` and `zlib`, which vifx replaces with an empty module (`__vite-browser-external`,
`module.exports = {}`), and calls `util.inherits(...)` as it loads: a TypeError.

The app loads it at startup. In vifx's development export, which keeps the module structure readable,
`src/components/dialogs/nuxs/InviteFriendsAnnouncement.tsx` runs at the top level of the bundle, and its imports run
`inviteFriends` → `InviteFriendsDialog` → `InviteFriendsDialogInner` → `ThemedQrCard` → `react-native-qrcode-styled`
→ `qrcode/lib/index.js` → `lib/server.js` → `lib/renderer/png.js` → `pngjs`. The release bundle holds the same
modules. Adding `browser` to `resolver.mainFields` would not help: vifx's resolver skips a `browser` field that maps
files. An alias from `qrcode` to `qrcode/lib/browser.js` would sidestep this one package (not tried).

### Worklets bundle mode is not implemented

The app turns on react-native-worklets bundle mode in four places:

- `babel.config.js`: the worklets Babel plugin with `bundleMode: true`. Each worklet is written to its own module
  under `node_modules/react-native-worklets/.worklets/`, and `globalThis._WORKLETS_BUNDLE_MODE_ENABLED` is set to
  `true` in worklets' own sources.
- `metro.config.ts`: `getBundleModeMetroConfig`. Those modules get their hash as Metro module id, a polyfill
  (`prepareBundleMode.js`) runs before the first module so the native side can start early, and `react-native` goes
  through a shim.
- Two pnpm patches: `metro` (a SHA-1 for the generated `.worklets/*` files) and `metro-runtime` (Fast Refresh updates
  forwarded to the worklet runtimes).

In bundle mode, the UI runtime evaluates the bundle too, and each worklet is looked up by its module id through
Metro's `__r`. vifx runs the app's Babel config on the app's sources, `react-native-worklets` and
`react-native-reanimated`, so their worklets are compiled for bundle mode and the flag is set: worklets starts in
bundle mode. Other libraries (`react-native-gesture-handler`, for one) go through `babel-preset-expo`, which adds the
worklets plugin without the option, so their worklets keep the legacy form, with their code in `__initData`. vifx's
release bundle mixes the two: 748 bundle-mode worklet modules (Metro's has 958) and 231 `__initData` references
(Metro's has 12). The module ids, the polyfill and the shim are Metro config, which vifx does not run, and its output
defines no `__r`. vifx's stand-in for worklets' unpacker then falls back to `__initData`, which bundle-mode worklets
do not have, and throws (`Vifx could not resolve a Worklets bundle-mode worklet without Metro __r.`). The app's own
worklets (Reanimated animations, gesture callbacks on the UI thread) are not expected to run.

### Sentry's Metro integration is not applied

`metro.config.ts` builds on `getSentryExpoConfig`. Nothing here stops the app, but the bundles differ:

- Metro's bundle ends with a Sentry Debug ID (`//# debugId=…`); vifx's has none, so Sentry cannot match its source
  maps by Debug ID.
- On iOS and Android, Sentry's `resolveRequest` replaces `@sentry/replay`, `@sentry-internal/feedback` and the
  server-only modules of `@sentry/core` with empty modules. vifx bundles them: 69 `@sentry/replay` modules,
  27 feedback modules, `rrweb`, and AI and MCP integrations of `@sentry/core` (30 modules under `mcp-server`,
  `tracing/openai` and the like), none of which are in Metro's bundle.
- Sentry's Babel transformer, which adds component names for `annotateReactComponents`, does not run.

The app's own `resolveRequest` acts only on web (and with `BSKY_PROFILE`), so it changes nothing in these bundles.

## Reading the numbers

- **Cold builds are a quarter faster with vifx** (28.3 → 21.2 s release, 25.0 → 18.8 s development), and its dev
  server answers within about a second from any start.
- **Warm builds are where Metro leads on this app**: 6.1 s against 7.6 s for a release bundle; development bundles
  are level (5.8 and 5.9 s). In a profiled run (`--profile`), vifx spent 3.0 s of an 8.0 s warm release build building
  the module graph (15.0 of 21.2 s cold). The rest is start-up and what follows the graph: rendering, minifying and
  writing a 26 MB bundle and a 72 MB source map, on every build, while Metro keeps each module's minified code in its
  cache. Development bundles are not minified, and there the two tools are level.
- **Fast Refresh is slower with vifx here** (0.28 against 0.17 s), the reverse of the template app (0.05 against
  0.13 s). A new full bundle is also slower (0.81 against 0.71 s). A warm restart serves the first bundle in about the
  same time (6.2 and 6.4 s).
- **vifx's release bundle is 20 % smaller and its bytecode 4.6 % smaller**, the first app where vifx's bytecode is
  smaller (+3.6 % on the template, +3.9 % on the private app). Given the differences above (library worklets in legacy
  form, Sentry's web modules included, `qrcode`'s Node.js entry), the size figures do not compare like with like.
- **Memory**: vifx peaks lower on cold builds (−14 % release, −3 % development) and higher on warm ones (+52 %,
  +32 %).

## Hermes

The app's `hermesc` (`hermes-compiler` 260318099.0.4) exited at once whenever the harness started it through
`/usr/bin/time` (`time: command terminated abnormally`, `time: signal: Invalid argument`), so the generated report has
no Hermes figures and reports both tools' dev bundles and patches as rejected. Started directly, the same compiler
compiled both release bundles with `hermesc -emit-binary -O`; the bytecode sizes above come from that, and the compile
times are the median of 3 runs. It also accepted both tools' served dev bundles and their Fast Refresh patches,
compiled without `-O` as the harness does.

## Setting up

### Installing the app

`pnpm install` runs pnpm 11.28.5 and Node 24.22.1, which the app pins in `devEngines`, and its `postinstall` runs the
codegen (`lexicons:generate`, `intl:compile`) that both bundlers need. In the shell this run used, every process pnpm
started for a lifecycle script was killed (`Killed: 9`, exit code 137): the `@sentry/cli` binary download,
`unrs-resolver`'s check, and the app's own codegen. The Vite+ `pnpm` shim was killed inside the app's directory too.
The app was installed with `--ignore-scripts`, and the codegen run with the Node it pins (from the app's directory,
`node` being `node_modules/node/bin/node`):

```bash
node node_modules/.bin/lex build --clear --index-file --import-ext '' --lexicons lexicons --out src/lexicons
node node_modules/@lingui/cli/dist/lingui-compile.js --config lingui.config.ts
```

Neither skipped dependency script is needed to bundle.

### vifx's setup and CLI

`vifx setup --yes --expo-go` wrote a working `vifx.config.ts` (entry `./index.ts`). Three gaps showed up:

- **No Metro migration notes.** vifx 0.2.0's `doctor` and `setup` only looked for `metro.config.{js,cjs,mjs}`, and
  Bluesky's is `metro.config.ts`. Fixed on this branch: they now read `.ts`, `.cts` and `.mts` the way Metro does, and
  name worklets bundle mode. On this app `vifx doctor` now reports bundle mode and Sentry's serializer as unsupported,
  and Sentry's Babel transformer and the custom `resolveRequest` as settings to port.
- **No aliases.** `setup` reads `tsconfig.json` as strict JSON, and Bluesky's has comments, so its `paths` were
  ignored without a word. No effect here (the app's Babel config resolves `#/` itself), and read as JSONC its
  type-only `paths` (`.d.ts` targets) would become runtime aliases, so this is left as is.
- **The Lingui macro looks for its config from the current directory.** Run from another directory,
  `vifx export:embed <app>` fails with `No Lingui config found` (`Lingui was unable to find a config!`). The harness
  runs both tools from the app's directory, as `expo export:embed` always does.

### The harness

With this app's Expo CLI (58.1.15), `expo start --localhost` listened on `[::1]` only, and the harness waited for it
on `127.0.0.1`. It now tries both loopback addresses.

## Reproduce

From a clone of the vifx repository:

```bash
vp install
vp run build
git clone --depth 1 --branch 1.137.0 https://github.com/bluesky-social/social-app.git ../social-app
pnpm --dir ../social-app install --frozen-lockfile
node packages/cli/dist/bin.mjs setup ../social-app --yes --expo-go
pnpm bench:expo --project ../social-app --runs 3 --platforms ios --entry ./index.ts --edit-file src/view/screens/Home.tsx
node scripts/bench/compare-sources.mjs \
  .bench/social-app/embed/ios-release/metro/main.jsbundle.map \
  .bench/social-app/embed/ios-release/vifx/main.jsbundle.map
```

Raw results (`results.json`, `report.md`, the bundles and maps) are written to `.bench/social-app/`, which is
git-ignored.
