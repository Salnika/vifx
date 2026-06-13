import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { SourceMap } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vite-plus/test";
import {
  createExpoGoBundleUrlPath,
  expo,
  findExpoAppConfig,
  startExpoDevServer,
  startExpoGoDevServer,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");
type SourceMapPayload = ConstructorParameters<typeof SourceMap>[0];

interface RawSourceMap {
  mappings: string;
  names?: string[];
  sources: string[];
  sourcesContent?: Array<string | null>;
  version: number;
}

interface TestWebSocket {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  close: () => void;
  send: (data: string) => void;
}

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-plugin-"));
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
      'console.log("native react-native package active");',
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

async function writeReactNativePolyfillsPackage(projectRoot: string) {
  await writeTestPackage(projectRoot, "@react-native/js-polyfills", {
    "console.js": ['console.log("native console polyfill active");', ""].join("\n"),
    "error-guard.js": [
      'console.log("native error guard polyfill active");',
      "globalThis.ErrorUtils = {",
      "  applyWithGuard(fn, context, args) { return fn.apply(context, args ?? []); },",
      "  applyWithGuardIfNeeded(fn, context, args) { return fn.apply(context, args ?? []); },",
      "  getGlobalHandler() { return this._handler; },",
      "  guard(fn) { return fn; },",
      "  inGuard() { return false; },",
      "  reportError(error) { throw error; },",
      "  reportFatalError(error) { throw error; },",
      "  setGlobalHandler(handler) { this._handler = handler; },",
      "};",
      "",
    ].join("\n"),
  });
}

async function writeNativeExpoPackage(projectRoot: string) {
  await writeTestPackage(projectRoot, "expo", {
    "index.js": [
      'import { AppRegistry } from "react-native";',
      'console.log("native expo package active");',
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

async function writeReactNativeWebPackage(projectRoot: string) {
  await writeTestPackage(projectRoot, "react-native-web", {
    "index.js": [
      'console.log("react-native-web compat active");',
      "export const AppRegistry = {",
      "  registerComponent(name, loadComponent) {",
      "    return { loadComponent, name };",
      "  },",
      "  getApplication() { return { element: null, getStyleElement() { return null; } }; },",
      "  runApplication() {},",
      "};",
      "export const NativeModules = {};",
      'export const Platform = { OS: "web", select(options) { return options?.web ?? options?.default; } };',
      "export const TurboModuleRegistry = { get() { return null; }, getEnforcing() { return {}; } };",
      "export default { AppRegistry, NativeModules, Platform, TurboModuleRegistry };",
      "",
    ].join("\n"),
  });
}

function findSymbolicatablePosition(sourceMap: RawSourceMap) {
  const sourceMapInstance = new SourceMap(sourceMap as SourceMapPayload);

  for (let line = 0; line < 200; line += 1) {
    for (let column = 0; column < 200; column += 1) {
      const entry = sourceMapInstance.findEntry(line, column);
      if ("originalSource" in entry && entry.originalSource) {
        return {
          column: column + 1,
          lineNumber: line + 1,
        };
      }
    }
  }

  throw new Error("No symbolicatable source-map position found.");
}

function openWebSocket(url: string) {
  const WebSocketCtor = globalThis.WebSocket as unknown as
    | (new (socketUrl: string) => TestWebSocket)
    | undefined;
  if (!WebSocketCtor) {
    throw new Error("This test requires globalThis.WebSocket.");
  }

  const socket = new WebSocketCtor(url);
  return new Promise<TestWebSocket>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`WebSocket failed: ${url}`)), {
      once: true,
    });
  });
}

function waitForWebSocketMessage(socket: TestWebSocket) {
  return new Promise<string>((resolve, reject) => {
    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data === "string") {
          resolve(event.data);
          return;
        }

        reject(new Error("Expected a text WebSocket message."));
      },
      { once: true },
    );
    socket.addEventListener("close", () => reject(new Error("WebSocket closed.")), { once: true });
  });
}

const NETWORK_SERVER_TESTS = (await canListenOnLocalhost()) ? test : test.skip;

test("createExpoGoBundleUrlPath reflects the bundle mode through the dev query param", async () => {
  const defaultUrlPath = await createExpoGoBundleUrlPath({
    mainModuleName: "index",
    platform: "ios",
  });
  const developmentUrlPath = await createExpoGoBundleUrlPath({
    dev: true,
    mainModuleName: "index",
    platform: "ios",
  });
  const productionUrlPath = await createExpoGoBundleUrlPath({
    dev: false,
    mainModuleName: "index",
    platform: "android",
  });

  expect(defaultUrlPath).toContain("dev=true");
  expect(developmentUrlPath).toContain("dev=true");
  expect(productionUrlPath).toContain("dev=false");
  expect(productionUrlPath).toContain("platform=android");
});

