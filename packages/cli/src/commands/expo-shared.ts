import { VifxError, isVifxError } from "@vifx/errors";
import {
  formatVifxHeader,
  formatVifxInfo,
  formatVifxKeyValues,
  formatVifxMuted,
  formatVifxWarning,
} from "@vifx/logger";
import type { VifxExpoDevServer, VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type { VifxBundlePlatform, VifxBundleTargetConfig, VifxRebuildReport } from "@vifx/types";
import qrcodeTerminal from "qrcode-terminal";

export const EXPO_HELP = `Usage:
  vifx expo audit [path] [--export-root <dir>] [--supported-sdk <sdk>] [--json]
  vifx expo dev [path] [--platform ios|android] [--expo-go] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--json]
  vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--json]
  vifx expo smoke [path] [--platform ios|android] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--asset-limit <number>] [--json]

Audits and runs the Expo no-Metro Vite bundling corridor. The --expo-go dev mode starts the Vifx native manifest and bundle server for Expo Go; these commands still do not replace EAS or native app binaries.

Options:
  --export-root     Optional existing Expo export directory to inspect.
  --supported-sdk   Expo SDK range to report against. Default: the support table (54-58).
  --json            Output machine-readable JSON.
  --help            Show this message.
`;

export const DEFAULT_EXPO_DEV_HOST = "127.0.0.1";
export const DEFAULT_EXPO_GO_DEV_HOST = "0.0.0.0";
export const DEFAULT_EXPO_DEV_PORT = 5173;

export interface ExpoBuildResult {
  durationMs: number;
  result: Awaited<ReturnType<typeof buildReactNativeBundle>>;
}

function renderTerminalQrCode(value: string) {
  let rendered = "";

  qrcodeTerminal.generate(value, { small: true }, (qrCode) => {
    rendered = qrCode;
  });

  return rendered.trimEnd();
}

export function formatExpoGoServerOutput(options: {
  configFile: string | undefined;
  server: VifxExpoGoDevServer;
  keyHint?: string;
}) {
  const { server } = options;
  const qrCode = renderTerminalQrCode(server.expoGoUrl);

  return [
    formatVifxHeader("Vifx Expo Go Dev", "Scan the QR code with Expo Go."),
    "",
    qrCode,
    "",
    formatVifxKeyValues([
      { label: "Project", value: server.projectRoot },
      { label: "Config", value: options.configFile ?? "inline config" },
      { label: "Platform", value: server.platform },
      { label: "Local", value: server.url },
      { label: "Expo Go", value: server.expoGoUrl },
      { label: "Manifest", value: server.manifestUrl },
      { label: "Bundle", value: server.bundleUrl },
      { label: "Messages", value: server.messageSocketUrl },
      { label: "Events", value: server.eventsSocketUrl },
      { label: "Inspector", value: server.inspectorProxyUrl },
      { label: "Refresh", value: server.fastRefresh ? "Fast Refresh" : `${server.hmr} only` },
    ]),
    "",
    formatVifxWarning(
      "Boundary: Vifx serves Expo Go manifest and bundle endpoints backed by Vite. It does not replace Expo native runtimes, EAS, or native app binaries.",
    ),
    ...(server.watching && server.hotSocketUrl
      ? [formatVifxInfo(`Watching for changes — hot: ${server.hotSocketUrl}`)]
      : []),
    ...(options.keyHint ? [formatVifxInfo(options.keyHint)] : []),
    formatVifxInfo("Press Ctrl+C to stop the Expo Go dev server."),
  ].join("\n");
}

function roundMs(value: number): number {
  return Math.round(value);
}

/**
 * One-line terminal instrumentation for a dev rebuild cycle, e.g.:
 *
 *   ~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
 *
 * The total is approximate (rounded). `hbcMs` is included only when present
 * (export-flavored builds); dev metro bundles skip Hermes so it is omitted. The
 * cache segment shows this CYCLE's hit-rate and `hits/(hits+misses)`, not the
 * cumulative count. On an error cycle it renders the reason instead.
 */
export function formatRebuildReport(report: VifxRebuildReport): string {
  if (report.hmr === "error") {
    return formatVifxMuted(`rebuild #${String(report.cycle)} failed: ${report.error ?? "unknown"}`);
  }

  const { phases, cache } = report;
  const segments: string[] = [
    `${formatVifxMuted("transform")} ${String(roundMs(phases.transformMs))}`,
    `${formatVifxMuted("serialize")} ${String(roundMs(phases.serializeMs))}`,
    `${formatVifxMuted("write")} ${String(roundMs(phases.writeMs))}`,
  ];
  if (phases.hbcMs !== undefined) {
    segments.push(`${formatVifxMuted("hbc")} ${String(roundMs(phases.hbcMs))}`);
  }
  if (phases.applyMs !== undefined) {
    segments.push(`${formatVifxMuted("apply")} ${String(roundMs(phases.applyMs))}`);
  }
  if (cache) {
    const lookups = cache.hits + cache.misses;
    const percent = Math.round(cache.hitRate * 100);
    segments.push(
      `${formatVifxMuted("cache")} ${String(percent)}% (${String(cache.hits)}/${String(lookups)})`,
    );
  }

  return `~${String(roundMs(phases.totalMs))}ms  ${segments.join("  ")}`;
}

export function formatExpoDevServerOutput(options: {
  configFile: string | undefined;
  server: VifxExpoDevServer;
}) {
  const { server } = options;

  return [
    formatVifxHeader("Vifx Expo Dev", "Browser preview server is ready."),
    "",
    formatVifxKeyValues([
      { label: "Project", value: server.projectRoot },
      { label: "Config", value: options.configFile ?? "inline config" },
      { label: "Platform", value: server.platform },
      { label: "Local", value: server.url },
      { label: "Refresh", value: server.fastRefresh ? "Fast Refresh" : `${server.hmr} only` },
    ]),
    "",
    formatVifxWarning(
      "Boundary: this is a Vite bundle/dev server for configured Expo targets. It is not Expo CLI, Expo Go, native runtime parity, or React Native Fast Refresh parity.",
    ),
    formatVifxInfo("Press Ctrl+C to stop the Expo dev server."),
  ].join("\n");
}

export function validateRequestedPlatform(value: string | undefined) {
  if (value === undefined || value === "all" || value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_EXPO_EXPORT_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx expo export.`,
    hint: "Use --platform ios, --platform android, or --platform all.",
    docsPath: "/reference/cli#vifx-expo-export",
  });
}

export function validateRequestedDevPlatform(value: string | undefined) {
  if (value === undefined || value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_EXPO_DEV_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx expo dev.`,
    hint: "Use --platform ios or --platform android.",
    docsPath: "/reference/cli#vifx-expo-dev",
  });
}

