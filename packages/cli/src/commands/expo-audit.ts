import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import {
  evaluateExpoNoMetroContract,
  startExpoUpdatesServer,
  writeExpoExport,
} from "@vifx/expo-export";
import type { VifxExpoUpdatesServer } from "@vifx/expo-export";
import { startExpoDevServer } from "@vifx/vite-plugin-expo";
import type { VifxExpoDevServer } from "@vifx/vite-plugin-expo";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type {
  VifxBundlePlatform,
  VifxBundleTargetConfig,
  VifxExpoNoMetroWorkflowReport,
} from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

export const EXPO_HELP = `Usage:
  vifx expo audit [path] [--export-root <dir>] [--supported-sdk <sdk>] [--json]
  vifx expo dev [path] [--platform ios|android] [--config <file>] [--host <host>] [--port <number>] [--json]
  vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--updates-url <url>] [--runtime-version <version>] [--created-at <timestamp>] [--json]
  vifx expo serve [path] [--export-root <dir>] [--host <host>] [--port <number>] [--signing-key <file>] [--signing-key-id <id>] [--signing-alg <alg>] [--json]

Audits the explicit Expo without Metro support contract. This is a support matrix and blocker report, not an Expo CLI replacement.

Options:
  --export-root     Optional existing Expo export directory to inspect.
  --supported-sdk   Fixture-backed Expo SDK range to report against. Default: 54.
  --json            Output machine-readable JSON.
  --help            Show this message.
`;

const DEFAULT_EXPO_DEV_HOST = "127.0.0.1";
const DEFAULT_EXPO_DEV_PORT = 5173;
const DEFAULT_EXPO_UPDATES_HOST = "127.0.0.1";
const DEFAULT_EXPO_UPDATES_PORT = 8081;

const EXPO_DEV_HELP = `Usage: vifx expo dev [path] [--platform ios|android] [--config <file>] [--host <host>] [--port <number>] [--json]

Starts a Vite-powered Expo browser preview server for a configured web-compatible Expo target.

Options:
  --platform  Restrict the dev server to one platform target.
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the local dev server to. Default: 127.0.0.1.
  --port      Port to bind the local dev server to. Default: 5173.
  --json      Output machine-readable server details.
  --help      Show this message.
`;

const EXPO_EXPORT_HELP = `Usage: vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--updates-url <url>] [--runtime-version <version>] [--created-at <timestamp>] [--json]

Builds configured Expo Vifx targets and writes an Expo export directory with bundles, source maps, assets, manifest, metadata, and optional Expo Updates v1 manifests.

Options:
  --platform         Restrict the export to one platform. Default: all configured targets.
  --config           Use a specific Vifx config file.
  --out-dir          Export output directory. Default: dist/expo.
  --updates-url      Base URL where exported files will be served for Updates manifests.
  --runtime-version  Runtime version for generated Updates manifests. Requires --updates-url.
  --created-at       ISO timestamp for generated Updates manifests. Defaults to current time.
  --json             Output machine-readable generation results.
  --help             Show this message.
`;

const EXPO_SERVE_HELP = `Usage: vifx expo serve [path] [--export-root <dir>] [--host <host>] [--port <number>] [--signing-key <file>] [--signing-key-id <id>] [--signing-alg <alg>] [--json]

Serves a Vifx-generated Expo export directory using the Expo Updates v1 JSON or multipart manifest request shape.

Options:
  --export-root     Existing generated export directory to serve. Default: dist/expo.
  --host            Hostname to bind the local Updates server to. Default: 127.0.0.1.
  --port            Port to bind the local Updates server to. Default: 8081.
  --signing-key     PEM private key used to sign manifest responses when requested.
  --signing-key-id  Optional key id emitted in the expo-signature header.
  --signing-alg     Signing algorithm to advertise. Currently only rsa-v1_5-sha256.
  --json            Output machine-readable server details.
  --help            Show this message.
`;

