import { spawn } from "node:child_process";
import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { startExpoDevServer, startExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxRebuildReport } from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import { loadProjectEnvIntoProcess } from "../lib/env.ts";
import type { CliResult } from "../types.ts";
import {
  DEFAULT_EXPO_DEV_HOST,
  DEFAULT_EXPO_GO_DEV_HOST,
  createExpoDevServerLifetime,
  createExpoGoDevServerLifetime,
  formatClientLog,
  formatExpoDevServerOutput,
  formatExpoGoServerOutput,
  formatRebuildReport,
  parseExpoDevServerPort,
  selectSingleExpoTarget,
  validateRequestedDevPlatform,
} from "./expo-shared.ts";

const EXPO_DEV_HELP = `Usage: vifx expo dev [path] [--platform ios|android] [--expo-go] [--fast-refresh] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--json]

Starts a Vite-powered Expo dev server. By default this serves the bounded browser preview path; --expo-go starts the native Expo Go manifest and bundle server.

Options:
  --platform  Restrict the dev server to one platform target.
  --expo-go   Serve an Expo Go compatible native manifest and Vifx bundle URL.
  --fast-refresh  Use the older Metro-format (module registry) bundle for Fast Refresh instead of the default Rolldown dev engine, which already has Fast Refresh (experimental). Requires --expo-go.
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the local dev server to. Default: 127.0.0.1, or 0.0.0.0 with --expo-go.
  --public-host  Hostname or LAN IP emitted in Expo Go URLs when it differs from --host.
  --port      Port to bind the local dev server to. Default: 5173.
  --json      Output machine-readable server details.
  --help      Show this message.
`;

export const EXPO_GO_DEV_KEY_HINT = "Keys: r reload  m dev menu  j devtools  o editor  ? all";
export const EXPO_GO_DEV_KEYS_HELP = [
  "Expo Go commands:",
  "  r  reload the app",
  "  m  open the dev menu",
  "  j  open React Native DevTools",
  "  o  open the project in your editor ($EXPO_EDITOR / $EDITOR)",
  "  ?  show this help",
].join("\n");
const CTRL_C_BYTE = 0x03;
const CTRL_D_BYTE = 0x04;
const DEVTOOLS_OPEN_PATHNAME = "/open-debugger";

/**
 * Opens React Native DevTools (Fusebox) for the most recently connected debug
 * target by POSTing to the dev server's own `/open-debugger` endpoint, served by
 * `@react-native/dev-middleware`. The middleware selects the target and launches
 * the DevTools browser window itself, so this works cross-platform without the
 * CLI spawning a browser.
 *
 * The request is sent over loopback (`127.0.0.1`) so binding to `0.0.0.0` or a
 * `--public-host` never affects the self-call. A `404` means no Hermes debug
 * target is connected yet (the app must be running on a device/simulator first).
 *
 * Exported for unit testing; not part of the public CLI surface.
 */
export function openReactNativeDevTools(server: VifxExpoGoDevServer): void {
  if (typeof server.port !== "number" || !server.inspectorProxyUrl) {
    process.stdout.write(
      "React Native DevTools unavailable: this server has no inspector proxy.\n",
    );
    return;
  }

  void fetch(`http://127.0.0.1:${server.port}${DEVTOOLS_OPEN_PATHNAME}`, { method: "POST" })
    .then((response) => {
      if (response.status === 404) {
        process.stdout.write(
          "No debug target connected. Open or reload the app on your device (Hermes required), then press j again.\n",
        );
      } else if (!response.ok) {
        process.stdout.write(`Could not open React Native DevTools (HTTP ${response.status}).\n`);
      }
      // 200 → dev-middleware is launching the DevTools window.
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`Could not open React Native DevTools: ${message}\n`);
    });
}

/**
 * Opens the project in the user's editor (`$EXPO_EDITOR` or `$EDITOR`),
 * mirroring the `o` binding of `expo start`. No-op with a hint when no editor
 * is configured.
 *
 * Exported for unit testing; not part of the public CLI surface.
 */
