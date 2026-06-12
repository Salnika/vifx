import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectAssetGroup, writeProdAssets } from "@vifx/asset-registry";
import type { WriteProdAssetsResult } from "@vifx/asset-registry";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import type {
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxBundleTargetConfig,
} from "@vifx/types";
import { buildExpoBundle } from "@vifx/vite-plugin-expo";
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";
import type { CliResult } from "../types.ts";

const EXPORT_EMBED_HELP = `Usage: vifx export:embed [path] --bundle-output <path> [options]

Builds the release bundle and production asset layout consumed by the Xcode
"Bundle React Native code and images" phase and the Gradle bundle task
(react { bundleCommand = "export:embed" }). The flag surface is compatible
with "npx expo export:embed" and "npx react-native bundle"; unknown flags are
warned about and ignored instead of failing the build.

Options:
  --entry-file <path>        Entry file. Default: the configured target entry or ./index.js.
  --platform <ios|android>   Target platform. Default: ios.
  --dev <true|false>         Development build. Default: true. --dev false requests production semantics.
  --bundle-output <path>     Required. Exact file path to write the bundle to.
  --sourcemap-output <path>  File path to write the bundle source map to.
  --assets-dest <dir>        Directory that receives the production asset layout
                             (Android drawable-<density>/ and raw/, iOS assets/) plus assetmap.json.
  --minify <true|false>      Request bundle minification. Default: matches --dev.
  --reset-cache              Accepted for Metro compatibility. No-op.
  --config <path>            Use a specific Vifx config file.
  --verbose                  Show detailed diagnostic information.
  --json                     Output a machine-readable result.
  --help                     Show this message.

The optional positional path selects the project root. Without it the project
root is resolved upward from the current directory like @vifx/core does.
`;

interface ExportEmbedArgs {
  assetsDest?: string;
  bundleOutput?: string;
  configFile?: string;
  dev: boolean;
  entryFile?: string;
  errors: string[];
  help: boolean;
  json: boolean;
  minify?: boolean;
  platform?: string;
  projectPath?: string;
  resetCache: boolean;
  sourcemapOutput?: string;
  verbose: boolean;
  warnings: string[];
}

type ExportEmbedStringArg =
  | "assetsDest"
  | "bundleOutput"
  | "configFile"
  | "entryFile"
  | "platform"
  | "sourcemapOutput";

const VALUE_FLAGS: Record<string, ExportEmbedStringArg> = {
  "assets-dest": "assetsDest",
  "bundle-output": "bundleOutput",
  config: "configFile",
  "entry-file": "entryFile",
  platform: "platform",
  "sourcemap-output": "sourcemapOutput",
};

// Metro / Expo export:embed flags that take a value and are accepted but have
// no effect in Vifx. Their value is consumed so it never leaks into the
// positional project path.
const IGNORED_VALUE_FLAGS = new Set([
  "asset-catalog-dest",
  "bundle-encoding",
  "config-cmd",
  "max-workers",
  "sourcemap-sources-root",
  "transformer",
  "unstable-transform-profile",
]);

// Metro / Expo export:embed boolean flags that are accepted but have no
// effect in Vifx.
const IGNORED_BOOLEAN_FLAGS = new Set([
  "clear",
  "read-global-cache",
  "sourcemap-use-absolute-path",
]);

const BOOLEAN_VALUE_TOKENS = new Set(["0", "1", "false", "true"]);

function parseBooleanToken(value: string): boolean {
  return value !== "false" && value !== "0";
}

/**
 * Parses the Metro/Expo-compatible export:embed argv. Unknown flags never
 * fail the command: they produce warnings and are skipped (consuming a
 * directly following non-flag token as their value).
 */
