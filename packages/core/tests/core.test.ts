import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import {
  createVifxContext,
  detectProject,
  detectWorkspaceRoot,
  loadVifxConfig,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("detects Expo projects when the expo dependency and app config are present", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "app.json": JSON.stringify({ expo: { name: "demo" } }, null, 2),
    "package.json": JSON.stringify(
      {
        dependencies: {
          expo: "^52.0.0",
        },
        name: "expo-app",
      },
      null,
      2,
    ),
  });

  const project = await detectProject(projectRoot);

  expect(project.projectType).toBe("expo");
  expect(project.appConfigPath).toBe(path.join(projectRoot, "app.json"));
  expect(project.reasons).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Detected an "expo" dependency.'),
      expect.stringContaining("Found Expo app config"),
    ]),
  );
});

test("detects bare React Native projects by dependency", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "package.json": JSON.stringify(
      {
        dependencies: {
          "react-native": "0.80.0",
        },
        name: "rn-app",
      },
      null,
      2,
    ),
  });

  const project = await detectProject(projectRoot);

  expect(project.projectType).toBe("react-native");
  expect(project.reasons).toEqual(
    expect.arrayContaining([expect.stringContaining('Detected a "react-native" dependency.')]),
  );
});

test("detects workspace roots from nested packages", async () => {
  const workspaceRoot = await createTempProject();
  const projectRoot = path.join(workspaceRoot, "apps/mobile");

  await writeFiles(workspaceRoot, {
    "apps/mobile/package.json": JSON.stringify({ name: "mobile" }, null, 2),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  });

  const workspace = await detectWorkspaceRoot(projectRoot);

  expect(workspace).toEqual({
    patterns: ["apps/*", "packages/*"],
    root: workspaceRoot,
    source: "pnpm-workspace",
  });
});

test("loads vifx.config.ts and wires injected primitive adapters", async () => {
  const projectRoot = await createTempProject();
  const appFile = path.join(projectRoot, "src/App.tsx");

  await writeFiles(projectRoot, {
    "package.json": JSON.stringify(
      {
        dependencies: {
          "react-native": "0.80.0",
        },
        name: "rn-app",
      },
      null,
      2,
    ),
    "src/App.tsx": "export {};",
    "vifx.config.ts": [
      "export default {",
      "  platforms: ['ios'],",
      "  resolver: { extensions: ['tsx', 'ts'] },",
      "};",
      "",
    ].join("\n"),
  });

  const configLoader = async () => ({
    normalizeVifxConfig(input: unknown) {
      const config = input as Record<string, unknown>;
      return {
        ...config,
        normalized: true,
      };
    },
  });
  const loaded = await loadVifxConfig({
    cwd: projectRoot,
    imports: {
      config: configLoader,
    },
  });

  expect(loaded.configFilePath).toBe(path.join(projectRoot, "vifx.config.ts"));
  expect(loaded.config).toMatchObject({
    normalized: true,
    platforms: ["ios"],
    projectRoot,
    resolver: {
      extensions: ["tsx", "ts"],
    },
  });

  const context = await createVifxContext({
    cwd: projectRoot,
    imports: {
      assetRegistry: async () => ({
        async collectAssetGroup(input) {
          return input;
        },
      }),
      config: configLoader,
      platformResolver: async () => ({
        async resolveReactNativeModule(input) {
          return input;
        },
      }),
    },
  });

  await expect(
    context.resolveModule({
      fromFile: appFile,
      platform: "ios",
      specifier: "./Button",
    }),
  ).resolves.toMatchObject({
    fromFile: appFile,
    platform: "ios",
    projectRoot,
    specifier: "./Button",
  });
  await expect(
    context.collectAssetGroup({
      filePath: path.join(projectRoot, "assets/icon.png"),
    }),
  ).resolves.toMatchObject({
    filePath: path.join(projectRoot, "assets/icon.png"),
    projectRoot,
  });
});

async function createTempProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "vifx-core-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeFiles(rootDirectory: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    await ensureParentDirectory(filePath);
    await writeFile(filePath, source, "utf8");
  }
}
