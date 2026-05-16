import path from "node:path";
import type {
  CompatCategoryReport,
  CompatReportCase,
  CompatReportFormat,
  CompatRunReport,
} from "./types.ts";

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

  return [
    "Compatibility report",
    "",
    `Adapter: ${report.adapterId}`,
    `Status: ${report.status}`,
    `Cases: ${report.passedCases}/${report.totalCases} passed`,
    "",
    ...report.categories.map((category) => createCategoryLine(category, categoryWidth)),
    "",
    failureCases.length === 0
      ? "No failing cases."
      : ["Failures:", ...failureCases.map((failureCase) => formatFailureCase(failureCase))].join(
          "\n",
        ),
  ].join("\n");
}
