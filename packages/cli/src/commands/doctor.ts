import path from "node:path";
import { inspectProject } from "@vifx/compat-runner";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const DOCTOR_HELP = `Usage: vifx doctor [path] [--json]

Checks project readiness for first-pass Vifx workflows.

Options:
  --json  Output machine-readable JSON with no extra logs.
  --help  Show this message.
`;

function formatValue(label: string, value: string | null) {
  return `${label}: ${value ?? "missing"}`;
}

function formatDiagnostic(diagnostic: {
  level: string;
  code: string;
  summary: string;
  hint?: string;
}) {
  const lines = [
    `  ${diagnostic.level.toUpperCase().padEnd(5)} ${diagnostic.code}`,
    `        ${diagnostic.summary}`,
  ];

  if (diagnostic.hint) {
    lines.push(`        Run: ${diagnostic.hint.replace(/^Run:\s*/, "")}`);
  }

  return lines.join("\n");
}

export async function runDoctorCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
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
      stdout: DOCTOR_HELP,
      stderr: "",
    };
  }

  const targetPath = path.resolve(cwd, parsed.positional[0] ?? ".");
  const inspection = await inspectProject(targetPath);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(inspection, null, 2),
      stderr: "",
    };
  }

  const workspaceRoot = path.relative(targetPath, inspection.workspaceRoot) || ".";

  return {
    exitCode: 0,
    stdout: [
      "Vifx Doctor",
      "",
      formatValue("Project type", inspection.projectType),
      formatValue("Node version", inspection.nodeVersion),
      formatValue("Package manager", inspection.packageManager),
      formatValue("React Native", inspection.reactNativeVersion),
      formatValue("Expo", inspection.expoVersion),
      formatValue("Metro config", inspection.metroConfigPath ? "found" : "missing"),
      formatValue("Vite config", inspection.viteConfigPath ? "found" : "missing"),
      formatValue("Vifx config", inspection.vifxConfigPath ? "found" : "missing"),
      formatValue("Workspace root", workspaceRoot),
      formatValue("Hermes compiler", inspection.hermesCompilerPath ?? "unavailable"),
      "",
      "Issues:",
      inspection.diagnostics.length > 0
        ? inspection.diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n\n")
        : "  INFO  VIFX_NO_ISSUES\n        No first-pass issues detected.",
    ].join("\n"),
    stderr: "",
  };
}
