import path from "node:path";
import { applyPlannedChanges, formatPlannedChanges, planInit } from "@vifx/codemods";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const INIT_HELP = `Usage: vifx init [path] [--write] [--force]

Creates a first-pass vifx.config.ts without overwriting user files by default.

Options:
  --write  Write the planned files instead of printing a preview.
  --force  Replace an existing vifx.config.ts.
  --help   Show this message.
`;

export async function runInitCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "write", "force"],
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
      stdout: INIT_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const plan = await planInit(projectRoot, {
    force: Boolean(parsed.flags.force),
  });
  const shouldWrite = Boolean(parsed.flags.write);

  if (shouldWrite) {
    await applyPlannedChanges(projectRoot, plan.changes);
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Init",
      "",
      formatPlannedChanges(plan.changes),
      "",
      shouldWrite ? "Files written." : "Dry run only. No files were written.",
    ].join("\n"),
    stderr: "",
  };
}
