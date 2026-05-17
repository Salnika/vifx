import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  createNativeCommandPlan,
  detectNativeHost,
  diagnoseNativeRuntimeTargets,
  diagnoseNativeToolchain,
  prepareNativeArtifacts,
  runNativeCommandPlan,
  startNativeBundleServer,
  validateNativeHost,
  type VifxNativeArtifactManifest,
} from "../src/index.ts";
import { VifxError } from "@vifx/errors";
import type { VifxBundleArtifacts } from "@vifx/types";

async function createBundleArtifacts(projectRoot: string): Promise<VifxBundleArtifacts> {
  await mkdir(path.join(projectRoot, "dist", "vifx", "ios", "assets"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "assets"), { recursive: true });
  await writeFile(path.join(projectRoot, "dist", "vifx", "ios", "index.bundle"), "bundle", "utf8");
  await writeFile(path.join(projectRoot, "dist", "vifx", "ios", "index.bundle.map"), "{}", "utf8");
  await writeFile(path.join(projectRoot, "dist", "vifx", "ios", "index.hbc"), "hbc", "utf8");
  await writeFile(
    path.join(projectRoot, "dist", "vifx", "ios", "assets", "icon.svg"),
    "<svg />",
    "utf8",
  );
  await writeFile(path.join(projectRoot, "src", "assets", "icon.svg"), "<svg />", "utf8");

  return {
    assets: [
      {
        emittedPath: "dist/vifx/ios/assets/icon.svg",
        hash: "abc123",
        httpServerLocation: "/assets",
        name: "icon",
        scales: [1],
        sizeBytes: 7,
        sourceFilePath: "src/assets/icon.svg",
        type: "svg",
      },
    ],
    bundle: {
      path: "dist/vifx/ios/index.bundle",
      sizeBytes: 6,
    },
    entry: "./index.js",
    hermesBytecodePath: "dist/vifx/ios/index.hbc",
    mode: "react-native",
    platform: "ios",
    projectRoot,
    runtime: null,
    sourceMap: {
      path: "dist/vifx/ios/index.bundle.map",
      sourceCount: 1,
      valid: true,
      warnings: [],
    },
  };
}

test("prepareNativeArtifacts copies bundle, source map, Hermes bytecode, assets, and manifest", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-artifacts-"));
  const artifacts = await createBundleArtifacts(projectRoot);

  const manifest = await prepareNativeArtifacts({
    artifacts,
    outDir: ".vifx/native-test/ios",
  });

  expect(manifest.platform).toBe("ios");
  expect(manifest.bundle.outputPath).toBe(".vifx/native-test/ios/main.jsbundle");
  expect(manifest.sourceMap?.outputPath).toBe(".vifx/native-test/ios/main.jsbundle.map");
  expect(manifest.hermesBytecode?.outputPath).toBe(".vifx/native-test/ios/main.hbc");
  expect(manifest.assets[0]?.outputPath).toBe(".vifx/native-test/ios/assets/icon.svg");
  expect(manifest.assets[0]?.variants?.[0]?.outputPath).toBe(
    ".vifx/native-test/ios/assets/icon.svg",
  );

  const manifestJson = JSON.parse(
    await readFile(path.join(projectRoot, manifest.manifestPath), "utf8"),
  ) as VifxNativeArtifactManifest;
  expect(manifestJson.bundle.sourcePath).toBe("dist/vifx/ios/index.bundle");
  expect(manifestJson.assets[0]?.hash).toBe("abc123");
});

test("startNativeBundleServer serves bundle, assets, and Metro status endpoints", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-bundle-server-"));
  const artifacts = await createBundleArtifacts(projectRoot);

  await prepareNativeArtifacts({
    artifacts,
    outDir: ".vifx/native/ios",
  });

  const server = await startNativeBundleServer({
    platform: "ios",
    port: 0,
    projectRoot,
  });

  try {
    const bundleResponse = await fetch(
      `${server.url}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false`,
    );
    const assetResponse = await fetch(`${server.url}/assets/icon.svg`);
    const statusResponse = await fetch(`${server.url}/status`);

    expect(bundleResponse.status).toBe(200);
    expect(await bundleResponse.text()).toBe("bundle");
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe("<svg />");
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.text()).toBe("packager-status:running");
  } finally {
    await server.close();
  }
});

test("prepareNativeArtifacts reports missing bundle inputs as structured errors", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-artifacts-missing-"));
  const artifacts = await createBundleArtifacts(projectRoot);
  artifacts.bundle.path = "missing/index.bundle";

  await expect(prepareNativeArtifacts({ artifacts })).rejects.toMatchObject({
    code: "VIFX_NATIVE_ARTIFACT_MISSING",
  } satisfies Partial<VifxError>);
});

