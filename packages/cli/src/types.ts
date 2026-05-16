import type { CompatReportFormat } from "@vifx/compat-runner";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecuteCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
  errors: string[];
}

export interface ParseFlagsOptions {
  booleanFlags?: string[];
  stringFlags?: string[];
  aliases?: Record<string, string>;
}

export interface PlannedFileChange {
  kind: "create" | "update";
  path: string;
  before: string | null;
  after: string;
}

export interface InitPlan {
  projectRoot: string;
  wroteFiles: boolean;
  changes: PlannedFileChange[];
}

export interface MigrationPlan {
  projectRoot: string;
  wroteFiles: boolean;
  changes: PlannedFileChange[];
  nextSteps: string[];
  rollbackSteps: string[];
}

export interface CompatRunCommandOptions {
  adapter: "vifx";
  report: CompatReportFormat;
  fixtureId?: string;
}
