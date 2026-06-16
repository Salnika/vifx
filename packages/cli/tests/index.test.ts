import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chmod } from "node:fs/promises";
import { cp } from "node:fs/promises";
import {
  EXPERIMENTAL_EXPO_SDK_MAJOR_VERSIONS,
  SUPPORTED_EXPO_SDK_MAJOR_VERSIONS,
} from "@vifx/compat-runner";
import { EXPO_SDK_SUPPORT, SUPPORTED_EXPO_SDK_VERSIONS } from "@vifx/expo-export";
import { expect, test } from "vite-plus/test";
import { executeCli } from "../src/index.ts";
import {
  EXPO_GO_DEV_KEY_HINT,
  EXPO_GO_DEV_KEYS_HELP,
  attachExpoGoDevKeys,
} from "../src/commands/expo-dev.ts";
import type { VifxExpoGoDevServer } from "@vifx/vite-plugin-expo";

interface FakeStdin {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => FakeStdin;
  resume: () => void;
  pause: () => void;
  on: (event: string, listener: (chunk: Buffer) => void) => void;
  off: (event: string, listener: (chunk: Buffer) => void) => void;
  emitData: (chunk: Buffer) => void;
}

function createFakeStdin(options: { isTTY: boolean }): FakeStdin {
  const listeners = new Set<(chunk: Buffer) => void>();
  const stdin: FakeStdin = {
    isTTY: options.isTTY,
    isRaw: false,
    setRawMode(mode: boolean) {
      stdin.isRaw = mode;
      return stdin;
    },
    resume() {},
    pause() {},
    on(event, listener) {
      if (event === "data") {
        listeners.add(listener);
      }
    },
    off(event, listener) {
      if (event === "data") {
        listeners.delete(listener);
      }
    },
    emitData(chunk: Buffer) {
      for (const listener of listeners) {
        listener(chunk);
      }
    },
  };
  return stdin;
}

function createBroadcastSpyServer(): {
  server: VifxExpoGoDevServer;
  calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const server = {
    broadcast(method: string, params?: Record<string, unknown>) {
      calls.push({ method, ...(params === undefined ? {} : { params }) });
    },
  } as unknown as VifxExpoGoDevServer;
  return { calls, server };
}

function withFakeStdin<T>(stdin: FakeStdin, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
  try {
    return run();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "stdin", descriptor);
    }
  }
}

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function writeTestPackage(
  projectRoot: string,
  packageName: string,
  files: Record<string, string>,
) {
  const packageRoot = path.join(projectRoot, "node_modules", packageName);

  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: packageName, version: "0.0.0" }, null, 2),
  );

  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = path.join(packageRoot, fileName);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

async function writeNativeReactNativePackage(projectRoot: string) {
  await writeTestPackage(projectRoot, "react-native", {
    "index.js": [
      "export const AppRegistry = {",
      "  registerComponent(name, loadComponent) {",
      "    return { loadComponent, name };",
      "  },",
      "  runApplication() {},",
      "};",
      'export const Platform = { OS: "ios", select(options) { return options?.ios ?? options?.native ?? options?.default; } };',
      "export default { AppRegistry, Platform };",
      "",
    ].join("\n"),
  });
}

async function writeNativeExpoPackage(projectRoot: string) {
  await writeTestPackage(projectRoot, "expo", {
    "index.js": [
      'import { AppRegistry } from "react-native";',
      "export function registerRootComponent(component) {",
      '  AppRegistry.registerComponent("main", () => component);',
      "  return component;",
      "}",
      "const Expo = { registerRootComponent };",
      "export default Expo;",
      "",
    ].join("\n"),
  });
}

test("package manifest exposes the public vifx binary", async () => {
  const manifest = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
  ) as {
    bin?: Record<string, string>;
  };

  expect(manifest.bin?.vifx).toBe("./dist/bin.mjs");
});

