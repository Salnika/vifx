import type {
  CompatCase,
  CompatCaseOutcome,
  CompatCaseStatus,
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

/**
 * One row of the library support matrix for the adapter under report. Captures
 * the observed status (pass/partial/fail/skip) plus the human-readable detail
 * the adapter produced, so terminal/markdown reporters and the docs page can
 * render the snapshot without re-running the suite.
 */
export interface CompatLibraryMatrixRow {
  caseId: string;
  packageName: string;
  status: CompatCaseStatus;
  detail: string;
  docsPath: string;
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
  /** Present when the run included any "libraries" category cases. */
  libraryMatrix: CompatLibraryMatrixRow[];
}
