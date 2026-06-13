import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  applyPlannedChanges,
  formatPlannedChanges,
  planExpoSetup,
  planInit,
  planMigration,
  planViteInit,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("planInit creates a vifx.config.ts preview", async () => {
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

test("planExpoSetup creates an importless Expo config without mutating package.json", async () => {
  const plan = await planExpoSetup(path.join(FIXTURE_ROOT, "expo-basic"));
  const plannedPaths = plan.changes.map((change) => change.path);
  const vifxConfigChange = plan.changes.find((change) => change.path === "vifx.config.ts");

  expect(plan.detectedProjectType).toBe("expo");
  expect(plan.expoRouter).toBe(false);
  expect(plan.appDirectory).toBe(false);
  expect(plan.webPreviewConfigured).toBe(false);
  expect(plannedPaths).toEqual(["vifx.config.ts"]);
  expect(vifxConfigChange?.after).toContain("export default {");
  expect(vifxConfigChange?.after).not.toContain("defineVifxConfig");
  expect(vifxConfigChange?.after).toContain("projectRoot: process.cwd()");
  expect(vifxConfigChange?.after).toContain('mode: "expo"');
});

test("planMigration reports invalid package.json as a structured project error", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-invalid-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(path.join(targetPath, "package.json"), "{", "utf8");

  await expect(
    planMigration(targetPath, "react-native", { withVite: false }),
  ).rejects.toMatchObject({
    code: "VIFX_PROJECT_INVALID_PACKAGE_JSON",
    name: "VifxError",
  });
});

test("planViteInit creates a real Vite plugin config for Expo fixtures", async () => {
  const plan = await planViteInit(path.join(FIXTURE_ROOT, "expo-basic"), {});
  const packageJsonChange = plan.changes.find((change) => change.path === "package.json");
  const viteConfigChange = plan.changes.find((change) => change.path === "vite.config.vifx.ts");

  expect(packageJsonChange?.after).toContain('"vifx:vite": "vite --config vite.config.vifx.ts"');
  expect(viteConfigChange?.after).toContain("@vifx/vite-plugin-expo");
  expect(viteConfigChange?.after).toContain("VIFX_PLATFORM");
});

test("planViteInit detects Expo Router entries for browser preview targets", async () => {
  const plan = await planViteInit(path.join(FIXTURE_ROOT, "expo-router-basic"), {});
  const vifxConfigChange = plan.changes.find((change) => change.path === "vifx.config.ts");
  const viteConfigChange = plan.changes.find((change) => change.path === "vite.config.vifx.ts");

  expect(vifxConfigChange?.after).toContain('entry: "expo-router/entry"');
  expect(vifxConfigChange?.after).toContain('reactNativeCompat: "web"');
  expect(viteConfigChange?.after).toContain('entry: "expo-router/entry"');
});

test("planExpoSetup detects Expo Router browser preview targets and opt-in Vite config", async () => {
  const plan = await planExpoSetup(path.join(FIXTURE_ROOT, "expo-router-basic"), {
    withViteConfig: true,
  });
  const vifxConfigChange = plan.changes.find((change) => change.path === "vifx.config.ts");
  const viteConfigChange = plan.changes.find((change) => change.path === "vite.config.vifx.ts");

  expect(plan.expoRouter).toBe(true);
  expect(plan.appDirectory).toBe(true);
  expect(plan.webPreviewConfigured).toBe(true);
  expect(vifxConfigChange?.after).toContain('entry: "expo-router/entry"');
  expect(vifxConfigChange?.after).toContain('reactNativeCompat: "web"');
  expect(viteConfigChange?.after).toContain('entry: "expo-router/entry"');
});

test("planExpoSetup --expo-go opts native targets into the gated compat preview", async () => {
  const plan = await planExpoSetup(path.join(FIXTURE_ROOT, "expo-basic"), {
    expoGo: true,
  });
  const vifxConfigChange = plan.changes.find((change) => change.path === "vifx.config.ts");

  expect(plan.expoGo).toBe(true);
  expect(vifxConfigChange?.after).toContain("compatPreview: true");
  expect(vifxConfigChange?.after).toContain("real worklets land");
  // Expo Go targets native (not the web preview), so reactNativeCompat must stay off.
  expect(vifxConfigChange?.after).not.toContain('reactNativeCompat: "web"');
});

test("planExpoSetup leaves compatPreview out of the default (non Expo Go) config", async () => {
  const plan = await planExpoSetup(path.join(FIXTURE_ROOT, "expo-basic"));
  const vifxConfigChange = plan.changes.find((change) => change.path === "vifx.config.ts");

  expect(plan.expoGo).toBe(false);
  expect(vifxConfigChange?.after).not.toContain("compatPreview");
});

test("planExpoSetup preserves package.json and existing vite.config.ts by default", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-setup-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  const originalPackageJson = await readFile(path.join(targetPath, "package.json"), "utf8");
  const originalViteConfig = "export default { define: { __HNEWS__: true } };\n";

  await writeFile(path.join(targetPath, "vite.config.ts"), originalViteConfig, "utf8");

  const plan = await planExpoSetup(targetPath);
  await applyPlannedChanges(targetPath, plan.changes);

  expect(await readFile(path.join(targetPath, "package.json"), "utf8")).toBe(originalPackageJson);
  expect(await readFile(path.join(targetPath, "vite.config.ts"), "utf8")).toBe(originalViteConfig);
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
  expect(await readFile(path.join(targetPath, "vite.config.vifx.ts"), "utf8")).toContain(
    "@vifx/vite-plugin-expo",
  );
});
