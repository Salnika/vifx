import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

test("rejects case-ambiguous platform candidates", async () => {
  const projectRoot = await createTempProject();
  const sourceDirectory = path.join(projectRoot, "src");

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
    "src/Button.ios.tsx": "export const Button = 'ios';",
    "src/button.ios.tsx": "export const Button = 'lower-ios';",
  });

  if ((await readFile(path.join(sourceDirectory, "Button.ios.tsx"), "utf8")).includes("lower")) {
    return;
  }

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(sourceDirectory, "App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "./Button",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE",
    details: {
      filePaths: [
        path.join(sourceDirectory, "Button.ios.tsx"),
        path.join(sourceDirectory, "button.ios.tsx"),
      ],
    },
  });
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

test("respects configured package main field order", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/ordered-button/dist/index.ts": "export const mode = 'module';",
    "node_modules/ordered-button/package.json": JSON.stringify(
      {
        main: "./src/main",
        module: "./dist/index",
        name: "ordered-button",
        "react-native": "./src/native",
      },
      null,
      2,
    ),
    "node_modules/ordered-button/src/main.ts": "export const mode = 'main';",
    "node_modules/ordered-button/src/native.ts": "export const mode = 'native';",
    "src/App.tsx": "export {};",
  });

  const result = await resolveReactNativeModule({
    fromFile: path.join(projectRoot, "src/App.tsx"),
    mainFields: ["module", "react-native", "main"],
    platform: "ios",
    projectRoot,
    specifier: "ordered-button",
  });

  expect(result.filePath).toBe(path.join(projectRoot, "node_modules/ordered-button/dist/index.ts"));
  expect(result.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: 'Matched package main field "module".',
      }),
    ]),
  );
});

test("rejects malformed package specifiers with structured diagnostics", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "src/App.tsx": "export {};",
  });

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(projectRoot, "src/App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "@scope",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_INVALID_SPECIFIER",
    details: {
      specifier: "@scope",
    },
    name: "VifxError",
  });
});

test("rejects invalid package manifests with structured diagnostics", async () => {
  const projectRoot = await createTempProject();

  await writeFiles(projectRoot, {
    "node_modules/broken-package/package.json": "{",
    "src/App.tsx": "export {};",
  });

  await expect(
    resolveReactNativeModule({
      fromFile: path.join(projectRoot, "src/App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "broken-package",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
    details: {
      packageJsonPath: path.join(projectRoot, "node_modules/broken-package/package.json"),
    },
    name: "VifxError",
  });
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
