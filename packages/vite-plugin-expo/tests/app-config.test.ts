import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearProjectRequireChainCache } from "@vifx/platform-resolver";
import { afterEach, expect, test } from "vite-plus/test";
import { createAnonymousScopeKey, resolveExpoAppConfig } from "../src/index.ts";
import { canListenOnLocalhost, createExpoGoTestProject, startTestServer } from "./harness.ts";

const projectRoots: string[] = [];
const ENV_PROBE = "VIFX_APP_CONFIG_PROBE";

afterEach(async () => {
  delete process.env[ENV_PROBE];
  clearProjectRequireChainCache();
  await Promise.all(
    projectRoots.splice(0).map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
  );
});

async function createProject(files: Record<string, string>) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-app-config-"));
  projectRoots.push(projectRoot);

  const projectFiles: Record<string, string> = {
    "package.json": JSON.stringify({ name: "config-app", version: "1.2.3" }),
    ...files,
  };
  for (const [fileName, source] of Object.entries(projectFiles)) {
    const filePath = path.join(projectRoot, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, source, "utf8");
  }

  return projectRoot;
}

test("reads a static app.json and defaults name/slug to the package name", async () => {
  const withConfig = await resolveExpoAppConfig({
    projectRoot: await createProject({
      "app.json": JSON.stringify({ expo: { scheme: "configapp", slug: "from-app-json" } }),
    }),
  });
  expect(withConfig.exp).toEqual({
    name: "config-app",
    scheme: "configapp",
    slug: "from-app-json",
  });
  expect(withConfig.resolvedBy).toBe("vifx");
  expect(withConfig.dynamicConfigPath).toBeNull();

  const withoutConfig = await resolveExpoAppConfig({ projectRoot: await createProject({}) });
  expect(withoutConfig.exp).toEqual({ name: "config-app", slug: "config-app" });
});

test("a dynamic config function builds on the static config it receives", async () => {
  process.env[ENV_PROBE] = "staging";
  const projectRoot = await createProject({
    "app.config.js": [
      "module.exports = ({ config }) => ({",
      "  ...config,",
      "  name: config.name + ' (' + process.env.VIFX_APP_CONFIG_PROBE + ')',",
      "  extra: { stage: process.env.VIFX_APP_CONFIG_PROBE, eas: { projectId: 'abc-123' } },",
      "  hooks: () => 'functions are not serializable',",
      "});",
      "",
    ].join("\n"),
    "app.json": JSON.stringify({ expo: { name: "Config App", slug: "config-app-slug" } }),
  });

  const resolved = await resolveExpoAppConfig({ projectRoot });

  expect(resolved.exp).toEqual({
    extra: { eas: { projectId: "abc-123" }, stage: "staging" },
    name: "Config App (staging)",
    slug: "config-app-slug",
  });
  expect(resolved.dynamicConfigPath).toBe(path.join(projectRoot, "app.config.js"));
  expect(resolved.staticConfigPath).toBe(path.join(projectRoot, "app.json"));
});

test("an object export replaces the static config, and may wrap itself in `expo`", async () => {
  const projectRoot = await createProject({
    "app.config.ts": [
      "interface AppConfig { expo: { name: string; slug: string; version: string } }",
      "const config: AppConfig = { expo: { name: 'TS Config', slug: 'ts-config', version: '9.9.9' } };",
      "export default config;",
      "",
    ].join("\n"),
    "app.json": JSON.stringify({ expo: { scheme: "ignored-by-object-export" } }),
  });

  const { exp } = await resolveExpoAppConfig({ projectRoot });

  expect(exp).toEqual({ name: "TS Config", slug: "ts-config", version: "9.9.9" });
});