test("findExpoAppConfig discovers app.json in the Expo fixture", async () => {
  const projectRoot = await copyFixture("expo-basic");

  await expect(findExpoAppConfig(projectRoot)).resolves.toBe(path.join(projectRoot, "app.json"));
});

test("expo() loads on the Expo fixture and injects EXPO_PUBLIC_ values", async () => {
  const projectRoot = await copyFixture("expo-basic");
  const appPath = path.join(projectRoot, "App.tsx");
  const originalSource = await readFile(appPath, "utf8");

  await writeNativeReactNativePackage(projectRoot);
  await writeNativeExpoPackage(projectRoot);
  await writeFile(
    appPath,
    [originalSource.trimEnd(), "", "console.log(import.meta.env.EXPO_PUBLIC_VIFX_LABEL);", ""].join(
      "\n",
    ),
  );

  await build({
    appType: "custom",
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: ".vifx/expo-ios",
      rollupOptions: {
        input: path.join(projectRoot, "index.js"),
        output: {
          entryFileNames: "index.bundle",
          format: "es",
        },
      },
      sourcemap: true,
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      ...expo({
        entry: "./index.js",
        env: {
          EXPO_PUBLIC_VIFX_LABEL: "fixture-injected",
        },
        platform: "ios",
        projectRoot,
      }),
    ],
    publicDir: false,
    root: projectRoot,
  });

  const bundleSource = await readFile(
    path.join(projectRoot, ".vifx/expo-ios/index.bundle"),
    "utf8",
  );

  expect(bundleSource).toContain("fixture-injected");
  expect(bundleSource).toContain("native expo package active");
  expect(bundleSource).toContain('AppRegistry.registerComponent("main"');
});