export function parseExportEmbedArgs(argv: string[]): ExportEmbedArgs {
  const args: ExportEmbedArgs = {
    dev: true,
    errors: [],
    help: false,
    json: false,
    resetCache: false,
    verbose: false,
    warnings: [],
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }

    if (argument === "-h" || argument === "--help") {
      args.help = true;
      continue;
    }

    if (!argument.startsWith("--")) {
      args.warnings.push(`Ignoring unknown flag ${argument}.`);
      continue;
    }

    const rawFlag = argument.slice(2);
    const separatorIndex = rawFlag.indexOf("=");
    const flagName = separatorIndex === -1 ? rawFlag : rawFlag.slice(0, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : rawFlag.slice(separatorIndex + 1);

    if (flagName === "help") {
      args.help = true;
      continue;
    }

    if (flagName === "json" || flagName === "verbose") {
      args[flagName] = inlineValue === undefined ? true : parseBooleanToken(inlineValue);
      continue;
    }

    if (flagName === "reset-cache") {
      args.resetCache = inlineValue === undefined ? true : parseBooleanToken(inlineValue);
      continue;
    }

    if (flagName === "dev" || flagName === "minify") {
      if (inlineValue !== undefined) {
        args[flagName] = parseBooleanToken(inlineValue);
        continue;
      }

      const nextArgument = argv[index + 1];
      if (nextArgument !== undefined && BOOLEAN_VALUE_TOKENS.has(nextArgument.toLowerCase())) {
        args[flagName] = parseBooleanToken(nextArgument.toLowerCase());
        index += 1;
        continue;
      }

      args[flagName] = true;
      continue;
    }

    const valueTarget = VALUE_FLAGS[flagName];
    if (valueTarget !== undefined) {
      if (inlineValue !== undefined) {
        args[valueTarget] = inlineValue;
        continue;
      }

      const nextArgument = argv[index + 1];
      if (nextArgument === undefined || nextArgument.startsWith("-")) {
        args.errors.push(`Flag --${flagName} requires a value.`);
        continue;
      }

      args[valueTarget] = nextArgument;
      index += 1;
      continue;
    }

    if (IGNORED_VALUE_FLAGS.has(flagName)) {
      let consumed = inlineValue;
      if (consumed === undefined) {
        const nextArgument = argv[index + 1];
        if (nextArgument !== undefined && !nextArgument.startsWith("-")) {
          consumed = nextArgument;
          index += 1;
        }
      }
      args.warnings.push(
        `Flag --${flagName}${consumed === undefined ? "" : ` ${consumed}`} is accepted for Metro compatibility but has no effect in vifx export:embed.`,
      );
      continue;
    }

    if (IGNORED_BOOLEAN_FLAGS.has(flagName)) {
      args.warnings.push(
        `Flag --${flagName} is accepted for Metro compatibility but has no effect in vifx export:embed.`,
      );
      continue;
    }

    let unknownValue = inlineValue;
    if (unknownValue === undefined) {
      const nextArgument = argv[index + 1];
      if (nextArgument !== undefined && !nextArgument.startsWith("-")) {
        unknownValue = nextArgument;
        index += 1;
      }
    }
    args.warnings.push(
      `Ignoring unknown flag --${flagName}${unknownValue === undefined ? "" : ` ${unknownValue}`}.`,
    );
  }

  if (positional.length > 0) {
    args.projectPath = positional[0];
  }

  for (const extra of positional.slice(1)) {
    args.warnings.push(`Ignoring unexpected positional argument "${extra}".`);
  }

  return args;
}

function validatePlatform(value: string | undefined): VifxBundlePlatform {
  if (value === undefined) {
    return "ios";
  }

  if (value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_EXPORT_EMBED_INVALID_PLATFORM",
    message: `Unsupported platform "${value}" for vifx export:embed.`,
    hint: "Use --platform ios or --platform android.",
    docsPath: "/reference/cli#export-embed",
  });
}

async function isDirectory(candidate: string) {
  const stats = await stat(candidate).catch(() => undefined);
  return stats?.isDirectory() ?? false;
}

async function isFile(candidate: string) {
  const stats = await stat(candidate).catch(() => undefined);
  return stats?.isFile() ?? false;
}

const PROJECT_ROOT_MARKERS = [
  "vifx.config.ts",
  "vifx.config.mts",
  "vifx.config.js",
  "vifx.config.mjs",
  "package.json",
];

/**
 * Resolves the project root the same way @vifx/core does: an explicit
 * positional path wins, otherwise the nearest ancestor directory containing a
 * Vifx config or a package.json is used, falling back to the cwd.
 */
async function resolveProjectRoot(cwd: string, projectPath: string | undefined) {
  if (projectPath !== undefined) {
    const explicitRoot = path.resolve(cwd, projectPath);

    if (!(await isDirectory(explicitRoot))) {
      throw new VifxError({
        code: "VIFX_EXPORT_EMBED_PROJECT_NOT_FOUND",
        message: `Project path "${explicitRoot}" is not a directory.`,
        hint: "Pass an existing project directory or omit the positional path.",
        docsPath: "/reference/cli#export-embed",
      });
    }

    return explicitRoot;
  }

  let directory = path.resolve(cwd);

  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await isFile(path.join(directory, marker))) {
        return directory;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return path.resolve(cwd);
    }

    directory = parent;
  }
}

