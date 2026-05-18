import path from "node:path";
import { applyPlannedChanges, formatPlannedChanges, planViteInit } from "@vifx/codemods";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const VITE_INIT_HELP = `Usage: vifx vite init [path] [--write] [--force]

Creates a Vifx-owned vite.config.vifx.ts for advanced direct Vite usage.

Options:
  --write  Write the planned files instead of printing a preview.
  --force  Replace an existing vite.config.vifx.ts.
  --help   Show this message.
`;

export async function runViteInitCommand(argv: string[], cwd: string): Promise<CliResult> {
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
      stdout: VITE_INIT_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const plan = await planViteInit(projectRoot, {
    force: Boolean(parsed.flags.force),
  });
  const shouldWrite = Boolean(parsed.flags.write);

  if (shouldWrite) {
    await applyPlannedChanges(projectRoot, plan.changes);
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Vite Init",
      "",
      formatPlannedChanges(plan.changes),
      "",
      shouldWrite ? "Files written." : "Dry run only. No files were written.",
    ].join("\n"),
    stderr: "",
  };
}
