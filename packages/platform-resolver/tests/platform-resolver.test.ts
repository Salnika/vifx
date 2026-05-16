import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import { resolveReactNativeModule } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("resolves relative imports with platform and native fallbacks", async () => {
  const projectRoot = await createTempProject();
  const sourceDirectory = path.join(projectRoot, "src");

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
    "src/Button.native.tsx": "export const Button = 'native';",
    "src/Button.tsx": "export const Button = 'base';",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(sourceDirectory, "App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "./Button",
  });

  expect(result.filePath).toBe(path.join(sourceDirectory, "Button.native.tsx"));
  expect(result.resolvedVia).toBe("relative");
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidate: path.join(sourceDirectory, "Button.ios.tsx"),
        exists: false,
      }),
      expect.objectContaining({
        candidate: path.join(sourceDirectory, "Button.native.tsx"),
        exists: true,
        type: "resolved",
      }),
    ]),
  );
});

test("resolves bare packages through exports with react-native conditions", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/fancy-button/package.json": JSON.stringify(
      {
        exports: {
          ".": {
            "react-native": "./src/index.native",
            default: "./src/index.js",
          },
        },
        name: "fancy-button",
      },
      null,
      2,
    ),
    "node_modules/fancy-button/src/index.native.tsx": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "android",
    projectRoot,
    specifier: "fancy-button",
  });

  expect(result.filePath).toBe(
    path.join(projectRoot, "node_modules/fancy-button/src/index.native.tsx"),
  );
  expect(result.packageName).toBe("fancy-button");
  expect(result.packageRoot).toBe(path.join(projectRoot, "node_modules/fancy-button"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Matched package export condition "react-native"'),
        type: "condition",
      }),
    ]),
  );
});

test("resolves legacy react-native package fields when exports are absent", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/legacy-button/package.json": JSON.stringify(
      {
        main: "./dist/index.js",
        name: "legacy-button",
        "react-native": "./src/native-entry",
      },
      null,
      2,
    ),
    "node_modules/legacy-button/src/native-entry.ts": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "legacy-button",
  });

  expect(result.filePath).toBe(
    path.join(projectRoot, "node_modules/legacy-button/src/native-entry.ts"),
  );
  expect(result.packageName).toBe("legacy-button");
});

test("resolves workspace packages without a node_modules install", async () => {
  const workspaceRoot = await createTempProject();
  const projectRoot = path.join(workspaceRoot, "apps/mobile");

  await writeFiles(workspaceRoot, {
    "apps/mobile/package.json": JSON.stringify(
      {
        name: "mobile",
      },
      null,
      2,
    ),
    "apps/mobile/src/App.tsx": "export {};",
    "packages/ui/package.json": JSON.stringify(
      {
        name: "@acme/ui",
        "react-native": "./src/index",
      },
      null,
      2,
    ),
    "packages/ui/src/index.native.tsx": "export const mode = 'workspace-native';",
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    platform: "ios",
    projectRoot,
    specifier: "@acme/ui",
  });

  expect(result.filePath).toBe(path.join(workspaceRoot, "packages/ui/src/index.native.tsx"));
  expect(result.packageRoot).toBe(path.join(workspaceRoot, "packages/ui"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidate: path.join(workspaceRoot, "pnpm-workspace.yaml"),
        exists: true,
        type: "workspace",
      }),
      expect.objectContaining({
        candidate: path.join(workspaceRoot, "packages/ui"),
        exists: true,
        type: "workspace",
      }),
    ]),
  );
});

async function createTempProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "vifx-platform-resolver-"));
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
