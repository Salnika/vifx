// Behavioral contract test harness for the Expo Go dev server.
//
// This module exists to protect the sibling Metro-replacement rewrites: it
// spins up a *complete* synthetic Expo project on disk and starts the real
// `startExpoGoDevServer`, then exposes typed helpers (HTTP fetchers + WebSocket
// clients) so that `dev-server-harness.test.ts` can document the server's
// observable contract endpoint-by-endpoint.
//
// It deliberately duplicates the synthetic-project recipe from `index.test.ts`
// rather than refactoring that file to share helpers: the existing tests stay
// untouched, and this harness is free to extend the recipe (e.g. a runtime
// asset import that exercises `/assets` serving) without risking regressions.

import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type RawData, WebSocket } from "ws";
import {
  type StartExpoDevServerOptions,
  type VifxExpoGoDevServer,
  startExpoGoDevServer,
} from "../src/index.ts";

/**
 * Smallest valid 1x1 PNG. Registered as the app icon and imported at runtime so
 * that both the manifest's config-asset rewriting and the emitted-asset
 * `/assets` route are exercised by the harness.
 */
const ONE_BY_ONE_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
    "890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex",
);

export interface CreateExpoGoTestProjectOptions {
  /** Override the app `name` written to `app.json`. */
  name?: string;
  /** Override the app `slug` written to `app.json`. */
  slug?: string;
  /** Override the Expo SDK version declared in `app.json` + `package.json`. */
  sdkVersion?: string;
}

export interface ExpoGoTestProject {
  /** Absolute path to the registered icon asset on disk. */
  iconAssetPath: string;
  /** Absolute path to the synthetic project root (a fresh temp dir). */
  projectRoot: string;
  /** The slug written into `app.json` (used by manifest assertions). */
  slug: string;
}

/**
 * Build a complete synthetic Expo project in a fresh temp directory.
 *
 * The project contains:
 *  - `app.json` with name / slug / sdkVersion and an icon PNG asset,
 *  - `package.json` declaring an `expo` dependency (drives SDK detection),
 *  - `index.js` entry that registers a root component AND imports a PNG at
 *    runtime (so an emitted asset is produced and served under `/assets`),
 *  - minimal synthetic `node_modules` for `expo`, `react-native`, and
 *    `@react-native/js-polyfills` sufficient for `buildExpoBundle` to compile.
 */
