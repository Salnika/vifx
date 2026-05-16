import { expect, test } from "vite-plus/test";
import { resolveFixturePath } from "@vifx/compat";
import { formatCompatReport, inspectProject, runCompatSuite } from "../src/index.ts";

test("runCompatSuite executes the vifx adapter against the first-pass cases", async () => {
  const report = await runCompatSuite({
    adapter: "vifx",
  });

  expect(report.status).toBe("PASS");
  expect(report.totalCases).toBe(9);
  expect(report.failedCases).toBe(0);
});

test("runCompatSuite executes the Metro reference adapter against the first-pass cases", async () => {
  const report = await runCompatSuite({
    adapter: "metro",
  });

  expect(report.status).toBe("PASS");
  expect(report.totalCases).toBe(9);
  expect(report.failedCases).toBe(0);
});

test("inspectProject returns doctor-friendly metadata", async () => {
  const inspection = await inspectProject(resolveFixturePath("expo-basic"));

  expect(inspection.projectType).toBe("expo");
  expect(inspection.packageManager).toBe("pnpm");
  expect(inspection.metroConfigPath).toBe("metro.config.js");
  expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "VIFX_CONFIG_MISSING",
  );
});

test("formatCompatReport supports terminal and markdown output", async () => {
  const report = await runCompatSuite({
    adapter: "vifx",
    fixtureIds: ["rn-bare-platform-files"],
  });

  const terminalReport = formatCompatReport(report, "terminal");
  const markdownReport = formatCompatReport(report, "markdown");

  expect(terminalReport).toContain("resolver.platformExtensions");
  expect(markdownReport).toContain("| resolver.platformExtensions | PASS | 4/4 |");
});
