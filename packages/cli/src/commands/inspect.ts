import path from "node:path";
import { inspectProject } from "@vifx/compat-runner";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const INSPECT_HELP = `Usage: vifx inspect [path] [--json]

Inspects Vifx project primitives: project type, configs, platform files, and asset groups.

Options:
  --json  Output machine-readable JSON.
  --help  Show this message.
`;

function formatList(label: string, values: string[]) {
  if (values.length === 0) {
    return `${label}: none`;
  }

  return [`${label}:`, ...values.map((value) => `  - ${value}`)].join("\n");
}

export async function runInspectCommand(argv: string[], cwd: string): Promise<CliResult> {
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
      stdout: INSPECT_HELP,
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

  const assetLines =
    inspection.assetGroups.length === 0
      ? "Asset groups: none"
      : [
          "Asset groups:",
          ...inspection.assetGroups.map(
            (assetGroup) =>
              `  - ${assetGroup.assetPath} -> ${assetGroup.scales.map((scale) => `${scale}x`).join(", ")}`,
          ),
        ].join("\n");

  return {
    exitCode: 0,
    stdout: [
      "Vifx Inspect",
      "",
      `Project root: ${targetPath}`,
      `Project type: ${inspection.projectType}`,
      `Package manager: ${inspection.packageManager}`,
      `Metro config: ${inspection.metroConfigPath ?? "missing"}`,
      `Vite config: ${inspection.viteConfigPath ?? "missing"}`,
      `Vite mode: ${inspection.vitePluginMode}`,
      `Vifx config: ${inspection.vifxConfigPath ?? "missing"}`,
      `Workspace root: ${path.relative(targetPath, inspection.workspaceRoot) || "."}`,
      formatList("Platform files", inspection.platformFiles),
      assetLines,
      formatList(
        "Diagnostics",
        inspection.diagnostics.map(
          (diagnostic) =>
            `${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.summary}`,
        ),
      ),
    ].join("\n\n"),
    stderr: "",
  };
}