test("an explicit appConfigPath pins the config file", async () => {
  const projectRoot = await createProject({
    "app.json": JSON.stringify({ expo: { name: "Default", slug: "default" } }),
    "config/app.staging.json": JSON.stringify({ expo: { name: "Staging", slug: "staging" } }),
  });

  const { exp, staticConfigPath } = await resolveExpoAppConfig({
    appConfigPath: "config/app.staging.json",
    projectRoot,
  });

  expect(exp).toEqual({ name: "Staging", slug: "staging" });
  expect(staticConfigPath).toBe(path.join(projectRoot, "config/app.staging.json"));
});

test("a throwing dynamic config surfaces a structured error naming the file", async () => {
  const projectRoot = await createProject({
    "app.config.js": "module.exports = () => { throw new Error('missing API key'); };\n",
  });

  await expect(resolveExpoAppConfig({ projectRoot })).rejects.toMatchObject({
    code: "VIFX_EXPO_CONFIG_INVALID",
    message: expect.stringContaining("missing API key"),
  });
});

test.runIf(await canListenOnLocalhost())(
  "the Expo Go manifest reflects a dynamic app.config.js",
  async () => {
    const project = await createExpoGoTestProject({ name: "Static Name", slug: "dynamic-app" });
    projectRoots.push(project.projectRoot);
    process.env[ENV_PROBE] = "preview";
    await writeFile(
      path.join(project.projectRoot, "app.config.js"),
      [
        "module.exports = ({ config }) => ({",
        "  ...config,",
        "  name: 'Dynamic Name',",
        "  scheme: 'dynamicapp',",
        "  extra: { channel: process.env.VIFX_APP_CONFIG_PROBE, eas: { projectId: 'project-42' } },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const handle = await startTestServer(project);
    try {
      const manifest = (await handle.get("/manifest")).json<{
        extra: {
          eas: { projectId?: string };
          expoClient: { extra?: { channel?: string }; name: string; scheme?: string; slug: string };
          scopeKey: string;
        };
      }>();

      expect(manifest.extra.expoClient.name).toBe("Dynamic Name");
      expect(manifest.extra.expoClient.scheme).toBe("dynamicapp");
      expect(manifest.extra.expoClient.extra?.channel).toBe("preview");
      // Values the dynamic config kept from app.json survive.
      expect(manifest.extra.expoClient.slug).toBe("dynamic-app");
      // Expo Go for Android only installs Expo modules for an anonymous
      // (`@anonymous/...`) development manifest.
      expect(manifest.extra.scopeKey).toMatch(
        /^@anonymous\/dynamic-app-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(manifest.extra.scopeKey).toBe(
        createAnonymousScopeKey("dynamic-app", project.projectRoot),
      );
      expect(manifest.extra.eas.projectId).toBe("project-42");
      // The scheme now comes from the dynamic config, so a dev-client URL exists.
      expect(handle.server.devClientUrl).toContain("dynamicapp://");
    } finally {
      await handle.cleanup();
    }
  },
);

test("uses the project's own @expo/config when it is installed", async () => {
  const projectRoot = await createProject({
    "app.json": JSON.stringify({ expo: { name: "Ignored", slug: "ignored" } }),
    "node_modules/@expo/config/index.js": [
      "exports.getConfig = (projectRoot, options) => {",
      "  if (!options.skipPlugins) throw new Error('config plugin failed to load');",
      "  return {",
      "    exp: { name: 'From Expo Config', slug: 'from-expo-config', sdkVersion: '58.0.0', mods: null },",
      "    staticConfigPath: projectRoot + '/app.json',",
      "  };",
      "};",
      "",
    ].join("\n"),
    "node_modules/@expo/config/package.json": JSON.stringify({
      main: "index.js",
      name: "@expo/config",
    }),
  });

  const resolved = await resolveExpoAppConfig({ projectRoot });

  // A failing config plugin is retried without plugins instead of taking the
  // manifest down.
  expect(resolved.resolvedBy).toBe("expo-config");
  expect(resolved.exp).toEqual({
    mods: null,
    name: "From Expo Config",
    sdkVersion: "58.0.0",
    slug: "from-expo-config",
  });
});
