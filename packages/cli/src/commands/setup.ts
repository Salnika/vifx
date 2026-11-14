import path from "node:path";
import { createInterface } from "node:readline/promises";
import { applyPlannedChanges, planExpoSetup, type PlannedFileChange } from "@vifx/codemods";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import { analyzeMetroConfig, type MetroConfigAnalysis } from "../lib/metro-config.ts";
import type { CliResult, ExecuteCliOptions } from "../types.ts";

export const SETUP_HELP = `Usage: vifx setup [path] [--yes] [--dry-run] [--json] [--force] [--expo-go] [--with-vite-config] [--experimental-embed]

Onboards an existing Expo project with a Vifx-owned config without editing Expo-owned app files.

Options:
  --yes                 Apply the planned changes without interactive confirmation.
  --dry-run             Optional preview mode without writing files.
  --json                Output machine-readable setup details. Previews unless combined with --yes.
  --force               Replace existing Vifx-owned files.
  --expo-go             Generate native Expo targets for the Vifx Expo Go server.
  --with-vite-config    Also create a Vifx-owned vite.config.vifx.ts for advanced direct Vite usage.
  --experimental-embed  Experimental: register @vifx/expo-config-plugin in app.json so expo prebuild points native builds at vifx export:embed.
  --help                Show this message.
`;

interface SetupCommandOptions {
  confirm?: ExecuteCliOptions["confirm"];
  interactive?: boolean;
}