test("diagnoseNativeToolchain reports iOS and Android readiness without failing preparation", async () => {
  const ios = await diagnoseNativeToolchain({
    commandExists: (command) => command === "xcrun",
    platform: "ios",
  });
  expect(ios.checks.map((check) => [check.name, check.status])).toEqual([
    ["xcodebuild", "warn"],
    ["xcrun", "pass"],
  ]);

  const android = await diagnoseNativeToolchain({
    commandExists: () => false,
    env: {
      ANDROID_HOME: "/android/sdk",
    },
    platform: "android",
  });
  expect(android.checks.map((check) => [check.name, check.status])).toEqual([
    ["android-sdk", "pass"],
    ["adb", "warn"],
    ["gradle", "warn"],
  ]);
});

test("diagnoseNativeToolchain accepts xcodebuild commands that use -version instead of --version", async () => {
  const toolRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-toolchain-path-"));
  const xcodebuildPath = path.join(toolRoot, "xcodebuild");
  const originalPath = process.env.PATH;

  await writeFile(
    xcodebuildPath,
    ["#!/bin/sh", 'if [ "$1" = "-version" ]; then', "  exit 0", "fi", "exit 64", ""].join("\n"),
    "utf8",
  );
  await chmod(xcodebuildPath, 0o755);

  process.env.PATH = `${toolRoot}${path.delimiter}${originalPath ?? ""}`;

  try {
    const diagnostics = await diagnoseNativeToolchain({
      platform: "ios",
    });

    expect(diagnostics.checks.find((check) => check.name === "xcodebuild")?.status).toBe("pass");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("diagnoseNativeRuntimeTargets reports booted iOS simulators", async () => {
  const diagnostics = await diagnoseNativeRuntimeTargets({
    platform: "ios",
    runCommand: () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
            {
              isAvailable: true,
              name: "iPhone 16",
              state: "Booted",
              udid: "SIM-1",
            },
          ],
        },
      }),
    }),
  });

  expect(diagnostics.checks.map((check) => [check.name, check.status])).toEqual([
    ["ios-simulator-target", "pass"],
  ]);
  expect(diagnostics.checks[0]?.message).toContain("iPhone 16");
});

test("diagnoseNativeRuntimeTargets reports Android devices and emulator tooling", async () => {
  const diagnostics = await diagnoseNativeRuntimeTargets({
    env: {
      ANDROID_HOME: "/android/sdk",
    },
    pathExists: (filePath) => filePath === "/android/sdk/emulator/emulator",
    platform: "android",
    runCommand: () => ({
      exitCode: 0,
      stderr: "",
      stdout: "List of devices attached\nemulator-5554\tdevice\n",
    }),
  });

  expect(diagnostics.checks.map((check) => [check.name, check.status])).toEqual([
    ["android-device-target", "pass"],
    ["android-emulator", "pass"],
  ]);
});

test("detectNativeHost and createNativeCommandPlan cover iOS host lifecycle commands", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-ios-host-"));
  await mkdir(path.join(projectRoot, "ios", "VifxHost.xcodeproj"), { recursive: true });
  await mkdir(path.join(projectRoot, "ios", "VifxHost.xcworkspace"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ios", "VifxHost.xcodeproj", "project.pbxproj"),
    "PRODUCT_BUNDLE_IDENTIFIER = dev.vifx.host;\n",
    "utf8",
  );

  const host = await detectNativeHost({
    platform: "ios",
    projectRoot,
  });
  const buildPlan = await createNativeCommandPlan({
    action: "build",
    platform: "ios",
    projectRoot,
  });
  const launchPlan = await createNativeCommandPlan({
    action: "launch",
    platform: "ios",
    projectRoot,
  });

  expect(host.scheme).toBe("VifxHost");
  expect(host.bundleId).toBe("dev.vifx.host");
  expect(host.iosWorkspace).toBe(path.join(projectRoot, "ios", "VifxHost.xcworkspace"));
  expect(buildPlan.steps[0]?.command).toBe("xcodebuild");
  expect(buildPlan.steps[0]?.args[0]).toBe("-workspace");
  expect(buildPlan.steps[0]?.args[1]).toBe(path.join(projectRoot, "ios", "VifxHost.xcworkspace"));
  expect(buildPlan.steps[0]?.args).toContain("-derivedDataPath");
  expect(buildPlan.steps[0]?.args).toContain("-quiet");
  expect(launchPlan.steps[0]?.args).toContain("dev.vifx.host");
});

test("runNativeCommandPlan tolerates native tool output larger than the default spawnSync buffer", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-command-buffer-"));
  const outputLength = 1024 * 1024 + 2048;
  const execution = runNativeCommandPlan({
    action: "build",
    host: {
      hostRoot: projectRoot,
      platform: "ios",
      projectRoot,
    },
    platform: "ios",
    steps: [
      {
        args: ["-e", `process.stdout.write("x".repeat(${outputLength}))`],
        command: process.execPath,
        cwd: projectRoot,
        label: "Emit large stdout payload",
      },
    ],
  });

  expect(execution.steps[0]?.exitCode).toBe(0);
  expect(execution.steps[0]?.stdout.length).toBe(outputLength);
});

