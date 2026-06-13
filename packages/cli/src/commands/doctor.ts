import path from "node:path";
import { inspectProject } from "@vifx/compat-runner";
import { parseFlags } from "../lib/args.ts";
import {
  analyzeMetroConfig,
  type MetroConfigAnalysis,
  type MetroMigrationHint,
  type MetroUnsupportedFeature,
} from "../lib/metro-config.ts";
import type { CliResult } from "../types.ts";

const DOCTOR_HELP = `Usage: vifx doctor [path] [--verbose] [--json]

Checks project readiness for Vifx workflows.

Options:
  --verbose  Show detailed diagnostic information.
  --json     Output machine-readable JSON with no extra logs.
  --help     Show this message.
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
    lines.push(
      `        ${diagnostic.hint.startsWith("Run:") ? diagnostic.hint : `Hint: ${diagnostic.hint}`}`,
    );
  }

  return lines.join("\n");
}

function formatMetroHint(hint: MetroMigrationHint) {
  const label = hint.severity === "info" ? "INFO" : "ACTION";
  const lines = [`  ${label.padEnd(6)} ${hint.source}`, `         ${hint.suggestion}`];

  if (hint.vifxConfigKey) {
    lines.push(`         vifx.config.ts: ${hint.vifxConfigKey}`);
  }

  return lines.join("\n");
}

function formatMetroUnsupported(feature: MetroUnsupportedFeature) {
  return [
    `  UNSUP  ${feature.code}`,
    `         ${feature.source}`,
    `         ${feature.suggestion}`,
  ].join("\n");
}

function formatMetroMigrationSection(analysis: MetroConfigAnalysis) {
  const lines = ["Metro config migration:", `  Config: ${analysis.path ?? "missing"}`];

  if (analysis.extraction === "static") {
    lines.push("  Note: config could not be evaluated; using a conservative static scan.");
  }

  const entries = [
    ...analysis.unsupported.map((feature) => formatMetroUnsupported(feature)),
    ...analysis.hints.map((hint) => formatMetroHint(hint)),
  ];

  if (entries.length === 0) {
    lines.push("  INFO   VIFX_METRO_CONFIG_COMPATIBLE");
    lines.push("         No migration actions detected for this Metro config.");
  } else {
    lines.push(entries.join("\n\n"));
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
  const metroConfigMigration = await analyzeMetroConfig(targetPath);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ...inspection, metroConfigMigration }, null, 2),
      stderr: "",
    };
  }

  const workspaceRoot = path.relative(targetPath, inspection.workspaceRoot) || ".";

  const sections = [
    "Vifx Doctor",
    "",
    formatValue("Project type", inspection.projectType),
    formatValue("Node version", inspection.nodeVersion),
    formatValue("Package manager", inspection.packageManager),
    formatValue("React Native", inspection.reactNativeVersion),
    formatValue("Expo", inspection.expoVersion),
    formatValue("Metro config", inspection.metroConfigPath),
    formatValue("Vite config", inspection.viteConfigPath),
    formatValue("Vite mode", inspection.vitePluginMode),
    formatValue("Vifx config", inspection.vifxConfigPath),
    formatValue("Workspace root", workspaceRoot),
    formatValue("Hermes compiler", inspection.hermesCompilerPath ?? "unavailable"),
    "",
    "Issues:",
    inspection.diagnostics.length > 0
      ? inspection.diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n\n")
      : "  INFO  VIFX_NO_ISSUES\n        No issues detected.",
  ];

  // Additive section: only shown when a Metro config exists in the project.
  if (metroConfigMigration.found) {
    sections.push("", formatMetroMigrationSection(metroConfigMigration));
  }

  return {
    exitCode: 0,
    stdout: sections.join("\n"),
    stderr: "",
  };
}
