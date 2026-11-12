import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { applyProjectEnv, getProjectEnvFileNames, loadProjectEnv } from "../src/index.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createProject(files: Record<string, string>) {
  const projectRoot = await mkdtemp(join(tmpdir(), "vifx-env-"));
  tempDirectories.push(projectRoot);

  for (const [fileName, source] of Object.entries(files)) {
    await writeFile(join(projectRoot, fileName), source, "utf8");
  }

  return projectRoot;
}

test("lists dotenv files in Expo's priority order", () => {
  expect(getProjectEnvFileNames("development")).toEqual([
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]);
  // Machine-local overrides never leak into test runs.
  expect(getProjectEnvFileNames("test")).toEqual([".env.test.local", ".env.test", ".env"]);
});

test("the most specific file wins and missing files are skipped", async () => {
  const projectRoot = await createProject({
    ".env": "EXPO_PUBLIC_API=base\nEXPO_PUBLIC_ONLY_BASE=1\n",
    ".env.local": "EXPO_PUBLIC_API=local\n",
    ".env.production": "EXPO_PUBLIC_API=production\nEXPO_PUBLIC_STAGE=prod\n",
  });

  const development = await loadProjectEnv({ env: {}, mode: "development", projectRoot });
  expect(development.files).toEqual([".env.local", ".env"]);
  expect(development.env).toEqual({ EXPO_PUBLIC_API: "local", EXPO_PUBLIC_ONLY_BASE: "1" });

  // `.env.local` outranks `.env.<mode>`, exactly as in Expo CLI.
  const production = await loadProjectEnv({ env: {}, mode: "production", projectRoot });
  expect(production.files).toEqual([".env.local", ".env.production", ".env"]);
  expect(production.env).toEqual({
    EXPO_PUBLIC_API: "local",
    EXPO_PUBLIC_ONLY_BASE: "1",
    EXPO_PUBLIC_STAGE: "prod",
  });
});

test("variables already in the environment are never overridden", async () => {
  const projectRoot = await createProject({
    ".env": "EXPO_PUBLIC_API=from-file\nEXPO_PUBLIC_OTHER=kept\n",
  });
  const shellEnv = { EXPO_PUBLIC_API: "from-shell" };

  const loaded = await loadProjectEnv({ env: shellEnv, mode: "development", projectRoot });
  expect(loaded.env).toEqual({ EXPO_PUBLIC_OTHER: "kept" });

  const target: Record<string, string | undefined> = { ...shellEnv };
  expect(applyProjectEnv(loaded, target)).toEqual(["EXPO_PUBLIC_OTHER"]);
  expect(target).toEqual({ EXPO_PUBLIC_API: "from-shell", EXPO_PUBLIC_OTHER: "kept" });
  // The base environment handed to loadProjectEnv is left untouched.
  expect(shellEnv).toEqual({ EXPO_PUBLIC_API: "from-shell" });
});

test("expands references against the shell and the files", async () => {
  const projectRoot = await createProject({
    ".env": [
      "HOST=api.example.com",
      "EXPO_PUBLIC_URL=https://${HOST}/v1",
      "EXPO_PUBLIC_USER=$USER_NAME",
      "EXPO_PUBLIC_REGION=${REGION:-eu-west-1}",
      "EXPO_PUBLIC_PRICE=\\$10",
      "EXPO_PUBLIC_MISSING=[${NOT_SET}]",
      'EXPO_PUBLIC_QUOTED="hello world" # trailing comment',
    ].join("\n"),
  });

  const loaded = await loadProjectEnv({
    env: { USER_NAME: "ada" },
    mode: "development",
    projectRoot,
  });

  expect(loaded.env).toMatchObject({
    EXPO_PUBLIC_MISSING: "[]",
    EXPO_PUBLIC_PRICE: "$10",
    EXPO_PUBLIC_QUOTED: "hello world",
    EXPO_PUBLIC_REGION: "eu-west-1",
    EXPO_PUBLIC_URL: "https://api.example.com/v1",
    EXPO_PUBLIC_USER: "ada",
  });
});

test("EXPO_NO_DOTENV disables dotenv loading", async () => {
  const projectRoot = await createProject({ ".env": "EXPO_PUBLIC_API=from-file\n" });

  expect(
    await loadProjectEnv({ env: { EXPO_NO_DOTENV: "1" }, mode: "development", projectRoot }),
  ).toEqual({ env: {}, files: [] });
  expect(
    (await loadProjectEnv({ env: { EXPO_NO_DOTENV: "0" }, mode: "development", projectRoot })).env,
  ).toEqual({ EXPO_PUBLIC_API: "from-file" });
});
