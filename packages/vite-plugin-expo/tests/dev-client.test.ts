import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  createDevClientLaunchUrl,
  negotiateManifestResponse,
  resolveDevClientScheme,
} from "../src/dev-client.ts";
import { startExpoGoDevServer } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-dev-client-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
}

async function canListenOnLocalhost() {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

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

async function declareAppScheme(projectRoot: string, scheme: string) {
  const appJsonPath = path.join(projectRoot, "app.json");
  const appJson = JSON.parse(await readFile(appJsonPath, "utf8")) as {
    expo: Record<string, unknown>;
  };

  await writeFile(
    appJsonPath,
    JSON.stringify({ expo: { ...appJson.expo, scheme } }, null, 2),
    "utf8",
  );
}

interface MultipartPart {
  body: string;
  headers: Record<string, string>;
}

function parseMultipartMixed(body: string, contentType: string) {
  const boundaryMatch = /;\s*boundary=(?<boundary>"[^"]+"|[^;]+)/u.exec(contentType);
  const rawBoundary = boundaryMatch?.groups?.boundary;
  if (!rawBoundary) {
    throw new Error(`No multipart boundary in content type: ${contentType}`);
  }

  const boundary = rawBoundary.replaceAll('"', "");
  const segments = body.split(`--${boundary}`);
  const closingSegment = segments.at(-1);
  if (segments.length < 3 || closingSegment?.trimEnd() !== "--") {
    throw new Error("Multipart body is missing its closing boundary.");
  }

  return segments.slice(1, -1).map((segment): MultipartPart => {
    const chunk = segment.replace(/^\r\n/u, "").replace(/\r\n$/u, "");
    const separatorIndex = chunk.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      throw new Error("Multipart part is missing its header separator.");
    }

    const headers: Record<string, string> = {};
    for (const headerLine of chunk.slice(0, separatorIndex).split("\r\n")) {
      const colonIndex = headerLine.indexOf(":");
      headers[headerLine.slice(0, colonIndex).trim().toLowerCase()] = headerLine
        .slice(colonIndex + 1)
        .trim();
    }

    return {
      body: chunk.slice(separatorIndex + 4),
      headers,
    };
  });
}

function withoutVolatileManifestFields(manifest: Record<string, unknown>) {
  const { createdAt: _createdAt, id: _id, ...stable } = manifest;
  return stable;
}

const NETWORK_SERVER_TESTS = (await canListenOnLocalhost()) ? test : test.skip;

const SAMPLE_MANIFEST = {
  extra: { expoClient: { name: "Sample", slug: "sample" } },
  id: "00000000-0000-0000-0000-000000000000",
  launchAsset: {
    contentType: "application/javascript",
    url: "http://127.0.0.1:19000/index.bundle",
  },
  runtimeVersion: "exposdk:54.0.0",
};

