import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const BUILD_HELP = `Usage: vifx build [path] [--platform ios|android|all] [--config <file>] [--verbose] [--json]

Builds the configured Vifx bundle targets from vifx.config.*.

Options:
  --platform  Restrict the build to one platform. Default: all configured targets.
  --config    Use a specific Vifx config file.
  --verbose   Show detailed diagnostic information.
  --json      Output machine-readable build results.
  --help      Show this message.
`;

interface BuildResult {
  durationMs: number;
  result: Awaited<ReturnType<typeof buildReactNativeBundle>>;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(2)} kB`;
  }

  return `${sizeBytes} B`;
}

function validateRequestedPlatform(value: string | undefined) {
  if (value === undefined || value === "all" || value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_BUILD_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx build.`,
    hint: "Use --platform ios, --platform android, or --platform all.",
    docsPath: "/reference/cli#build",
  });
}

function formatBuildResult(build: BuildResult) {
  const { result } = build;

  return [
    `[${result.platform}]`,
    `  Entry: ${result.entry}`,
    `  Bundle: ${result.bundle.path} (${formatBytes(result.bundle.sizeBytes)})`,
    `  Assets: ${result.assets.length}`,
    result.runtime
      ? `  Runtime: ${result.runtime.htmlPath} (served with vifx run)`
      : "  Runtime: unavailable",
    result.sourceMap
      ? `  Source map: ${result.sourceMap.path} (${result.sourceMap.valid ? "valid" : "invalid"}, ${result.sourceMap.sourceCount} sources)`
      : "  Source map: missing",
    `  Duration: ${build.durationMs} ms`,
  ].join("\n");
}

export async function runBuildCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["config", "platform"],
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
      stdout: BUILD_HELP,
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
      code: "VIFX_BUILD_TARGETS_MISSING",
      message: `No Vifx build targets are configured in "${loaded.filePath ?? "inline config"}".`,
      hint: "Set vite.mode and at least one vite.targets entry in vifx.config.*.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const targets =
    requestedPlatform && requestedPlatform !== "all"
      ? loaded.config.vite.targets.filter((target) => target.platform === requestedPlatform)
      : loaded.config.vite.targets;

  if (targets.length === 0) {
    throw new VifxError({
      code: "VIFX_BUILD_TARGET_NOT_FOUND",
      message: `No configured Vifx target matched platform "${requestedPlatform}".`,
      hint: "Add a matching vite.targets entry or omit --platform to build all configured targets.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const results: BuildResult[] = [];
  for (const target of targets) {
    const startedAt = Date.now();
    const result = await buildReactNativeBundle({
      aliases: target.aliases,
      babelInPackages: target.babelInPackages,
      compatPreview: target.compatPreview,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      jsxInPackages: target.jsxInPackages,
      mainFields: loaded.config.resolver.mainFields,
      outDir: target.outDir,
      platform: target.platform,
      projectRoot: loaded.config.projectRoot,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
    });
    results.push({
      durationMs: Date.now() - startedAt,
      result,
    });
  }

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          configFile: loaded.filePath,
          mode: loaded.config.vite.mode,
          projectRoot: loaded.config.projectRoot,
          results,
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
      "Vifx Build",
      "",
      `Config: ${loaded.filePath ?? "inline config"}`,
      `Mode: ${loaded.config.vite.mode}`,
      `Project root: ${loaded.config.projectRoot}`,
      "",
      results.map((result) => formatBuildResult(result)).join("\n\n"),
    ].join("\n"),
    stderr: "",
  };
}
