import { writeFile } from "node:fs/promises";
import path from "node:path";
import { supportedAssetExtensions } from "@vifx/asset-registry";
import { inspectProject } from "@vifx/compat-runner";
import { findVifxConfig, loadVifxConfig, VIFX_DEFAULT_RESOLVER_EXTENSIONS } from "@vifx/config";
import { getSdkSupportTier } from "@vifx/expo-export";
import type { VifxConfig, VifxExpoSdkSupportStatus } from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import {
  analyzeMetroConfig,
  pruneAppliedFixes,
  type MetroConfigAnalysis,
  type MetroMigrationHint,
  type MetroUnsupportedFeature,
} from "../lib/metro-config.ts";
import { paint, severityLabel } from "../lib/style.ts";
import { applyMetroFixesToVifxConfig, type VifxConfigEditResult } from "../lib/vifx-config-edit.ts";
import type { CliResult } from "../types.ts";

const DOCTOR_HELP = `Usage: vifx doctor [path] [--fix] [--verbose] [--json]

Checks project readiness for Vifx workflows and maps metro.config.js settings
to vifx.config.ts.

Options:
  --fix      Write the settings mapped from metro.config.js (source and asset
             extensions, module aliases) into vifx.config.ts.
  --verbose  Show detailed diagnostic information.
  --json     Output machine-readable JSON with no extra logs.
  --help     Show this message.
`;

// The bundler's own asset list (the asset registry's, without json, which is a
// source file): a new resolver.assetExtensions starts from it.
const DEFAULT_ASSET_EXTENSIONS = supportedAssetExtensions.filter(
  (extension) => extension !== "json",
);

const BASELINE_NAMES: Record<MetroConfigAnalysis["baseline"], string> = {
  expo: "expo/metro-config defaults",
  metro: "Metro defaults",
  "react-native": "@react-native/metro-config defaults",
};

function formatValue(label: string, value: string | null) {
  return `${paint("dim", `${label}:`)} ${value ?? paint("yellow", "missing")}`;
}

function formatHeading(title: string) {
  return paint("bold", title);
}

function formatDiagnostic(diagnostic: {
  level: string;
  code: string;
  summary: string;
  hint?: string;
}) {
  const lines = [
    `  ${severityLabel(diagnostic.level.toUpperCase(), 5)} ${paint("bold", diagnostic.code)}`,
    `        ${diagnostic.summary}`,
  ];

  if (diagnostic.hint) {
    lines.push(
      `        ${paint("dim", diagnostic.hint.startsWith("Run:") ? diagnostic.hint : `Hint: ${diagnostic.hint}`)}`,
    );
  }

  return lines.join("\n");
}

function formatExpoSdkSupportSection(sdkSupport: VifxExpoSdkSupportStatus) {
  const tierStyle = sdkSupport.tier === "validated" ? "green" : "yellow";
  return [
    formatHeading("Expo SDK support:"),
    `  ${paint("dim", "SDK:")} ${sdkSupport.sdk ?? "not detected"}`,
    `  ${paint("dim", "Tier:")} ${paint(["bold", tierStyle], sdkSupport.tier)}`,
    ...sdkSupport.notes.map((note) => paint("dim", `  - ${note}`)),
  ].join("\n");
}

function formatMetroHint(hint: MetroMigrationHint) {
  const label = hint.severity === "info" ? "INFO" : "ACTION";
  const lines = [
    `  ${severityLabel(label, 6)} ${paint("cyan", hint.source)}`,
    `         ${hint.suggestion}`,
  ];

  if (hint.vifxConfigKey) {
    const fixable = hint.fixable ? paint("green", "  (vifx doctor --fix)") : "";
    lines.push(`         ${paint("dim", "vifx.config.ts:")} ${hint.vifxConfigKey}${fixable}`);
  }

  return lines.join("\n");
}

function formatMetroUnsupported(feature: MetroUnsupportedFeature) {
  return [
    `  ${severityLabel("UNSUP", 6)} ${paint("bold", feature.code)}`,
    `         ${paint("cyan", feature.source)}`,
    `         ${feature.suggestion}`,
  ].join("\n");
}

function formatMetroMigrationSection(analysis: MetroConfigAnalysis, fixApplied: boolean) {
  const lines = [
    formatHeading("Metro config migration:"),
    `  ${paint("dim", "Config:")} ${analysis.path ?? "missing"}`,
  ];

  if (analysis.extraction === "static") {
    lines.push(
      paint("yellow", "  Note: config could not be evaluated; using a conservative static scan."),
    );
  } else if (analysis.extraction === "evaluated") {
    lines.push(`  ${paint("dim", "Compared with:")} ${BASELINE_NAMES[analysis.baseline]}`);
  }

  const entries = [
    ...analysis.unsupported.map((feature) => formatMetroUnsupported(feature)),
    ...analysis.hints.map((hint) => formatMetroHint(hint)),
  ];

  if (entries.length === 0) {
    lines.push(`  ${severityLabel("OK", 6)} No migration actions detected for this Metro config.`);
  } else {
    lines.push(entries.join("\n\n"));
  }

  if (!fixApplied && analysis.hints.some((hint) => hint.fixable)) {
    lines.push(
      "",
      `  Run ${paint(["bold", "green"], "vifx doctor --fix")} to write the settings marked (vifx doctor --fix) into vifx.config.ts.`,
    );
  }

  return lines.join("\n");
}