export function openProjectInEditor(server: VifxExpoGoDevServer): void {
  const editor = process.env.EXPO_EDITOR ?? process.env.EDITOR;
  if (!editor) {
    process.stdout.write(
      "No editor configured: set $EDITOR (or $EXPO_EDITOR) to open the project with o.\n",
    );
    return;
  }

  const target = server.projectRoot ?? process.cwd();
  try {
    const child = spawn(editor, [target], { detached: true, stdio: "ignore" });
    child.once("error", (error) => {
      process.stdout.write(`Could not open the editor "${editor}": ${error.message}\n`);
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`Could not open the editor "${editor}": ${message}\n`);
  }
}

export interface AttachExpoGoDevKeysOptions {
  /**
   * Injectable RN DevTools opener. Defaults to {@link openReactNativeDevTools};
   * tests pass a spy so the `j` binding can be asserted without a live server.
   */
  openDevTools?: (server: VifxExpoGoDevServer) => void;
  /**
   * Injectable editor opener. Defaults to {@link openProjectInEditor}; tests pass
   * a spy so the `o` binding can be asserted without spawning a process.
   */
  openEditor?: (server: VifxExpoGoDevServer) => void;
}

/**
 * Wires TTY keybindings for the Expo Go dev server. Returns a cleanup function
 * that detaches the listener and restores the terminal mode. Returns undefined
 * when no interactive TTY is available so callers skip the hint line.
 *
 * Exported for unit testing; not part of the public CLI surface.
 */
export function attachExpoGoDevKeys(
  server: VifxExpoGoDevServer,
  options: AttachExpoGoDevKeysOptions = {},
): (() => void) | undefined {
  const stdin = process.stdin;
  const broadcast = server.broadcast;
  if (broadcast === undefined || !stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return undefined;
  }

  const openDevTools = options.openDevTools ?? openReactNativeDevTools;
  const openEditor = options.openEditor ?? openProjectInEditor;

  const onKey = (chunk: Buffer) => {
    // Ctrl+C and Ctrl+D forward to the standard SIGINT path so raw mode never
    // swallows the interrupt that stops the dev server.
    if (chunk.length === 1 && (chunk[0] === CTRL_C_BYTE || chunk[0] === CTRL_D_BYTE)) {
      process.kill(process.pid, "SIGINT");
      return;
    }

    const key = chunk.toString("utf8");

    if (key === "r") {
      broadcast("reload");
      return;
    }

    if (key === "m") {
      broadcast("devMenu");
      return;
    }

    if (key === "j") {
      openDevTools(server);
      return;
    }

    if (key === "o") {
      openEditor(server);
      return;
    }

    if (key === "?") {
      process.stdout.write(`${EXPO_GO_DEV_KEYS_HELP}\n`);
    }
  };

  const previousRawMode = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onKey);

  return () => {
    stdin.off("data", onKey);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(previousRawMode);
    }
    stdin.pause();
  };
}

