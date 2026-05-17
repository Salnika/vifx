import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  VIFX_CONFIG_FILE_NAMES,
  detectProject,
  detectProjectKind,
  findWorkspaceRoot,
  inspectProject,
  loadProjectContext,
} from "../src/index.ts";

describe("@vifx/core", () => {
  it("re-exports the shared Vifx config filename contract", () => {
    expect(VIFX_CONFIG_FILE_NAMES).toEqual([
      "vifx.config.ts",
      "vifx.config.mts",
      "vifx.config.js",
      "vifx.config.mjs",
    ]);
  });

  it("detects Expo and React Native projects from dependencies", () => {
    expect(detectProjectKind({ expo: "^54.0.0", react: "^19.0.0" })).toBe("expo");
    expect(detectProjectKind({ "react-native": "^0.82.0" })).toBe("react-native");
    expect(detectProjectKind({ react: "^19.0.0" })).toBe("unknown");
  });

  it("detects Expo projects from either dependency or app config signals", async () => {
    const dependencyOnlyRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-dep-"));
    await writeFile(
      path.join(dependencyOnlyRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            expo: "^54.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const configOnlyRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-config-"));
    await writeFile(path.join(configOnlyRoot, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(configOnlyRoot, "app.json"), '{"expo":{"name":"Fixture"}}\n', "utf8");

    await expect(detectProject(dependencyOnlyRoot)).resolves.toMatchObject({
      projectType: "expo",
    });
    await expect(detectProject(configOnlyRoot)).resolves.toMatchObject({
      projectType: "expo",
    });
  });

  it("reports invalid project package manifests as structured errors", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-invalid-package-json-"));
    await writeFile(path.join(projectRoot, "package.json"), "{", "utf8");

    await expect(detectProject(projectRoot)).rejects.toMatchObject({
      code: "VIFX_PROJECT_INVALID_PACKAGE_JSON",
      details: {
        packageJsonPath: path.join(projectRoot, "package.json"),
      },
      name: "VifxError",
    });
  });

  it("finds the nearest workspace root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vifx-core-"));
    const nested = path.join(root, "apps", "mobile");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");

    expect(await findWorkspaceRoot(nested)).toBe(root);
  });

  it("inspects a project and loads its config when available", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-project-"));
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            expo: "^54.0.0",
          },
          packageManager: "pnpm@11.1.2",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "vifx.config.mjs"),
      [
        "export default {",
        `  projectRoot: ${JSON.stringify(projectRoot)},`,
        "  vite: { mode: 'expo', targets: [{ platform: 'ios', entry: './index.js', hermes: false }] },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const inspection = await inspectProject(projectRoot);
    const context = await loadProjectContext(projectRoot);

    expect(inspection.kind).toBe("expo");
    expect(context.config.vite.targets[0]?.platform).toBe("ios");
    expect(context.inspection.packageManager).toBe("pnpm");
  });
});