function formatFixSection(result: VifxConfigEditResult, configPath: string) {
  const lines = [formatHeading(`Applied to ${configPath}:`)];

  if (result.applied.length === 0 && result.manual.length === 0) {
    lines.push(`  ${severityLabel("OK", 6)} Nothing to write: vifx.config.ts already has them.`);
  }
  for (const change of result.applied) {
    lines.push(`  ${severityLabel("FIXED", 6)} ${change}`);
  }
  for (const change of result.manual) {
    lines.push(`  ${severityLabel("MANUAL", 6)} ${change}`);
  }

  return lines.join("\n");
}

/** The settings of a loaded vifx.config.ts that `--fix` may already have written. */
function currentSettings(config: VifxConfig) {
  return {
    assetExtensions: config.resolver.assetExtensions,
    extensions: config.resolver.extensions,
    targetAliases: config.vite.targets.map((target) => target.aliases),
  };
}

async function loadProjectConfig(targetPath: string, configFile: string) {
  try {
    return (await loadVifxConfig({ cwd: targetPath, configFile, optional: false })).config;
  } catch {
    return undefined;
  }
}

export async function runDoctorCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json", "fix"],
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
  const expoSdkSupport = getSdkSupportTier(inspection.expoVersion);
  const vifxConfigFile = await findVifxConfig(targetPath);
  const vifxConfig = vifxConfigFile
    ? await loadProjectConfig(targetPath, vifxConfigFile)
    : undefined;

  let metroConfigMigration = await analyzeMetroConfig(targetPath);
  if (vifxConfig) {
    metroConfigMigration = pruneAppliedFixes(metroConfigMigration, currentSettings(vifxConfig));
  }

  let fix: VifxConfigEditResult | undefined;
  if (parsed.flags.fix) {
    if (!vifxConfigFile) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `No vifx.config.ts in ${targetPath}. Run \`vifx setup\` first, then \`vifx doctor --fix\`.`,
      };
    }
    if (!vifxConfig) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${vifxConfigFile} does not load: fix it before running \`vifx doctor --fix\`.`,
      };
    }

    fix = await applyMetroFixesToVifxConfig(vifxConfigFile, metroConfigMigration.fixes, {
      assetExtensions: DEFAULT_ASSET_EXTENSIONS,
      extensions: VIFX_DEFAULT_RESOLVER_EXTENSIONS,
    });

    if (fix.applied.length > 0) {
      const updated = await loadProjectConfig(targetPath, vifxConfigFile);
      if (!updated) {
        await writeFile(vifxConfigFile, fix.original, "utf8");
        return {
          exitCode: 1,
          stdout: "",
          stderr: `The edited ${vifxConfigFile} did not load, so it was restored. Add these settings by hand:\n${fix.applied.map((change) => `  ${change}`).join("\n")}`,
        };
      }
      metroConfigMigration = pruneAppliedFixes(metroConfigMigration, currentSettings(updated));
    }
  }

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          ...inspection,
          expoSdkSupport,
          metroConfigMigration,
          ...(fix ? { fix: { applied: fix.applied, manual: fix.manual } } : {}),
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  const workspaceRoot = path.relative(targetPath, inspection.workspaceRoot) || ".";
  const expoSdkSupportSection =
    inspection.projectType === "expo" || inspection.expoVersion !== null
      ? [formatExpoSdkSupportSection(expoSdkSupport), ""]
      : [];

  const sections = [
    paint(["bold", "magenta"], "Vifx Doctor"),
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
    ...expoSdkSupportSection,
    formatHeading("Issues:"),
    inspection.diagnostics.length > 0
      ? inspection.diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n\n")
      : `  ${severityLabel("INFO", 5)} ${paint("bold", "VIFX_NO_ISSUES")}\n        No issues detected.`,
  ];

  // Additive section: only shown when a Metro config exists in the project.
  if (metroConfigMigration.found) {
    sections.push("", formatMetroMigrationSection(metroConfigMigration, fix !== undefined));
  }

  if (fix && vifxConfigFile) {
    sections.push("", formatFixSection(fix, path.relative(targetPath, vifxConfigFile)));
  }

  return {
    exitCode: 0,
    stdout: sections.join("\n"),
    stderr: "",
  };
}