test("runNativeCommandPlan surfaces stderr tail and spawn error metadata on failure", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-command-failure-"));

  try {
    runNativeCommandPlan({
      action: "build",
      host: {
        hostRoot: projectRoot,
        platform: "ios",
        projectRoot,
      },
      platform: "ios",
      steps: [
        {
          args: ["-e", 'console.error("native build failed"); process.exit(3)'],
          command: process.execPath,
          cwd: projectRoot,
          label: "Fail with stderr",
        },
      ],
    });
  } catch (error) {
    expect(error).toMatchObject({
      code: "VIFX_NATIVE_COMMAND_FAILED",
      details: expect.objectContaining({
        command: process.execPath,
        exitCode: 3,
        platform: "ios",
        stderrTail: "native build failed\n",
      }),
    });
    return;
  }

  expect.unreachable("Expected runNativeCommandPlan to throw for a failing command.");
});

test("detectNativeHost and createNativeCommandPlan cover Android host lifecycle commands", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-android-host-"));
  await mkdir(path.join(projectRoot, "android", "app"), { recursive: true });
  await writeFile(path.join(projectRoot, "android", "settings.gradle"), "pluginManagement {}\n");
  await writeFile(path.join(projectRoot, "android", "gradlew"), "#!/usr/bin/env sh\n");
  await writeFile(
    path.join(projectRoot, "android", "app", "build.gradle"),
    'android { namespace "dev.vifx.host"; defaultConfig { applicationId "dev.vifx.host" } }\n',
    "utf8",
  );

  const host = await detectNativeHost({
    platform: "android",
    projectRoot,
  });
  const buildPlan = await createNativeCommandPlan({
    action: "build",
    platform: "android",
    projectRoot,
  });
  const launchPlan = await createNativeCommandPlan({
    action: "launch",
    platform: "android",
    projectRoot,
  });

  expect(host.androidApplicationId).toBe("dev.vifx.host");
  expect(buildPlan.steps[0]?.command).toBe("./gradlew");
  expect(buildPlan.steps[0]?.args).toEqual([":app:assembleDebug"]);
  expect(launchPlan.steps[0]?.command).toBe("adb");
  expect(launchPlan.steps[0]?.args).toContain("dev.vifx.host");
});

test("validateNativeHost reports iOS manifest and signing readiness", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-ios-validation-"));
  const artifacts = await createBundleArtifacts(projectRoot);

  await prepareNativeArtifacts({
    artifacts,
    outDir: ".vifx/native/ios",
  });
  await mkdir(path.join(projectRoot, "ios", "VifxHost.xcodeproj"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ios", "VifxHost.xcodeproj", "project.pbxproj"),
    [
      "PRODUCT_BUNDLE_IDENTIFIER = dev.vifx.host;",
      "DEVELOPMENT_TEAM = ABC123TEAM;",
      "CODE_SIGN_STYLE = Automatic;",
      "",
    ].join("\n"),
    "utf8",
  );

  const validation = await validateNativeHost({
    platform: "ios",
    projectRoot,
  });

  expect(validation.status).toBe("pass");
  expect(validation.checks.map((check) => [check.name, check.status])).toEqual([
    ["ios-host", "pass"],
    ["ios-bundle-id", "pass"],
    ["ios-signing-team", "pass"],
    ["ios-code-sign-style", "pass"],
    ["ios-provisioning-profile", "pass"],
    ["native-manifest", "pass"],
  ]);
});

test("validateNativeHost reports Android application id, signing, and manifest readiness", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-native-android-validation-"));

  await mkdir(path.join(projectRoot, "android", "app"), { recursive: true });
  await mkdir(path.join(projectRoot, ".vifx", "native", "android"), { recursive: true });
  await writeFile(path.join(projectRoot, "android", "settings.gradle"), "pluginManagement {}\n");
  await writeFile(
    path.join(projectRoot, "android", "app", "build.gradle"),
    [
      "android {",
      '  defaultConfig { applicationId "dev.vifx.host" }',
      '  signingConfigs { release { storeFile file("debug.keystore"); keyAlias "debug" } }',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, ".vifx", "native", "android", "vifx-native-manifest.json"),
    "{}\n",
    "utf8",
  );

  const validation = await validateNativeHost({
    platform: "android",
    projectRoot,
  });

  expect(validation.status).toBe("pass");
  expect(validation.checks.map((check) => [check.name, check.status])).toEqual([
    ["android-host", "pass"],
    ["android-application-id", "pass"],
    ["android-app-gradle", "pass"],
    ["android-signing-config", "pass"],
    ["android-signing-material", "pass"],
    ["native-manifest", "pass"],
  ]);
});
