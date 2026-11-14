import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("planInit imports defineVifxConfig from @vifx/cli, never the unresolvable @vifx/config", async () => {
  // Regression for B4: a generated config must import from the package a user
  // actually installs (@vifx/cli, which ships the `vifx` bin and re-exports
  // defineVifxConfig). Importing the workspace-only @vifx/config makes the CLI
  // generate a config it cannot itself load (VIFX_CONFIG_LOAD_FAILED).
  const plan = await planInit(path.join(FIXTURE_ROOT, "rn-bare-basic"), {});
  const generated = plan.changes[0]?.after ?? "";

  expect(generated).toContain('import { defineVifxConfig } from "@vifx/cli";');
  expect(generated).not.toContain('from "@vifx/config"');
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

test("planExpoSetup takes the entry Expo bundles, with routes in src/app (SDK 55+ templates)", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-sdk58-"));
  await mkdir(path.join(projectRoot, "src", "app"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "app", "index.tsx"), "export default null;\n");
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      dependencies: { expo: "~58.0.25", "expo-router": "~58.0.31", "react-native": "0.88.1" },
      main: "expo-router/entry",
      name: "sdk58",
    }),
  );

  const router = await planExpoSetup(projectRoot, { expoGo: true });
  expect(router.appDirectory).toBe(true);
  expect(router.changes.find((change) => change.path === "vifx.config.ts")?.after).toContain(
    'entry: "expo-router/entry"',
  );

  // The blank TypeScript template: `main` names a project file.
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ dependencies: { expo: "~58.0.25" }, main: "index.ts", name: "blank" }),
  );
  await writeFile(path.join(projectRoot, "index.ts"), "export {};\n");
  const blank = await planExpoSetup(projectRoot, { expoGo: true });
  expect(blank.changes.find((change) => change.path === "vifx.config.ts")?.after).toContain(
    'entry: "./index.ts"',
  );
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
  const originalViteConfig = "export default { define: { __APP_FLAG__: true } };\n";

  await writeFile(path.join(targetPath, "vite.config.ts"), originalViteConfig, "utf8");

  const plan = await planExpoSetup(targetPath);
  await applyPlannedChanges(targetPath, plan.changes);

  expect(await readFile(path.join(targetPath, "package.json"), "utf8")).toBe(originalPackageJson);
  expect(await readFile(path.join(targetPath, "vite.config.ts"), "utf8")).toBe(originalViteConfig);
});

test("planExpoSetup --experimental-embed plans the app.json config plugin registration", async () => {
  const plan = await planExpoSetup(path.join(FIXTURE_ROOT, "expo-basic"), {
    experimentalEmbed: true,
  });
  const appJsonChange = plan.changes.find((change) => change.path === "app.json");
  const parsed = JSON.parse(appJsonChange?.after ?? "{}") as {
    expo: { name: string; plugins: string[]; slug: string };
  };

  expect(plan.experimentalEmbed).toBe(true);
  expect(appJsonChange?.kind).toBe("update");
  expect(parsed.expo.plugins).toEqual(["@vifx/expo-config-plugin"]);
  expect(parsed.expo.name).toBe("Expo Basic");
  expect(parsed.expo.slug).toBe("expo-basic");
});

test("planExpoSetup --experimental-embed is idempotent once the plugin is registered", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-embed-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const firstPlan = await planExpoSetup(targetPath, { experimentalEmbed: true });
  await applyPlannedChanges(targetPath, firstPlan.changes);

  const secondPlan = await planExpoSetup(targetPath, { experimentalEmbed: true });

  expect(firstPlan.changes.map((change) => change.path)).toContain("app.json");
  expect(secondPlan.changes.map((change) => change.path)).not.toContain("app.json");
});

test("planExpoSetup --experimental-embed keeps existing plugins including tuple entries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-embed-plugins-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "app.json"),
    JSON.stringify(
      {
        expo: {
          name: "Expo Basic",
          plugins: ["expo-router", ["expo-camera", { cameraPermission: "Allow" }]],
          slug: "expo-basic",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const plan = await planExpoSetup(targetPath, { experimentalEmbed: true });
  const appJsonChange = plan.changes.find((change) => change.path === "app.json");
  const parsed = JSON.parse(appJsonChange?.after ?? "{}") as { expo: { plugins: unknown[] } };

  expect(parsed.expo.plugins).toEqual([
    "expo-router",
    ["expo-camera", { cameraPermission: "Allow" }],
    "@vifx/expo-config-plugin",
  ]);
});

test("planExpoSetup --experimental-embed honors a tuple registration of the plugin", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-codemods-embed-tuple-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "app.json"),
    JSON.stringify(
      {
        expo: {
          name: "Expo Basic",
          plugins: [["@vifx/expo-config-plugin", { bundleCommand: "export:embed" }]],
          slug: "expo-basic",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const plan = await planExpoSetup(targetPath, { experimentalEmbed: true });

  expect(plan.changes.map((change) => change.path)).not.toContain("app.json");
});

test("planExpoSetup --experimental-embed requires a static app.json", async () => {
  await expect(
    planExpoSetup(path.join(FIXTURE_ROOT, "expo-router-basic"), { experimentalEmbed: true }),
  ).rejects.toMatchObject({
    code: "VIFX_SETUP_APP_JSON_REQUIRED",
    name: "VifxError",
  });
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
