import path from "node:path";
import { expect, test } from "vite-plus/test";
import { formatMetroInspectionReport, inspectMetroProject } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("inspectMetroProject reads captured Metro artifacts for a React Native fixture", async () => {
  const report = await inspectMetroProject({
    platform: "ios",
    projectRoot: path.join(FIXTURE_ROOT, "rn-bare-basic"),
  });

  expect(report.bundle?.path).toBe("metro-output/ios/index.bundle");
  expect(report.sourceMap?.valid).toBe(true);
  expect(report.assets).toHaveLength(1);
});

test("inspectMetroProject reads captured Metro artifacts for an Expo fixture", async () => {
  const report = await inspectMetroProject({
    platform: "android",
    projectRoot: path.join(FIXTURE_ROOT, "expo-basic"),
  });

  expect(report.bundle?.path).toBe("metro-output/android/index.bundle");
  expect(report.sourceMap?.valid).toBe(true);
  expect(formatMetroInspectionReport(report)).toContain("Metro inspect report");
});

test("inspectMetroProject emits warnings instead of crashing when no artifacts exist", async () => {
  const report = await inspectMetroProject({
    platform: "ios",
    projectRoot: path.join(FIXTURE_ROOT, "rn-bare-platform-files"),
  });

  expect(report.bundle).toBe(null);
  expect(report.sourceMap).toBe(null);
  expect(report.warnings.length).toBeGreaterThan(0);
});
