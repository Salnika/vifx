import path from "node:path";
import { formatMetroInspectionReport, inspectMetroProject } from "@vifx/metro-inspect";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const METRO_INSPECT_HELP = `Usage: vifx metro inspect [path] [--platform ios|android|native|web] [--entry index.js] [--json]

Inspects captured Metro reference artifacts for a fixture or project.

Options:
  --platform  Target platform. Defaults to ios.
  --entry     Entry file used to derive bundle names. Defaults to index.js.
  --json      Output machine-readable JSON.
  --help      Show this message.
`;

function isSupportedPlatform(value: string): value is "android" | "ios" | "native" | "web" {
  return value === "android" || value === "ios" || value === "native" || value === "web";
}

export async function runMetroInspectCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["entry", "platform"],
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
      stdout: METRO_INSPECT_HELP,
      stderr: "",
    };
  }

  const platform = (parsed.flags.platform as string | undefined) ?? "ios";
  if (!isSupportedPlatform(platform)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported platform "${platform}".`,
    };
  }

  const report = await inspectMetroProject({
    entry: (parsed.flags.entry as string | undefined) ?? "index.js",
    platform,
    projectRoot: path.resolve(cwd, parsed.positional[0] ?? "."),
  });

  return {
    exitCode: 0,
    stdout: formatMetroInspectionReport(report, parsed.flags.json ? "json" : "terminal"),
    stderr: "",
  };
}
