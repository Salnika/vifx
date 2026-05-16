import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  detectProjectKind,
  findWorkspaceRoot,
  inspectProject,
  loadProjectContext,
} from "../src/index.ts";

describe("@vifx/core", () => {
  it("detects Expo and React Native projects from dependencies", () => {
    expect(detectProjectKind({ expo: "^54.0.0", react: "^19.0.0" })).toBe("expo");
    expect(detectProjectKind({ "react-native": "^0.82.0" })).toBe("react-native");
    expect(detectProjectKind({ react: "^19.0.0" })).toBe("unknown");
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
        "  targets: [{ platform: 'ios', entry: './index.js' }],",
        "};",
      ].join("\n"),
      "utf8",
    );

    const inspection = await inspectProject(projectRoot);
    const context = await loadProjectContext(projectRoot);
    const config = context.config as { targets?: Array<{ platform: string }> };

    expect(inspection.kind).toBe("expo");
    expect(config.targets?.[0]?.platform).toBe("ios");
    expect(context.inspection.packageManager).toBe("pnpm");
  });
});
