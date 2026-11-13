# Dev Server and Fast Refresh

`vifx expo dev --expo-go` serves an Expo app to Expo Go without Metro: the manifest, the bundle and its source map, assets, `/symbolicate`, `/status`, React Native DevTools, and the `/message`, `/events` and `/hot` WebSockets. In development, Fast Refresh is on by default: each save is compiled into a patch and applied in the running app, which keeps component state.

Without `--expo-go`, `vifx expo dev` serves a react-native-web preview in the browser instead (see [Web preview](#web-preview)). Bare React Native projects use [`vifx dev`](/reference/cli#vifx-dev), which serves a built bundle without file watching or Fast Refresh.

## Start the server

```sh
npx vifx expo dev . --expo-go --platform ios
```

The server listens before it bundles. The URLs and the QR code are printed at once, `/status` answers right away, and every other request waits until the first bundle is built. Scan the QR code with Expo Go, or open the printed `exp://` URL on a simulator, for example with `xcrun simctl openurl booted exp://192.168.1.10:5173` on iOS.

The banner lists the project and config paths, the local, Expo Go, manifest and bundle URLs, the WebSocket and inspector URLs, and a `Refresh` line: `Fast Refresh` when saves are applied in place, `reload only` when each save reloads the app.

One server serves one platform. When the config has both an iOS and an Android target, pass `--platform`, and start a second server on another port for the other platform:

```sh
npx vifx expo dev . --expo-go --platform android --port 5174
```

With `--expo-go` the server binds `0.0.0.0`, and the URLs it prints carry the machine's LAN address, so a device on the same network can load the app. Set `--public-host` (or `REACT_NATIVE_PACKAGER_HOSTNAME`) when the device must use another address.

Vifx writes the dev bundle under `.vifx/` in the project, next to its transform cache. That directory does not belong in version control.

### Flags

| Flag                      | Default                                           | What it does                                                                                                                          |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--expo-go`               | off                                               | Serve the native Expo Go manifest and bundle. Without it, `vifx expo dev` serves the browser preview.                                 |
| `--platform ios\|android` | —                                                 | Target to serve. Required when the config has more than one target.                                                                   |
| `--host <host>`           | `0.0.0.0` with `--expo-go`, otherwise `127.0.0.1` | Hostname to bind.                                                                                                                     |
| `--public-host <host>`    | —                                                 | Hostname or LAN IP written into the Expo Go URLs when it differs from `--host`.                                                       |
| `--port <number>`         | `5173`                                            | Port to bind.                                                                                                                         |
| `--config <file>`         | —                                                 | Use a specific Vifx config file.                                                                                                      |
| `--json`                  | off                                               | Print NDJSON on stdout: a server snapshot, then one report per save. See [JSON reports](#json-reports).                               |
| `--fast-refresh`          | off                                               | Serve the Metro module-registry format instead of the dev engine. Experimental; see [Registry format](#registry-format-fast-refresh). |

### Keys

In an interactive terminal, and without `--json`, the server reads single keys:

```text
Keys: r reload  m dev menu  j devtools  o editor  ? all
```

| Key                | Action                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `r`                | Reload the app.                                                     |
| `m`                | Open the dev menu in the app.                                       |
| `j`                | Open React Native DevTools for the connected app (requires Hermes). |
| `o`                | Open the project in `$EXPO_EDITOR` or `$EDITOR`.                    |
| `?`                | List the keys.                                                      |
| `Ctrl+C`, `Ctrl+D` | Stop the server.                                                    |

## How Fast Refresh works

In development, with the default `hoisted` module format, the server runs Rolldown's dev engine (`dev()` from `vite/rolldown/experimental`) with the same plugins, defines and resolution as a regular development build.

1. The first build produces the whole development bundle, scope-hoisted, with a small runtime in front of it.
2. The engine keeps the module graph in memory. When you save, it compiles only the changed modules into a patch, and the server sends the patch to each connected app over the `/hot` WebSocket.
3. The app evaluates the patch, re-runs the modules it has to, and tells the server what it did. The terminal prints one line for the save.
4. The full bundle is rebuilt in the background, so the next reload gets the current code without waiting for a build.

The runtime in the app is Rolldown's dev runtime ported to ES5, so that Hermes parses it as is. It applies Metro's Fast Refresh rules:

- A module whose exports are all React components is a refresh boundary. Editing it updates its components in place and keeps their state.
- Any other edited module re-runs together with its importers, up to the nearest boundary. When the modules that re-run create a React context, the state below that context is reset, as with Metro.
- When an edit propagates up to a module that no running module imports (the entry file, for example) without meeting a boundary, there is no boundary and the app reloads. A dependency cycle on the way, or a boundary whose exports are no longer all components, also reloads the app.

Project files are compiled with `react-refresh/babel`; files under `node_modules` are not. Changing an asset file (an image or a font) rebuilds the bundle and reloads the app.

## What the terminal prints

Each save prints one line, once the app has applied it:

```text
fast refresh  app/(tabs)/index.tsx  36ms
fast refresh  src/api/endpoints.ts  48ms  (32 modules re-run)
reload  index.js  52ms  — No root boundary: nothing that ran imports index.js
```

- `fast refresh`: the app applied the edit in place. `(N modules re-run)` is added when the edit propagated beyond the edited file.
- `reload`: the app had to reload, followed by the reason, for example `No root boundary: …`, `The dev server restarted`, or `No app is connected for Fast Refresh` (no app had the `/hot` connection open, so the server reloaded the apps once the bundle included the change).
- When one save touched several files, the line names the first one and counts the others: `src/a.ts (+2)`.

The time runs from the moment the file watcher saw the save to the moment the app reported the update applied. It is left out when the update cannot be tied to a save seen in the previous two seconds. If no app answers within 1.5 seconds, the line is printed without waiting longer.

### App logs

The app's `console.*` calls are printed in the terminal, the way Expo CLI prints them:

```text
 LOG  feed loaded 30
 WARN  Possible unhandled promise rejection
 ERROR  Network request failed
```

React Native's startup line (`Running "main" with …`) is left out. Logs travel over the `/hot` connection, so they are printed with the dev engine and with `--fast-refresh`, not in the [rebuild-and-reload loop](#rebuild-and-reload-loop). With `--json` they are not printed, so that stdout only carries reports.

### Compile errors

A save that does not compile prints `update failed`, then the cause of the error and its code frame, once:

```text
update failed
SyntaxError: /Users/me/my-app/app/(tabs)/index.tsx: Unexpected token (45:17)

  44 |   const [feed, setFeed] = useState("top");
> 45 |   const broken = ;
     |                  ^
```

The app shows React Native's own "Failed to compile" / "Syntax Error" screen with the same code frame. The server keeps serving the last bundle that built, so a reload in the meantime still starts the app. The error screen is cleared as soon as a save that compiles is applied, and the app keeps its state.

If the project does not compile when the server starts, the terminal prints the error after `The Expo Go bundle failed to build; it will be built again on the next save.`, and requests other than `/status` answer with the error (HTTP 500). The next save builds again; apps that were waiting are told to reload once that build succeeds.

## Reconnects and restarts

The app keeps its `/hot` connection open and reconnects by itself when it drops, for example when the server restarts or the device goes to sleep. It retries with a delay that grows up to 5 seconds.

On reconnect, the app tells the server which server process built its bundle and how many saves the bundle includes. If the server restarted in the meantime, or the app missed a save while it was disconnected, the server tells the app that its bundle is stale, and the app reloads itself:

```text
reload  — The dev server restarted
```

Reconnects belong to the dev engine. The [registry format](#registry-format-fast-refresh) does not reconnect.

## Settings

| Setting                  | Effect                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `VIFX_DEV_ENGINE=0`      | Use the [rebuild-and-reload loop](#rebuild-and-reload-loop) instead of the dev engine.                                |
| `devEngine: false`       | The same, for code that calls `startExpoGoDevServer` from `@vifx/vite-plugin-expo`. It is not a `vifx.config.ts` key. |
| `VIFX_BABEL_WORKERS=<n>` | Maximum number of [Babel worker threads](#babel-worker-threads). `0` disables them.                                   |
| `--fast-refresh`         | Serve the [registry format](#registry-format-fast-refresh) instead of the dev engine.                                 |

### Rebuild-and-reload loop

With `VIFX_DEV_ENGINE=0`, each save rebuilds the whole bundle and reloads the app. The server also falls back to this loop by itself when the dev engine cannot start, and says so with `The incremental dev engine could not start; using full rebuilds instead.`, followed by the cause.

In this loop the app does not open the `/hot` connection: there is no Fast Refresh, no app log in the terminal and no reconnect. The per-save line keeps the older `~Nms  transform …  apply …` shape, and with the default `hoisted` format only the `apply` step (telling the app to reload) is measured.

### Babel worker threads

Babel transforms that miss the transform cache run on worker threads when there are many of them, as in a cold build. A single transform, such as the one a save triggers, stays on the main thread. Each worker loads the project's own `@babel/core`.

`VIFX_BABEL_WORKERS` sets the maximum number of threads. The default is the number of CPU cores minus one, capped at 8; `0` runs every transform on the main thread. The setting applies to every command that bundles, not only to the dev server.

### Registry format (`--fast-refresh`)

`--fast-refresh` serves the Metro module-registry format (`moduleFormat: "metro"`, the `__d`/`__r` layout) instead of the dev engine. It is the earlier, experimental Fast Refresh path: each save rebuilds the whole bundle, the changed module factories are sent over `/hot` in Metro's update protocol, and a deleted module reloads the app. It only applies with `--expo-go`.

Its per-save line breaks the rebuild down by phase and shows the transform-cache hit rate of that save alone:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

`transform` is the Vite/Rolldown build (Babel and bundling run in one call), `serialize` assembles the module registry and its source map, `write` writes the bundle, the map and the assets, and `apply` diffs the modules and sends the update. `cache` is `hits/(hits+misses)` for that save.

This path was not re-validated in Expo Go after the dev engine became the default.

## JSON reports

With `--json`, stdout is NDJSON:

```sh
npx vifx expo dev . --expo-go --platform ios --json > saves.ndjson
```

The first line is a snapshot of the server. Among other fields, it has the URLs (`url`, `expoGoUrl`, `manifestUrl`, `bundleUrl`, `sourceMapUrl`, `hotSocketUrl`, `messageSocketUrl`, `eventsSocketUrl`, `inspectorProxyUrl`), `host`, `hostUri`, `port`, `platform`, `projectRoot`, `configFile`, `fastRefresh` and `hmr` (`"fast-refresh"` or `"reload"`). Each following line is one `VifxRebuildReport`, one per save:

```json
{
  "cycle": 1,
  "engine": true,
  "phases": { "transformMs": 36.4, "serializeMs": 0, "writeMs": 0, "totalMs": 36.4 },
  "changedPaths": ["app/(tabs)/index.tsx"],
  "hmr": "fast-refresh",
  "moduleCount": 1
}
```

Reports from the dev engine carry `engine: true` and these fields:

| Field            | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `cycle`          | Report counter, starting at 1.                                                                            |
| `hmr`            | `"fast-refresh"` (applied in place), `"reload"` (the app reloaded) or `"error"`.                          |
| `changedPaths`   | The files of the save, relative to the project.                                                           |
| `moduleCount`    | The number of modules the app re-ran for the save.                                                        |
| `reason`         | Why the app reloaded.                                                                                     |
| `error`          | The cause of the error and its code frame: a save that did not compile, or a patch the app could not run. |
| `phases.totalMs` | Milliseconds from the save being seen to the update being applied; `0` when it cannot be tied to a save.  |

The other `phases` fields carry no breakdown on the dev engine, and there is no `cache` field. The transform/serialize/write breakdown and the per-save `cache` statistics are measured on the [registry format](#registry-format-fast-refresh), where `moduleCount` is the number of modules in the bundle. The [rebuild-and-reload loop](#rebuild-and-reload-loop) reports `0` for those phases on the default format.

## Web preview

Without `--expo-go`, `vifx expo dev` serves the app in the browser through react-native-web and a Vite dev server. The selected target must set `reactNativeCompat: "web"`:

```sh
npx vifx expo dev . --platform ios
```

The browser preview uses Vite's own update mechanism; the Fast Refresh described on this page belongs to the Expo Go server.

## Limitations

- Stack frames inside a hot-patched module are not yet symbolicated against the patch's own source map.
- `/symbolicate` returns frames only, without a code frame, so LogBox shows no source snippet for a runtime error.
- The dev engine was validated in Expo Go on an iOS simulator with one app. Android was not exercised.
- Expo Go was seen crashing on some full reloads of an app that opens an expo-sqlite database with an FTS5 table (a native crash in expo-sqlite's `closeDatabase`). Whether the same reloads crash under Metro has not been checked yet.
- One server serves one platform, and there is no tunnel and no key to open a simulator.

See [Project Status](/guide/status) for the full list of known gaps.
