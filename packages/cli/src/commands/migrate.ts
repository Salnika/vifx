import path from "node:path";
import { applyPlannedChanges, formatPlannedChanges, planMigration } from "@vifx/codemods";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const MIGRATE_HELP = `Usage:
  vifx migrate expo <path> [--dry-run] [--write] [--with-vite]
  vifx migrate react-native <path> [--dry-run] [--write] [--with-vite]

Prepares an Expo or React Native project for first-pass Vifx experiments without overwriting files by default.

Options:
  --dry-run    Preview changes without writing files. This is the default.
  --write      Apply the planned changes.
  --with-vite  Generate a minimal experimental vite.config.ts when one does not exist.
  --help       Show this message.
`;

export async function runMigrateCommand(
  kind: "expo" | "react-native",
  argv: string[],
  cwd: string,
): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "dry-run", "write", "with-vite"],
    aliases: {
      "-h": "--help",
      "-w": "--write",
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
      stdout: MIGRATE_HELP,
      stderr: "",
    };
  }

  const targetArgument = parsed.positional[0];
  if (!targetArgument) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Missing project path.\n\n${MIGRATE_HELP}`,
    };
  }

  if (parsed.flags.write && parsed.flags["dry-run"]) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Use either --write or --dry-run, not both.",
    };
  }

  const projectRoot = path.resolve(cwd, targetArgument);
  const plan = await planMigration(projectRoot, kind, {
    withVite: Boolean(parsed.flags["with-vite"]),
  });
  const shouldWrite = Boolean(parsed.flags.write);

  if (shouldWrite) {
    await applyPlannedChanges(projectRoot, plan.changes);
  }

  return {
    exitCode: 0,
    stdout: [
      `Vifx Migrate ${kind === "expo" ? "Expo" : "React Native"}`,
      "",
      formatPlannedChanges(plan.changes),
      "",
      shouldWrite ? "Files written." : "Dry run only. No files were written.",
      "",
      "Next steps:",
      ...plan.nextSteps.map((step) => `- ${step}`),
      "",
      "Rollback:",
      ...plan.rollbackSteps.map((step) => `- ${step}`),
    ].join("\n"),
    stderr: "",
  };
}
