import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  applyPlannedChanges,
  formatPlannedChanges,
  planInit,
  planMigration,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("planInit creates a conservative vifx.config.ts preview", async () => {
  const plan = await planInit(path.join(FIXTURE_ROOT, "rn-bare-basic"), {});

  expect(plan.changes).toHaveLength(1);
  expect(plan.changes[0]?.path).toBe("vifx.config.ts");
  expect(formatPlannedChanges(plan.changes)).toContain("+++ create");
});

test("planMigration previews package.json and Vifx config changes for Expo fixtures", async () => {
  const plan = await planMigration(path.join(FIXTURE_ROOT, "expo-basic"), "expo", {
    withVite: false,
  });

  expect(plan.changes.map((change) => change.path)).toContain("package.json");
  expect(plan.changes.map((change) => change.path)).toContain("vifx.config.ts");
  expect(plan.nextSteps[0]).toContain("pnpm install");
});

test("applyPlannedChanges writes the generated files into a copied fixture", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  const plan = await planMigration(targetPath, "expo", {
    withVite: true,
  });

  await applyPlannedChanges(targetPath, plan.changes);

  expect(await readFile(path.join(targetPath, "vifx.config.ts"), "utf8")).toContain(
    "defineVifxConfig",
  );
  expect(await readFile(path.join(targetPath, "vite.config.ts"), "utf8")).toContain("defineConfig");
});