export async function createExpoGoTestProject(
  options: CreateExpoGoTestProjectOptions = {},
): Promise<ExpoGoTestProject> {
  const slug = options.slug ?? "vifx-harness-app";
  const name = options.name ?? "Vifx Harness App";
  const sdkVersion = options.sdkVersion ?? "54.0.33";
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-harness-"));

  const iconAssetPath = path.join(projectRoot, "assets", "icon.png");
  await mkdir(path.dirname(iconAssetPath), { recursive: true });
  await writeFile(iconAssetPath, ONE_BY_ONE_PNG);

  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify(
      {
        expo: {
          icon: "./assets/icon.png",
          name,
          sdkVersion,
          slug,
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: { expo: `~${sdkVersion}` },
        name: slug,
        version: "0.0.0",
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { registerRootComponent } from "expo";',
      'import runtimeIcon from "./assets/icon.png";',
      "function HarnessRoot() {",
      "  return runtimeIcon;",
      "}",
      'console.log("vifx harness runtime asset", runtimeIcon);',
      "registerRootComponent(HarnessRoot);",
      "",
    ].join("\n"),
  );

  await writeSyntheticNodeModules(projectRoot);

  return { iconAssetPath, projectRoot, slug };
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

async function writeSyntheticNodeModules(projectRoot: string) {
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

  await writeTestPackage(projectRoot, "@react-native/js-polyfills", {
    "console.js": "",
    "error-guard.js": [
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

/**
 * Probe whether the sandbox can bind an ephemeral localhost port. The dev-server
 * contract suite is gated on this so it self-skips in network-restricted CI.
 */
export async function canListenOnLocalhost(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export interface TestServerOverrides extends Partial<
  Omit<StartExpoDevServerOptions, "platform" | "projectRoot">
> {
  platform?: StartExpoDevServerOptions["platform"];
}

export interface TestServerHandle {
  /** The running dev server (its `close()` is wrapped by `cleanup`). */
  server: VifxExpoGoDevServer;
  /** GET helper that resolves the response + parsed text/JSON. */
  get: (pathname: string) => Promise<HttpProbe>;
  /** GET helper for an absolute URL (manifest emits absolute asset/bundle URLs). */
  fetchUrl: (url: string) => Promise<HttpProbe>;
  /** POST helper (JSON body) for `/symbolicate`. */
  postJson: (pathname: string, body: unknown) => Promise<HttpProbe>;
  /** Open a `ws` client against `/message` (resolves once OPEN). */
  openMessageClient: () => Promise<TestSocket>;
  /** Open a `ws` client against `/events` (resolves once OPEN). */
  openEventsClient: () => Promise<TestSocket>;
  /** Idempotent teardown: closes sockets then the server. */
  cleanup: () => Promise<void>;
}

export interface HttpProbe {
  body: string;
  contentType: string | null;
  headers: Headers;
  json: <T = unknown>() => T;
  status: number;
}

/**
 * Start the real Expo Go dev server against a synthetic project on an ephemeral
 * port (0) and return typed probe helpers + an idempotent cleanup.
 */
export async function startTestServer(
  project: ExpoGoTestProject,
  overrides: TestServerOverrides = {},
): Promise<TestServerHandle> {
  const server = await startExpoGoDevServer({
    entry: "./index.js",
    platform: "ios",
    port: 0,
    projectRoot: project.projectRoot,
    ...overrides,
  });

  const openSockets = new Set<TestSocket>();
  let closed = false;

  const probe = async (response: Response): Promise<HttpProbe> => {
    const body = await response.text();
    return {
      body,
      contentType: response.headers.get("content-type"),
      headers: response.headers,
      json: <T = unknown>() => JSON.parse(body) as T,
      status: response.status,
    };
  };

  const openClient = async (pathname: string): Promise<TestSocket> => {
    const wsUrl = `${server.url.replace(/^http:/u, "ws:")}${pathname}`;
    const socket = await openTestSocket(wsUrl);
    openSockets.add(socket);
    return socket;
  };

  return {
    cleanup: async () => {
      for (const socket of openSockets) {
        socket.close();
      }
      openSockets.clear();
      // Idempotent: the underlying http server's close() rejects if called when
      // already stopped, so the harness guards repeat teardown to a no-op.
      if (closed) {
        return;
      }
      closed = true;
      await server.close();
    },
    fetchUrl: async (url) => probe(await fetch(url)),
    get: async (pathname) => probe(await fetch(`${server.url}${pathname}`)),
    openEventsClient: () => openClient("/events"),
    openMessageClient: () => openClient("/message"),
    postJson: async (pathname, body) =>
      probe(
        await fetch(`${server.url}${pathname}`, {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    server,
  };
}

export interface TestSocket {
  /** Close the underlying socket (safe to call repeatedly). */
  close: () => void;
  /** Send a JSON-serialized message frame. */
  sendJson: (message: unknown) => void;
  /** Resolve with the next text message; rejects on close/timeout. */
  nextMessage: (timeoutMs?: number) => Promise<string>;
  /** Resolve with the next text message parsed as JSON. */
  nextJson: <T = unknown>(timeoutMs?: number) => Promise<T>;
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

async function openTestSocket(url: string): Promise<TestSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", (error) => reject(error));
  });

  const nextMessage = (timeoutMs = 5000) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for a WebSocket message on ${url}.`));
      }, timeoutMs);

      const onMessage = (data: RawData, isBinary: boolean) => {
        cleanup();
        if (isBinary) {
          reject(new Error(`Expected a text frame on ${url} but received a binary frame.`));
          return;
        }
        resolve(rawDataToString(data));
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`WebSocket ${url} closed while awaiting a message.`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
      };

      socket.on("message", onMessage);
      socket.once("close", onClose);
    });

  return {
    close: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
    nextJson: async <T = unknown>(timeoutMs?: number) =>
      JSON.parse(await nextMessage(timeoutMs)) as T,
    nextMessage,
    sendJson: (message) => socket.send(JSON.stringify(message)),
  };
}