function formatShellArg(value: string) {
  if (/^[\w./:=+-]+$/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatChangeSummary(changes: PlannedFileChange[]) {
  if (changes.length === 0) {
    return ["  none"];
  }

  return changes.map((change) => `  [${change.kind}] ${change.path}`);
}

function formatMetroMigrationNotes(analysis: MetroConfigAnalysis): string[] {
  if (!analysis.found) {
    return [];
  }

  const lines = ["", "Metro config migration:", `  Detected ${analysis.path ?? "metro config"}.`];

  if (analysis.extraction === "static") {
    lines.push("  (config could not be evaluated; notes come from a static scan)");
  }

  for (const feature of analysis.unsupported) {
    lines.push(`  [unsupported] ${feature.source}: ${feature.suggestion}`);
  }

  for (const hint of analysis.hints) {
    const target = hint.vifxConfigKey ? ` -> vifx.config.ts ${hint.vifxConfigKey}` : "";
    lines.push(`  [${hint.severity}] ${hint.source}: ${hint.suggestion}${target}`);
  }

  if (analysis.unsupported.length === 0 && analysis.hints.length === 0) {
    lines.push("  No migration actions detected.");
  }

  return lines;
}

function createNextCommands(options: {
  expoGo: boolean;
  includeExpoDev: boolean;
  targetPath: string;
}) {
  const targetPath = formatShellArg(options.targetPath);
  // npx runs the project's installed @vifx/cli whatever its package manager.
  const nextCommands = [`npx vifx build ${targetPath}`, `npx vifx expo audit ${targetPath}`];

  if (options.includeExpoDev) {
    nextCommands.push(
      `npx vifx expo dev ${targetPath} --platform ios${options.expoGo ? " --expo-go" : ""}`,
    );
  }

  nextCommands.push(`npx vifx expo export ${targetPath} --out-dir dist/expo`);
  return nextCommands;
}

function isInteractiveSession(options: SetupCommandOptions) {
  if (typeof options.interactive === "boolean") {
    return options.interactive;
  }

  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function confirmSetup(message: string, options: SetupCommandOptions) {
  if (options.confirm) {
    return await options.confirm(message);
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return /^(y|yes)$/iu.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function createNonInteractiveSetupError() {
  return new VifxError({
    code: "VIFX_SETUP_CONFIRMATION_REQUIRED",
    message: "vifx setup requires interactive confirmation unless you pass --yes.",
    hint: "Re-run with --yes to apply non-interactively, or use --dry-run/--json to preview the setup.",
    docsPath: "/reference/cli#vifx-setup",
  });
}

function renderTerminalSetup(options: {
  applied: boolean;
  changes: PlannedFileChange[];
  detectedExpoVersion: string | null;
  detectedProjectType: string;
  detectedReactNativeVersion: string | null;
  experimentalEmbed: boolean;
  expoGo: boolean;
  dryRun: boolean;
  expoRouter: boolean;
  iosHostPresent: boolean;
  metroNotes: string[];
  nextCommands: string[];
  projectRoot: string;
  targetPath: string;
  wasCancelled: boolean;
  withViteConfig: boolean;
  appDirectory: boolean;
}) {
  const statusLine = options.dryRun
    ? "Dry run only. No files were written."
    : options.wasCancelled
      ? "Setup cancelled. No files were written."
      : options.changes.length === 0
        ? "Setup complete. No Vifx-owned file changes were needed."
        : "Files written.";

  return [
    "Vifx Setup",
    "",
    `Project root: ${options.projectRoot}`,
    `Target path: ${options.targetPath}`,
    `Detected project type: ${options.detectedProjectType}`,
    `Expo: ${options.detectedExpoVersion ?? "missing"}`,
    `React Native: ${options.detectedReactNativeVersion ?? "missing"}`,
    `Expo Router: ${options.expoRouter ? "detected" : "missing"}`,
    `Routes directory (src/app or app): ${options.appDirectory ? "detected" : "missing"}`,
    `iOS host: ${options.iosHostPresent ? "present" : "missing"}`,
    `Expo Go server: ${options.expoGo ? "requested" : "skipped"}`,
    `Advanced Vite config: ${options.withViteConfig ? "requested" : "skipped"}`,
    `Native embed plugin: ${options.experimentalEmbed ? "requested (experimental)" : "skipped"}`,
    "",
    "Planned changes:",
    ...formatChangeSummary(options.changes),
    "",
    "Boundaries:",
    options.expoGo
      ? "  - This setup configures the Vifx Expo Go server (with Fast Refresh), not full Expo CLI parity."
      : "  - This setup does not configure the Expo Go server path unless --expo-go is passed.",
    "  - This setup does not install EAS parity.",
    "  - This setup does not install native build or runtime parity.",
    "  - This setup does not install Expo Updates runtime support.",
    "",
    statusLine,
    ...options.metroNotes,
    "",
    "Next commands:",
    ...options.nextCommands.map((command) => `  ${command}`),
  ].join("\n");
}

export async function runSetupCommand(
  argv: string[],
  cwd: string,
  options: SetupCommandOptions = {},
): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: [
      "expo-go",
      "help",
      "yes",
      "dry-run",
      "json",
      "force",
      "with-vite-config",
      "experimental-embed",
    ],
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
      stdout: SETUP_HELP,
      stderr: "",
    };
  }

  if (parsed.flags["dry-run"] && parsed.flags.yes) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Use either --yes or --dry-run, not both.",
    };
  }

  const targetPath = parsed.positional[0] ?? ".";
  const projectRoot = path.resolve(cwd, targetPath);
  const plan = await planExpoSetup(projectRoot, {
    experimentalEmbed: Boolean(parsed.flags["experimental-embed"]),
    expoGo: Boolean(parsed.flags["expo-go"]),
    force: Boolean(parsed.flags.force),
    withViteConfig: Boolean(parsed.flags["with-vite-config"]),
  });
  const metroConfigMigration = await analyzeMetroConfig(projectRoot);
  const dryRun = Boolean(parsed.flags["dry-run"] || (parsed.flags.json && !parsed.flags.yes));
  const nextCommands = createNextCommands({
    expoGo: plan.expoGo,
    includeExpoDev: plan.webPreviewConfigured || plan.expoGo,
    targetPath,
  });

  let applied = false;
  let wasCancelled = false;

  if (!dryRun) {
    if (parsed.flags.yes) {
      await applyPlannedChanges(projectRoot, plan.changes);
      applied = true;
    } else {
      if (!isInteractiveSession(options)) {
        throw createNonInteractiveSetupError();
      }

      const confirmed = await confirmSetup(
        `Apply the planned Vifx Expo setup to ${formatShellArg(projectRoot)}?`,
        options,
      );

      if (confirmed) {
        await applyPlannedChanges(projectRoot, plan.changes);
        applied = true;
      } else {
        wasCancelled = true;
      }
    }
  }

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          projectRoot: plan.projectRoot,
          detectedProjectType: plan.detectedProjectType,
          detectedExpoVersion: plan.detectedExpoVersion,
          detectedReactNativeVersion: plan.detectedReactNativeVersion,
          experimentalEmbed: plan.experimentalEmbed,
          expoGo: plan.expoGo,
          expoRouter: plan.expoRouter,
          appDirectory: plan.appDirectory,
          iosHostPresent: plan.iosHostPresent,
          changes: plan.changes.map((change) => ({
            kind: change.kind,
            path: change.path,
          })),
          applied,
          withViteConfig: plan.withViteConfig,
          nextCommands,
          metroConfigMigration,
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  return {
    exitCode: 0,
    stdout: renderTerminalSetup({
      appDirectory: plan.appDirectory,
      applied,
      changes: plan.changes,
      detectedExpoVersion: plan.detectedExpoVersion,
      detectedProjectType: plan.detectedProjectType,
      detectedReactNativeVersion: plan.detectedReactNativeVersion,
      dryRun,
      experimentalEmbed: plan.experimentalEmbed,
      expoGo: plan.expoGo,
      expoRouter: plan.expoRouter,
      iosHostPresent: plan.iosHostPresent,
      metroNotes: formatMetroMigrationNotes(metroConfigMigration),
      nextCommands,
      projectRoot: plan.projectRoot,
      targetPath,
      wasCancelled,
      withViteConfig: plan.withViteConfig,
    }),
    stderr: "",
  };
}