export async function runExpoDevCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["expo-go", "fast-refresh", "help", "json"],
    stringFlags: ["config", "host", "platform", "port", "public-host"],
    aliases: {
      "-h": "--help",
    },
  });

  if (parsed.errors.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: parsed.errors.join("\n"),
    };
  }

  if (parsed.flags.help) {
    return {
      exitCode: 0,
      stdout: EXPO_DEV_HELP,
      stderr: "",
    };
  }

  const requestedPlatform = validateRequestedDevPlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const loaded = await loadVifxConfig({
    configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
    cwd: projectRoot,
    optional: false,
  });

  if (loaded.config.vite.mode !== "expo") {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_REQUIRES_EXPO_MODE",
      message: `vifx expo dev requires vite.mode "expo" in "${loaded.filePath ?? "inline config"}".`,
      hint: "Run this command only for configured Expo Vifx targets.",
      docsPath: "/reference/config#vite-mode",
    });
  }

  if (loaded.config.vite.targets.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_TARGETS_MISSING",
      message: `No Expo Vifx dev target is configured in "${loaded.filePath ?? "inline config"}".`,
      hint: "Set vite.mode to expo and add at least one vite.targets entry.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const target = selectSingleExpoTarget(loaded.config.vite.targets, requestedPlatform);
  await loadProjectEnvIntoProcess(loaded.config.projectRoot, "development");
  if (!parsed.flags["expo-go"] && target.reactNativeCompat !== "web") {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_REQUIRES_WEB_COMPAT",
      message: `Target "${target.platform}" cannot be served by vifx expo dev because reactNativeCompat is not set to "web".`,
      hint: 'Set vite.targets[].reactNativeCompat to "web" for browser dev previews, or pass --expo-go for the native Expo Go server.',
      docsPath: "/reference/config#vite-targets",
    });
  }

  const host =
    typeof parsed.flags.host === "string"
      ? parsed.flags.host
      : parsed.flags["expo-go"]
        ? DEFAULT_EXPO_GO_DEV_HOST
        : DEFAULT_EXPO_DEV_HOST;
  const publicHost =
    typeof parsed.flags["public-host"] === "string" ? parsed.flags["public-host"] : undefined;
  const port = parseExpoDevServerPort(parsed.flags.port);
  // --fast-refresh forces the metro module format, which the Expo Go dev server
  // requires to serve a state-preserving Fast Refresh bundle; otherwise honor
  // the target's configured moduleFormat (default hoisted = full reload).
  const moduleFormat = parsed.flags["fast-refresh"] ? "metro" : target.moduleFormat;
  if (parsed.flags["expo-go"]) {
    // Per-cycle rebuild instrumentation. In --json mode each rebuild emits one
    // compact NDJSON line; in terminal mode it emits the one-line breakdown.
    // Written straight to stdout because rebuilds happen after the command has
    // already returned its initial output and is parked in waitUntilExit.
    const onRebuild = parsed.flags.json
      ? (report: VifxRebuildReport) => {
          process.stdout.write(`${JSON.stringify(report)}\n`);
        }
      : (report: VifxRebuildReport) => {
          process.stdout.write(`${formatRebuildReport(report)}\n`);
        };

    const server = await startExpoGoDevServer({
      aliases: target.aliases,
      appConfigPath: loaded.config.expoOptions.appConfigPath,
      babelInPackages: target.babelInPackages,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      host,
      jsxInPackages: target.jsxInPackages,
      // Listen first, bundle in the background: the URLs print at once and the
      // first request waits for the bundle, like `expo start`.
      lazyStart: true,
      mainFields: loaded.config.resolver.mainFields,
      mode: "development",
      moduleFormat,
      // App console output, as `expo start` prints it. Kept out of --json
      // mode, whose stdout is one rebuild report per line.
      onClientLog: parsed.flags.json
        ? undefined
        : (log) => {
            process.stdout.write(`${formatClientLog(log)}\n`);
          },
      onRebuild,
      platform: target.platform,
      port,
      projectRoot: loaded.config.projectRoot,
      publicHost,
      publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
      userViteConfig: loaded.config.vite.userConfigFile,
    });

    if (parsed.flags.json) {
      const waitUntilExit = createExpoGoDevServerLifetime(server);

      // Compact single line so the stdout stream stays pure NDJSON: this initial
      // dev-server snapshot is line 1, and every subsequent rebuild (via
      // onRebuild) appends one more line. A pretty-printed multi-line blob here
      // would make the stream unparseable line-by-line.
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          bundleUrl: server.bundleUrl,
          configFile: loaded.filePath,
          ...(server.devClientUrl === undefined ? {} : { devClientUrl: server.devClientUrl }),
          eventsSocketUrl: server.eventsSocketUrl,
          expoGoUrl: server.expoGoUrl,
          fastRefresh: server.fastRefresh,
          hmr: server.hmr,
          host: server.host,
          hostUri: server.hostUri,
          hotSocketUrl: server.hotSocketUrl,
          inspectorProxyUrl: server.inspectorProxyUrl ?? null,
          manifestUrl: server.manifestUrl,
          messageSocketUrl: server.messageSocketUrl,
          metro: server.metro,
          nativeRuntime: server.nativeRuntime,
          platform: server.platform,
          port: server.port,
          projectRoot: server.projectRoot,
          sourceMapUrl: server.sourceMapUrl,
          url: server.url,
          watching: server.watching,
        }),
        stderr: "",
        waitUntilExit,
      };
    }

    const detachKeys = attachExpoGoDevKeys(server);
    const waitUntilExit = createExpoGoDevServerLifetime(server, detachKeys);

    return {
      exitCode: 0,
      stdout: formatExpoGoServerOutput({
        configFile: loaded.filePath,
        server,
        ...(detachKeys ? { keyHint: EXPO_GO_DEV_KEY_HINT } : {}),
      }),
      stderr: "",
      waitUntilExit,
    };
  }

  const server = await startExpoDevServer({
    aliases: target.aliases,
    appConfigPath: loaded.config.expoOptions.appConfigPath,
    babelInPackages: target.babelInPackages,
    entry: target.entry,
    env: process.env,
    hermes: target.hermes,
    host,
    jsxInPackages: target.jsxInPackages,
    mainFields: loaded.config.resolver.mainFields,
    mode: "development",
    outDir: target.outDir,
    platform: target.platform,
    port,
    projectRoot: loaded.config.projectRoot,
    publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
    reactNativeCompat: target.reactNativeCompat,
    shimJsxRuntime: target.shimJsxRuntime,
    shimReact: target.shimReact,
    shimReactNative: target.shimReactNative,
    userViteConfig: loaded.config.vite.userConfigFile,
  });
  const waitUntilExit = createExpoDevServerLifetime(server);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          configFile: loaded.filePath,
          fastRefresh: server.fastRefresh,
          hmr: server.hmr,
          host: server.host,
          nativeRuntime: server.nativeRuntime,
          platform: server.platform,
          port: server.port,
          projectRoot: server.projectRoot,
          url: server.url,
        },
        null,
        2,
      ),
      stderr: "",
      waitUntilExit,
    };
  }

  return {
    exitCode: 0,
    stdout: formatExpoDevServerOutput({ configFile: loaded.filePath, server }),
    stderr: "",
    waitUntilExit,
  };
}
