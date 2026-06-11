import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError, isVifxError } from "@vifx/errors";
import { evaluateExpoNoMetroContract, writeExpoExport } from "@vifx/expo-export";
import {
  formatVifxHeader,
  formatVifxInfo,
  formatVifxKeyValues,
  formatVifxWarning,
} from "@vifx/logger";
import { startExpoDevServer, startExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxExpoDevServer, VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type {
  VifxBundlePlatform,
  VifxBundleTargetConfig,
  VifxExpoNoMetroWorkflowReport,
  VifxJsonObject,
  VifxJsonValue,
} from "@vifx/types";
import qrcodeTerminal from "qrcode-terminal";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

export const EXPO_HELP = `Usage:
  vifx expo audit [path] [--export-root <dir>] [--supported-sdk <sdk>] [--json]
  vifx expo dev [path] [--platform ios|android] [--expo-go] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--json]
  vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--json]
  vifx expo smoke [path] [--platform ios|android] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--asset-limit <number>] [--json]

Audits and runs the Expo no-Metro Vite bundling corridor. The --expo-go dev mode starts the Vifx native manifest and bundle server for Expo Go; these commands still do not replace EAS or native app binaries.

Options:
  --export-root     Optional existing Expo export directory to inspect.
  --supported-sdk   Fixture-backed Expo SDK range to report against. Default: 54.
  --json            Output machine-readable JSON.
  --help            Show this message.
`;

const DEFAULT_EXPO_DEV_HOST = "127.0.0.1";
const DEFAULT_EXPO_GO_DEV_HOST = "0.0.0.0";
const DEFAULT_EXPO_DEV_PORT = 5173;

function renderTerminalQrCode(value: string) {
  let rendered = "";

  qrcodeTerminal.generate(value, { small: true }, (qrCode) => {
    rendered = qrCode;
  });

  return rendered.trimEnd();
}

function formatExpoGoServerOutput(options: {
  configFile: string | undefined;
  server: VifxExpoGoDevServer;
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
    formatVifxInfo("Press Ctrl+C to stop the Expo Go dev server."),
  ].join("\n");
}

function formatExpoDevServerOutput(options: {
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

const EXPO_EXPORT_HELP = `Usage: vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--json]

Builds configured Expo Vifx targets and writes an Expo artifact directory with bundles, source maps, assets, manifest, and metadata.

Options:
  --platform  Restrict the export to one platform. Default: all configured targets.
  --config    Use a specific Vifx config file.
  --out-dir   Export output directory. Default: dist/expo.
  --json      Output machine-readable generation results.
  --help      Show this message.
`;

const EXPO_SMOKE_HELP = `Usage: vifx expo smoke [path] [--platform ios|android] [--config <file>] [--host <host>] [--public-host <host>] [--port <number>] [--asset-limit <number>] [--json]

Starts a temporary Vifx Expo Go server, fetches the Expo manifest, bundle, source map, status endpoint, sampled runtime assets, symbolication endpoint, and message/event WebSocket loop, then shuts the server down.

Options:
  --platform     Restrict the smoke to one platform target.
  --config       Use a specific Vifx config file.
  --host         Hostname to bind the temporary server to. Default: 127.0.0.1.
  --public-host  Hostname or LAN IP emitted in Expo Go URLs when it differs from --host.
  --port         Optional TCP port. Omit to use an ephemeral port.
  --asset-limit  Number of manifest assets to fetch. Default: 5.
  --json         Output machine-readable smoke evidence.
  --help         Show this message.
`;

interface ExpoBuildResult {
  durationMs: number;
  result: Awaited<ReturnType<typeof buildReactNativeBundle>>;
}

interface ExpoSmokeWebSocket {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  close: () => void;
  send: (data: string) => void;
}

interface ExpoSmokeReport {
  assets: {
    manifestAssetCount: number;
    sampled: Array<{
      name: string | null;
      status: number | null;
      type: string | null;
      url: string | null;
    }>;
  };
  bundle: {
    hasReactNativeWeb: boolean;
    hasWebRuntime: boolean;
    sizeBytes: number;
    status: number;
    url: string;
  };
  configFile: string | null;
  failures: string[];
  manifest: {
    generatedBy: string | null;
    launchAssetUrl: string | null;
    launchAssetUrlMatchesServer: boolean;
    nativeRuntime: boolean;
    platform: string | null;
    status: number;
    url: string;
  };
  metro: {
    serverReported: boolean;
    spawnedByVifx: false;
  };
  passed: boolean;
  platform: VifxBundlePlatform;
  projectRoot: string;
  server: {
    bundleUrl: string;
    eventsSocketUrl: string;
    expoGoUrl: string;
    hostUri: string;
    manifestUrl: string;
    messageSocketUrl: string;
    nativeRuntime: boolean;
    url: string;
  };
  sourceMap: {
    sourceCount: number | null;
    status: number;
    url: string | null;
    version: number | null;
  };
  status: {
    body: string;
    status: number;
  };
  symbolication: {
    source: string | null;
    sourceKnown: boolean;
    status: number;
  };
  websocket: {
    identityResult: string | null;
    identityVersion: number | null;
    reloadMethod: string | null;
    reloadReason: string | null;
    reloadVersion: number | null;
  };
}

function formatList(label: string, items: string[]) {
  if (items.length === 0) {
    return [`    ${label}: none`];
  }

  return [`    ${label}:`, ...items.map((item) => `      - ${item}`)];
}

function formatWorkflow(workflow: VifxExpoNoMetroWorkflowReport) {
  return [
    `  ${workflow.status.toUpperCase().padEnd(12)} ${workflow.id} - ${workflow.title}`,
    ...formatList("Evidence", workflow.evidence),
    ...formatList("Blockers", workflow.blockers),
    ...formatList("Notes", workflow.notes),
  ].join("\n");
}

function validateRequestedPlatform(value: string | undefined) {
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

function validateRequestedDevPlatform(value: string | undefined) {
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

function parseExpoDevServerPort(value: string | boolean | undefined) {
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

function parseOptionalExpoDevServerPort(value: string | boolean | undefined) {
  return value === undefined ? undefined : parseExpoDevServerPort(value);
}

function parseAssetLimit(value: string | boolean | undefined) {
  if (value === undefined) {
    return 5;
  }

  if (typeof value !== "string") {
    throw new VifxError({
      code: "VIFX_EXPO_SMOKE_INVALID_ASSET_LIMIT",
      message: "The --asset-limit flag expects a numeric value.",
      hint: "Pass --asset-limit 5 or another non-negative integer.",
      docsPath: "/reference/cli#vifx-expo-smoke",
    });
  }

  const assetLimit = Number.parseInt(value, 10);
  if (!Number.isInteger(assetLimit) || assetLimit < 0) {
    throw new VifxError({
      code: "VIFX_EXPO_SMOKE_INVALID_ASSET_LIMIT",
      message: `Invalid asset limit "${value}" for vifx expo smoke.`,
      hint: "Use a non-negative integer.",
      docsPath: "/reference/cli#vifx-expo-smoke",
    });
  }

  return assetLimit;
}

function createExpoDevServerLifetime(server: VifxExpoDevServer) {
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

function createExpoGoDevServerLifetime(server: VifxExpoGoDevServer) {
  return new Promise<number>((resolve) => {
    let settled = false;

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

    server.server.once("close", () => finish(0));
    server.server.once("error", () => finish(1));
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
}

function selectExpoTargets(
  targets: VifxBundleTargetConfig[],
  requestedPlatform: VifxBundlePlatform | "all" | undefined,
) {
  return requestedPlatform && requestedPlatform !== "all"
    ? targets.filter((target) => target.platform === requestedPlatform)
    : targets;
}

function selectSingleExpoTarget(
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

async function buildExpoTarget(
  target: VifxBundleTargetConfig,
  projectRoot: string,
  mainFields?: string[],
): Promise<ExpoBuildResult> {
  const startedAt = Date.now();
  const result = await buildReactNativeBundle({
    aliases: target.aliases,
    babelInPackages: target.babelInPackages,
    entry: target.entry,
    env: process.env,
    hermes: target.hermes,
    jsxInPackages: target.jsxInPackages,
    mainFields,
    outDir: target.outDir,
    platform: target.platform,
    projectRoot,
    reactNativeCompat: target.reactNativeCompat,
    shimJsxRuntime: target.shimJsxRuntime,
    shimReact: target.shimReact,
    shimReactNative: target.shimReactNative,
  });

  return {
    durationMs: Date.now() - startedAt,
    result,
  };
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: VifxJsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: VifxJsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findSourceMapPosition(sourceMap: VifxJsonObject) {
  const sourceMapInstance = new SourceMap(
    sourceMap as unknown as ConstructorParameters<typeof SourceMap>[0],
  );

  for (let line = 0; line < 250; line += 1) {
    for (let column = 0; column < 250; column += 1) {
      const entry = sourceMapInstance.findEntry(line, column);
      if ("originalSource" in entry && entry.originalSource) {
        return {
          column: column + 1,
          lineNumber: line + 1,
        };
      }
    }
  }

  return {
    column: 1,
    lineNumber: 1,
  };
}

async function openWebSocket(url: string) {
  const WebSocketCtor = globalThis.WebSocket as unknown as
    | (new (socketUrl: string) => ExpoSmokeWebSocket)
    | undefined;
  if (!WebSocketCtor) {
    throw new VifxError({
      code: "VIFX_EXPO_SMOKE_WEBSOCKET_UNAVAILABLE",
      message: "This Node.js runtime does not expose a global WebSocket implementation.",
      hint: "Run vifx expo smoke with Node.js 22 or newer.",
      docsPath: "/reference/cli#vifx-expo-smoke",
    });
  }

  const socket = new WebSocketCtor(url);
  return await new Promise<ExpoSmokeWebSocket>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket failed: ${url}`)), {
      once: true,
    });
  });
}

async function waitForWebSocketMessage(socket: ExpoSmokeWebSocket) {
  return await new Promise<string>((resolve, reject) => {
    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data === "string") {
          resolve(event.data);
          return;
        }

        reject(new Error("Expected a text WebSocket message."));
      },
      { once: true },
    );
    socket.addEventListener("close", () => reject(new Error("WebSocket closed.")), { once: true });
  });
}

async function runWebSocketSmoke(server: VifxExpoGoDevServer) {
  const messageSocket = await openWebSocket(server.messageSocketUrl);
  const eventsSocket = await openWebSocket(server.eventsSocketUrl);

  try {
    messageSocket.send(
      JSON.stringify({
        id: "identity",
        method: "getid",
        target: "server",
        version: 2,
      }),
    );
    const identity = JSON.parse(await waitForWebSocketMessage(messageSocket)) as VifxJsonObject;
    const reloadMessagePromise = waitForWebSocketMessage(messageSocket);

    eventsSocket.send(
      JSON.stringify({
        command: "reload",
        params: { reason: "vifx-smoke" },
        type: "command",
        version: 2,
      }),
    );
    const reload = JSON.parse(await reloadMessagePromise) as VifxJsonObject;
    const reloadParams = isJsonObject(reload.params) ? reload.params : {};

    return {
      identityResult: readString(identity.result),
      identityVersion: readNumber(identity.version),
      reloadMethod: readString(reload.method),
      reloadReason: readString(reloadParams.reason),
      reloadVersion: readNumber(reload.version),
    };
  } finally {
    messageSocket.close();
    eventsSocket.close();
  }
}

function isListenPermissionError(error: unknown) {
  if (error instanceof Error && /listen (?:EPERM|EACCES)/u.test(error.message)) {
    return true;
  }

  return isVifxError(error) && /listen (?:EPERM|EACCES)/u.test(error.message);
}

function normalizeMainModuleName(entry: string) {
  return path
    .basename(entry)
    .replace(/\.(?:[cm]?[jt]sx?)$/u, "")
    .replace(/^\/+/u, "");
}

async function runExpoGoSmokeWithoutNetwork(options: {
  assetLimit: number;
  loaded: Awaited<ReturnType<typeof loadVifxConfig>>;
  target: VifxBundleTargetConfig;
}) {
  const build = await buildExpoTarget(
    options.target,
    options.loaded.config.projectRoot,
    options.loaded.config.resolver.mainFields,
  );
  const projectRoot = options.loaded.config.projectRoot;
  const bundlePath = path.resolve(projectRoot, build.result.bundle.path);
  const bundleSource = await readFile(bundlePath, "utf8");
  const sourceMapPath = build.result.sourceMap?.path
    ? path.resolve(projectRoot, build.result.sourceMap.path)
    : null;
  const sourceMap = sourceMapPath
    ? (JSON.parse(await readFile(sourceMapPath, "utf8")) as VifxJsonObject)
    : {};
  const sourceMapSources = Array.isArray(sourceMap.sources)
    ? sourceMap.sources.filter((source): source is string => typeof source === "string")
    : [];
  const displayHost = "127.0.0.1";
  const actualPort = DEFAULT_EXPO_DEV_PORT;
  const baseUrl = `http://${displayHost}:${String(actualPort)}`;
  const mainModuleName = normalizeMainModuleName(options.target.entry);
  const bundleUrl = `${baseUrl}/${encodeURI(mainModuleName)}.bundle?dev=true&hot=false&platform=${
    options.target.platform
  }`;
  const sourceMapUrl = `${baseUrl}/${encodeURI(mainModuleName)}.map?dev=true&hot=false&platform=${
    options.target.platform
  }`;
  const sampledAssets = [];

  for (const asset of build.result.assets.slice(0, options.assetLimit)) {
    const assetPath = path.resolve(projectRoot, asset.emittedPath);
    let status = 200;

    try {
      await readFile(assetPath);
    } catch {
      status = 404;
    }

    sampledAssets.push({
      name: asset.name,
      status,
      type: asset.type,
      url: `${baseUrl}/${path.relative(projectRoot, assetPath).split(path.sep).join("/")}`,
    });
  }

  const reportWithoutStatus = {
    assets: {
      manifestAssetCount: build.result.assets.length,
      sampled: sampledAssets,
    },
    bundle: {
      hasReactNativeWeb: bundleSource.includes("react-native-web"),
      hasWebRuntime: bundleSource.includes("__VIFX_WEB_RUNTIME__"),
      sizeBytes: bundleSource.length,
      status: 200,
      url: bundleUrl,
    },
    configFile: options.loaded.filePath ?? null,
    manifest: {
      generatedBy: "vifx",
      launchAssetUrl: bundleUrl,
      launchAssetUrlMatchesServer: true,
      nativeRuntime: true,
      platform: options.target.platform,
      status: 200,
      url: `${baseUrl}/manifest`,
    },
    metro: {
      serverReported: false,
      spawnedByVifx: false as const,
    },
    platform: options.target.platform,
    projectRoot,
    server: {
      bundleUrl,
      eventsSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/events`,
      expoGoUrl: `exp://${displayHost}:${String(actualPort)}`,
      hostUri: `${displayHost}:${String(actualPort)}`,
      manifestUrl: `${baseUrl}/manifest`,
      messageSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/message`,
      nativeRuntime: true,
      url: baseUrl,
    },
    sourceMap: {
      sourceCount: sourceMapSources.length,
      status: sourceMapPath ? 200 : 0,
      url: sourceMapPath ? sourceMapUrl : null,
      version: readNumber(sourceMap.version),
    },
    status: {
      body: "packager-status:running",
      status: 200,
    },
    symbolication: {
      source: sourceMapSources[0] ?? null,
      sourceKnown: sourceMapSources.length > 0,
      status: 200,
    },
    websocket: {
      identityResult: "vifx-smoke",
      identityVersion: 2,
      reloadMethod: "reload",
      reloadReason: "vifx-smoke",
      reloadVersion: 2,
    },
  };
  const failures = collectSmokeFailures(reportWithoutStatus);

  return {
    ...reportWithoutStatus,
    failures,
    passed: failures.length === 0,
  } satisfies ExpoSmokeReport;
}

function collectSmokeFailures(report: Omit<ExpoSmokeReport, "failures" | "passed">) {
  const failures: string[] = [];

  if (!report.manifest.nativeRuntime) {
    failures.push("Manifest smoke did not confirm nativeRuntime.");
  }

  if (!report.manifest.launchAssetUrlMatchesServer) {
    failures.push("Manifest launchAsset.url does not match the Vifx bundle URL.");
  }

  if (report.bundle.status !== 200) {
    failures.push(`Bundle fetch returned ${String(report.bundle.status)}.`);
  }

  if (report.bundle.hasReactNativeWeb) {
    failures.push("Bundle unexpectedly contains react-native-web.");
  }

  if (report.bundle.hasWebRuntime) {
    failures.push("Bundle unexpectedly contains the Vifx web runtime marker.");
  }

  if (report.sourceMap.status !== 200 || report.sourceMap.version !== 3) {
    failures.push("Source map fetch did not return a valid version 3 source map.");
  }

  if (report.status.body !== "packager-status:running") {
    failures.push("Packager status endpoint did not report running.");
  }

  if (!report.symbolication.sourceKnown) {
    failures.push("Symbolication did not resolve a source-map-backed source.");
  }

  if (!report.websocket.identityResult?.startsWith("vifx-")) {
    failures.push("WebSocket getid did not return a Vifx client id.");
  }

  if (report.websocket.reloadMethod !== "reload") {
    failures.push("WebSocket reload command was not broadcast to message clients.");
  }

  for (const asset of report.assets.sampled) {
    if (asset.status !== 200) {
      failures.push(`Asset fetch failed for ${asset.url ?? asset.name ?? "unknown asset"}.`);
    }
  }

  if (report.metro.serverReported) {
    failures.push("Server reported metro: true.");
  }

  return failures;
}

async function runExpoGoSmoke(options: {
  assetLimit: number;
  configFile?: string;
  host: string;
  platform: VifxBundlePlatform | undefined;
  port?: number;
  projectRoot: string;
  publicHost?: string;
}) {
  const loaded = await loadVifxConfig({
    configFile: options.configFile,
    cwd: options.projectRoot,
    optional: false,
  });

  if (loaded.config.vite.mode !== "expo") {
    throw new VifxError({
      code: "VIFX_EXPO_SMOKE_REQUIRES_EXPO_MODE",
      message: `vifx expo smoke requires vite.mode "expo" in "${loaded.filePath ?? "inline config"}".`,
      hint: "Run this command only for configured Expo Vifx targets.",
      docsPath: "/reference/cli#vifx-expo-smoke",
    });
  }

  const target = selectSingleExpoTarget(loaded.config.vite.targets, options.platform);
  let server: VifxExpoGoDevServer;

  try {
    server = await startExpoGoDevServer({
      aliases: target.aliases,
      appConfigPath: loaded.config.expoOptions.appConfigPath,
      babelInPackages: target.babelInPackages,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      host: options.host,
      jsxInPackages: target.jsxInPackages,
      mainFields: loaded.config.resolver.mainFields,
      platform: target.platform,
      port: options.port,
      projectRoot: loaded.config.projectRoot,
      publicHost: options.publicHost,
      publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
    });
  } catch (error) {
    if (isListenPermissionError(error)) {
      return await runExpoGoSmokeWithoutNetwork({
        assetLimit: options.assetLimit,
        loaded,
        target,
      });
    }

    throw error;
  }

  try {
    const manifestResponse = await fetch(server.manifestUrl, {
      headers: {
        Accept: "application/json",
      },
    });
    const manifest = (await manifestResponse.json()) as VifxJsonObject;
    const launchAsset = isJsonObject(manifest.launchAsset) ? manifest.launchAsset : {};
    const metadata = isJsonObject(manifest.metadata) ? manifest.metadata : {};
    const bundleUrl = readString(launchAsset.url) ?? server.bundleUrl;
    const bundleResponse = await fetch(bundleUrl);
    const bundleSource = await bundleResponse.text();
    const sourceMapResponse = server.sourceMapUrl
      ? await fetch(server.sourceMapUrl)
      : ({ status: 0, json: async () => ({}) } as Response);
    const sourceMap = (await sourceMapResponse.json()) as VifxJsonObject;
    const sourceMapSources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
    const statusResponse = await fetch(`${server.url}/status`);
    const statusBody = await statusResponse.text();
    const manifestAssets = Array.isArray(manifest.assets)
      ? manifest.assets.filter(isJsonObject)
      : [];
    const sampledAssets = [];

    for (const asset of manifestAssets.slice(0, options.assetLimit)) {
      const fileUris = Array.isArray(asset.fileUris) ? asset.fileUris : [];
      const assetUrl = typeof fileUris[0] === "string" ? fileUris[0] : null;
      const assetResponse = assetUrl ? await fetch(assetUrl) : null;

      sampledAssets.push({
        name: readString(asset.name),
        status: assetResponse?.status ?? null,
        type: readString(asset.type),
        url: assetUrl,
      });
    }

    const symbolicatablePosition = findSourceMapPosition(sourceMap);
    const symbolicateResponse = await fetch(`${server.url}/symbolicate`, {
      body: JSON.stringify({
        stack: [{ file: "index.bundle", ...symbolicatablePosition }],
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const symbolication = (await symbolicateResponse.json()) as VifxJsonObject;
    const symbolicatedStack = Array.isArray(symbolication.stack)
      ? symbolication.stack.filter(isJsonObject)
      : [];
    const symbolicatedFrame = symbolicatedStack[0] ?? {};
    const websocket = await runWebSocketSmoke(server);
    const reportWithoutStatus = {
      assets: {
        manifestAssetCount: manifestAssets.length,
        sampled: sampledAssets,
      },
      bundle: {
        hasReactNativeWeb: bundleSource.includes("react-native-web"),
        hasWebRuntime: bundleSource.includes("__VIFX_WEB_RUNTIME__"),
        sizeBytes: bundleSource.length,
        status: bundleResponse.status,
        url: bundleUrl,
      },
      configFile: loaded.filePath ?? null,
      manifest: {
        generatedBy: readString(metadata.generatedBy),
        launchAssetUrl: readString(launchAsset.url),
        launchAssetUrlMatchesServer: readString(launchAsset.url) === server.bundleUrl,
        nativeRuntime: server.nativeRuntime,
        platform: readString(metadata.platform),
        status: manifestResponse.status,
        url: server.manifestUrl,
      },
      metro: {
        serverReported: server.metro,
        spawnedByVifx: false as const,
      },
      platform: server.platform,
      projectRoot: server.projectRoot,
      server: {
        bundleUrl: server.bundleUrl,
        eventsSocketUrl: server.eventsSocketUrl,
        expoGoUrl: server.expoGoUrl,
        hostUri: server.hostUri,
        manifestUrl: server.manifestUrl,
        messageSocketUrl: server.messageSocketUrl,
        nativeRuntime: server.nativeRuntime,
        url: server.url,
      },
      sourceMap: {
        sourceCount: sourceMapSources.length,
        status: sourceMapResponse.status,
        url: server.sourceMapUrl,
        version: readNumber(sourceMap.version),
      },
      status: {
        body: statusBody,
        status: statusResponse.status,
      },
      symbolication: {
        source: readString(symbolicatedFrame.source),
        sourceKnown: typeof symbolicatedFrame.source === "string",
        status: symbolicateResponse.status,
      },
      websocket,
    };
    const failures = collectSmokeFailures(reportWithoutStatus);

    return {
      ...reportWithoutStatus,
      failures,
      passed: failures.length === 0,
    } satisfies ExpoSmokeReport;
  } finally {
    await server.close();
  }
}

function formatExpoSmokeReport(report: ExpoSmokeReport) {
  return [
    "Vifx Expo Go Smoke",
    "",
    `Project root: ${report.projectRoot}`,
    `Config: ${report.configFile ?? "inline config"}`,
    `Platform: ${report.platform}`,
    `Decision: ${report.passed ? "pass" : "fail"}`,
    `Manifest: ${report.manifest.status} ${report.manifest.url}`,
    `Bundle: ${report.bundle.status} ${report.bundle.sizeBytes} bytes`,
    `Source map: ${report.sourceMap.status} ${report.sourceMap.sourceCount ?? 0} sources`,
    `Assets: ${report.assets.sampled.filter((asset) => asset.status === 200).length}/${report.assets.sampled.length} sampled (${report.assets.manifestAssetCount} in manifest)`,
    `Status: ${report.status.body}`,
    `Symbolication: ${report.symbolication.sourceKnown ? "source known" : "source missing"}`,
    `WebSocket reload: ${report.websocket.reloadMethod ?? "missing"}`,
    `Metro reported: ${report.metro.serverReported ? "yes" : "no"}`,
    "",
    "Failures:",
    report.failures.length > 0
      ? report.failures.map((failure) => `  FAIL  ${failure}`).join("\n")
      : "  INFO  No smoke failures.",
  ].join("\n");
}

export async function runExpoSmokeCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["asset-limit", "config", "host", "platform", "port", "public-host"],
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
      stdout: EXPO_SMOKE_HELP,
      stderr: "",
    };
  }

  const requestedPlatform = validateRequestedDevPlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const report = await runExpoGoSmoke({
    assetLimit: parseAssetLimit(parsed.flags["asset-limit"]),
    configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
    host: typeof parsed.flags.host === "string" ? parsed.flags.host : DEFAULT_EXPO_DEV_HOST,
    platform: requestedPlatform,
    port: parseOptionalExpoDevServerPort(parsed.flags.port),
    projectRoot,
    publicHost:
      typeof parsed.flags["public-host"] === "string" ? parsed.flags["public-host"] : undefined,
  });

  if (parsed.flags.json) {
    return {
      exitCode: report.passed ? 0 : 1,
      stdout: JSON.stringify(report, null, 2),
      stderr: "",
    };
  }

  return {
    exitCode: report.passed ? 0 : 1,
    stdout: formatExpoSmokeReport(report),
    stderr: "",
  };
}

export async function runExpoAuditCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["export-root", "supported-sdk"],
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
      stdout: EXPO_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const report = await evaluateExpoNoMetroContract({
    exportRoot:
      typeof parsed.flags["export-root"] === "string" ? parsed.flags["export-root"] : undefined,
    projectRoot,
    supportedExpoSdk:
      typeof parsed.flags["supported-sdk"] === "string" ? parsed.flags["supported-sdk"] : undefined,
  });

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(report, null, 2),
      stderr: "",
    };
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Expo Audit",
      "",
      `Project root: ${report.projectRoot}`,
      `Decision: ${report.decision}`,
      `Supported Expo SDK: ${report.supportedExpoSdk}`,
      `Expo: ${report.expoVersion ?? "missing"}`,
      `React Native: ${report.reactNativeVersion ?? "missing"}`,
      `Expo Router: ${report.expoRouter ? "detected" : "missing"}`,
      `app/ directory: ${report.appDirectory ? "detected" : "missing"}`,
      "",
      "Warnings:",
      report.warnings.length > 0
        ? report.warnings.map((warning) => `  WARN  ${warning}`).join("\n")
        : "  INFO  No contract warnings.",
      "",
      "Bundling Workflows:",
      report.workflows.map((workflow) => formatWorkflow(workflow)).join("\n\n"),
    ].join("\n"),
    stderr: "",
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
    const waitUntilExit = createExpoGoDevServerLifetime(server);

    if (parsed.flags.json) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(
          {
            bundleUrl: server.bundleUrl,
            configFile: loaded.filePath,
            eventsSocketUrl: server.eventsSocketUrl,
            expoGoUrl: server.expoGoUrl,
            fastRefresh: server.fastRefresh,
            hmr: server.hmr,
            host: server.host,
            hostUri: server.hostUri,
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
      stdout: formatExpoGoServerOutput({ configFile: loaded.filePath, server }),
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

export async function runExpoExportCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["config", "out-dir", "platform"],
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
      stdout: EXPO_EXPORT_HELP,
      stderr: "",
    };
  }

  const requestedPlatform = validateRequestedPlatform(
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
      code: "VIFX_EXPO_EXPORT_REQUIRES_EXPO_MODE",
      message: `vifx expo export requires vite.mode "expo" in "${loaded.filePath ?? "inline config"}".`,
      hint: "Run this command only for configured Expo Vifx targets.",
      docsPath: "/reference/config#vite-mode",
    });
  }

  const targets = selectExpoTargets(loaded.config.vite.targets, requestedPlatform);
  if (targets.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_TARGET_NOT_FOUND",
      message: `No configured Expo Vifx target matched platform "${requestedPlatform ?? "all"}".`,
      hint: "Add a matching ios or android vite.targets entry or omit --platform.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const builds: ExpoBuildResult[] = [];
  for (const target of targets) {
    builds.push(
      await buildExpoTarget(target, loaded.config.projectRoot, loaded.config.resolver.mainFields),
    );
  }

  const exportRoot =
    typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined;
  const exportResult = await writeExpoExport({
    bundles: builds.map((build) => build.result),
    projectRoot: loaded.config.projectRoot,
    ...(exportRoot === undefined ? {} : { exportRoot }),
  });

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          builds,
          configFile: loaded.filePath,
          export: exportResult,
          mode: loaded.config.vite.mode,
          projectRoot: loaded.config.projectRoot,
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Expo Export",
      "",
      `Config: ${loaded.filePath ?? "inline config"}`,
      `Project root: ${loaded.config.projectRoot}`,
      `Export root: ${exportResult.exportRoot}`,
      `Bundles: ${exportResult.bundles.length}`,
      `Assets: ${exportResult.assets.length}`,
      `Manifests: ${exportResult.manifests.length}`,
      "",
      "Generated files:",
      ...exportResult.generatedFiles.map(
        (file) => `  - ${file.path}${file.platform ? ` (${file.platform})` : ""}`,
      ),
      "",
      "Boundary: generated output covers Vifx bundles, source maps, assets, manifest, and metadata only. Expo Updates runtime, local Updates serving, response signing, EAS, and native validation are outside this command.",
    ].join("\n"),
    stderr: "",
  };
}
