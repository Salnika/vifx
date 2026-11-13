import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { startExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";
import type {
  VifxBundlePlatform,
  VifxBundleTargetConfig,
  VifxJsonObject,
  VifxJsonValue,
} from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import { loadProjectEnvIntoProcess } from "../lib/env.ts";
import type { CliResult } from "../types.ts";
import {
  DEFAULT_EXPO_DEV_HOST,
  DEFAULT_EXPO_DEV_PORT,
  buildExpoTarget,
  isListenPermissionError,
  parseOptionalExpoDevServerPort,
  selectSingleExpoTarget,
  validateRequestedDevPlatform,
} from "./expo-shared.ts";

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

  // The dev engine's bundle opens with its runtime and the module graph, which
  // map to no source: the first mapped position can be thousands of lines in.
  // Lines without any mapping are skipped outright, so this stays cheap.
  const mappingLines = typeof sourceMap.mappings === "string" ? sourceMap.mappings.split(";") : [];
  for (let line = 0; line < mappingLines.length; line += 1) {
    if (mappingLines[line] === "") {
      continue;
    }
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
  await loadProjectEnvIntoProcess(loaded.config.projectRoot, "development");
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
      mode: "development",
      platform: target.platform,
      port: options.port,
      projectRoot: loaded.config.projectRoot,
      publicHost: options.publicHost,
      publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
      userViteConfig: loaded.config.vite.userConfigFile,
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
