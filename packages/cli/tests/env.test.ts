import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { executeCli } from "../src/index.ts";

const PROBE = "EXPO_PUBLIC_VIFX_ENV_PROBE";
const SECRET = "VIFX_ENV_PRIVATE_PROBE";
const projectRoots: string[] = [];

afterEach(async () => {
  // The CLI loads dotenv files into process.env, like Expo CLI; undo it so the
  // tests stay independent of each other.
  delete process.env[PROBE];
  delete process.env[SECRET];
  await Promise.all(
    projectRoots.splice(0).map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
  );
});

async function createProject(files: Record<string, string>) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-env-"));
  projectRoots.push(projectRoot);

  const projectFiles: Record<string, string> = {
    "index.js": `console.log("probe:" + process.env.${PROBE}, typeof process.env.${SECRET});\n`,
    "package.json": JSON.stringify({ name: "cli-env" }),
    "vifx.config.ts": [
      "export default {",
      `  projectRoot: ${JSON.stringify(projectRoot)},`,
      '  projectType: "react-native",',
      "  reactNative: true,",
      "  vite: {",
      '    mode: "react-native",',
      "    targets: [",
      '      { platform: "ios", entry: "./index.js", outDir: ".vifx/env/ios", hermes: false },',
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
    ...files,
  };

  for (const [fileName, source] of Object.entries(projectFiles)) {
    await writeFile(path.join(projectRoot, fileName), source, "utf8");
  }

  return projectRoot;
}

async function buildAndReadBundle(projectRoot: string, extraArgs: string[] = []) {
  const result = await executeCli(["build", projectRoot, "--platform", "ios", ...extraArgs]);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);

  return readFile(path.join(projectRoot, ".vifx/env/ios/index.bundle"), "utf8");
}

test("build inlines EXPO_PUBLIC_* variables from the project's .env files", async () => {
  const projectRoot = await createProject({
    ".env": `${PROBE}=from-dotenv\n${SECRET}=never-bundled\n`,
    ".env.production": `${PROBE}=from-dotenv-production\n`,
  });

  const development = await buildAndReadBundle(projectRoot);
  expect(development).toContain("from-dotenv");
  expect(development).not.toContain("from-dotenv-production");
  // Only the public prefix is inlined; other variables stay out of the bundle.
  expect(development).not.toContain("never-bundled");

  delete process.env[PROBE];
  const production = await buildAndReadBundle(projectRoot, ["--mode", "production"]);
  expect(production).toContain("from-dotenv-production");
});

test("a variable set in the shell wins over the .env files", async () => {
  const projectRoot = await createProject({ ".env": `${PROBE}=from-dotenv\n` });
  process.env[PROBE] = "from-shell";

  const bundle = await buildAndReadBundle(projectRoot);
  expect(bundle).toContain("from-shell");
  expect(bundle).not.toContain("from-dotenv");
});
