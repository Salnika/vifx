import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import {
  diagnoseNativeToolchain,
  prepareNativeArtifacts,
  serializeNativeManifestForJson,
  type NativeToolchainDiagnostics,
  type NativeToolchainCheck,
  type VifxNativeArtifactManifest,
} from "@vifx/native-artifacts";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

export const NATIVE_PREPARE_HELP = `Usage: vifx native prepare [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--json]

Builds configured Vifx targets and prepares native-ready bundle, source-map, Hermes, asset, and manifest files.

Options:
  --platform  Restrict native preparation to one platform. Default: all configured native targets.
  --config    Use a specific Vifx config file.
  --out-dir   Write prepared native artifacts to this directory.
  --json      Output machine-readable preparation results.
  --help      Show this message.
`;

export interface NativePrepareResult {
  manifest: VifxNativeArtifactManifest;
  toolchain: NativeToolchainDiagnostics;
}

export interface NativePrepareTargetsResult {
  configFile: string | null;
  projectRoot: string;
  results: NativePrepareResult[];
}

function validateRequestedPlatform(value: string | undefined) {
  if (value === undefined || value === "all" || value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_NATIVE_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx native prepare.`,
    hint: "Use --platform ios, --platform android, or --platform all.",
    docsPath: "/reference/cli#vifx-native-prepare",
  });
}

function formatNativeResult(result: NativePrepareResult) {
  const { manifest, toolchain } = result;

  return [
    `[${manifest.platform}]`,
    `  Bundle: ${manifest.bundle.outputPath}`,
    manifest.sourceMap ? `  Source map: ${manifest.sourceMap.outputPath}` : "  Source map: missing",
    manifest.hermesBytecode
      ? `  Hermes bytecode: ${manifest.hermesBytecode.outputPath}`
      : "  Hermes bytecode: not emitted",
    `  Assets: ${manifest.assets.length}`,
    `  Manifest: ${manifest.manifestPath}`,
    "  Toolchain diagnostics:",
    ...toolchain.checks.map(
      (check: NativeToolchainCheck) =>
        `    ${check.status.toUpperCase()} ${check.name}: ${check.message}${
          check.hint ? ` Hint: ${check.hint}` : ""
        }`,
    ),
  ].join("\n");
}

function resolvePrepareOutDir(options: {
  baseOutDir?: string;
  platform: string;
  projectRoot: string;
  totalTargets: number;
}) {
  if (!options.baseOutDir) {
    return undefined;
  }

  const outDir =
    options.totalTargets === 1
      ? options.baseOutDir
      : path.join(options.baseOutDir, options.platform);
  return path.isAbsolute(outDir)
    ? outDir
    : path.relative(options.projectRoot, path.resolve(options.projectRoot, outDir));
}

export async function prepareConfiguredNativeTargets(options: {
  configFile?: string;
  outDir?: string;
  platform?: string;
  projectRoot: string;
}): Promise<NativePrepareTargetsResult> {
  const requestedPlatform = validateRequestedPlatform(options.platform);
  const projectRoot = path.resolve(options.projectRoot);
  const loaded = await loadVifxConfig({
    configFile: options.configFile,
    cwd: projectRoot,
    optional: false,
  });

  if (loaded.config.vite.mode === "none" || loaded.config.vite.targets.length === 0) {
    throw new VifxError({
      code: "VIFX_NATIVE_TARGETS_MISSING",
      message: `No Vifx native targets are configured in "${loaded.filePath ?? "inline config"}".`,
      hint: "Set vite.mode and at least one ios or android vite.targets entry in vifx.config.*.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const nativeTargets = loaded.config.vite.targets.filter(
    (target) => target.platform === "ios" || target.platform === "android",
  );
  const targets =
    requestedPlatform && requestedPlatform !== "all"
      ? nativeTargets.filter((target) => target.platform === requestedPlatform)
      : nativeTargets;

  if (targets.length === 0) {
    throw new VifxError({
      code: "VIFX_NATIVE_TARGET_NOT_FOUND",
      message: `No configured Vifx native target matched platform "${requestedPlatform ?? "all"}".`,
      hint: "Add a matching ios or android vite.targets entry before preparing native artifacts.",
      docsPath: "/reference/config#vite-targets",
    });
  }

  const results: NativePrepareResult[] = [];
  for (const target of targets) {
    const artifacts = await buildReactNativeBundle({
      aliases: target.aliases,
      babelInPackages: target.babelInPackages,
      entry: target.entry,
      env: process.env,
      hermes: target.hermes,
      jsxInPackages: target.jsxInPackages,
      outDir: target.outDir,
      platform: target.platform,
      projectRoot: loaded.config.projectRoot,
      reactNativeCompat: target.reactNativeCompat,
      shimJsxRuntime: target.shimJsxRuntime,
      shimReact: target.shimReact,
      shimReactNative: target.shimReactNative,
    });
    const manifest = await prepareNativeArtifacts({
      artifacts,
      outDir: resolvePrepareOutDir({
        baseOutDir: options.outDir,
        platform: target.platform,
        projectRoot: loaded.config.projectRoot,
        totalTargets: targets.length,
      }),
      projectRoot: loaded.config.projectRoot,
    });
    const toolchain = await diagnoseNativeToolchain({
      platform: target.platform,
      projectRoot: loaded.config.projectRoot,
    });
    results.push({
      manifest,
      toolchain,
    });
  }

  return {
    configFile: loaded.filePath ?? null,
    projectRoot: loaded.config.projectRoot,
    results,
  };
}

export async function runNativePrepareCommand(argv: string[], cwd: string): Promise<CliResult> {
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
      stdout: NATIVE_PREPARE_HELP,
      stderr: "",
    };
  }

  const prepared = await prepareConfiguredNativeTargets({
    configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
    outDir: typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined,
    platform: typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
    projectRoot: path.resolve(cwd, parsed.positional[0] ?? "."),
  });

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          configFile: prepared.configFile,
          projectRoot: prepared.projectRoot,
          results: prepared.results.map((result) => ({
            manifest: serializeNativeManifestForJson(result.manifest),
            toolchain: result.toolchain,
          })),
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
      "Vifx Native Prepare",
      "",
      `Config: ${prepared.configFile ?? "inline config"}`,
      `Project root: ${prepared.projectRoot}`,
      "",
      prepared.results.map((result) => formatNativeResult(result)).join("\n\n"),
    ].join("\n"),
    stderr: "",
  };
}
