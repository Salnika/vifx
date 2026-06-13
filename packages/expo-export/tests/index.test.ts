import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  evaluateExpoNoMetroContract,
  formatSupportedExpoSdkList,
  getSdkSupportTier,
  inspectExpoExport,
  writeExpoExport,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

test("inspectExpoExport normalizes bundles, assets, and manifests from an export fixture", async () => {
  const result = await inspectExpoExport({
    exportRoot: "dist",
    projectRoot: path.join(FIXTURE_ROOT, "expo-export-basic"),
  });

  expect(result.bundles).toHaveLength(2);
  expect(result.assets).toHaveLength(1);
  expect(result.manifests.map((manifest) => manifest.kind)).toEqual(["manifest", "metadata"]);
  expect(result.bundles.every((bundle) => bundle.sourceMap?.valid ?? false)).toBe(true);
});

test("evaluateExpoNoMetroContract makes unsupported Expo without Metro workflows explicit", async () => {
  const result = await evaluateExpoNoMetroContract({
    projectRoot: path.join(FIXTURE_ROOT, "expo-basic"),
  });

  expect(result.decision).toBe("partial");
  expect(result.expoVersion).toBe("~54.0.0");
  expect(result.workflows.map((workflow) => [workflow.id, workflow.status])).toEqual([
    ["config", "blocked"],
    ["vite-build", "blocked"],
    ["metro-parity", "partial"],
    ["dev-server", "blocked"],
    ["export-artifacts", "blocked"],
  ]);
});

test("evaluateExpoNoMetroContract records bounded Vifx, router, and export evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-no-metro-"));
  const projectRoot = path.join(tempRoot, "expo-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-basic"), projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "vifx.config.ts"),
    [
      "export default {",
      "  projectRoot: process.cwd(),",
      '  projectType: "expo",',
      "  expo: true,",
      "  reactNative: true,",
      "  vite: {",
      '    mode: "expo",',
      "    targets: [",
      "      {",
      '        platform: "ios",',
      '        entry: "expo-router/entry",',
      "        hermes: false,",
      '        outDir: "dist/vite/ios",',
      '        reactNativeCompat: "web",',
      "      },",
      "      {",
      '        platform: "android",',
      '        entry: "expo-router/entry",',
      "        hermes: false,",
      '        outDir: "dist/vite/android",',
      '        reactNativeCompat: "web",',
      "      },",
      "    ],",
      "  },",
      "  expoOptions: {",
      '    publicEnvPrefix: "EXPO_PUBLIC_",',
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(projectRoot, "vite.config.vifx.ts"), "export default {};\n");
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          expo: "~54.0.0",
          "expo-router": "^6.0.0",
          "react-native": "0.81.0",
        },
      },
      null,
      2,
    ),
  );

  const result = await evaluateExpoNoMetroContract({
    exportRoot: "dist",
    projectRoot: path.join(FIXTURE_ROOT, "expo-export-basic"),
  });
  const projectResult = await evaluateExpoNoMetroContract({
    projectRoot,
  });

  expect(projectResult.decision).toBe("partial");
  expect(projectResult.workflows.find((workflow) => workflow.id === "vite-build")?.status).toBe(
    "partial",
  );
  expect(projectResult.workflows.find((workflow) => workflow.id === "metro-parity")?.status).toBe(
    "partial",
  );
  expect(result.workflows.find((workflow) => workflow.id === "export-artifacts")?.status).toBe(
    "partial",
  );
  expect(projectResult.workflows.map((workflow) => workflow.id)).toEqual([
    "config",
    "vite-build",
    "metro-parity",
    "dev-server",
    "export-artifacts",
  ]);
});

test("evaluateExpoNoMetroContract treats setup-generated Expo config as sufficient for build and dev audits", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-setup-audit-"));
  const projectRoot = path.join(tempRoot, "expo-router-basic");

  await cp(path.join(FIXTURE_ROOT, "expo-router-basic"), projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "vifx.config.ts"),
    [
      "export default {",
      "  projectRoot: process.cwd(),",
      '  projectType: "expo",',
      "  expo: true,",
      "  reactNative: true,",
      "  vite: {",
      '    mode: "expo",',
      "    targets: [",
      "      {",
      '        platform: "ios",',
      '        entry: "expo-router/entry",',
      "        hermes: false,",
      '        outDir: "dist/vite/ios",',
      '        reactNativeCompat: "web",',
      "      },",
      "      {",
      '        platform: "android",',
      '        entry: "expo-router/entry",',
      "        hermes: false,",
      '        outDir: "dist/vite/android",',
      '        reactNativeCompat: "web",',
      "      },",
      "    ],",
      "  },",
      "  expoOptions: {",
      '    publicEnvPrefix: "EXPO_PUBLIC_",',
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const result = await evaluateExpoNoMetroContract({
    projectRoot,
  });

  expect(result.workflows.find((workflow) => workflow.id === "dev-server")?.status).toBe("partial");
  expect(result.workflows.find((workflow) => workflow.id === "vite-build")?.status).toBe("partial");
  expect(result.workflows.find((workflow) => workflow.id === "metro-parity")?.status).toBe(
    "partial",
  );
});

