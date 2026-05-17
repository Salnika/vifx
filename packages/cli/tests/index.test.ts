import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chmod } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { executeCli } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("package manifest exposes the public vifx binary", async () => {
  const manifest = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
  ) as {
    bin?: Record<string, string>;
  };

  expect(manifest.bin?.vifx).toBe("./dist/bin.mjs");
});

test("migrate parent command prints migration help", async () => {
  const result = await executeCli(["migrate"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("vifx migrate expo <path>");
  expect(result.stdout).toContain("vifx migrate react-native <path>");
});

test("migrate --help prints migration help", async () => {
  const result = await executeCli(["migrate", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage:");
  expect(result.stdout).toContain("--with-vite");
});

test("expo parent command prints Expo audit help", async () => {
  const result = await executeCli(["expo"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("vifx expo audit");
  expect(result.stdout).toContain("vifx expo dev");
  expect(result.stdout).toContain("vifx expo serve");
  expect(result.stdout).toContain("Expo without Metro support contract");
});

test("expo dev --help prints bounded dev server usage", async () => {
  const result = await executeCli(["expo", "dev", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx expo dev");
  expect(result.stdout).toContain("Vite-powered Expo browser dev server");
});

test("expo serve --help prints Updates server usage", async () => {
  const result = await executeCli(["expo", "serve", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx expo serve");
  expect(result.stdout).toContain("--export-root");
  expect(result.stdout).toContain("--signing-key");
  expect(result.stdout).toContain("Expo Updates v1");
});

test("expo audit --json returns the no-Metro contract matrix", async () => {
  const result = await executeCli([
    "expo",
    "audit",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--json",
  ]);
  const report = JSON.parse(result.stdout) as {
    decision: string;
    expoVersion: string;
    supportedExpoSdk: string;
    workflows: Array<{ id: string; status: string }>;
  };

  expect(result.exitCode).toBe(0);
  expect(report.decision).toBe("blocked");
  expect(report.expoVersion).toBe("~54.0.0");
  expect(report.supportedExpoSdk).toBe("54");
  expect(report.workflows.map((workflow) => [workflow.id, workflow.status])).toEqual([
    ["dev-server", "blocked"],
    ["build", "blocked"],
    ["export", "blocked"],
    ["router", "blocked"],
    ["native-ios", "blocked"],
    ["native-android", "blocked"],
    ["updates", "blocked"],
  ]);
});

test("expo audit terminal output lists workflow evidence and blockers", async () => {
  const result = await executeCli([
    "expo",
    "audit",
    path.join(FIXTURE_ROOT, "expo-export-basic"),
    "--export-root",
    "dist",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Vifx Expo Audit");
  expect(result.stdout).toContain("Decision: partial");
  expect(result.stdout).toContain("INSPECT-ONLY export - Expo export without Metro");
  expect(result.stdout).toContain("Inspected 2 bundle(s), 1 asset(s), and 2 manifest(s).");
  expect(result.stdout).toContain("Expo Updates without Metro");
});

test("expo export --json builds configured Expo targets and writes an inspectable export", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-expo-export-"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          expo: "~54.0.0",
          "react-native": "0.81.0",
        },
        name: "cli-expo-export",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "CLI Expo Export", slug: "cli-expo-export" } }, null, 2),
  );
  await writeFile(path.join(projectRoot, "index.js"), "console.log('cli expo export');\n");
  await writeFile(
    path.join(projectRoot, "vifx.config.ts"),
    [
      "export default {",
      `  projectRoot: ${JSON.stringify(projectRoot)},`,
      '  projectType: "expo",',
      "  expo: true,",
      "  reactNative: true,",
      "  vite: {",
      '    mode: "expo",',
      "    targets: [",
      "      {",
      '        platform: "ios",',
      '        entry: "./index.js",',
      '        outDir: ".vifx/cli-expo-export/ios",',
      "        hermes: false,",
      "      },",
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const result = await executeCli([
    "expo",
    "export",
    projectRoot,
    "--platform",
    "ios",
    "--out-dir",
    "dist/expo",
    "--updates-url",
    "https://updates.example/vifx/",
    "--runtime-version",
    "1.0.0",
    "--created-at",
    "2026-05-17T00:00:00.000Z",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    export: {
      bundles: Array<{ platform: string }>;
      exportRoot: string;
      generatedFiles: Array<{ kind: string; path: string }>;
      manifests: Array<{ contents: { slug?: string }; kind: string }>;
      updatesManifests: Array<{ launchAsset: { url: string }; runtimeVersion: string }>;
    };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.export.exportRoot).toBe("dist/expo");
  expect(parsed.export.bundles.map((bundle) => bundle.platform)).toEqual(["ios"]);
  expect(parsed.export.generatedFiles.map((file) => file.kind)).toContain("metadata");
  expect(parsed.export.generatedFiles.map((file) => file.kind)).toContain("updates-manifest");
  expect(parsed.export.updatesManifests).toHaveLength(1);
  expect(parsed.export.updatesManifests[0]?.runtimeVersion).toBe("1.0.0");
  expect(parsed.export.updatesManifests[0]?.launchAsset.url).toBe(
    "https://updates.example/vifx/ios/index.bundle",
  );
  expect(
    parsed.export.manifests.find((manifest) => manifest.kind === "manifest")?.contents.slug,
  ).toBe("cli-expo-export");
  expect(
    await readFile(path.join(projectRoot, "dist", "expo", "ios", "index.bundle"), "utf8"),
  ).toContain("cli expo export");
});

test("expo export rejects incomplete Updates manifest options", async () => {
  const result = await executeCli([
    "expo",
    "export",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--updates-url",
    "https://updates.example/vifx/",
    "--json",
  ]);
  const error = JSON.parse(result.stderr) as { code: string };

  expect(result.exitCode).toBe(1);
  expect(error.code).toBe("VIFX_EXPO_EXPORT_UPDATES_OPTIONS_MISSING");
});

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
  expect(result.stdout).toContain("Metro config: metro.config.js");
  expect(result.stdout).toContain("Vite config: missing");
  expect(result.stdout).toContain("Vite mode: none");
  expect(result.stdout).toContain("Vifx config: missing");
});

test("doctor prints the no-issues diagnostic when inspection is clean", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-doctor-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "vifx.config.ts"),
    [
      "export default {",
      "  vite: {",
      '    mode: "react-native",',
      "    targets: [],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(targetPath, "vite.config.vifx.ts"),
    'import { reactNativeVitePlugin } from "@vifx/vite-plugin-react-native";\nexport default { plugins: [reactNativeVitePlugin()] };\n',
  );

  const result = await executeCli(["doctor", targetPath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Vite config: vite.config.vifx.ts");
  expect(result.stdout).toContain("Vite mode: react-native");
  expect(result.stdout).toContain("INFO  VIFX_NO_ISSUES");
  expect(result.stdout).toContain("No issues detected.");
});

test("inspect terminal output includes detected config paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-inspect-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(path.join(targetPath, "vifx.config.ts"), "export default {};\n");
  await writeFile(
    path.join(targetPath, "vite.config.vifx.ts"),
    'import { reactNativeVitePlugin } from "@vifx/vite-plugin-react-native";\nexport default { plugins: [reactNativeVitePlugin()] };\n',
  );

  const result = await executeCli(["inspect", targetPath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Metro config: metro.config.js");
  expect(result.stdout).toContain("Vite config: vite.config.vifx.ts");
  expect(result.stdout).toContain("Vite mode: react-native");
  expect(result.stdout).toContain("Vifx config: vifx.config.ts");
});

test("doctor formats remediation hints without forcing command wording", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-doctor-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "metro.config.js"),
    "module.exports = { resolver: { resolveRequest() { return null; } } };\n",
  );

  const result = await executeCli(["doctor", targetPath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("WARN  VIFX_CONFIG_MISSING");
  expect(result.stdout).toContain("Run: vifx init to create vifx.config.ts.");
  expect(result.stdout).toContain("WARN  VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST");
  expect(result.stdout).toContain(
    "Hint: Keep Metro for that path or remove the custom resolver before migrating.",
  );
  expect(result.stdout).not.toContain("Run: Keep Metro");
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

test("native prepare --json builds and writes native artifact manifests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-native-"));
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

  const result = await executeCli([
    "native",
    "prepare",
    targetPath,
    "--platform",
    "ios",
    "--out-dir",
    ".vifx/native-cli/ios",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    results: Array<{
      manifest: {
        bundle: { outputPath: string };
        manifestPath: string;
        platform: string;
      };
      toolchain: { checks: Array<{ name: string; status: string }> };
    }>;
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.results).toHaveLength(1);
  expect(parsed.results[0]?.manifest.platform).toBe("ios");
  expect(parsed.results[0]?.manifest.bundle.outputPath).toBe(".vifx/native-cli/ios/main.jsbundle");
  expect(parsed.results[0]?.manifest.manifestPath).toBe(
    ".vifx/native-cli/ios/vifx-native-manifest.json",
  );
  expect(parsed.results[0]?.toolchain.checks.map((check) => check.name)).toContain("xcodebuild");
  expect(
    await readFile(path.join(targetPath, ".vifx/native-cli/ios/main.jsbundle"), "utf8"),
  ).toContain("rn ios bundle");
});

test("native build --dry-run --json plans an iOS host build without executing xcodebuild", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-native-build-ios-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await mkdir(path.join(targetPath, "ios", "VifxHost.xcodeproj"), { recursive: true });
  await writeFile(
    path.join(targetPath, "ios", "VifxHost.xcodeproj", "project.pbxproj"),
    "PRODUCT_BUNDLE_IDENTIFIER = dev.vifx.host;\n",
  );

  const result = await executeCli([
    "native",
    "build",
    targetPath,
    "--platform",
    "ios",
    "--dry-run",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    dryRun: boolean;
    execution: null;
    plan: {
      host: { scheme: string };
      steps: Array<{ args: string[]; command: string }>;
    };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.dryRun).toBe(true);
  expect(parsed.execution).toBeNull();
  expect(parsed.plan.host.scheme).toBe("VifxHost");
  expect(parsed.plan.steps[0]?.command).toBe("xcodebuild");
  expect(parsed.plan.steps[0]?.args).toContain("build");
});

test("native launch --dry-run --json plans an Android launch without executing adb", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-native-launch-android-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await mkdir(path.join(targetPath, "android", "app"), { recursive: true });
  await writeFile(path.join(targetPath, "android", "settings.gradle"), "pluginManagement {}\n");
  await writeFile(
    path.join(targetPath, "android", "app", "build.gradle"),
    'android { defaultConfig { applicationId "dev.vifx.host" } }\n',
  );

  const result = await executeCli([
    "native",
    "launch",
    targetPath,
    "--platform",
    "android",
    "--dry-run",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    dryRun: boolean;
    execution: null;
    plan: {
      host: { androidApplicationId: string };
      steps: Array<{ args: string[]; command: string }>;
    };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.dryRun).toBe(true);
  expect(parsed.execution).toBeNull();
  expect(parsed.plan.host.androidApplicationId).toBe("dev.vifx.host");
  expect(parsed.plan.steps[0]?.command).toBe("adb");
  expect(parsed.plan.steps[0]?.args).toContain("dev.vifx.host");
});

test("native doctor --json validates host, manifest, signing, and toolchain diagnostics", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-native-doctor-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await mkdir(path.join(targetPath, "ios", "VifxHost.xcodeproj"), { recursive: true });
  await mkdir(path.join(targetPath, ".vifx", "native", "ios"), { recursive: true });
  await writeFile(
    path.join(targetPath, "ios", "VifxHost.xcodeproj", "project.pbxproj"),
    [
      "PRODUCT_BUNDLE_IDENTIFIER = dev.vifx.host;",
      "DEVELOPMENT_TEAM = ABC123TEAM;",
      "CODE_SIGN_STYLE = Automatic;",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(targetPath, ".vifx", "native", "ios", "vifx-native-manifest.json"),
    "{}\n",
  );

  const result = await executeCli(["native", "doctor", targetPath, "--platform", "ios", "--json"]);
  const parsed = JSON.parse(result.stdout) as {
    host: {
      checks: Array<{ name: string; status: string }>;
      status: string;
    };
    status: string;
    toolchain: { checks: Array<{ name: string; status: string }> };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.host.status).toBe("pass");
  expect(parsed.host.checks.map((check) => [check.name, check.status])).toEqual([
    ["ios-host", "pass"],
    ["ios-bundle-id", "pass"],
    ["ios-signing-team", "pass"],
    ["ios-code-sign-style", "pass"],
    ["ios-provisioning-profile", "pass"],
    ["native-manifest", "pass"],
  ]);
  expect(parsed.toolchain.checks.map((check) => check.name)).toContain("xcodebuild");
  expect(["pass", "warn"]).toContain(parsed.status);
});

test("native run --dry-run --json prepares, diagnoses, and plans the full lifecycle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-native-run-"));
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
      '        outDir: ".vifx/cli-run-build/ios",',
      "        hermes: false,",
      "      },",
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(targetPath, "ios", "VifxHost.xcodeproj"), { recursive: true });
  await writeFile(
    path.join(targetPath, "ios", "VifxHost.xcodeproj", "project.pbxproj"),
    [
      "PRODUCT_BUNDLE_IDENTIFIER = dev.vifx.host;",
      "DEVELOPMENT_TEAM = ABC123TEAM;",
      "CODE_SIGN_STYLE = Automatic;",
      "",
    ].join("\n"),
  );

  const result = await executeCli([
    "native",
    "run",
    targetPath,
    "--platform",
    "ios",
    "--out-dir",
    ".vifx/native-run/ios",
    "--dry-run",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    dryRun: boolean;
    execution: null;
    hostValidation: { status: string };
    preparation: {
      results: Array<{
        manifest: { manifestPath: string; platform: string };
      }>;
    };
    steps: {
      build: { steps: Array<{ command: string }> };
      install: { steps: Array<{ command: string }> };
      launch: { steps: Array<{ command: string }> };
    };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.dryRun).toBe(true);
  expect(parsed.execution).toBeNull();
  expect(parsed.preparation.results[0]?.manifest.platform).toBe("ios");
  expect(parsed.preparation.results[0]?.manifest.manifestPath).toBe(
    ".vifx/native-run/ios/vifx-native-manifest.json",
  );
  expect(parsed.hostValidation.status).toBe("pass");
  expect(parsed.steps.build.steps[0]?.command).toBe("xcodebuild");
  expect(parsed.steps.install.steps[0]?.command).toBe("xcrun");
  expect(parsed.steps.launch.steps[0]?.command).toBe("xcrun");
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

test("vite init --write creates a plugin-backed vite.config.vifx.ts in a copied fixture", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-vite-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const result = await executeCli(["vite", "init", targetPath, "--write"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Files written.");
  expect(await readFile(path.join(targetPath, "vite.config.vifx.ts"), "utf8")).toContain(
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
  expect(migratedPackageJson.scripts?.["vifx:metro"]).toBe("vifx metro inspect . --platform ios");
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
