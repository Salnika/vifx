import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { resolveFixturePath } from "@vifx/compat";
import { formatCompatReport, inspectProject, runCompatSuite } from "../src/index.ts";

test("runCompatSuite executes the vifx adapter against the compatibility cases", async () => {
  const report = await runCompatSuite({
    adapter: "vifx",
  });

  expect(report.status).toBe("PASS");
  expect(report.totalCases).toBe(35);
  expect(report.failedCases).toBe(0);
});

test("runCompatSuite executes the Metro reference adapter against the compatibility cases", async () => {
  const report = await runCompatSuite({
    adapter: "metro",
  });

  expect(report.status).toBe("PASS");
  expect(report.totalCases).toBe(35);
  expect(report.failedCases).toBe(0);
});

test("the vifx library matrix reflects the synthetic-package support snapshot", async () => {
  const report = await runCompatSuite({ adapter: "vifx" });
  const statusByPackage = new Map(report.libraryMatrix.map((row) => [row.packageName, row.status]));

  expect(report.libraryMatrix).toHaveLength(16);
  // Pure-JS surface resolves and bundles fully.
  expect(statusByPackage.get("react-native-safe-area-context")).toBe("pass");
  // A native module bundles but cannot run from a bundler build.
  expect(statusByPackage.get("react-native-gesture-handler")).toBe("partial");
  // Untranspiled JSX in a published .js file: the integrated project-derived Babel
  // pipeline runs node_modules sources through the RN preset on native (like Metro),
  // so the JSX is transpiled and the bundle builds.
  expect(statusByPackage.get("react-native-vector-icons")).toBe("pass");
});

test("the Metro library matrix records every library case as skipped", async () => {
  const report = await runCompatSuite({ adapter: "metro" });

  expect(report.libraryMatrix).toHaveLength(16);
  expect(report.libraryMatrix.every((row) => row.status === "skip")).toBe(true);
});

test("inspectProject returns doctor-friendly metadata", async () => {
  const inspection = await inspectProject(resolveFixturePath("expo-basic"));

  expect(inspection.projectType).toBe("expo");
  expect(inspection.packageManager).toBe("pnpm");
  expect(inspection.metroConfigPath).toBe("metro.config.js");
  expect(inspection.vitePluginMode).toBe("none");
  expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "VIFX_CONFIG_MISSING",
  );
});

test("inspectProject uses shared Vifx config filenames", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vifx-compat-runner-"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "config-format-fixture" }, null, 2),
    "utf8",
  );
  await writeFile(path.join(projectRoot, "vifx.config.mts"), "export default {};\n", "utf8");

  const inspection = await inspectProject(projectRoot);

  expect(inspection.vifxConfigPath).toBe("vifx.config.mts");
  expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "VIFX_CONFIG_MISSING",
  );
});

test("inspectProject detects Vifx-owned Vite config formats", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vifx-compat-runner-"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "vite-format-fixture" }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "vite.config.vifx.mts"),
    'import { reactNativeVitePlugin } from "@vifx/vite-plugin-react-native";\nexport default { plugins: [reactNativeVitePlugin()] };\n',
    "utf8",
  );

  const inspection = await inspectProject(projectRoot);

  expect(inspection.viteConfigPath).toBe("vite.config.vifx.mts");
  expect(inspection.vitePluginMode).toBe("react-native");
});

test("inspectProject ignores generated Vifx output directories", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vifx-compat-runner-"));

  await mkdir(path.join(projectRoot, "src", "assets"), { recursive: true });
  await mkdir(path.join(projectRoot, ".vifx", "native", "ios", "assets"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "generated-output-fixture" }, null, 2),
    "utf8",
  );
  await writeFile(path.join(projectRoot, "src", "assets", "icon.svg"), "<svg />\n", "utf8");
  await writeFile(
    path.join(projectRoot, ".vifx", "native", "ios", "assets", "icon.svg"),
    "<svg />\n",
    "utf8",
  );

  const inspection = await inspectProject(projectRoot);

  expect(inspection.assetGroups.map((assetGroup) => assetGroup.assetPath)).toEqual([
    "src/assets/icon.svg",
  ]);
});

test("inspectProject warns for Expo SDK versions outside the fixture-backed range", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vifx-compat-runner-"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          expo: "~53.0.0",
          "react-native": "0.80.0",
        },
        name: "old-expo-fixture",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "Old Expo" } }, null, 2),
    "utf8",
  );

  const inspection = await inspectProject(projectRoot);

  expect(inspection.projectType).toBe("expo");
  expect(inspection.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION",
        level: "warn",
      }),
    ]),
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