async function isExpoProject(projectRoot: string, configuredMode: string) {
  if (configuredMode === "expo") {
    return true;
  }

  if (configuredMode === "react-native") {
    return false;
  }

  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await isFile(packageJsonPath))) {
    return false;
  }

  try {
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return Boolean(manifest.dependencies?.expo ?? manifest.devDependencies?.expo);
  } catch {
    return false;
  }
}

interface ExportEmbedExecution {
  assets: WriteProdAssetsResult | null;
  bundleOutput: string;
  durationMs: number;
  result: VifxBundleArtifacts;
  sourcemapOutput: string | null;
}

async function writeBundleOutputs(options: {
  bundleOutput: string;
  projectRoot: string;
  result: VifxBundleArtifacts;
  sourcemapOutput?: string;
}) {
  const bundleSource = path.resolve(options.projectRoot, options.result.bundle.path);
  let bundleContents = await readFile(bundleSource, "utf8");

  await mkdir(path.dirname(options.bundleOutput), { recursive: true });

  if (options.sourcemapOutput === undefined) {
    bundleContents = bundleContents.replace(/^\/\/# sourceMappingURL=.*$\n?/mu, "");
  } else {
    bundleContents = bundleContents.replace(
      /^\/\/# sourceMappingURL=.*$/mu,
      `//# sourceMappingURL=${path.basename(options.sourcemapOutput)}`,
    );
  }

  await writeFile(options.bundleOutput, bundleContents, "utf8");

  if (options.sourcemapOutput !== undefined) {
    const sourceMapPath = options.result.sourceMap?.path;
    if (sourceMapPath === undefined) {
      throw new VifxError({
        code: "VIFX_SOURCEMAP_INVALID",
        message: "The build produced no source map but --sourcemap-output was requested.",
        hint: "Re-run without --sourcemap-output or report this as a Vifx bug.",
        docsPath: "/reference/cli#export-embed",
      });
    }

    await mkdir(path.dirname(options.sourcemapOutput), { recursive: true });
    const mapContents = await readFile(path.resolve(options.projectRoot, sourceMapPath));
    await writeFile(options.sourcemapOutput, mapContents);
  }
}

async function writeAssetsDest(options: {
  assetsDest: string;
  platform: VifxBundlePlatform;
  projectRoot: string;
  result: VifxBundleArtifacts;
}) {
  const descriptors = [];

  for (const asset of options.result.assets) {
    descriptors.push(
      await collectAssetGroup({
        filePath: path.resolve(options.projectRoot, asset.sourceFilePath),
        projectRoot: options.projectRoot,
      }),
    );
  }

  return writeProdAssets(descriptors, {
    assetsDest: options.assetsDest,
    platform: options.platform,
  });
}

function findTarget(
  targets: readonly VifxBundleTargetConfig[],
  platform: VifxBundlePlatform,
): VifxBundleTargetConfig | undefined {
  return targets.find((target) => target.platform === platform);
}

export async function runExportEmbedCommand(argv: string[], cwd: string): Promise<CliResult> {
  const args = parseExportEmbedArgs(argv);

  if (args.help) {
    return {
      exitCode: 0,
      stdout: EXPORT_EMBED_HELP,
      stderr: "",
    };
  }

  if (args.errors.length > 0) {
    throw new VifxError({
      code: "VIFX_EXPORT_EMBED_INVALID_FLAG",
      message: args.errors.join("\n"),
      hint: "Run vifx export:embed --help for the supported flags.",
      docsPath: "/reference/cli#export-embed",
    });
  }

  const warnings = [...args.warnings];
  const platform = validatePlatform(args.platform);

  if (args.bundleOutput === undefined) {
    throw new VifxError({
      code: "VIFX_EXPORT_EMBED_BUNDLE_OUTPUT_REQUIRED",
      message: "vifx export:embed requires --bundle-output.",
      hint: "Pass --bundle-output <path> pointing at the file the native build expects.",
      docsPath: "/reference/cli#export-embed",
    });
  }

  const projectRoot = await resolveProjectRoot(cwd, args.projectPath);
  const loaded = await loadVifxConfig({
    configFile: args.configFile,
    cwd: projectRoot,
    optional: true,
  });
  const target = findTarget(loaded.config.vite.targets, platform);
  const entry = args.entryFile ?? target?.entry ?? "./index.js";
  const minify = args.minify ?? !args.dev;
  const mode = args.dev ? ("development" as const) : ("production" as const);

  if (!args.dev || minify) {
    warnings.push(
      'production semantics pending: --dev false / --minify true were forwarded as mode "production", but this Vifx version still emits a development-flavored bundle.',
    );
  }

  const bundleOutput = path.resolve(cwd, args.bundleOutput);
  const sourcemapOutput =
    args.sourcemapOutput === undefined ? undefined : path.resolve(cwd, args.sourcemapOutput);
  const assetsDest = args.assetsDest === undefined ? undefined : path.resolve(cwd, args.assetsDest);

  if (assetsDest === undefined) {
    warnings.push("--assets-dest was not provided; the production asset layout is skipped.");
  }

  const expo = await isExpoProject(loaded.config.projectRoot, loaded.config.vite.mode);
  const outDir = `.vifx/export-embed/${platform}`;
  const startedAt = Date.now();
  const buildOptions = {
    aliases: target?.aliases,
    babelInPackages: target?.babelInPackages,
    entry,
    env: process.env,
    hermes: false,
    jsxInPackages: target?.jsxInPackages,
    mainFields: loaded.config.resolver.mainFields,
    mode,
    outDir,
    platform,
    projectRoot: loaded.config.projectRoot,
    reactNativeCompat: "none" as const,
    shimJsxRuntime: target?.shimJsxRuntime,
    shimReact: target?.shimReact,
    shimReactNative: target?.shimReactNative,
  };
  const result = expo
    ? await buildExpoBundle({
        ...buildOptions,
        appConfigPath: loaded.config.expoOptions.appConfigPath,
        publicEnvPrefix: loaded.config.expoOptions.publicEnvPrefix,
      })
    : await buildReactNativeBundle(buildOptions);

  await writeBundleOutputs({
    bundleOutput,
    projectRoot: loaded.config.projectRoot,
    result,
    ...(sourcemapOutput === undefined ? {} : { sourcemapOutput }),
  });

  const assets =
    assetsDest === undefined
      ? null
      : await writeAssetsDest({
          assetsDest,
          platform,
          projectRoot: loaded.config.projectRoot,
          result,
        });

  const execution: ExportEmbedExecution = {
    assets,
    bundleOutput,
    durationMs: Date.now() - startedAt,
    result,
    sourcemapOutput: sourcemapOutput ?? null,
  };

  if (args.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          assets:
            execution.assets === null
              ? null
              : {
                  assetMapPath: execution.assets.assetMapPath,
                  assetsDest: execution.assets.assetsDest,
                  count: execution.assets.assets.length,
                  writtenFiles: execution.assets.writtenFiles,
                },
          bundleOutput: execution.bundleOutput,
          configFile: loaded.filePath ?? null,
          dev: args.dev,
          durationMs: execution.durationMs,
          entry,
          minify,
          mode,
          platform,
          projectRoot: loaded.config.projectRoot,
          sourcemapOutput: execution.sourcemapOutput,
          warnings,
        },
        null,
        2,
      ),
      stderr: warnings.map((warning) => `WARN ${warning}`).join("\n"),
    };
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Export Embed",
      "",
      `Project root: ${loaded.config.projectRoot}`,
      `Config: ${loaded.filePath ?? "default (no vifx.config found)"}`,
      `Platform: ${platform}`,
      `Mode: ${mode}`,
      `Entry: ${entry}`,
      `Bundle: ${execution.bundleOutput}`,
      execution.sourcemapOutput === null
        ? "Source map: skipped (--sourcemap-output not provided)"
        : `Source map: ${execution.sourcemapOutput}`,
      execution.assets === null
        ? "Assets: skipped (--assets-dest not provided)"
        : `Assets: ${execution.assets.assets.length} group(s), ${execution.assets.writtenFiles.length} file(s) in ${execution.assets.assetsDest}`,
      `Duration: ${execution.durationMs} ms`,
    ].join("\n"),
    stderr: warnings.map((warning) => `WARN ${warning}`).join("\n"),
  };
}