test("negotiateManifestResponse keeps plain JSON for clients that do not ask otherwise", () => {
  for (const headers of [
    {},
    { accept: "application/json" },
    { accept: "*/*" },
    { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  ]) {
    const response = negotiateManifestResponse({
      manifestJson: SAMPLE_MANIFEST,
      request: { headers },
    });

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(response.headers["Cache-Control"]).toBe("private, max-age=0");
    expect(response.headers["expo-protocol-version"]).toBe("1");
    expect(response.headers["expo-sfv-version"]).toBe("0");
    expect(response.headers["expo-manifest-filters"]).toBe("");
    expect(response.headers["expo-server-defined-headers"]).toBe("");
    expect(response.body).toBe(`${JSON.stringify(SAMPLE_MANIFEST)}\n`);
  }
});

test("negotiateManifestResponse serves multipart/mixed when the Accept header lists it", () => {
  const response = negotiateManifestResponse({
    manifestJson: SAMPLE_MANIFEST,
    request: {
      headers: {
        // The Accept header sent by expo-updates clients embedded in dev-client builds.
        accept: "multipart/mixed,application/expo+json,application/json",
        "expo-platform": "ios",
      },
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers["Content-Type"]).toMatch(/^multipart\/mixed; boundary=/u);
  expect(response.headers["expo-protocol-version"]).toBe("1");
  expect(response.headers["expo-sfv-version"]).toBe("0");

  const parts = parseMultipartMixed(response.body, response.headers["Content-Type"] ?? "");

  expect(parts).toHaveLength(1);
  expect(parts[0]?.headers["content-disposition"]).toBe('form-data; name="manifest"');
  expect(parts[0]?.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(parts[0]?.body ?? "")).toEqual(SAMPLE_MANIFEST);
});

test("negotiateManifestResponse echoes the requested expo-protocol-version", () => {
  for (const [requested, expected] of [
    ["0", "0"],
    ["1", "1"],
    [undefined, "1"],
    ["2", "1"],
  ] as const) {
    const response = negotiateManifestResponse({
      manifestJson: SAMPLE_MANIFEST,
      request: {
        headers: requested === undefined ? {} : { "expo-protocol-version": requested },
      },
    });

    expect(response.headers["expo-protocol-version"]).toBe(expected);
  }
});

test("negotiateManifestResponse rejects code-signing requests with a structured error", () => {
  for (const headerName of ["expo-expect-signature", "expo-expects-signature"]) {
    const response = negotiateManifestResponse({
      manifestJson: SAMPLE_MANIFEST,
      request: {
        headers: {
          accept: "multipart/mixed,application/expo+json,application/json",
          [headerName]: 'sig, keyid="root", alg="rsa-v1_5-sha256"',
        },
      },
    });

    expect(response.status).toBe(501);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");

    const error = JSON.parse(response.body) as { code: string; hint: string; message: string };

    expect(error.code).toBe("VIFX_EXPO_DEV_CLIENT_SIGNING_UNSUPPORTED");
    expect(error.message).toContain(headerName);
    expect(error.message).toContain("code signing is unsupported");
  }
});

test("createDevClientLaunchUrl percent-encodes the manifest URL", () => {
  expect(
    createDevClientLaunchUrl({
      manifestUrl: "http://127.0.0.1:8081/manifest",
      scheme: "vifxdev",
    }),
  ).toBe("vifxdev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081%2Fmanifest");
});

test("resolveDevClientScheme reads usable schemes from the app config", () => {
  expect(resolveDevClientScheme({ scheme: "vifxdev" })).toBe("vifxdev");
  expect(resolveDevClientScheme({ scheme: ["", "https", "vifxdev"] })).toBe("vifxdev");
  expect(resolveDevClientScheme({})).toBeNull();
  expect(resolveDevClientScheme({ scheme: "" })).toBeNull();
  // Mirrors @expo/cli: http(s) and "_" can never open a development client.
  expect(resolveDevClientScheme({ scheme: "HTTPS" })).toBeNull();
  expect(resolveDevClientScheme({ scheme: "my_app" })).toBeNull();
});

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer negotiates dev-client manifest responses and exposes devClientUrl",
  async () => {
    const projectRoot = await copyFixture("expo-basic");

    await declareAppScheme(projectRoot, "vifxdev");
    await writeNativeReactNativePackage(projectRoot);
    await writeNativeExpoPackage(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
    });

    try {
      expect(server.devClientUrl).toBe(
        `vifxdev://expo-development-client/?url=${encodeURIComponent(server.manifestUrl)}`,
      );

      const plainResponse = await fetch(server.manifestUrl, {
        headers: {
          Accept: "application/json",
        },
      });

      expect(plainResponse.status).toBe(200);
      expect(plainResponse.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(plainResponse.headers.get("cache-control")).toBe("private, max-age=0");
      expect(plainResponse.headers.get("expo-protocol-version")).toBe("1");
      expect(plainResponse.headers.get("expo-sfv-version")).toBe("0");
      expect(plainResponse.headers.get("expo-manifest-filters")).toBe("");
      expect(plainResponse.headers.get("expo-server-defined-headers")).toBe("");

      const plainBody = await plainResponse.text();

      expect(plainBody.endsWith("\n")).toBe(true);

      const plainManifest = JSON.parse(plainBody) as Record<string, unknown> & {
        launchAsset: { url: string };
      };

      expect(plainManifest.launchAsset.url).toBe(server.bundleUrl);

      const multipartResponse = await fetch(server.manifestUrl, {
        headers: {
          Accept: "multipart/mixed,application/expo+json,application/json",
          "expo-platform": "ios",
        },
      });
      const multipartContentType = multipartResponse.headers.get("content-type") ?? "";

      expect(multipartResponse.status).toBe(200);
      expect(multipartContentType).toMatch(/^multipart\/mixed; boundary=/u);
      expect(multipartResponse.headers.get("expo-protocol-version")).toBe("1");
      expect(multipartResponse.headers.get("expo-sfv-version")).toBe("0");

      const parts = parseMultipartMixed(await multipartResponse.text(), multipartContentType);

      expect(parts).toHaveLength(1);
      expect(parts[0]?.headers["content-disposition"]).toBe('form-data; name="manifest"');
      expect(parts[0]?.headers["content-type"]).toBe("application/json");

      const multipartManifest = JSON.parse(parts[0]?.body ?? "") as Record<string, unknown>;

      // Each request mints a fresh manifest id/createdAt; everything else must match
      // the plain JSON response exactly.
      expect(withoutVolatileManifestFields(multipartManifest)).toEqual(
        withoutVolatileManifestFields(plainManifest),
      );

      const signedResponse = await fetch(server.manifestUrl, {
        headers: {
          Accept: "multipart/mixed,application/expo+json,application/json",
          "expo-expect-signature": 'sig, keyid="root", alg="rsa-v1_5-sha256"',
          "expo-platform": "ios",
        },
      });

      expect(signedResponse.status).toBe(501);

      const signedError = (await signedResponse.json()) as { code: string };

      expect(signedError.code).toBe("VIFX_EXPO_DEV_CLIENT_SIGNING_UNSUPPORTED");
    } finally {
      await server.close();
    }
  },
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer omits devClientUrl when the app config declares no scheme",
  async () => {
    const projectRoot = await copyFixture("expo-basic");

    await writeNativeReactNativePackage(projectRoot);
    await writeNativeExpoPackage(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
    });

    try {
      expect(server.devClientUrl).toBeUndefined();
      expect("devClientUrl" in server).toBe(false);
    } finally {
      await server.close();
    }
  },
);
