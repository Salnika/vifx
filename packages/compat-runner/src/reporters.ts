import path from "node:path";
import { isLibraryBuildResult } from "@vifx/compat";
import type {
  CompatCategoryReport,
  CompatLibraryMatrixRow,
  CompatReportCase,
  CompatReportFormat,
  CompatRunReport,
} from "./types.ts";

export function buildLibraryMatrix(cases: CompatReportCase[]): CompatLibraryMatrixRow[] {
  return cases
    .filter((compatCase) => compatCase.category === "libraries")
    .map((compatCase) => {
      const result = isLibraryBuildResult(compatCase.actual) ? compatCase.actual : null;
      return {
        caseId: compatCase.caseId,
        packageName: result?.packageName ?? compatCase.caseId,
        status: compatCase.status,
        detail: result?.detail ?? compatCase.message,
        docsPath: compatCase.docsPath,
      } satisfies CompatLibraryMatrixRow;
    });
}

const LIBRARY_STATUS_LABELS: Record<CompatLibraryMatrixRow["status"], string> = {
  pass: "pass",
  partial: "partial",
  fail: "fail",
  skip: "skip",
};

function createCategoryLine(categoryReport: CompatCategoryReport, width: number) {
  return `${categoryReport.category.padEnd(width)} ${categoryReport.status.padEnd(4)} ${categoryReport.passed}/${categoryReport.total}`;
}

function formatFailureCase(failureCase: CompatReportCase) {
  const fixturePath =
    path.relative(process.cwd(), failureCase.fixturePath) || failureCase.fixturePath;
  return [
    `- ${failureCase.caseId}`,
    `  Fixture: ${fixturePath}`,
    `  Message: ${failureCase.message}`,
    `  Docs: ${failureCase.docsPath}`,
  ].join("\n");
}

export function buildCategoryReports(cases: CompatReportCase[]): CompatCategoryReport[] {
  const groupedCategories = new Map<
    CompatCategoryReport["category"],
    { passed: number; total: number }
  >();

  for (const compatCase of cases) {
    const existingCategory = groupedCategories.get(compatCase.category);
    if (existingCategory) {
      existingCategory.total += 1;
      existingCategory.passed += compatCase.passed ? 1 : 0;
      continue;
    }

    groupedCategories.set(compatCase.category, {
      total: 1,
      passed: compatCase.passed ? 1 : 0,
    });
  }

  return [...groupedCategories.entries()].map(([category, counts]) => ({
    category,
    passed: counts.passed,
    total: counts.total,
    status: counts.passed === counts.total ? "PASS" : "FAIL",
  }));
}

export function formatCompatReport(report: CompatRunReport, format: CompatReportFormat) {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "markdown") {
    const categoryRows = report.categories
      .map(
        (category) =>
          `| ${category.category} | ${category.status} | ${category.passed}/${category.total} |`,
      )
      .join("\n");

    const failureSection =
      report.failedCases === 0
        ? "No failing cases."
        : report.cases
            .filter((compatCase) => !compatCase.passed)
            .map((compatCase) => `- \`${compatCase.caseId}\` (${compatCase.docsPath})`)
            .join("\n");

    const librarySection =
      report.libraryMatrix.length === 0
        ? []
        : [
            "",
            "## Library support matrix",
            "",
            `Observed status for the \`${report.adapterId}\` toolchain. \`partial\` means the JavaScript bundles but a build-time-invisible aspect (native module, worklet, CSS/Babel transform) is not exercised; \`skip\` means the toolchain does not run the case.`,
            "",
            "| Library | Status | Notes |",
            "| --- | --- | --- |",
            ...report.libraryMatrix.map(
              (row) =>
                `| \`${row.packageName}\` | ${LIBRARY_STATUS_LABELS[row.status]} | ${row.detail.replace(/\|/g, "\\|")} |`,
            ),
          ];

    return [
      "# Compatibility report",
      "",
      `- Adapter: ${report.adapterId}`,
      `- Status: ${report.status}`,
      `- Generated: ${report.generatedAt}`,
      "",
      "| Category | Status | Pass rate |",
      "| --- | --- | --- |",
      categoryRows,
      ...librarySection,
      "",
      "## Failures",
      failureSection,
    ].join("\n");
  }

  const categoryWidth = Math.max(
    "Category".length,
    ...report.categories.map((category) => category.category.length),
  );
  const failureCases = report.cases.filter((compatCase) => !compatCase.passed);

  const librarySection =
    report.libraryMatrix.length === 0
      ? []
      : (() => {
          const libraryWidth = Math.max(
            "Library".length,
            ...report.libraryMatrix.map((row) => row.packageName.length),
          );
          return [
            "",
            "Library support matrix:",
            ...report.libraryMatrix.map(
              (row) =>
                `  ${row.packageName.padEnd(libraryWidth)}  ${LIBRARY_STATUS_LABELS[row.status].padEnd(7)}  ${row.detail}`,
            ),
          ];
        })();

  return [
    "Compatibility report",
    "",
    `Adapter: ${report.adapterId}`,
    `Status: ${report.status}`,
    `Cases: ${report.passedCases}/${report.totalCases} passed`,
    "",
    ...report.categories.map((category) => createCategoryLine(category, categoryWidth)),
    ...librarySection,
    "",
    failureCases.length === 0
      ? "No failing cases."
      : ["Failures:", ...failureCases.map((failureCase) => formatFailureCase(failureCase))].join(
          "\n",
        ),
  ].join("\n");
}
