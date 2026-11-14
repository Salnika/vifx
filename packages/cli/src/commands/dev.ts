import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detectProject, loadVifxConfig } from "@vifx/core";
import { VifxError } from "@vifx/errors";
import type { VifxBundlePlatform, VifxBundleTargetConfig } from "@vifx/types";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import { parseFlags } from "../lib/args.ts";
import { loadProjectEnvIntoProcess } from "../lib/env.ts";
import { startMetroDevServer, type VifxMetroDevServer } from "../lib/metro-server.ts";
import { resolverBuildOptions } from "../lib/resolver-options.ts";
import type { CliResult } from "../types.ts";

const DEFAULT_DEV_HOST = "127.0.0.1";
const DEFAULT_METRO_PORT = 8081;

export const DEV_HELP = `Usage: vifx dev [path] [--platform ios|android] [--config <file>] [--host <host>] [--port <number>] [--no-build] [--verbose] [--json]

Starts a Metro-compatible dev server for bare React Native projects.

The server speaks the Metro dev-server conventions used by the React Native
community CLI: GET /status, GET /<entry>.bundle?platform=...&dev=..., the
matching source-map route, POST /symbolicate, and a /message WebSocket channel.

Options:
  --platform  Serve one configured platform target (ios or android).
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the dev server to. Default: 127.0.0.1.
  --port      Port to bind the dev server to. Default: 8081 (falls back to a
              free port unless --port is passed explicitly).
  --no-build  Reuse existing bundle artifacts instead of rebuilding first.
  --verbose   Show detailed diagnostic information.
  --json      Output machine-readable server details.
  --help      Show this message.
`;

function validateRequestedPlatform(value: string | undefined) {
  if (value === undefined || value === "ios" || value === "android") {
    return value as VifxBundlePlatform | undefined;
  }

  throw new VifxError({
    code: "VIFX_DEV_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx dev.`,
    hint: "Use --platform ios or --platform android.",
    docsPath: "/reference/cli#dev",
  });
}

function parsePort(value: string | boolean | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new VifxError({
      code: "VIFX_DEV_INVALID_PORT",
      message: "The --port flag expects a numeric value.",
      hint: "Pass --port 8081 or another TCP port number.",
      docsPath: "/reference/cli#dev",
    });
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new VifxError({
      code: "VIFX_DEV_INVALID_PORT",
      message: `Invalid port "${value}" for vifx dev.`,
      hint: "Use a port between 0 and 65535.",
      docsPath: "/reference/cli#dev",
    });
  }

  return port;
}

function resolveTargetOutDir(projectRoot: string, target: VifxBundleTargetConfig) {
  return path.resolve(projectRoot, target.outDir ?? `.vifx/vite/${target.platform}`);
}

