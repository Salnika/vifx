import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chmod } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { executeCli } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("doctor --json returns machine-readable inspection data", async () => {
  const result = await executeCli(["doctor", path.join(FIXTURE_ROOT, "expo-basic"), "--json"]);

  expect(result.exitCode).toBe(0);
  const inspection = JSON.parse(result.stdout) as {
    projectType: string;
    nodeVersion: string;
    vitePluginMode: string;
  };

  expect(inspection.projectType).toBe("expo");
  expect(inspection.nodeVersion).toBe(process.version);
  expect(inspection.vitePluginMode).toBe("none");
});

test("doctor prints the detected Node version in terminal mode", async () => {
  const result = await executeCli(["doctor", path.join(FIXTURE_ROOT, "expo-basic")]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Node version: ${process.version}`);
  expect(result.stdout).toContain("Vite mode: none");
});

test("build --json uses vifx.config.ts targets to produce bundle artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-build-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "vifx.config.ts"),
    [
      "export default {",
      "  vite: {",
      '    mode: "react-native",',
      "    targets: [",
      "      {",
      '        platform: "ios",',
      '        entry: "./index.js",',
      '        outDir: ".vifx/cli-build/ios",',
      "        hermes: false,",
      "      },",
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const result = await executeCli(["build", targetPath, "--json"]);
  const parsed = JSON.parse(result.stdout) as {
    mode: string;
    results: Array<{
      durationMs: number;
      result: {
        bundle: { path: string };
        platform: string;
        runtime: { htmlPath: string } | null;
        sourceMap: { valid: boolean } | null;
      };
    }>;
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.mode).toBe("react-native");
  expect(parsed.results).toHaveLength(1);
  expect(parsed.results[0]?.result.platform).toBe("ios");
  expect(parsed.results[0]?.result.bundle.path).toBe(".vifx/cli-build/ios/index.bundle");
  expect(parsed.results[0]?.result.runtime).toBe(null);
  expect(parsed.results[0]?.result.sourceMap?.valid).toBe(true);
  expect(parsed.results[0]?.durationMs).toBeGreaterThanOrEqual(0);
});

test("run --help prints runtime usage", async () => {
  const result = await executeCli(["run", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx run");
  expect(result.stdout).toContain("--no-build");
});

test("compat run uses the vifx adapter", async () => {
  const result = await executeCli(["compat", "run", "--adapter", "vifx", "--report", "json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).status).toBe("PASS");
});

test("compat run supports the all adapter shortcut", async () => {
  const result = await executeCli(["compat", "run", "--adapter", "all", "--report", "json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toHaveLength(2);
});

test("migrate expo previews package.json and vifx.config.ts changes", async () => {
  const result = await executeCli([
    "migrate",
    "expo",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--dry-run",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("[update] package.json");
  expect(result.stdout).toContain("[create] vifx.config.ts");
  expect(result.stdout).toContain("Dry run only. No files were written.");
});

test("migrate renders structured errors for project type mismatches", async () => {
  const result = await executeCli(["migrate", "expo", path.join(FIXTURE_ROOT, "rn-bare-basic")]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_MIGRATION_UNSAFE_CHANGE]");
  expect(result.stderr).toContain("Expected an Expo project");
  expect(result.stderr).toContain("Docs: https://vifx.dev/guide/migration");
});

test("vite init --write creates a plugin-backed vite.config.ts in a copied fixture", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-vite-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const result = await executeCli(["vite", "init", targetPath, "--write"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Files written.");
  expect(await readFile(path.join(targetPath, "vite.config.ts"), "utf8")).toContain(
    "@vifx/vite-plugin-expo",
  );
});

test("init --write creates a vifx.config.ts in a copied fixture", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });

  const result = await executeCli(["init", targetPath, "--write"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Files written.");
  expect(await readFile(path.join(targetPath, "vifx.config.ts"), "utf8")).toContain(
    "defineVifxConfig",
  );
});

test("migrate react-native --write preserves existing scripts while adding vifx scripts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  const packageJsonPath = path.join(targetPath, "package.json");
  const originalPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  originalPackageJson.scripts = {
    ...originalPackageJson.scripts,
    custom: "node custom.js",
  };
  await writeFile(packageJsonPath, JSON.stringify(originalPackageJson, null, 2));

  const result = await executeCli(["migrate", "react-native", targetPath, "--write"]);
  const migratedPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(result.exitCode).toBe(0);
  expect(migratedPackageJson.scripts?.custom).toBe("node custom.js");
  expect(migratedPackageJson.scripts?.["vifx:doctor"]).toBe("vifx doctor");
  expect(migratedPackageJson.devDependencies?.["@vifx/config"]).toBe("workspace:*");
});

test("metro inspect returns captured Metro reference artifacts", async () => {
  const result = await executeCli([
    "metro",
    "inspect",
    path.join(FIXTURE_ROOT, "rn-bare-basic"),
    "--platform",
    "ios",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).bundle.path).toBe("metro-output/ios/index.bundle");
});

test("hermes compile uses a provided fake compiler", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-hermes-"));
  const compilerPath = path.join(tempRoot, "hermesc");
  const bundlePath = path.join(tempRoot, "input.bundle.js");
  const outputPath = path.join(tempRoot, "dist/index.hbc");

  await writeFile(bundlePath, "globalThis.__vifx = 'bundle';\n");
  await writeFile(
    compilerPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('-out');",
      "const outputPath = args[outputIndex + 1];",
      "const inputPath = args.at(-1);",
      "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
      "fs.writeFileSync(outputPath, `HBC:${fs.readFileSync(inputPath, 'utf8')}`);",
      "",
    ].join("\n"),
  );
  await chmod(compilerPath, 0o755);

  const result = await executeCli([
    "hermes",
    "compile",
    "--input",
    bundlePath,
    "--output",
    outputPath,
    "--compiler",
    compilerPath,
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).outputBytecodePath).toBe(outputPath);
});