NETWORK_SERVER_TESTS("startExpoDevServer serves bounded dev HTML and Vite HMR client", async () => {
  const projectRoot = await copyFixture("expo-basic");
  const server = await startExpoDevServer({
    entry: "./index.js",
    platform: "ios",
    port: 5179,
    projectRoot,
  });

  try {
    const htmlResponse = await fetch(server.url);
    const html = await htmlResponse.text();
    const clientResponse = await fetch(`${server.url}/@vifx/expo-dev-client`);
    const client = await clientResponse.text();

    expect(server.hmr).toBe("vite-browser");
    expect(server.fastRefresh).toBe(false);
    expect(server.nativeRuntime).toBe(false);
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain("Vifx Expo Dev");
    expect(html).toContain("/@vifx/expo-dev-client");
    expect(clientResponse.status).toBe(200);
    expect(client).toContain("import.meta.hot.accept");
    expect(client).toContain("await import");
  } finally {
    await server.close();
  }
});

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer serves an Expo Go manifest backed by Vifx bundle artifacts",
  async () => {
    const projectRoot = await copyFixture("expo-basic");
    const appPath = path.join(projectRoot, "App.tsx");
    const assetPath = path.join(projectRoot, "assets", "icon.png");
    const appJsonPath = path.join(projectRoot, "app.json");
    const packageJsonPath = path.join(projectRoot, "package.json");
    const appJson = JSON.parse(await readFile(appJsonPath, "utf8")) as {
      expo: { icon?: string; name: string; slug: string };
    };
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    const originalAppSource = await readFile(appPath, "utf8");

    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, Buffer.from("vifx-icon"));
    await writeFile(
      appPath,
      [
        'import runtimeIcon from "./assets/icon.png";',
        originalAppSource.trimEnd(),
        'console.log("runtime asset", runtimeIcon);',
        "",
      ].join("\n"),
    );
    await writeFile(
      appJsonPath,
      JSON.stringify(
        {
          expo: {
            ...appJson.expo,
            icon: "./assets/icon.png",
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          ...packageJson,
          dependencies: {
            ...packageJson.dependencies,
            expo: "~54.0.33",
          },
        },
        null,
        2,
      ),
    );
    await writeNativeReactNativePackage(projectRoot);
    await writeReactNativePolyfillsPackage(projectRoot);
    await writeNativeExpoPackage(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
    });

    try {
      const manifestResponse = await fetch(server.manifestUrl, {
        headers: {
          Accept: "application/json",
        },
      });
      const manifest = (await manifestResponse.json()) as {
        assets: Array<{
          fileExtension: string;
          fileUris: string[];
          hash: string | null;
          key: string;
          name: string;
          type: string;
          url: string;
        }>;
        extra: {
          expoClient: { hostUri: string; icon: string; sdkVersion: string; slug: string };
          expoGo: { developer: { tool: string }; mainModuleName: string };
        };
        launchAsset: { contentType: string; fileExtension: string; url: string };
        metadata: { generatedBy: string; platform: string };
        runtimeVersion: string;
        sdkVersion: string;
      };
      const bundleResponse = await fetch(server.bundleUrl);
      const bundleSource = await bundleResponse.text();
      const sourceMapResponse = await fetch(server.sourceMapUrl ?? "");
      const sourceMap = (await sourceMapResponse.json()) as RawSourceMap;
      const assetUrl = manifest.extra.expoClient.icon;
      const assetResponse = await fetch(assetUrl);
      const assetBody = await assetResponse.text();
      const runtimeAssetUrl = manifest.assets[0]?.fileUris[0] ?? `${server.url}/assets/icon.png`;
      const runtimeAssetResponse = await fetch(runtimeAssetUrl);
      const runtimeAssetBody = await runtimeAssetResponse.text();
      const statusResponse = await fetch(`${server.url}/status`);
      const status = await statusResponse.text();
      const symbolicatablePosition = findSymbolicatablePosition(sourceMap);
      const symbolicateResponse = await fetch(`${server.url}/symbolicate`, {
        body: JSON.stringify({
          stack: [{ file: "index.bundle", ...symbolicatablePosition }],
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const symbolication = (await symbolicateResponse.json()) as {
        stack: Array<{ file?: string; source?: string }>;
      };
      const messageSocket = await openWebSocket(server.messageSocketUrl);
      const eventsSocket = await openWebSocket(server.eventsSocketUrl);

      try {
        messageSocket.send(
          JSON.stringify({
            id: "identity",
            method: "getid",
            target: "server",
            version: 2,
          }),
        );
        const identityMessage = JSON.parse(await waitForWebSocketMessage(messageSocket)) as {
          result: string;
          version: number;
        };
        const reloadMessagePromise = waitForWebSocketMessage(messageSocket);

        eventsSocket.send(
          JSON.stringify({
            command: "reload",
            params: { reason: "test" },
            type: "command",
            version: 2,
          }),
        );
        const reloadMessage = JSON.parse(await reloadMessagePromise) as {
          method: string;
          params: { reason?: string };
          version: number;
        };

        expect(server.nativeRuntime).toBe(true);
        expect(server.metro).toBe(false);
        expect(server.hmr).toBe("reload");
        expect(server.expoGoUrl).toBe(`exp://${server.hostUri}`);
        expect(server.hostUri).toContain(`:${String(server.port)}`);
        expect(server.messageSocketUrl).toBe(`${server.url.replace(/^http:/u, "ws:")}/message`);
        expect(server.eventsSocketUrl).toBe(`${server.url.replace(/^http:/u, "ws:")}/events`);
        expect(identityMessage.version).toBe(2);
        expect(identityMessage.result).toMatch(/^vifx-/u);
        expect(reloadMessage.version).toBe(2);
        expect(reloadMessage.method).toBe("reload");
        expect(reloadMessage.params.reason).toBe("test");
        expect(manifestResponse.status).toBe(200);
        expect(manifestResponse.headers.get("expo-protocol-version")).toBe("1");
        expect(manifestResponse.headers.get("expo-sfv-version")).toBe("0");
        expect(manifestResponse.headers.get("expo-manifest-filters")).toBe("");
        expect(manifestResponse.headers.get("expo-server-defined-headers")).toBe("");
        expect(manifest.launchAsset.url).toBe(server.bundleUrl);
        expect(manifest.launchAsset.contentType).toBe("application/javascript");
        expect(manifest.launchAsset.fileExtension).toBe("bundle");
        expect(manifest.extra.expoClient.slug).toBe("expo-basic");
        expect(manifest.extra.expoClient.hostUri).toBe(server.hostUri);
        expect(manifest.extra.expoClient.sdkVersion).toBe("54.0.0");
        expect(manifest.sdkVersion).toBe("54.0.0");
        expect(assetUrl).toBe(`${server.url}/assets/assets/icon.png`);
        expect(manifest.assets[0]?.name).toBe("icon");
        expect(manifest.assets[0]?.type).toBe("png");
        expect(manifest.assets[0]?.fileExtension).toBe("png");
        expect(manifest.assets[0]?.key).toBeTruthy();
        expect(manifest.assets[0]?.url).toBe(runtimeAssetUrl);
        expect(manifest.extra.expoGo.developer.tool).toBe("vifx");
        expect(manifest.extra.expoGo.mainModuleName).toBe("index");
        expect(manifest.metadata.generatedBy).toBe("vifx");
        expect(manifest.metadata.platform).toBe("ios");
        expect(manifest.runtimeVersion).toBe("exposdk:54.0.0");
        expect(bundleResponse.status).toBe(200);
        expect(bundleSource).not.toContain("native console polyfill active");
        expect(bundleSource).toContain("native error guard polyfill active");
        expect(bundleSource).toContain("native expo package active");
        expect(bundleSource).toContain("runtime asset");
        expect(bundleSource).toContain('AppRegistry.registerComponent("main"');
        expect(sourceMapResponse.status).toBe(200);
        expect(sourceMap.version).toBe(3);
        expect(assetResponse.status).toBe(200);
        expect(assetBody).toBe("vifx-icon");
        expect(runtimeAssetResponse.status).toBe(200);
        expect(runtimeAssetBody).toBe("vifx-icon");
        expect(status).toBe("packager-status:running");
        expect(symbolication.stack).toHaveLength(1);
        expect(sourceMap.sources).toContain(symbolication.stack[0]?.source);
        expect(symbolication.stack[0]?.file).toBe(symbolication.stack[0]?.source);
      } finally {
        messageSocket.close();
        eventsSocket.close();
      }
    } finally {
      await server.close();
    }
  },
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer exposes a broadcast that reaches connected message clients",
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
      expect(server.broadcast).toBeTypeOf("function");

      const messageSocket = await openWebSocket(server.messageSocketUrl);

      try {
        const reloadPromise = waitForWebSocketMessage(messageSocket);
        server.broadcast?.("reload");
        const reload = JSON.parse(await reloadPromise) as { method: string };

        expect(reload.method).toBe("reload");

        const devMenuPromise = waitForWebSocketMessage(messageSocket);
        server.broadcast?.("devMenu", { source: "vifx-test" });
        const devMenu = JSON.parse(await devMenuPromise) as {
          method: string;
          params: { source?: string };
        };

        expect(devMenu.method).toBe("devMenu");
        expect(devMenu.params.source).toBe("vifx-test");
      } finally {
        messageSocket.close();
      }
    } finally {
      await server.close();
    }
  },
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer can emit an explicit public host for Expo Go URLs",
  async () => {
    const projectRoot = await copyFixture("expo-basic");

    await writeNativeReactNativePackage(projectRoot);
    await writeNativeExpoPackage(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
      publicHost: "localhost",
    });

    try {
      const manifest = (await (await fetch(server.manifestUrl)).json()) as {
        extra: { expoClient: { hostUri: string }; expoGo: { debuggerHost: string } };
        launchAsset: { url: string };
      };

      expect(server.hostUri).toBe(`localhost:${String(server.port)}`);
      expect(server.url).toBe(`http://localhost:${String(server.port)}`);
      expect(server.expoGoUrl).toBe(`exp://localhost:${String(server.port)}`);
      expect(manifest.launchAsset.url).toBe(server.bundleUrl);
      expect(manifest.extra.expoClient.hostUri).toBe(server.hostUri);
      expect(manifest.extra.expoGo.debuggerHost).toBe(server.hostUri);
    } finally {
      await server.close();
    }
  },
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer resolves native React Native even when a target was configured for web preview",
  async () => {
    const projectRoot = await copyFixture("expo-basic");

    await writeNativeReactNativePackage(projectRoot);
    await writeNativeExpoPackage(projectRoot);
    await writeReactNativeWebPackage(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
      reactNativeCompat: "web",
    });

    try {
      const bundleSource = await (await fetch(server.bundleUrl)).text();
      const defaultExpoGoBundle = await readFile(
        path.join(projectRoot, ".vifx", "expo-go", "ios", "index.bundle"),
        "utf8",
      );

      expect(bundleSource).toContain("native react-native package active");
      expect(bundleSource).toContain("native expo package active");
      expect(bundleSource).not.toContain("react-native-web compat active");
      expect(bundleSource).not.toContain("__VIFX_WEB_RUNTIME__");
      expect(defaultExpoGoBundle).toBe(bundleSource);
    } finally {
      await server.close();
    }
  },
);