interface ExpoBuildResult {
  durationMs: number;
  result: Awaited<ReturnType<typeof buildReactNativeBundle>>;
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

function parseUpdatesServerPort(value: string | boolean | undefined) {
  if (value === undefined) {
    return DEFAULT_EXPO_UPDATES_PORT;
  }

  if (typeof value !== "string") {
    throw new VifxError({
      code: "VIFX_EXPO_UPDATES_SERVER_INVALID_PORT",
      message: "The --port flag expects a numeric value.",
      hint: "Pass --port 8081 or another TCP port number.",
      docsPath: "/reference/cli#vifx-expo-serve",
    });
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new VifxError({
      code: "VIFX_EXPO_UPDATES_SERVER_INVALID_PORT",
      message: `Invalid port "${value}" for vifx expo serve.`,
      hint: "Use a port between 0 and 65535.",
      docsPath: "/reference/cli#vifx-expo-serve",
    });
  }

  return port;
}

function parseSigningAlg(value: string | boolean | undefined) {
  if (value === undefined) {
    return "rsa-v1_5-sha256";
  }

  if (value !== "rsa-v1_5-sha256") {
    throw new VifxError({
      code: "VIFX_EXPO_UPDATES_SIGNING_ALG_UNSUPPORTED",
      message: `Unsupported Expo Updates signing algorithm "${String(value)}".`,
      hint: 'Use the supported algorithm "rsa-v1_5-sha256".',
      docsPath: "/reference/cli#vifx-expo-serve",
    });
  }

  return value;
}

async function resolveSigningOptions(flags: Record<string, string | boolean>) {
  const signingKey = flags["signing-key"];
  const signingKeyId = flags["signing-key-id"];
  const signingAlg = parseSigningAlg(flags["signing-alg"]);

  if (signingKey === undefined && signingKeyId === undefined) {
    return undefined;
  }

  if (typeof signingKey !== "string") {
    throw new VifxError({
      code: "VIFX_EXPO_UPDATES_SIGNING_KEY_MISSING",
      message: "Expo Updates response signing requires --signing-key.",
      hint: "Pass a PEM private key path with --signing-key, or omit all signing flags.",
      docsPath: "/reference/cli#vifx-expo-serve",
    });
  }

  if (signingKeyId !== undefined && typeof signingKeyId !== "string") {
    throw new VifxError({
      code: "VIFX_EXPO_UPDATES_SIGNING_KEY_MISSING",
      message: "The --signing-key-id flag expects a string value.",
      hint: "Pass --signing-key-id root or omit the key id.",
      docsPath: "/reference/cli#vifx-expo-serve",
    });
  }

  return {
    alg: signingAlg,
    keyId: signingKeyId,
    privateKey: await readFile(signingKey, "utf8"),
  };
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

function createServerLifetime(server: VifxExpoUpdatesServer) {
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
      if (!server.server.listening) {
        finish(0);
        return;
      }

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

function resolveUpdatesOptions(
  flags: Record<string, string | boolean>,
): { baseUrl: string; createdAt?: string; runtimeVersion: string } | undefined {
  const updatesUrl = typeof flags["updates-url"] === "string" ? flags["updates-url"] : undefined;
  const runtimeVersion =
    typeof flags["runtime-version"] === "string" ? flags["runtime-version"] : undefined;
  const createdAt = typeof flags["created-at"] === "string" ? flags["created-at"] : undefined;

  if (!updatesUrl && !runtimeVersion && !createdAt) {
    return undefined;
  }

  if (!updatesUrl || !runtimeVersion) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_UPDATES_OPTIONS_MISSING",
      message:
        "Expo Updates manifest generation requires both --updates-url and --runtime-version.",
      hint: "Pass both flags, or omit all Updates flags to generate only export artifacts.",
      docsPath: "/reference/cli#vifx-expo-export",
    });
  }

  const updates: { baseUrl: string; createdAt?: string; runtimeVersion: string } = {
    baseUrl: updatesUrl,
    runtimeVersion,
  };
  if (createdAt) {
    updates.createdAt = createdAt;
  }

  return updates;
}

async function buildExpoTarget(
  target: VifxBundleTargetConfig,
  projectRoot: string,
): Promise<ExpoBuildResult> {
  const startedAt = Date.now();
  const result = await buildReactNativeBundle({
    aliases: target.aliases,
    babelInPackages: target.babelInPackages,
    entry: target.entry,
    env: process.env,
    hermes: target.hermes,
    jsxInPackages: target.jsxInPackages,
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
      "Workflows:",
      report.workflows.map((workflow) => formatWorkflow(workflow)).join("\n\n"),
    ].join("\n"),
    stderr: "",
  };
}

