import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { SourceMap } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { startExpoGoDevServer } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");
const SERVER_TEST_TIMEOUT = 180_000;
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-devtools-"));
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

async function startDevtoolsFixtureServer() {
  const projectRoot = await copyFixture("expo-basic");

  await writeNativeReactNativePackage(projectRoot);
  await writeNativeExpoPackage(projectRoot);

  return await startExpoGoDevServer({
    entry: "./index.js",
    platform: "ios",
    port: 0,
    projectRoot,
  });
}

const NETWORK_SERVER_TESTS = (await canListenOnLocalhost()) ? test : test.skip;

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer exposes the RN DevTools inspector proxy endpoints",
  async () => {
    const server = await startDevtoolsFixtureServer();

    try {
      expect(server.inspectorProxyUrl).toBe(`${server.url}/json/list`);

      const pagesListResponse = await fetch(`${server.url}/json/list`);
      const pagesList = (await pagesListResponse.json()) as unknown;
      const pagesResponse = await fetch(`${server.url}/json`);
      const pages = (await pagesResponse.json()) as unknown;
      const versionResponse = await fetch(`${server.url}/json/version`);
      const version = (await versionResponse.json()) as { Browser?: string };

      expect(pagesListResponse.status).toBe(200);
      expect(Array.isArray(pagesList)).toBe(true);
      expect(pagesList).toEqual([]);
      expect(pagesResponse.status).toBe(200);
      expect(Array.isArray(pages)).toBe(true);
      expect(pages).toEqual([]);
      expect(versionResponse.status).toBe(200);
      expect(version.Browser).toBe("Mobile JavaScript");
    } finally {
      await server.close();
    }
  },
  SERVER_TEST_TIMEOUT,
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer serves /reload /open-url /open-stack-frame /logs dev actions",
  async () => {
    const server = await startDevtoolsFixtureServer();

    try {
      const messageSocket = await openWebSocket(server.messageSocketUrl);

      try {
        const reloadPostPromise = waitForWebSocketMessage(messageSocket);
        const reloadPostResponse = await fetch(`${server.url}/reload`, { method: "POST" });
        const reloadPostMessage = JSON.parse(await reloadPostPromise) as { method: string };

        const reloadGetPromise = waitForWebSocketMessage(messageSocket);
        const reloadGetResponse = await fetch(`${server.url}/reload`);
        const reloadGetMessage = JSON.parse(await reloadGetPromise) as { method: string };

        expect(reloadPostResponse.status).toBe(200);
        expect(reloadPostMessage.method).toBe("reload");
        expect(reloadGetResponse.status).toBe(200);
        expect(reloadGetMessage.method).toBe("reload");
      } finally {
        messageSocket.close();
      }

      const openUrlResponse = await fetch(`${server.url}/open-url`, {
        body: JSON.stringify({ url: "https://vifx.dev/devtools" }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const openUrl = (await openUrlResponse.json()) as { opened: boolean; url: string | null };

      const logsResponse = await fetch(`${server.url}/logs`, {
        body: JSON.stringify([
          { body: ["hello from the app", { tag: "vifx" }], level: "info" },
          { body: ["something looks off"], level: "warn" },
        ]),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const logs = (await logsResponse.json()) as { received: number };

      const sourceMapResponse = await fetch(server.sourceMapUrl ?? "");
      const sourceMap = (await sourceMapResponse.json()) as RawSourceMap;
      const symbolicatablePosition = findSymbolicatablePosition(sourceMap);
      const openStackFrameResponse = await fetch(`${server.url}/open-stack-frame`, {
        body: JSON.stringify({
          file: "index.bundle",
          methodName: "boot",
          ...symbolicatablePosition,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const openStackFrame = (await openStackFrameResponse.json()) as {
        frame: { methodName?: string; source?: string } | null;
      };

      const missingResponse = await fetch(`${server.url}/definitely-not-a-route`);

      expect(openUrlResponse.status).toBe(200);
      expect(openUrl.opened).toBe(false);
      expect(openUrl.url).toBe("https://vifx.dev/devtools");
      expect(logsResponse.status).toBe(200);
      expect(logs.received).toBe(2);
      expect(sourceMapResponse.status).toBe(200);
      expect(openStackFrameResponse.status).toBe(200);
      expect(openStackFrame.frame?.methodName).toBe("boot");
      expect(sourceMap.sources).toContain(openStackFrame.frame?.source);
      expect(missingResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  },
  SERVER_TEST_TIMEOUT,
);
