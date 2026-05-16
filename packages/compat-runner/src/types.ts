import type {
  CompatCase,
  CompatCaseOutcome,
  CompatCategory,
  FixtureId,
  FixtureManifest,
  PackageManager,
  ProjectType,
} from "@vifx/compat";
import type { VifxVitePluginMode } from "@vifx/types";

export type CompatAdapterId = "metro" | "vifx";
export type CompatReportFormat = "terminal" | "json" | "markdown";
export type DiagnosticLevel = "info" | "warn" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  summary: string;
  hint?: string;
  docsPath?: string;
}

export interface AssetGroup {
  assetPath: string;
  scales: number[];
  files: string[];
}

export interface ProjectInspection {
  projectRoot: string;
  workspaceRoot: string;
  packageName: string | null;
  projectType: ProjectType;
  packageManager: PackageManager;
  nodeVersion: string;
  expoVersion: string | null;
  reactNativeVersion: string | null;
  metroConfigPath: string | null;
  viteConfigPath: string | null;
  vitePluginMode: VifxVitePluginMode;
  vifxConfigPath: string | null;
  hermesCompilerPath: string | null;
  platformFiles: string[];
  assetGroups: AssetGroup[];
  diagnostics: Diagnostic[];
}

export interface CompatCaseContext {
  fixtureId: FixtureId;
  fixtureManifest: FixtureManifest;
  fixturePath: string;
}

export interface CompatAdapter {
  id: CompatAdapterId;
  label: string;
  runCase(compatCase: CompatCase, context: CompatCaseContext): Promise<CompatCaseOutcome["actual"]>;
}

export interface CompatRunOptions {
  adapter: CompatAdapterId;
  fixtureIds?: FixtureId[];
  caseIds?: string[];
}

export interface CompatCategoryReport {
  category: CompatCategory;
  passed: number;
  total: number;
  status: "PASS" | "FAIL";
}

export interface CompatReportCase extends CompatCaseOutcome {
  fixturePath: string;
}

export interface CompatRunReport {
  adapterId: CompatAdapterId;
  generatedAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  status: "PASS" | "FAIL";
  categories: CompatCategoryReport[];
  cases: CompatReportCase[];
}
