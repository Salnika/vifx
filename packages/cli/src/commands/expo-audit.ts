import path from "node:path";
import { evaluateExpoNoMetroContract } from "@vifx/expo-export";
import type { VifxExpoNoMetroWorkflowReport } from "@vifx/types";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";
import { EXPO_HELP } from "./expo-shared.ts";

export { EXPO_HELP };

function formatList(label: string, items: string[]) {
  if (items.length === 0) {
    return [`    ${label}: none`];
  }

  return [`    ${label}:`, ...items.map((item) => `      - ${item}`)];
}

function formatWorkflow(workflow: VifxExpoNoMetroWorkflowReport) {
  return [
    `  ${workflow.status.toUpperCase().padEnd(12)} ${workflow.id} - ${workflow.title}`,
    ...formatList("Evidence", workflow.evidence),
    ...formatList("Blockers", workflow.blockers),
    ...formatList("Notes", workflow.notes),
  ].join("\n");
}

export async function runExpoAuditCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["export-root", "supported-sdk"],
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
      stdout: EXPO_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const report = await evaluateExpoNoMetroContract({
    exportRoot:
      typeof parsed.flags["export-root"] === "string" ? parsed.flags["export-root"] : undefined,
    projectRoot,
    supportedExpoSdk:
      typeof parsed.flags["supported-sdk"] === "string" ? parsed.flags["supported-sdk"] : undefined,
  });

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(report, null, 2),
      stderr: "",
    };
  }

  return {
    exitCode: 0,
    stdout: [
      "Vifx Expo Audit",
      "",
      `Project root: ${report.projectRoot}`,
      `Decision: ${report.decision}`,
      `Supported Expo SDK: ${report.supportedExpoSdk}`,
      `SDK support tier: ${report.sdkSupport.tier}${report.sdkSupport.sdk ? ` (SDK ${report.sdkSupport.sdk})` : ""}`,
      `Expo: ${report.expoVersion ?? "missing"}`,
      `React Native: ${report.reactNativeVersion ?? "missing"}`,
      `Expo Router: ${report.expoRouter ? "detected" : "missing"}`,
      `app/ directory: ${report.appDirectory ? "detected" : "missing"}`,
      "",
      "Warnings:",
      report.warnings.length > 0
        ? report.warnings.map((warning) => `  WARN  ${warning}`).join("\n")
        : "  INFO  No contract warnings.",
      "",
      "Bundling Workflows:",
      report.workflows.map((workflow) => formatWorkflow(workflow)).join("\n\n"),
    ].join("\n"),
    stderr: "",
  };
}