function resolveEntryBaseName(entry: string) {
  return entry.replace(/^\.\//u, "").replace(/\.(?:cjs|jsx?|mjs|tsx?)$/u, "");
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function createServerLifetime(server: VifxMetroDevServer) {
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

export async function runDevCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json", "no-build"],
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
      stdout: DEV_HELP,
      stderr: "",
    };
  }

  const requestedPlatform = validateRequestedPlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const project = await detectProject(projectRoot);

  if (project.projectType === "expo") {
    throw new VifxError({
      code: "VIFX_DEV_REQUIRES_REACT_NATIVE",
      message: `Project "${project.projectRoot}" is an Expo project, which vifx dev does not serve.`,
      hint: `Use vifx expo dev ${parsed.positional[0] ?? "."} --platform ${requestedPlatform ?? "ios"} for Expo projects.`,
      docsPath: "/reference/cli#dev",
    });
  }

  if (project.projectType !== "react-native") {
    throw new VifxError({
      code: "VIFX_DEV_REQUIRES_REACT_NATIVE",
      message: `Project "${project.projectRoot}" was not detected as a bare React Native project (detected "${project.projectType}").`,
      hint: 'Run vifx dev inside a project with a "react-native" dependency in package.json.',
      docsPath: "/reference/cli#dev",
    });
  }

  const loaded = await loadVifxConfig({
    configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
    cwd: projectRoot,
    optional: false,
  });
  const configFile = loaded.configFilePath ?? "inline config";
  await loadProjectEnvIntoProcess(loaded.config.projectRoot, "development");

  if (loaded.config.vite.mode !== "react-native" || loaded.config.vite.targets.length === 0) {
    throw new VifxError({
      code: "VIFX_DEV_TARGETS_MISSING",
      message: `No React Native dev target is configured in "${configFile}".`,
      hint: 'Set vite.mode to "react-native" and add at least one vite.targets entry in vifx.config.*.',
      docsPath: "/reference/config#vite-targets",
    });
  }

  const matchingTargets =
    requestedPlatform === undefined
      ? loaded.config.vite.targets
      : loaded.config.vite.targets.filter((target) => target.platform === requestedPlatform);

  if (matchingTargets.length === 0) {
    throw new VifxError({
      code: "VIFX_DEV_TARGET_NOT_FOUND",
      message: `No configured Vifx target matched platform "${requestedPlatform}".`,
      hint: "Add a matching vite.targets entry or omit --platform when only one target exists.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  if (matchingTargets.length > 1) {
    throw new VifxError({
      code: "VIFX_DEV_PLATFORM_REQUIRED",
      message: "Multiple Vifx targets are configured for this project.",
      hint: "Pass --platform ios or --platform android to choose which target to serve.",
      docsPath: "/reference/cli#dev",
    });
  }

  const target = matchingTargets[0]!;
  const host = typeof parsed.flags.host === "string" ? parsed.flags.host : DEFAULT_DEV_HOST;
  const explicitPort = parsePort(parsed.flags.port);
  const shouldReuseBuild = parsed.flags["no-build"] === true;

  let bundlePath = path.join(
    resolveTargetOutDir(loaded.config.projectRoot, target),
    "index.bundle",
  );
  if (!shouldReuseBuild) {
    const buildResult = await buildReactNativeBundle({
      aliases: target.aliases,
      babelInPackages: target.babelInPackages,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      jsxInPackages: target.jsxInPackages,
      ...resolverBuildOptions(loaded.config.resolver),
      outDir: target.outDir,
      platform: target.platform,
      projectRoot: loaded.config.projectRoot,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
      userViteConfig: loaded.config.vite.userConfigFile,
    });
    bundlePath = path.resolve(loaded.config.projectRoot, buildResult.bundle.path);
  }

  if (!(await pathExists(bundlePath))) {
    throw new VifxError({
      code: "VIFX_DEV_BUNDLE_NOT_FOUND",
      message: `Could not find a Vifx bundle at "${bundlePath}".`,
      hint: shouldReuseBuild
        ? "Run vifx build once before using --no-build."
        : "Ensure the target builds successfully and emits an index.bundle file.",
      docsPath: "/reference/cli#dev",
    });
  }

  const bundleSource = await readFile(bundlePath, "utf8");
  const sourceMapPath = `${bundlePath}.map`;
  const sourceMapSource = (await pathExists(sourceMapPath))
    ? await readFile(sourceMapPath, "utf8")
    : null;

  const server = await startMetroDevServer({
    bundleBaseNames: [resolveEntryBaseName(target.entry)],
    bundleSource,
    host,
    onRequest: (line) => process.stderr.write(`[vifx dev] ${line}\n`),
    platform: target.platform,
    port: explicitPort ?? DEFAULT_METRO_PORT,
    projectRoot: loaded.config.projectRoot,
    sourceMapPath: sourceMapSource !== null ? sourceMapPath : null,
    sourceMapSource,
    strictPort: explicitPort !== undefined,
  });
  const waitUntilExit = createServerLifetime(server);

  if (parsed.flags.json) {
    return {
      close: () => server.close(),
      exitCode: 0,
      stdout: JSON.stringify(
        {
          bundleUrl: server.bundleUrl,
          platform: server.platform,
          projectRoot: server.projectRoot,
          sourceMapUrl: server.sourceMapUrl,
          statusUrl: server.statusUrl,
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
    close: () => server.close(),
    exitCode: 0,
    stdout: [
      "Vifx Dev (Metro-compatible)",
      "",
      `Config: ${configFile}`,
      `Platform: ${server.platform}`,
      `Project root: ${server.projectRoot}`,
      `Bundle: ${path.relative(loaded.config.projectRoot, bundlePath)}`,
      `URL: ${server.url}`,
      `Bundle URL: ${server.bundleUrl}`,
      `Source map URL: ${server.sourceMapUrl ?? "missing"}`,
      `Status URL: ${server.statusUrl}`,
      `Message socket: ${server.messageSocketUrl}`,
      `Build: ${shouldReuseBuild ? "reused existing artifacts" : "rebuilt target"}`,
      "",
      "Press Ctrl+C to stop the dev server.",
    ].join("\n"),
    stderr: "",
    waitUntilExit,
  };
}
