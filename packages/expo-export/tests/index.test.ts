import path from "node:path";
import { expect, test } from "vite-plus/test";
import { inspectExpoExport } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("inspectExpoExport normalizes bundles, assets, and manifests from an export fixture", async () => {
  const result = await inspectExpoExport({
    exportRoot: "dist",
    projectRoot: path.join(FIXTURE_ROOT, "expo-export-basic"),
  });

  expect(result.bundles).toHaveLength(2);
  expect(result.assets).toHaveLength(1);
  expect(result.manifests.map((manifest) => manifest.kind)).toEqual(["manifest", "metadata"]);
  expect(result.bundles.every((bundle) => bundle.sourceMap?.valid ?? false)).toBe(true);
});
