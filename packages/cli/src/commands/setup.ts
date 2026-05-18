import path from "node:path";
import { createInterface } from "node:readline/promises";
import { applyPlannedChanges, planExpoSetup, type PlannedFileChange } from "@vifx/codemods";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import type { CliResult, ExecuteCliOptions } from "../types.ts";

export const SETUP_HELP = `Usage: vifx setup [path] [--yes] [--dry-run] [--json] [--force] [--with-vite-config]

Onboards an existing Expo project with a Vifx-owned config without editing Expo-owned app files.

Options:
  --yes               Apply the planned changes without interactive confirmation.
  --dry-run           Optional preview mode without writing files.
  --json              Output machine-readable setup details. Previews unless combined with --yes.
  --force             Replace existing Vifx-owned files.
  --with-vite-config  Also create a Vifx-owned vite.config.vifx.ts for advanced direct Vite usage.
  --help              Show this message.
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

function createNextCommands(options: { includeExpoDev: boolean; targetPath: string }) {
  const targetPath = formatShellArg(options.targetPath);
  const nextCommands = [`pnpm vifx expo audit ${targetPath}`];

  if (options.includeExpoDev) {
    nextCommands.push(`pnpm vifx expo dev ${targetPath} --platform ios`);
  }

  nextCommands.push(`pnpm vifx native run ${targetPath} --platform ios`);
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
  dryRun: boolean;
  expoRouter: boolean;
  iosHostPresent: boolean;
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
    `app/ directory: ${options.appDirectory ? "detected" : "missing"}`,
    `iOS host: ${options.iosHostPresent ? "present" : "missing"}`,
    `Advanced Vite config: ${options.withViteConfig ? "requested" : "skipped"}`,
    "",
    "Planned changes:",
    ...formatChangeSummary(options.changes),
    "",
    "Boundaries:",
    "  - This setup does not install Expo Go parity.",
    "  - This setup does not install React Native Fast Refresh parity.",
    "  - This setup does not install EAS parity.",
    "  - This setup does not install Android runtime parity.",
    "",
    statusLine,
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
    booleanFlags: ["help", "yes", "dry-run", "json", "force", "with-vite-config"],
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
    force: Boolean(parsed.flags.force),
    withViteConfig: Boolean(parsed.flags["with-vite-config"]),
  });
  const dryRun = Boolean(parsed.flags["dry-run"] || (parsed.flags.json && !parsed.flags.yes));
  const nextCommands = createNextCommands({
    includeExpoDev: plan.webPreviewConfigured,
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
      expoRouter: plan.expoRouter,
      iosHostPresent: plan.iosHostPresent,
      nextCommands,
      projectRoot: plan.projectRoot,
      targetPath,
      wasCancelled,
      withViteConfig: plan.withViteConfig,
    }),
    stderr: "",
  };
}
