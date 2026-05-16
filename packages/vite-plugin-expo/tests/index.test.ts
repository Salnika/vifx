import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vite-plus/test";
import { expo, findExpoAppConfig } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-plugin-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

test("findExpoAppConfig discovers app.json in the Expo fixture", async () => {
  const projectRoot = await copyFixture("expo-basic");

  await expect(findExpoAppConfig(projectRoot)).resolves.toBe(path.join(projectRoot, "app.json"));
});

test("expo() loads on the Expo fixture and injects EXPO_PUBLIC_ values", async () => {
  const projectRoot = await copyFixture("expo-basic");
  const appPath = path.join(projectRoot, "App.tsx");
  const originalSource = await readFile(appPath, "utf8");

  await writeFile(
    appPath,
    [originalSource.trimEnd(), "", "console.log(import.meta.env.EXPO_PUBLIC_VIFX_LABEL);", ""].join(
      "\n",
    ),
  );

  await build({
    appType: "custom",
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: ".vifx/expo-ios",
      rollupOptions: {
        input: path.join(projectRoot, "index.js"),
        output: {
          entryFileNames: "index.bundle",
          format: "es",
        },
      },
      sourcemap: true,
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      ...expo({
        entry: "./index.js",
        env: {
          EXPO_PUBLIC_VIFX_LABEL: "fixture-injected",
        },
        platform: "ios",
        projectRoot,
      }),
    ],
    publicDir: false,
    root: projectRoot,
  });

  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/expo-ios/index.bundle"),
    "utf8",
  );

  expect(bundleSource).toContain("fixture-injected");
  expect(bundleSource).toContain('AppRegistry.registerComponent("main"');
  expect(bundleSource).toContain('AppRegistry.runApplication("main"');
});
