import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { evaluateExpoNoMetroContract, writeExpoExport } from "@vifx/expo-export";
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
  vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--json]

Audits and runs the Expo no-Metro Vite bundling corridor. These commands produce or inspect Vifx bundle artifacts; they do not replace Expo CLI, Expo Go, EAS, or app build/run workflows.

Options:
  --export-root     Optional existing Expo export directory to inspect.
  --supported-sdk   Fixture-backed Expo SDK range to report against. Default: 54.
  --json            Output machine-readable JSON.
  --help            Show this message.
`;

const DEFAULT_EXPO_DEV_HOST = "127.0.0.1";
const DEFAULT_EXPO_DEV_PORT = 5173;

const EXPO_DEV_HELP = `Usage: vifx expo dev [path] [--platform ios|android] [--config <file>] [--host <host>] [--port <number>] [--json]

Starts a Vite-powered Expo bundle dev server for a configured web-compatible Expo target.

Options:
  --platform  Restrict the dev server to one platform target.
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the local dev server to. Default: 127.0.0.1.
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
      "Bundling Workflows:",
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
      "Boundary: this is a Vite bundle/dev server for configured Expo targets. It is not Expo CLI, Expo Go, native runtime parity, or React Native Fast Refresh parity.",
      "Press Ctrl+C to stop the Expo dev server.",
    ].join("\n"),
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
    builds.push(await buildExpoTarget(target, loaded.config.projectRoot));
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
