import path from "node:path";
import { loadVifxConfig } from "@vifx/config";
import { VifxError } from "@vifx/errors";
import { writeExpoExport } from "@vifx/expo-export";
import { resolveExpoAppConfig } from "@vifx/vite-plugin-expo";
import { parseFlags } from "../lib/args.ts";
import { loadProjectEnvIntoProcess } from "../lib/env.ts";
import { resolverBuildOptions } from "../lib/resolver-options.ts";
import type { CliResult } from "../types.ts";
import {
  type ExpoBuildResult,
  buildExpoTarget,
  selectExpoTargets,
  validateRequestedPlatform,
} from "./expo-shared.ts";

const EXPO_EXPORT_HELP = `Usage: vifx expo export [path] [--platform ios|android|all] [--config <file>] [--out-dir <dir>] [--dev] [--json]

Builds configured Expo Vifx targets and writes an Expo artifact directory with bundles, source maps, assets, manifest, and metadata.

Options:
  --platform  Restrict the export to one platform. Default: all configured targets.
  --config    Use a specific Vifx config file.
  --out-dir   Export output directory. Default: dist/expo.
  --dev       Export development bundles (unminified, __DEV__ true). Default: production bundles, as npx expo export does.
  --json      Output machine-readable generation results.
  --help      Show this message.
`;

export async function runExpoExportCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["dev", "help", "json"],
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

  // Like `npx expo export`, the export is a release artifact unless --dev is
  // passed. A release build never ships Vifx's Expo Go compat mocks: the real
  // native modules are in the app binary that runs it (as with export:embed).
  const mode = parsed.flags.dev ? ("development" as const) : ("production" as const);
  await loadProjectEnvIntoProcess(loaded.config.projectRoot, mode);

  const builds: ExpoBuildResult[] = [];
  for (const target of targets) {
    builds.push(
      await buildExpoTarget(
        mode === "production"
          ? { ...target, compatPreview: false, mode, reactNativeCompat: "none" }
          : { ...target, mode },
        loaded.config.projectRoot,
        resolverBuildOptions(loaded.config.resolver),
      ),
    );
  }

  const exportRoot =
    typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined;
  // The export manifest carries the fully resolved Expo config, dynamic
  // `app.config.js` / `.ts` included — not just the static app.json.
  const { exp } = await resolveExpoAppConfig({
    appConfigPath: loaded.config.expoOptions.appConfigPath,
    projectRoot: loaded.config.projectRoot,
  });
  const exportResult = await writeExpoExport({
    bundles: builds.map((build) => build.result),
    manifest: exp,
    projectRoot: loaded.config.projectRoot,
    ...(exportRoot === undefined ? {} : { exportRoot }),
  });

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          builds,
          bundleMode: mode,
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
      `Mode: ${mode}`,
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