test("writeExpoExport generates inspectable bundles, manifests, metadata, and assets", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-export-"));
  const sourceRoot = path.join(projectRoot, ".vifx", "build", "ios");

  await mkdir(path.join(sourceRoot, "assets"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "generated-expo-export" }, null, 2),
  );
  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "Generated Export", slug: "generated-export" } }, null, 2),
  );
  await writeFile(path.join(sourceRoot, "index.bundle"), "console.log('generated ios');\n");
  await writeFile(
    path.join(sourceRoot, "index.bundle.map"),
    JSON.stringify({
      mappings: "",
      names: [],
      sources: ["index.js"],
      sourcesContent: ["console.log('generated ios');"],
      version: 3,
    }),
  );
  await writeFile(
    path.join(sourceRoot, "assets", "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>\n',
  );

  const result = await writeExpoExport({
    bundles: [
      {
        assets: [
          {
            emittedPath: ".vifx/build/ios/assets/icon.svg",
            hash: "iconhash",
            height: 64,
            httpServerLocation: "/assets",
            name: "icon",
            scales: [1],
            sizeBytes: 69,
            sourceFilePath: ".vifx/build/ios/assets/icon.svg",
            type: "svg",
            width: 64,
          },
        ],
        bundle: {
          path: ".vifx/build/ios/index.bundle",
          sizeBytes: 30,
        },
        entry: "./index.js",
        mode: "expo",
        platform: "ios",
        projectRoot,
        runtime: null,
        sourceMap: {
          path: ".vifx/build/ios/index.bundle.map",
          sourceCount: 1,
          valid: true,
          warnings: [],
        },
      },
    ],
    exportRoot: "dist/expo",
    projectRoot,
  });

  expect(result.exportRoot).toBe("dist/expo");
  expect(result.bundles).toHaveLength(1);
  expect(result.assets).toHaveLength(1);
  expect(result.manifests.map((manifest) => manifest.kind)).toEqual(["manifest", "metadata"]);
  expect(result.generatedFiles.map((file) => file.kind)).toContain("metadata");
  expect(result.generatedFiles.map((file) => file.kind)).not.toContain("updates-manifest");
  expect(
    await readFile(path.join(projectRoot, "dist", "expo", "ios", "index.bundle"), "utf8"),
  ).toContain("generated ios");

  const audit = await evaluateExpoNoMetroContract({
    exportRoot: "dist/expo",
    projectRoot,
  });

  expect(audit.workflows.find((workflow) => workflow.id === "export-artifacts")?.status).toBe(
    "supported",
  );
  expect(
    audit.workflows.find((workflow) => workflow.id === "export-artifacts")?.evidence,
  ).toContain("Vifx-generated export metadata detected.");
});

test("getSdkSupportTier classifies Expo SDK majors into honest support tiers", () => {
  expect(getSdkSupportTier("~54.0.0")).toMatchObject({ sdk: "54", tier: "validated" });
  expect(getSdkSupportTier("~55.0.0")).toMatchObject({ sdk: "55", tier: "experimental" });
  expect(getSdkSupportTier("~56.0.0")).toMatchObject({ sdk: "56", tier: "experimental" });
  expect(getSdkSupportTier("~57.0.0")).toMatchObject({ sdk: "57", tier: "unsupported" });
  expect(getSdkSupportTier(null)).toMatchObject({ sdk: null, tier: "unknown" });

  const experimentalNotes = getSdkSupportTier("~55.0.0").notes.join(" ");
  expect(experimentalNotes).toContain("not device-validated");
});

test("evaluateExpoNoMetroContract accepts experimental SDKs with tier warnings by default", async () => {
  const result = await evaluateExpoNoMetroContract({
    projectRoot: path.join(FIXTURE_ROOT, "expo-sdk55-basic"),
  });

  expect(result.expoVersion).toBe("~55.0.0");
  expect(result.supportedExpoSdk).toBe(formatSupportedExpoSdkList());
  expect(result.sdkSupport.tier).toBe("experimental");
  expect(result.sdkSupport.sdk).toBe("55");
  expect(result.warnings.join(" ")).toContain("not device-validated");
  expect(result.warnings.join(" ")).not.toContain("outside");
});

test("evaluateExpoNoMetroContract reports SDK 56 on the experimental tier", async () => {
  const result = await evaluateExpoNoMetroContract({
    projectRoot: path.join(FIXTURE_ROOT, "expo-sdk56-basic"),
  });

  expect(result.expoVersion).toBe("~56.0.0");
  expect(result.sdkSupport.tier).toBe("experimental");
  expect(result.sdkSupport.sdk).toBe("56");
  expect(result.warnings.join(" ")).toContain("not device-validated");
});

test("evaluateExpoNoMetroContract keeps explicit supported SDK flag semantics", async () => {
  const result = await evaluateExpoNoMetroContract({
    projectRoot: path.join(FIXTURE_ROOT, "expo-sdk55-basic"),
    supportedExpoSdk: "54",
  });

  expect(result.supportedExpoSdk).toBe("54");
  expect(result.warnings.join(" ")).toContain(
    'Expo dependency "~55.0.0" is outside the fixture-backed SDK 54 range.',
  );
});
