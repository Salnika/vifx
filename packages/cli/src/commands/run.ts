import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type { VifxBundleTargetConfig } from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const RUNTIME_HTML_FILE = "index.html";

const RUN_HELP = `Usage: vifx run [path] [--platform ios|android] [--config <file>] [--host <host>] [--port <number>] [--no-build] [--verbose] [--json]

Builds a web-compatible Vifx target and serves the generated runtime locally.

Options:
  --platform  Restrict the runtime to one platform target.
  --config    Use a specific Vifx config file.
  --host      Hostname to bind the local runtime server to. Default: 127.0.0.1.
  --port      Port to bind the local runtime server to. Default: 4173.
  --no-build  Reuse an existing runtime build instead of rebuilding first.
  --verbose   Show detailed diagnostic information.
  --json      Output machine-readable server details.
  --help      Show this message.
`;

function validateRequestedPlatform(value: string | undefined) {
  if (value === undefined || value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_RUN_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx run.`,
    hint: "Use --platform ios or --platform android.",
    docsPath: "/reference/cli#run",
  });
}

function parsePort(value: string | boolean | undefined) {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (typeof value !== "string") {
    throw new VifxError({
      code: "VIFX_RUN_INVALID_PORT",
      message: "The --port flag expects a numeric value.",
      hint: "Pass --port 4173 or another TCP port number.",
      docsPath: "/reference/cli#run",
    });
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new VifxError({
      code: "VIFX_RUN_INVALID_PORT",
      message: `Invalid port "${value}" for vifx run.`,
      hint: "Use a port between 0 and 65535.",
      docsPath: "/reference/cli#run",
    });
  }

  return port;
}

function resolveTargetOutDir(projectRoot: string, target: VifxBundleTargetConfig) {
  return path.resolve(projectRoot, target.outDir ?? `.vifx/vite/${target.platform}`);
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveServePath(rootDir: string, requestPathname: string) {
  const normalizedPathname = requestPathname === "/" ? `/${RUNTIME_HTML_FILE}` : requestPathname;
  const candidatePath = path.resolve(rootDir, `.${normalizedPathname}`);
  const normalizedRootDir = path.resolve(rootDir);

  if (
    candidatePath !== normalizedRootDir &&
    !candidatePath.startsWith(`${normalizedRootDir}${path.sep}`)
  ) {
    return null;
  }

  if (await pathExists(candidatePath)) {
    const candidateStats = await stat(candidatePath);
    if (candidateStats.isDirectory()) {
      const indexPath = path.join(candidatePath, RUNTIME_HTML_FILE);
      return (await pathExists(indexPath)) ? indexPath : null;
    }

    return candidatePath;
  }

  if (path.extname(normalizedPathname) === "") {
    const fallbackPath = path.join(normalizedRootDir, RUNTIME_HTML_FILE);
    return (await pathExists(fallbackPath)) ? fallbackPath : null;
  }

  return null;
}

function guessContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".bundle":
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html; charset=utf-8";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

async function startRuntimeServer(options: {
  host: string;
  port: number;
  rootDir: string;
}): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          Allow: "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Method Not Allowed");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      const filePath = await resolveServePath(options.rootDir, requestUrl.pathname);

      if (!filePath) {
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Not Found");
        return;
      }

      const fileBuffer = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": guessContentType(filePath),
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      response.end(fileBuffer);
    } catch (error) {
      response.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error instanceof Error ? error.message : "Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, options.host);
  });

  return server;
}

function createServerLifetime(server: Server) {
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
      if (!server.listening) {
        finish(0);
        return;
      }

      server.close(() => finish(0));
    };

    server.once("close", () => finish(0));
    server.once("error", () => finish(1));
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
}

export async function runRunCommand(argv: string[], cwd: string): Promise<CliResult> {
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
      stdout: RUN_HELP,
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

  if (loaded.config.vite.mode === "none" || loaded.config.vite.targets.length === 0) {
    throw new VifxError({
      code: "VIFX_RUN_TARGETS_MISSING",
      message: `No Vifx runtime target is configured in "${loaded.filePath ?? "inline config"}".`,
      hint: "Set vite.mode and at least one vite.targets entry in vifx.config.*.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const matchingTargets =
    requestedPlatform === undefined
      ? loaded.config.vite.targets
      : loaded.config.vite.targets.filter((target) => target.platform === requestedPlatform);

  if (matchingTargets.length === 0) {
    throw new VifxError({
      code: "VIFX_RUN_TARGET_NOT_FOUND",
      message: `No configured Vifx target matched platform "${requestedPlatform}".`,
      hint: "Add a matching vite.targets entry or omit --platform when only one target exists.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  if (matchingTargets.length > 1) {
    throw new VifxError({
      code: "VIFX_RUN_PLATFORM_REQUIRED",
      message: "Multiple Vifx targets are configured for this project.",
      hint: "Pass --platform ios or --platform android to choose which runtime to serve.",
      docsPath: "/reference/cli#run",
    });
  }

  const target = matchingTargets[0]!;
  if (target.reactNativeCompat !== "web") {
    throw new VifxError({
      code: "VIFX_RUN_REQUIRES_WEB_COMPAT",
      message: `Target "${target.platform}" cannot be served because reactNativeCompat is not set to "web".`,
      hint: 'Set vite.targets[].reactNativeCompat to "web" for browser runtime previews.',
      docsPath: "/reference/config#vite-targets",
    });
  }

  const host = typeof parsed.flags.host === "string" ? parsed.flags.host : DEFAULT_HOST;
  const port = parsePort(parsed.flags.port);
  const shouldReuseBuild = parsed.flags["no-build"] === true;
  const outDir = resolveTargetOutDir(loaded.config.projectRoot, target);

  let runtimeHtmlPath = path.join(outDir, RUNTIME_HTML_FILE);
  if (!shouldReuseBuild) {
    const buildResult = await buildReactNativeBundle({
      aliases: target.aliases,
      babelInPackages: target.babelInPackages,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      jsxInPackages: target.jsxInPackages,
      mainFields: loaded.config.resolver.mainFields,
      mode: target.mode,
      moduleFormat: target.moduleFormat,
      outDir: target.outDir,
      platform: target.platform,
      projectRoot: loaded.config.projectRoot,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
      transformCache: target.transformCache,
    });

    if (!buildResult.runtime) {
      throw new VifxError({
        code: "VIFX_RUN_RUNTIME_MISSING",
        message: `Target "${target.platform}" did not emit a browser runtime.`,
        hint: 'Enable reactNativeCompat: "web" and rebuild the target.',
        docsPath: "/reference/cli#run",
      });
    }

    runtimeHtmlPath = path.resolve(loaded.config.projectRoot, buildResult.runtime.htmlPath);
  }

  if (!(await pathExists(runtimeHtmlPath))) {
    throw new VifxError({
      code: "VIFX_RUN_RUNTIME_NOT_FOUND",
      message: `Could not find Vifx runtime HTML at "${runtimeHtmlPath}".`,
      hint: shouldReuseBuild
        ? "Run vifx build once before using --no-build."
        : "Ensure the target builds successfully and emits runtime files.",
      docsPath: "/reference/cli#run",
    });
  }

  const server = await startRuntimeServer({
    host,
    port,
    rootDir: outDir,
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${actualPort}`;
  const waitUntilExit = createServerLifetime(server);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          built: !shouldReuseBuild,
          configFile: loaded.filePath,
          host,
          htmlPath: path.relative(loaded.config.projectRoot, runtimeHtmlPath),
          outDir: path.relative(loaded.config.projectRoot, outDir),
          platform: target.platform,
          port: actualPort,
          projectRoot: loaded.config.projectRoot,
          url,
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
      "Vifx Run",
      "",
      `Config: ${loaded.filePath ?? "inline config"}`,
      `Platform: ${target.platform}`,
      `Out dir: ${path.relative(loaded.config.projectRoot, outDir)}`,
      `Runtime: ${path.relative(loaded.config.projectRoot, runtimeHtmlPath)}`,
      `URL: ${url}`,
      `Build: ${shouldReuseBuild ? "reused existing artifacts" : "rebuilt target"}`,
      "",
      "Press Ctrl+C to stop the runtime server.",
    ].join("\n"),
    stderr: "",
    waitUntilExit,
  };
}