export function parseExpoDevServerPort(value: string | boolean | undefined) {
  if (value === undefined) {
    return DEFAULT_EXPO_DEV_PORT;
  }

  if (typeof value !== "string") {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_INVALID_PORT",
      message: "The --port flag expects a numeric value.",
      hint: "Pass --port 5173 or another TCP port number.",
      docsPath: "/reference/cli#vifx-expo-dev",
    });
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_INVALID_PORT",
      message: `Invalid port "${value}" for vifx expo dev.`,
      hint: "Use a port between 1 and 65535.",
      docsPath: "/reference/cli#vifx-expo-dev",
    });
  }

  return port;
}

export function parseOptionalExpoDevServerPort(value: string | boolean | undefined) {
  return value === undefined ? undefined : parseExpoDevServerPort(value);
}

export function createExpoDevServerLifetime(server: VifxExpoDevServer) {
  return new Promise<number>((resolve) => {
    let settled = false;
    const httpServer = server.server.httpServer;

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }

      settled = true;
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      resolve(exitCode);
    };

    const handleSignal = () => {
      server.close().then(
        () => finish(0),
        () => finish(1),
      );
    };

    if (!httpServer) {
      finish(1);
      return;
    }

    httpServer.once("close", () => finish(0));
    httpServer.once("error", () => finish(1));
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
}

export function createExpoGoDevServerLifetime(server: VifxExpoGoDevServer, onClose?: () => void) {
  return new Promise<number>((resolve) => {
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }

      settled = true;
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      onClose?.();
      resolve(exitCode);
    };

    const handleSignal = () => {
      server.close().then(
        () => finish(0),
        () => finish(1),
      );
    };

    server.server.once("close", () => finish(0));
    server.server.once("error", () => finish(1));
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
}

export function selectExpoTargets(
  targets: VifxBundleTargetConfig[],
  requestedPlatform: VifxBundlePlatform | "all" | undefined,
) {
  return requestedPlatform && requestedPlatform !== "all"
    ? targets.filter((target) => target.platform === requestedPlatform)
    : targets;
}

export function selectSingleExpoTarget(
  targets: VifxBundleTargetConfig[],
  requestedPlatform: VifxBundlePlatform | undefined,
) {
  const matchingTargets =
    requestedPlatform === undefined
      ? targets
      : targets.filter((target) => target.platform === requestedPlatform);

  if (matchingTargets.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_TARGET_NOT_FOUND",
      message: `No configured Expo Vifx target matched platform "${requestedPlatform ?? "all"}".`,
      hint: "Add a matching ios or android vite.targets entry or omit --platform when only one target exists.",
      docsPath: "/reference/cli#vifx-expo-dev",
    });
  }

  if (matchingTargets.length > 1) {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_PLATFORM_REQUIRED",
      message: "Multiple Expo Vifx targets are configured for this project.",
      hint: "Pass --platform ios or --platform android to choose which dev server target to serve.",
      docsPath: "/reference/cli#vifx-expo-dev",
    });
  }

  return matchingTargets[0]!;
}

export async function buildExpoTarget(
  target: VifxBundleTargetConfig,
  projectRoot: string,
  mainFields?: string[],
): Promise<ExpoBuildResult> {
  const startedAt = Date.now();
  const result = await buildReactNativeBundle({
    aliases: target.aliases,
    babelInPackages: target.babelInPackages,
    compatPreview: target.compatPreview,
    entry: target.entry,
    env: process.env,
    hermes: target.hermes,
    jsxInPackages: target.jsxInPackages,
    mainFields,
    mode: target.mode,
    moduleFormat: target.moduleFormat,
    outDir: target.outDir,
    platform: target.platform,
    projectRoot,
    reactNativeCompat: target.reactNativeCompat,
    shimJsxRuntime: target.shimJsxRuntime,
    shimReact: target.shimReact,
    shimReactNative: target.shimReactNative,
    transformCache: target.transformCache,
  });

  return {
    durationMs: Date.now() - startedAt,
    result,
  };
}

export function isListenPermissionError(error: unknown) {
  if (error instanceof Error && /listen (?:EPERM|EACCES)/u.test(error.message)) {
    return true;
  }

  return isVifxError(error) && /listen (?:EPERM|EACCES)/u.test(error.message);
}
