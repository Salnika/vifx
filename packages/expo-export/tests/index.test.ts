import { createVerify, generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  evaluateExpoNoMetroContract,
  inspectExpoExport,
  startExpoUpdatesServer,
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
    ["dev-server", "blocked"],
    ["build", "blocked"],
    ["export", "blocked"],
    ["router", "blocked"],
    ["native-ios", "partial"],
    ["native-android", "blocked"],
    ["updates", "blocked"],
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
  expect(projectResult.workflows.find((workflow) => workflow.id === "build")?.status).toBe(
    "partial",
  );
  expect(projectResult.workflows.find((workflow) => workflow.id === "router")?.status).toBe(
    "partial",
  );
  expect(projectResult.workflows.find((workflow) => workflow.id === "native-ios")?.status).toBe(
    "partial",
  );
  expect(projectResult.workflows.find((workflow) => workflow.id === "native-android")?.status).toBe(
    "blocked",
  );
  expect(result.workflows.find((workflow) => workflow.id === "export")?.status).toBe(
    "inspect-only",
  );
  expect(
    projectResult.workflows.find((workflow) => workflow.id === "native-ios")?.evidence,
  ).toContain(
    "`vifx native run` can infer Expo iOS bundle targets, generate a prebuild host when needed, build a Debug simulator app, install it with simctl, launch it, and keep a local bundle server alive.",
  );
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
  expect(result.workflows.find((workflow) => workflow.id === "build")?.status).toBe("partial");
  expect(result.workflows.find((workflow) => workflow.id === "router")?.status).toBe("partial");
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
    updates: {
      baseUrl: "https://updates.example/vifx/",
      createdAt: "2026-05-17T00:00:00.000Z",
      runtimeVersion: "1.0.0",
    },
  });

  expect(result.exportRoot).toBe("dist/expo");
  expect(result.bundles).toHaveLength(1);
  expect(result.assets).toHaveLength(1);
  expect(result.manifests.map((manifest) => manifest.kind)).toEqual([
    "manifest",
    "metadata",
    "updates-manifest",
  ]);
  expect(result.generatedFiles.map((file) => file.kind)).toContain("metadata");
  expect(result.generatedFiles.map((file) => file.kind)).toContain("updates-manifest");
  expect(result.updatesManifests).toHaveLength(1);
  expect(result.updatesManifests[0]?.runtimeVersion).toBe("1.0.0");
  expect(result.updatesManifests[0]?.launchAsset.url).toBe(
    "https://updates.example/vifx/ios/index.bundle",
  );
  expect(
    await readFile(path.join(projectRoot, "dist", "expo", "ios", "index.bundle"), "utf8"),
  ).toContain("generated ios");

  const audit = await evaluateExpoNoMetroContract({
    exportRoot: "dist/expo",
    projectRoot,
  });

  expect(audit.workflows.find((workflow) => workflow.id === "export")?.status).toBe("partial");
  expect(audit.workflows.find((workflow) => workflow.id === "export")?.evidence).toContain(
    "Vifx-generated export metadata detected.",
  );
  expect(audit.workflows.find((workflow) => workflow.id === "updates")?.status).toBe("partial");
  expect(audit.workflows.find((workflow) => workflow.id === "updates")?.evidence).toContain(
    "Vifx-generated Expo Updates v1 manifest detected.",
  );
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKey = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();

  const server = await startExpoUpdatesServer({
    exportRoot: "dist/expo",
    port: 0,
    projectRoot,
    signing: {
      keyId: "root",
      privateKey,
    },
  });

  try {
    const manifestResponse = await fetch(server.url, {
      headers: {
        accept: "application/expo+json, application/json",
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });
    const servedManifest = (await manifestResponse.json()) as {
      launchAsset: { url: string };
      runtimeVersion: string;
    };

    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get("expo-protocol-version")).toBe("1");
    expect(manifestResponse.headers.get("content-type")).toBe("application/expo+json");
    expect(servedManifest.runtimeVersion).toBe("1.0.0");
    expect(servedManifest.launchAsset.url).toBe("https://updates.example/vifx/ios/index.bundle");

    const signedManifestResponse = await fetch(server.url, {
      headers: {
        accept: "application/expo+json, application/json",
        "expo-expect-signature": 'sig, keyid="root", alg="rsa-v1_5-sha256"',
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });
    const signedManifestBody = await signedManifestResponse.text();
    const signatureHeader = signedManifestResponse.headers.get("expo-signature") ?? "";
    const signature = signatureHeader.match(/\bsig="(?<sig>[^"]+)"/u)?.groups?.sig;
    const verifier = createVerify("RSA-SHA256");

    verifier.update(signedManifestBody);
    verifier.end();

    expect(signedManifestResponse.status).toBe(200);
    expect(signatureHeader).toContain('keyid="root"');
    expect(signatureHeader).toContain('alg="rsa-v1_5-sha256"');
    expect(signature).toBeDefined();
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);

    const multipartManifestResponse = await fetch(server.url, {
      headers: {
        accept: "multipart/mixed",
        "expo-expect-signature": 'sig, keyid="root", alg="rsa-v1_5-sha256"',
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });
    const multipartManifestBody = await multipartManifestResponse.text();
    const multipartSignatureHeader =
      multipartManifestBody.match(/expo-signature: (?<signature>[^\r\n]+)/iu)?.groups?.signature ??
      "";
    const multipartSignature =
      multipartSignatureHeader.match(/\bsig="(?<sig>[^"]+)"/u)?.groups?.sig;
    const multipartManifestPart =
      multipartManifestBody.split("\r\n\r\n")[1]?.split("\r\n--vifx-expo-updates--")[0] ?? "";
    const multipartVerifier = createVerify("RSA-SHA256");

    multipartVerifier.update(`${multipartManifestPart}\n`);
    multipartVerifier.end();

    expect(multipartManifestResponse.status).toBe(200);
    expect(multipartManifestResponse.headers.get("content-type")).toBe(
      "multipart/mixed; boundary=vifx-expo-updates",
    );
    expect(multipartManifestBody).toContain('content-disposition: form-data; name="manifest"');
    expect(multipartManifestBody).toContain("content-type: application/expo+json");
    expect(multipartSignatureHeader).toContain('keyid="root"');
    expect(multipartSignature).toBeDefined();
    expect(multipartVerifier.verify(publicKey, Buffer.from(multipartSignature!, "base64url"))).toBe(
      true,
    );

    const preferredMultipartResponse = await fetch(server.url, {
      headers: {
        accept: "multipart/mixed, application/expo+json",
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });

    expect(preferredMultipartResponse.status).toBe(200);
    expect(preferredMultipartResponse.headers.get("content-type")).toBe(
      "multipart/mixed; boundary=vifx-expo-updates",
    );

    const bundleResponse = await fetch(`${server.url}/ios/index.bundle`);
    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await bundleResponse.text()).toContain("generated ios");

    const missingRuntimeResponse = await fetch(server.url, {
      headers: {
        accept: "application/expo+json, application/json",
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "2.0.0",
      },
    });
    expect(missingRuntimeResponse.status).toBe(404);
  } finally {
    await server.close();
  }
});