test("root package exposes a pnpm vifx script", async () => {
  const manifest = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };

  expect(manifest.scripts?.vifx).toBe("pnpm --filter @vifx/cli vifx");
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
  expect(result.stdout).toContain("vifx expo export");
  expect(result.stdout).toContain("vifx expo smoke");
  expect(result.stdout).toContain("no-Metro Vite bundling corridor");
  expect(result.stdout).toContain("--expo-go");
  expect(result.stdout).not.toContain("expo serve");
  expect(result.stdout).not.toContain("signing");
});

test("root help does not expose native or Expo Updates commands", async () => {
  const result = await executeCli(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("vifx <command>");
  expect(result.stdout).toContain("expo export");
  expect(result.stdout).toContain("expo smoke");
  expect(result.stdout).not.toContain("native");
  expect(result.stdout).not.toContain("expo serve");
});

test("expo dev --help prints Vite bundle dev server usage", async () => {
  const result = await executeCli(["expo", "dev", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx expo dev");
  expect(result.stdout).toContain("--expo-go");
  expect(result.stdout).toContain("--fast-refresh");
  expect(result.stdout).toContain("--public-host");
  expect(result.stdout).toContain("native Expo Go manifest and bundle server");
});

test("expo smoke --help prints Expo Go smoke usage", async () => {
  const result = await executeCli(["expo", "smoke", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx expo smoke");
  expect(result.stdout).toContain("--asset-limit");
  expect(result.stdout).toContain("--public-host");
  expect(result.stdout).toContain("message/event WebSocket loop");
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
  expect(report.decision).toBe("partial");
  expect(report.expoVersion).toBe("~54.0.0");
  expect(report.supportedExpoSdk).toBe("54, 55, 56");
  expect(report.workflows.map((workflow) => [workflow.id, workflow.status])).toEqual([
    ["config", "blocked"],
    ["vite-build", "blocked"],
    ["metro-parity", "partial"],
    ["dev-server", "blocked"],
    ["export-artifacts", "blocked"],
  ]);
});

test("expo audit does not hard-fail experimental SDK projects and reports the tier", async () => {
  const result = await executeCli([
    "expo",
    "audit",
    path.join(FIXTURE_ROOT, "expo-sdk55-basic"),
    "--json",
  ]);
  const report = JSON.parse(result.stdout) as {
    expoVersion: string;
    sdkSupport: { notes: string[]; sdk: string | null; tier: string };
    warnings: string[];
  };

  expect(result.exitCode).toBe(0);
  expect(report.expoVersion).toBe("~55.0.0");
  expect(report.sdkSupport.tier).toBe("experimental");
  expect(report.sdkSupport.sdk).toBe("55");
  expect(report.warnings.join(" ")).toContain("not device-validated");
  expect(report.warnings.join(" ")).not.toContain("outside");
});

test("expo audit --supported-sdk keeps explicit range semantics", async () => {
  const result = await executeCli([
    "expo",
    "audit",
    path.join(FIXTURE_ROOT, "expo-sdk55-basic"),
    "--supported-sdk",
    "54",
    "--json",
  ]);
  const report = JSON.parse(result.stdout) as {
    supportedExpoSdk: string;
    warnings: string[];
  };

  expect(result.exitCode).toBe(0);
  expect(report.supportedExpoSdk).toBe("54");
  expect(report.warnings.join(" ")).toContain("outside the fixture-backed SDK 54 range");
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
  expect(result.stdout).toContain("PARTIAL      export-artifacts - Export artifacts without Metro");
  expect(result.stdout).toContain("Inspected 2 bundle(s), 1 asset(s), and 2 manifest(s).");
  expect(result.stdout).not.toContain("Updates");
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
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    export: {
      bundles: Array<{ platform: string }>;
      exportRoot: string;
      generatedFiles: Array<{ kind: string; path: string }>;
      manifests: Array<{ contents: { slug?: string }; kind: string }>;
    };
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.export.exportRoot).toBe("dist/expo");
  expect(parsed.export.bundles.map((bundle) => bundle.platform)).toEqual(["ios"]);
  expect(parsed.export.generatedFiles.map((file) => file.kind)).toContain("metadata");
  expect(parsed.export.generatedFiles.map((file) => file.kind)).not.toContain("updates-manifest");
  expect(
    parsed.export.manifests.find((manifest) => manifest.kind === "manifest")?.contents.slug,
  ).toBe("cli-expo-export");
  expect(
    await readFile(path.join(projectRoot, "dist", "expo", "ios", "index.bundle"), "utf8"),
  ).toContain("cli expo export");
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

test("doctor --json includes the structured Expo SDK support status", async () => {
  const result = await executeCli([
    "doctor",
    path.join(FIXTURE_ROOT, "expo-sdk55-basic"),
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  const inspection = JSON.parse(result.stdout) as {
    expoSdkSupport: { notes: string[]; sdk: string | null; tier: string };
    projectType: string;
  };

  expect(inspection.projectType).toBe("expo");
  expect(inspection.expoSdkSupport.tier).toBe("experimental");
  expect(inspection.expoSdkSupport.sdk).toBe("55");
  expect(inspection.expoSdkSupport.notes.join(" ")).toContain("not device-validated");
});

test("doctor terminal output reports the Expo SDK support tier", async () => {
  const validated = await executeCli(["doctor", path.join(FIXTURE_ROOT, "expo-basic")]);
  const experimental = await executeCli(["doctor", path.join(FIXTURE_ROOT, "expo-sdk56-basic")]);
  const bare = await executeCli(["doctor", path.join(FIXTURE_ROOT, "rn-bare-basic")]);

  expect(validated.exitCode).toBe(0);
  expect(validated.stdout).toContain("Expo SDK support:");
  expect(validated.stdout).toContain("SDK: 54");
  expect(validated.stdout).toContain("Tier: validated");
  expect(experimental.exitCode).toBe(0);
  expect(experimental.stdout).toContain("SDK: 56");
  expect(experimental.stdout).toContain("Tier: experimental");
  expect(experimental.stdout).toContain("not device-validated");
  expect(experimental.stdout).toContain("WARN  VIFX_PROJECT_EXPERIMENTAL_EXPO_SDK");
  expect(bare.exitCode).toBe(0);
  expect(bare.stdout).not.toContain("Expo SDK support:");
});

test("compat-runner SDK support mirror stays in sync with the expo-export table", () => {
  expect(SUPPORTED_EXPO_SDK_MAJOR_VERSIONS.map(String)).toEqual(SUPPORTED_EXPO_SDK_VERSIONS);
  expect(EXPERIMENTAL_EXPO_SDK_MAJOR_VERSIONS.map(String)).toEqual(
    SUPPORTED_EXPO_SDK_VERSIONS.filter((sdk) => EXPO_SDK_SUPPORT[sdk]?.tier === "experimental"),
  );
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
  // resolveRequest is now supported via vite.config.vifx.ts, so the diagnostic
  // is an informative migration hint, not a refusal.
  expect(result.stdout).toContain("INFO  VIFX_METRO_RESOLVE_REQUEST_MIGRATION");
  expect(result.stdout).toContain("Hint: Port your resolveRequest to vite.config.vifx.ts");
  expect(result.stdout).not.toContain("VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST");
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

test("build --mode production emits a smaller minified bundle than development", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-build-mode-"));
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
      '        outDir: ".vifx/cli-build-mode/ios",',
      "        hermes: false,",
      "      },",
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  interface BuildJsonOutput {
    results: Array<{
      bundleMode: string;
      result: { bundle: { path: string; sizeBytes: number } };
    }>;
  }

  const developmentResult = await executeCli(["build", targetPath, "--json"]);
  const developmentParsed = JSON.parse(developmentResult.stdout) as BuildJsonOutput;
  const productionResult = await executeCli([
    "build",
    targetPath,
    "--mode",
    "production",
    "--json",
  ]);
  const productionParsed = JSON.parse(productionResult.stdout) as BuildJsonOutput;
  const productionBundleSource = await readFile(
    path.join(targetPath, productionParsed.results[0]?.result.bundle.path ?? ""),
    "utf8",
  );

  expect(developmentResult.exitCode).toBe(0);
  expect(productionResult.exitCode).toBe(0);
  expect(developmentParsed.results[0]?.bundleMode).toBe("development");
  expect(productionParsed.results[0]?.bundleMode).toBe("production");
  expect(productionParsed.results[0]?.result.bundle.sizeBytes).toBeLessThan(
    developmentParsed.results[0]?.result.bundle.sizeBytes ?? 0,
  );
  expect(productionBundleSource).not.toContain("import.meta");
});

test("build rejects an unsupported --mode value", async () => {
  const result = await executeCli(["build", ".", "--mode", "staging"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("VIFX_BUILD_INVALID_MODE");
  expect(result.stderr).toContain("--mode development or --mode production");
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

test("expo smoke --json returns Vifx Expo Go endpoint evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-expo-smoke-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  await writeNativeReactNativePackage(targetPath);
  await writeNativeExpoPackage(targetPath);
  await executeCli(["setup", targetPath, "--yes", "--expo-go"]);

  const result = await executeCli([
    "expo",
    "smoke",
    targetPath,
    "--platform",
    "ios",
    "--asset-limit",
    "0",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);

  const report = JSON.parse(result.stdout) as {
    bundle: { hasReactNativeWeb: boolean; hasWebRuntime: boolean; status: number };
    manifest: { launchAssetUrlMatchesServer: boolean; nativeRuntime: boolean; status: number };
    metro: { serverReported: boolean; spawnedByVifx: boolean };
    passed: boolean;
    platform: string;
    server: { expoGoUrl: string; hostUri: string };
    status: { body: string };
    websocket: { identityResult: string | null; reloadMethod: string | null };
  };

  expect(report.passed).toBe(true);
  expect(report.platform).toBe("ios");
  expect(report.manifest.status).toBe(200);
  expect(report.manifest.nativeRuntime).toBe(true);
  expect(report.manifest.launchAssetUrlMatchesServer).toBe(true);
  expect(report.bundle.status).toBe(200);
  expect(report.bundle.hasReactNativeWeb).toBe(false);
  expect(report.bundle.hasWebRuntime).toBe(false);
  expect(report.status.body).toBe("packager-status:running");
  expect(report.server.hostUri).toContain(":");
  expect(report.server.expoGoUrl).toBe(`exp://${report.server.hostUri}`);
  expect(report.websocket.identityResult).toMatch(/^vifx-/u);
  expect(report.websocket.reloadMethod).toBe("reload");
  expect(report.metro.serverReported).toBe(false);
  expect(report.metro.spawnedByVifx).toBe(false);
});

test("compat run supports the all adapter shortcut", async () => {
  const result = await executeCli(["compat", "run", "--adapter", "all", "--report", "json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toHaveLength(2);
});

test("setup --dry-run previews the Expo onboarding plan without writing files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-setup-dry-run-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const result = await executeCli(["setup", targetPath, "--dry-run"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Vifx Setup");
  expect(result.stdout).toContain("[create] vifx.config.ts");
  expect(result.stdout).toContain("Dry run only. No files were written.");
  await expect(readFile(path.join(targetPath, "vifx.config.ts"), "utf8")).rejects.toThrow();
});

test("setup --yes writes an importless vifx.config.ts for Expo projects", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-setup-write-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const result = await executeCli(["setup", targetPath, "--yes"]);
  const vifxConfig = await readFile(path.join(targetPath, "vifx.config.ts"), "utf8");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Files written.");
  expect(vifxConfig).toContain("export default {");
  expect(vifxConfig).not.toContain("defineVifxConfig");
  await expect(readFile(path.join(targetPath, "vite.config.vifx.ts"), "utf8")).rejects.toThrow();
});

test("setup --json returns the expected machine-readable preview shape", async () => {
  const result = await executeCli([
    "setup",
    path.join(FIXTURE_ROOT, "expo-router-basic"),
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    appDirectory: boolean;
    applied: boolean;
    changes: Array<{ kind: string; path: string }>;
    detectedProjectType: string;
    expoGo: boolean;
    expoRouter: boolean;
    nextCommands: string[];
    withViteConfig: boolean;
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.detectedProjectType).toBe("expo");
  expect(parsed.expoGo).toBe(false);
  expect(parsed.expoRouter).toBe(true);
  expect(parsed.appDirectory).toBe(true);
  expect(parsed.applied).toBe(false);
  expect(parsed.withViteConfig).toBe(false);
  expect(parsed.changes.map((change) => change.path)).toEqual(["vifx.config.ts"]);
  expect(parsed.nextCommands).toContain(
    `pnpm vifx build ${path.join(FIXTURE_ROOT, "expo-router-basic")}`,
  );
  expect(parsed.nextCommands).toContain(
    `pnpm vifx expo dev ${path.join(FIXTURE_ROOT, "expo-router-basic")} --platform ios`,
  );
  expect(parsed.nextCommands).toContain(
    `pnpm vifx expo export ${path.join(FIXTURE_ROOT, "expo-router-basic")} --out-dir dist/expo`,
  );
  expect(parsed.nextCommands).not.toContain(
    `pnpm vifx native run ${path.join(FIXTURE_ROOT, "expo-router-basic")} --platform ios`,
  );
});

test("setup --expo-go generates native Expo targets and next command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-setup-expo-go-"));
  const targetPath = path.join(tempRoot, "expo-router-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-router-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          paths: {
            "@/*": ["./*"],
          },
        },
      },
      null,
      2,
    ),
  );

  const result = await executeCli(["setup", targetPath, "--yes", "--expo-go"]);
  const vifxConfig = await readFile(path.join(targetPath, "vifx.config.ts"), "utf8");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Expo Go server: requested");
  expect(result.stdout).toContain(`pnpm vifx expo dev ${targetPath} --platform ios --expo-go`);
  expect(vifxConfig).toContain('aliases: {"@":"."}');
  expect(vifxConfig).toContain('entry: "expo-router/entry"');
  expect(vifxConfig).not.toContain("reactNativeCompat");
});

test("setup without a TTY requires --yes for non-interactive apply mode", async () => {
  const result = await executeCli(["setup", path.join(FIXTURE_ROOT, "expo-basic")], {
    interactive: false,
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_SETUP_CONFIRMATION_REQUIRED]");
});

test("setup rejects non-Expo targets with a dedicated hint", async () => {
  const result = await executeCli(["setup", path.join(FIXTURE_ROOT, "rn-bare-basic"), "--dry-run"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_SETUP_EXPO_ONLY]");
  expect(result.stderr).toContain("migrate react-native");
});

test("setup --experimental-embed previews the app.json config plugin registration", async () => {
  const result = await executeCli([
    "setup",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--experimental-embed",
    "--dry-run",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    applied: boolean;
    changes: Array<{ kind: string; path: string }>;
    experimentalEmbed: boolean;
  };
  const appJsonChange = parsed.changes.find((change) => change.path === "app.json");

  expect(result.exitCode).toBe(0);
  expect(parsed.experimentalEmbed).toBe(true);
  expect(parsed.applied).toBe(false);
  expect(appJsonChange?.kind).toBe("update");
});

test("setup --experimental-embed --yes registers the plugin in app.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-setup-embed-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });

  const result = await executeCli(["setup", targetPath, "--yes", "--experimental-embed"]);
  const appJson = JSON.parse(await readFile(path.join(targetPath, "app.json"), "utf8")) as {
    expo: { plugins: string[] };
  };

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Native embed plugin: requested (experimental)");
  expect(appJson.expo.plugins).toEqual(["@vifx/expo-config-plugin"]);
});

test("setup without --experimental-embed leaves app.json untouched", async () => {
  const result = await executeCli([
    "setup",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--dry-run",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    changes: Array<{ path: string }>;
    experimentalEmbed: boolean;
  };

  expect(result.exitCode).toBe(0);
  expect(parsed.experimentalEmbed).toBe(false);
  expect(parsed.changes.map((change) => change.path)).not.toContain("app.json");
});

test("setup --with-vite-config writes the optional Vifx-owned Vite config explicitly", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-setup-vite-"));
  const targetPath = path.join(tempRoot, "expo-router-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-router-basic"), targetPath, { recursive: true });

  const result = await executeCli(["setup", targetPath, "--yes", "--with-vite-config"]);

  expect(result.exitCode).toBe(0);
  expect(await readFile(path.join(targetPath, "vite.config.vifx.ts"), "utf8")).toContain(
    "@vifx/vite-plugin-expo",
  );
});

test("migrate expo previews package.json and vifx.config.ts changes", async () => {
  const result = await executeCli([
    "migrate",
    "expo",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--dry-run",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Deprecated surface:");
  expect(result.stdout).toContain("pnpm vifx setup <expo-project-path> --yes");
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
  expect(result.stdout).toContain("Deprecated surface:");
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

test("--verbose sets VIFX_VERBOSE environment variable", async () => {
  const originalVerbose = process.env.VIFX_VERBOSE;
  try {
    delete process.env.VIFX_VERBOSE;
    await executeCli(["doctor", "--verbose"]);
    expect(process.env.VIFX_VERBOSE).toBe("true");
  } finally {
    process.env.VIFX_VERBOSE = originalVerbose;
  }
});

test("-v alias sets VIFX_VERBOSE environment variable", async () => {
  const originalVerbose = process.env.VIFX_VERBOSE;
  try {
    delete process.env.VIFX_VERBOSE;
    await executeCli(["doctor", "-v"]);
    expect(process.env.VIFX_VERBOSE).toBe("true");
  } finally {
    process.env.VIFX_VERBOSE = originalVerbose;
  }
});

test("--debug sets VIFX_DEBUG environment variable", async () => {
  const originalDebug = process.env.VIFX_DEBUG;
  try {
    delete process.env.VIFX_DEBUG;
    await executeCli(["doctor", "--debug"]);
    expect(process.env.VIFX_DEBUG).toBe("true");
  } finally {
    process.env.VIFX_DEBUG = originalDebug;
  }
});

test("doctor renders a Metro config migration section with mapped hints", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-metro-section-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "metro.config.js"),
    [
      "module.exports = {",
      "  resolver: {",
      '    assetExts: ["png", "lottie"],',
      '    extraNodeModules: { "@app/core": "../core" },',
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const result = await executeCli(["doctor", targetPath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Metro config migration:");
  expect(result.stdout).toContain("metro.config.js:resolver.assetExts");
  expect(result.stdout).toContain("vifx.config.ts: assetExtensions");
  expect(result.stdout).toContain("metro.config.js:resolver.extraNodeModules");
});

test("doctor omits the Metro config migration section when no metro config exists", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-metro-missing-"));
  const targetPath = path.join(tempRoot, "app");

  await mkdir(targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "package.json"),
    JSON.stringify({ name: "app", version: "0.0.0" }, null, 2),
  );

  const result = await executeCli(["doctor", targetPath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("Metro config migration:");
});

test("doctor --json includes the metroConfigMigration analysis", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-metro-json-"));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "metro.config.js"),
    "module.exports = { resolver: { resolveRequest: () => null } };\n",
  );

  const result = await executeCli(["doctor", targetPath, "--json"]);

  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    metroConfigMigration: {
      found: boolean;
      extraction: string;
      unsupported: Array<{ code: string }>;
      hints: Array<{ source: string; severity: string }>;
    };
  };

  expect(payload.metroConfigMigration.found).toBe(true);
  // resolveRequest is no longer a hard-refused unsupported feature; it is an
  // actionable migration hint pointing at the vite.config.vifx.ts mechanism.
  expect(payload.metroConfigMigration.unsupported).toHaveLength(0);
  const hint = payload.metroConfigMigration.hints.find((entry) =>
    entry.source.endsWith("resolver.resolveRequest"),
  );
  expect(hint?.severity).toBe("action");
});

test("setup includes Metro config migration notes for projects with a metro config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-cli-metro-setup-"));
  const targetPath = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "metro.config.js"),
    [
      "module.exports = {",
      '  transformer: { babelTransformerPath: "react-native-svg-transformer" },',
      "};",
      "",
    ].join("\n"),
  );

  const result = await executeCli(["setup", targetPath, "--dry-run"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Metro config migration:");
  expect(result.stdout).toContain("react-native-svg-transformer");
});

test("expo dev keybindings broadcast reload on r and dev menu on m", () => {
  const stdin = createFakeStdin({ isTTY: true });
  const { calls, server } = createBroadcastSpyServer();

  const detach = withFakeStdin(stdin, () => attachExpoGoDevKeys(server));

  expect(detach).toBeTypeOf("function");
  expect(stdin.isRaw).toBe(true);

  stdin.emitData(Buffer.from("r"));
  stdin.emitData(Buffer.from("m"));
  stdin.emitData(Buffer.from("x"));

  expect(calls).toEqual([{ method: "reload" }, { method: "devMenu" }]);

  detach?.();
  expect(stdin.isRaw).toBe(false);

  // Detached: further keys are ignored.
  stdin.emitData(Buffer.from("r"));
  expect(calls).toHaveLength(2);
});

test("expo dev keybindings open RN DevTools on j", () => {
  const stdin = createFakeStdin({ isTTY: true });
  const { server } = createBroadcastSpyServer();
  const opened: VifxExpoGoDevServer[] = [];

  const detach = withFakeStdin(stdin, () =>
    attachExpoGoDevKeys(server, { openDevTools: (target) => opened.push(target) }),
  );

  stdin.emitData(Buffer.from("j"));
  expect(opened).toEqual([server]);

  detach?.();
  // Detached: further keys are ignored.
  stdin.emitData(Buffer.from("j"));
  expect(opened).toHaveLength(1);
});

test("expo dev keybindings open the editor on o", () => {
  const stdin = createFakeStdin({ isTTY: true });
  const { server } = createBroadcastSpyServer();
  const opened: VifxExpoGoDevServer[] = [];

  const detach = withFakeStdin(stdin, () =>
    attachExpoGoDevKeys(server, { openEditor: (target) => opened.push(target) }),
  );

  stdin.emitData(Buffer.from("o"));
  expect(opened).toEqual([server]);

  detach?.();
  stdin.emitData(Buffer.from("o"));
  expect(opened).toHaveLength(1);
});

test("expo dev keybindings print the help block on ?", () => {
  const stdin = createFakeStdin({ isTTY: true });
  const { server } = createBroadcastSpyServer();
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  const detach = withFakeStdin(stdin, () => attachExpoGoDevKeys(server));
  try {
    stdin.emitData(Buffer.from("?"));
  } finally {
    process.stdout.write = originalWrite;
    detach?.();
  }

  expect(writes.join("")).toContain("afficher cette aide");
});

test("expo dev keybindings are skipped without an interactive TTY", () => {
  const stdin = createFakeStdin({ isTTY: false });
  const { calls, server } = createBroadcastSpyServer();

  const detach = withFakeStdin(stdin, () => attachExpoGoDevKeys(server));

  expect(detach).toBeUndefined();
  expect(stdin.isRaw).toBe(false);

  stdin.emitData(Buffer.from("r"));
  expect(calls).toHaveLength(0);
});

test("expo dev keybindings are skipped when the server has no broadcast", () => {
  const stdin = createFakeStdin({ isTTY: true });
  const server = {} as VifxExpoGoDevServer;

  const detach = withFakeStdin(stdin, () => attachExpoGoDevKeys(server));

  expect(detach).toBeUndefined();
  expect(stdin.isRaw).toBe(false);
});

test("expo dev exposes its keybinding hint string", () => {
  expect(EXPO_GO_DEV_KEY_HINT).toContain("r reload");
  expect(EXPO_GO_DEV_KEY_HINT).toContain("m dev menu");
  expect(EXPO_GO_DEV_KEY_HINT).toContain("j devtools");
  expect(EXPO_GO_DEV_KEY_HINT).toContain("o editor");
  expect(EXPO_GO_DEV_KEY_HINT).toContain("? all");
  expect(EXPO_GO_DEV_KEYS_HELP).toContain("recharger l'app");
  expect(EXPO_GO_DEV_KEYS_HELP).toContain("React Native DevTools");
});