export async function runExpoDevCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["config", "host", "platform", "port"],
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
  if (target.reactNativeCompat !== "web") {
    throw new VifxError({
      code: "VIFX_EXPO_DEV_REQUIRES_WEB_COMPAT",
      message: `Target "${target.platform}" cannot be served by vifx expo dev because reactNativeCompat is not set to "web".`,
      hint: 'Set vite.targets[].reactNativeCompat to "web" for browser dev previews.',
      docsPath: "/reference/config#vite-targets",
    });
  }

  const host = typeof parsed.flags.host === "string" ? parsed.flags.host : DEFAULT_EXPO_DEV_HOST;
  const port = parseExpoDevServerPort(parsed.flags.port);
  const server = await startExpoDevServer({
    aliases: target.aliases,
    appConfigPath: loaded.config.expoOptions.appConfigPath,
    babelInPackages: target.babelInPackages,
    entry: target.entry,
    env: process.env,
    hermes: target.hermes,
    host,
    jsxInPackages: target.jsxInPackages,
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
    stdout: [
      "Vifx Expo Dev",
      "",
      `Config: ${loaded.filePath ?? "inline config"}`,
      `Project root: ${server.projectRoot}`,
      `Platform: ${server.platform}`,
      `URL: ${server.url}`,
      "",
      "Boundary: this is a Vite browser dev server with Vite HMR only; it is not Expo Go, native device runtime parity, or React Native Fast Refresh parity.",
      "Press Ctrl+C to stop the Expo dev server.",
    ].join("\n"),
    stderr: "",
    waitUntilExit,
  };
}

export async function runExpoExportCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["config", "created-at", "out-dir", "platform", "runtime-version", "updates-url"],
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
  const updates = resolveUpdatesOptions(parsed.flags);
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
    builds.push(await buildExpoTarget(target, loaded.config.projectRoot));
  }

  const exportRoot =
    typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined;
  const exportResult = await writeExpoExport({
    bundles: builds.map((build) => build.result),
    projectRoot: loaded.config.projectRoot,
    ...(exportRoot === undefined ? {} : { exportRoot }),
    ...(updates === undefined ? {} : { updates }),
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
      `Updates manifests: ${exportResult.updatesManifests.length}`,
      "",
      "Generated files:",
      ...exportResult.generatedFiles.map(
        (file) => `  - ${file.path}${file.platform ? ` (${file.platform})` : ""}`,
      ),
      "",
      "Boundary: generated output covers Vifx bundles, assets, manifests, metadata, and optional Updates v1 manifests only; Updates serving, response signing, native validation, directives, and EAS parity remain separate work.",
    ].join("\n"),
    stderr: "",
  };
}

export async function runExpoServeCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["export-root", "host", "port", "signing-alg", "signing-key", "signing-key-id"],
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
      stdout: EXPO_SERVE_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const host =
    typeof parsed.flags.host === "string" ? parsed.flags.host : DEFAULT_EXPO_UPDATES_HOST;
  const port = parseUpdatesServerPort(parsed.flags.port);
  const exportRoot =
    typeof parsed.flags["export-root"] === "string" ? parsed.flags["export-root"] : undefined;
  const signing = await resolveSigningOptions(parsed.flags);
  // @ts-expect-error: TypeScript doesn't understand the conditional spreading here, but the runtime behavior is correct.
  const server = await startExpoUpdatesServer({
    host,
    port,
    projectRoot,
    ...(exportRoot === undefined ? {} : { exportRoot }),
    ...(signing === undefined ? {} : { signing }),
  });
  const waitUntilExit = createServerLifetime(server);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          exportRoot: server.exportRoot,
          host: server.host,
          port: server.port,
          projectRoot: server.projectRoot,
          signing: Boolean(signing),
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
    stdout: [
      "Vifx Expo Updates Serve",
      "",
      `Project root: ${server.projectRoot}`,
      `Export root: ${server.exportRoot}`,
      `URL: ${server.url}`,
      `Signing: ${signing ? "enabled when requested" : "disabled"}`,
      "",
      "Manifest requests must include expo-protocol-version: 1, expo-platform, and expo-runtime-version headers.",
      "Press Ctrl+C to stop the Updates server.",
    ].join("\n"),
    stderr: "",
    waitUntilExit,
  };
}
