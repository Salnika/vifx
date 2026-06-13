import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { startExpoDevServer, startExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";
import {
  DEFAULT_EXPO_DEV_HOST,
  DEFAULT_EXPO_GO_DEV_HOST,
  createExpoDevServerLifetime,
  createExpoGoDevServerLifetime,
  formatExpoDevServerOutput,
  formatExpoGoServerOutput,
  parseExpoDevServerPort,
  selectSingleExpoTarget,
  validateRequestedDevPlatform,
} from "./expo-shared.ts";

const EXPO_DEV_HELP = `Usage: vifx expo dev [path] [--platform ios|android] [--expo-go] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--json]

Starts a Vite-powered Expo dev server. By default this serves the bounded browser preview path; --expo-go starts the native Expo Go manifest and bundle server.

Options:
  --platform  Restrict the dev server to one platform target.
  --expo-go   Serve an Expo Go compatible native manifest and Vifx bundle URL.
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the local dev server to. Default: 127.0.0.1, or 0.0.0.0 with --expo-go.
  --public-host  Hostname or LAN IP emitted in Expo Go URLs when it differs from --host.
  --port      Port to bind the local dev server to. Default: 5173.
  --json      Output machine-readable server details.
  --help      Show this message.
`;

export const EXPO_GO_DEV_KEY_HINT = "Keys: r reload  m dev menu";
const CTRL_C_BYTE = 0x03;
const CTRL_D_BYTE = 0x04;

/**
 * Wires TTY keybindings for the Expo Go dev server. Returns a cleanup function
 * that detaches the listener and restores the terminal mode. Returns undefined
 * when no interactive TTY is available so callers skip the hint line.
 *
 * Exported for unit testing; not part of the public CLI surface.
 */
export function attachExpoGoDevKeys(server: VifxExpoGoDevServer): (() => void) | undefined {
  const stdin = process.stdin;
  const broadcast = server.broadcast;
  if (broadcast === undefined || !stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return undefined;
  }

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
    booleanFlags: ["expo-go", "help", "json"],
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
  if (parsed.flags["expo-go"]) {
    const server = await startExpoGoDevServer({
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
      platform: target.platform,
      port,
      projectRoot: loaded.config.projectRoot,
      publicHost,
      publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
    });

    if (parsed.flags.json) {
      const waitUntilExit = createExpoGoDevServerLifetime(server);

      return {
        exitCode: 0,
        stdout: JSON.stringify(
          {
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
          },
          null,
          2,
        ),
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
