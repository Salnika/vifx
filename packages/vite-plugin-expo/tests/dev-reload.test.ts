import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { startExpoGoDevServer } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

interface TestWebSocket {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  close: () => void;
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

const NETWORK_SERVER_TESTS = (await canListenOnLocalhost()) ? test : test.skip;

async function copyFixture(fixtureId: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-reload-"));
  const sourceRoot = path.join(FIXTURE_ROOT, fixtureId);
  const targetRoot = path.join(tempRoot, fixtureId);

  await cp(sourceRoot, targetRoot, { recursive: true });

  return targetRoot;
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

async function writeNativeRuntimePackages(projectRoot: string) {
  await writeTestPackage(projectRoot, "react-native", {
    "index.js": [
      "export const AppRegistry = {",
      "  registerComponent(name, loadComponent) {",
      "    return { loadComponent, name };",
      "  },",
      "  runApplication() {},",
      "};",
      "export default { AppRegistry };",
      "",
    ].join("\n"),
  });
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

function collectJsonMessages(socket: TestWebSocket) {
  const messages: Array<Record<string, unknown>> = [];

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      messages.push(JSON.parse(event.data) as Record<string, unknown>);
    }
  });

  return messages;
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string) {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out while waiting for ${description}.`);
    }

    await sleep(25);
  }
}

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer rebuilds on source changes and notifies /message and /hot clients",
  async () => {
    const projectRoot = await copyFixture("expo-basic");
    const appPath = path.join(projectRoot, "App.tsx");
    const originalAppSource = await readFile(appPath, "utf8");

    await writeNativeRuntimePackages(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
    });

    try {
      expect(server.watching).toBe(true);
      expect(server.hotSocketUrl).toBe(`${server.url.replace(/^http:/u, "ws:")}/hot`);

      const initialBundle = await (await fetch(server.bundleUrl)).text();
      const messageSocket = await openWebSocket(server.messageSocketUrl);
      const hotSocket = await openWebSocket(server.hotSocketUrl ?? "");
      const messageMessages = collectJsonMessages(messageSocket);
      const hotMessages = collectJsonMessages(hotSocket);

      try {
        const marker = `vifx-live-reload-${String(Date.now())}`;

        // Recursive watchers can take a moment to arm; keep touching the
        // source file until the first hot notification is observed.
        const touchDeadline = Date.now() + 15_000;
        while (hotMessages.length === 0 && Date.now() < touchDeadline) {
          await writeFile(
            appPath,
            [originalAppSource.trimEnd(), `console.log("${marker}");`, ""].join("\n"),
          );
          await sleep(500);
        }

        await waitFor(
          () => hotMessages.some((message) => message.type === "update-start"),
          15_000,
          'an "update-start" /hot message',
        );
        await waitFor(
          () => hotMessages.some((message) => message.type === "update-done"),
          15_000,
          'an "update-done" /hot message',
        );
        await waitFor(
          () => messageMessages.some((message) => message.method === "reload"),
          15_000,
          'a "reload" /message broadcast',
        );

        const reloadMessage = messageMessages.find((message) => message.method === "reload");
        expect(reloadMessage?.version).toBe(2);

        const updateStartIndex = hotMessages.findIndex(
          (message) => message.type === "update-start",
        );
        const updateDoneIndex = hotMessages.findIndex((message) => message.type === "update-done");
        expect(updateStartIndex).toBeGreaterThanOrEqual(0);
        expect(updateDoneIndex).toBeGreaterThan(updateStartIndex);
        expect(hotMessages[updateStartIndex]).toEqual({
          body: { isInitialUpdate: false },
          type: "update-start",
        });
        expect(hotMessages[updateDoneIndex]).toEqual({ type: "update-done" });
        expect(hotMessages.every((message) => message.type !== "update")).toBe(true);
        expect(hotMessages.every((message) => message.type !== "error")).toBe(true);

        const rebuiltBundle = await (await fetch(server.bundleUrl)).text();
        expect(rebuiltBundle).not.toBe(initialBundle);
        expect(rebuiltBundle).toContain(marker);
        expect(initialBundle).not.toContain(marker);
      } finally {
        messageSocket.close();
        hotSocket.close();
      }
    } finally {
      await server.close();
    }
  },
  120_000,
);

NETWORK_SERVER_TESTS(
  "startExpoGoDevServer keeps serving the last good bundle when a rebuild fails",
  async () => {
    const projectRoot = await copyFixture("expo-basic");
    const appPath = path.join(projectRoot, "App.tsx");
    const originalAppSource = await readFile(appPath, "utf8");

    await writeNativeRuntimePackages(projectRoot);

    const server = await startExpoGoDevServer({
      entry: "./index.js",
      platform: "ios",
      port: 0,
      projectRoot,
    });

    try {
      const initialBundle = await (await fetch(server.bundleUrl)).text();
      const hotSocket = await openWebSocket(server.hotSocketUrl ?? "");
      const hotMessages = collectJsonMessages(hotSocket);

      try {
        // Break the app source so the rebuild fails.
        const touchDeadline = Date.now() + 15_000;
        while (hotMessages.length === 0 && Date.now() < touchDeadline) {
          await writeFile(
            appPath,
            'import missing from "./does-not-exist-anywhere";\nexport default missing(;\n',
          );
          await sleep(500);
        }

        await waitFor(
          () => hotMessages.some((message) => message.type === "error"),
          30_000,
          'an "error" /hot message',
        );

        const errorMessage = hotMessages.find((message) => message.type === "error");
        const errorBody = errorMessage?.body as
          | { errors: Array<{ description: string }>; message: string; type: string }
          | undefined;
        expect(typeof errorBody?.type).toBe("string");
        expect(typeof errorBody?.message).toBe("string");
        expect(Array.isArray(errorBody?.errors)).toBe(true);

        // The last good bundle keeps being served from memory.
        const bundleAfterFailure = await (await fetch(server.bundleUrl)).text();
        expect(bundleAfterFailure).toBe(initialBundle);
      } finally {
        hotSocket.close();
        await writeFile(appPath, originalAppSource);
      }
    } finally {
      await server.close();
    }
  },
  120_000,
);
