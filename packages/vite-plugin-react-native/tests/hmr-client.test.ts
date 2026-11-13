import { expect, test } from "vite-plus/test";
import { VIFX_HMR_CLIENT_SOURCE } from "../src/hmr-client.ts";

/**
 * Drives the injected HMR client source ({@link VIFX_HMR_CLIENT_SOURCE}) through
 * a `new Function` harness with a fake `WebSocket` and `globalThis`, asserting
 * the message protocol: connect on enable, apply `update` deltas via the
 * Hermes-safe `globalEvalWithSourceUrl`, surface `error`, and stay inert without
 * an injected socket URL.
 */

interface FakeSocket {
  closed: boolean;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  sent: string[];
  url: string;
}

function createFakeWebSocket() {
  const instances: FakeSocket[] = [];
  class FakeWebSocket {
    closed = false;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    // Connecting until the test opens it, as a real socket is.
    readyState = 0;
    sent: string[] = [];
    url: string;
    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as FakeSocket);
    }
    close() {
      this.closed = true;
      this.readyState = 3;
    }
    send(data: string) {
      this.sent.push(data);
    }
  }
  return { FakeWebSocket, instances };
}

/** Opens a fake socket the way the platform does. */
function open(socket: FakeSocket | undefined) {
  if (socket) {
    socket.readyState = 1;
    socket.onopen?.();
  }
}

function sentMessages(socket: FakeSocket | undefined): Array<Record<string, unknown>> {
  return (socket?.sent ?? []).map((data) => JSON.parse(data) as Record<string, unknown>);
}

interface HmrClient {
  disable: () => void;
  enable: () => void;
  hasError: () => boolean;
  isEnabled: () => boolean;
  log: (level: string, data: unknown[]) => void;
  setup: () => void;
}

function loadHmrClient(options: {
  console?: { error: (message: string) => void };
  globals: Record<string, unknown>;
  /** What the bundler defines in front of the source on a real React Native. */
  loadLogBox?: () => unknown;
  /** Receives the callbacks the client schedules; a test runs them itself. */
  timers?: Array<() => void>;
  webSocket: unknown;
}): HmrClient {
  const body = VIFX_HMR_CLIENT_SOURCE.replace("export default HMRClient;", "return HMRClient;");
  // Timers are not run on their own (that includes the self-connect), so each
  // test drives the lifecycle explicitly. `new Function` is the point: it
  // evaluates the injected client source exactly as the device runtime would.
  // eslint-disable-next-line no-implied-eval
  const factory = new Function(
    "globalThis",
    "WebSocket",
    "console",
    "setTimeout",
    "clearTimeout",
    "vifxLoadLogBox",
    body,
  );
  const client = factory(
    options.globals,
    options.webSocket,
    options.console ?? console,
    (callback: () => void) => {
      options.timers?.push(callback);
      return options.timers?.length ?? 0;
    },
    () => undefined,
    options.loadLogBox,
  ) as HmrClient;
  // Drop the self-connect scheduled at load: tests connect through enable().
  if (options.timers) {
    options.timers.length = 0;
  }
  return client;
}

function updateMessage(modified: Array<[number, string, string]>) {
  return JSON.stringify({
    body: {
      added: [],
      deleted: [],
      isInitialUpdate: false,
      modified: modified.map(([id, code, sourceURL]) => ({
        module: [id, code],
        sourceMappingURL: null,
        sourceURL,
      })),
      revisionId: "rev-1",
    },
    type: "update",
  });
}

test("hmr client connects on enable and applies updates via globalEvalWithSourceUrl", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const evalCalls: Array<{ code: string; url: unknown }> = [];
  const globals: Record<string, unknown> = {
    __VIFX_HMR_URL: "ws://localhost:8081/hot",
    globalEvalWithSourceUrl: (code: string, url: unknown) => {
      evalCalls.push({ code, url });
    },
  };

  const client = loadHmrClient({ globals, webSocket: FakeWebSocket });
  client.enable();

  expect(instances).toHaveLength(1);
  expect(instances[0]?.url).toBe("ws://localhost:8081/hot");
  expect(client.isEnabled()).toBe(true);

  instances[0]?.onmessage?.({
    data: updateMessage([
      [3, '__d(function () {}, 3, [], undefined, { "3": [] });', "http://x/m3.js"],
    ]),
  });

  expect(evalCalls).toHaveLength(1);
  expect(evalCalls[0]?.code).toContain("__d(function () {}, 3");
  expect(evalCalls[0]?.url).toBe("http://x/m3.js");
});

test("hmr client triggers a full reload when a module is deleted", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const reloadReasons: string[] = [];
  const globals: Record<string, unknown> = {
    __VIFX_HMR_URL: "ws://localhost:8081/hot",
    __vifxFullReload: (reason: string) => {
      reloadReasons.push(reason);
    },
    globalEvalWithSourceUrl: () => {},
  };

  const client = loadHmrClient({ globals, webSocket: FakeWebSocket });
  client.enable();
  instances[0]?.onmessage?.({
    data: JSON.stringify({
      body: { added: [], deleted: [5], isInitialUpdate: false, modified: [], revisionId: "r" },
      type: "update",
    }),
  });

  expect(reloadReasons).toEqual(["Module deleted"]);
});

const COMPILE_ERROR_MESSAGE =
  "SyntaxError: /app/App.tsx: Unexpected token (2:17)\n\n  1 | const a = 1;\n> 2 | const broken = ;\n    |                 ^";

test("hmr client raises a compile error LogBox can parse, and clears it once fixed", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const timers: Array<() => void> = [];
  const cleared: string[] = [];
  const globals: Record<string, unknown> = {
    __VIFX_HMR_URL: "ws://localhost:8081/hot",
    __vifxDevRuntime: { applyPatch: () => true, clientId: "app-1", lastRerunIds: ["App.tsx"] },
    globalEvalWithSourceUrl: () => {},
  };

  const client = loadHmrClient({
    globals,
    loadLogBox: () => ({ default: { clearAllLogs: () => cleared.push("cleared") } }),
    timers,
    webSocket: FakeWebSocket,
  });
  client.enable();
  open(instances[0]);
  instances[0]?.onmessage?.({
    data: JSON.stringify({
      body: { errors: [], message: COMPILE_ERROR_MESSAGE, type: "TransformError" },
      type: "error",
    }),
  });

  // Thrown from a timer, i.e. uncaught: that is what puts React Native's
  // syntax-error screen up. The message is the one Metro sends.
  expect(timers).toHaveLength(1);
  let thrown: (Error & { preventSymbolication?: boolean }) | null = null;
  try {
    timers[0]?.();
  } catch (error) {
    thrown = error as Error & { preventSymbolication?: boolean };
  }
  expect(thrown?.message).toBe(`TransformError ${COMPILE_ERROR_MESSAGE}`);
  expect(thrown?.preventSymbolication).toBe(true);
  expect(client.hasError()).toBe(true);
  expect(cleared).toEqual([]);

  // The save that fixes it arrives as a patch.
  instances[0]?.onmessage?.({
    data: JSON.stringify({
      body: { changedIds: ["App.tsx"], code: "", filename: "patch-1.js", seq: 1 },
      type: "vifx:patch",
    }),
  });
  expect(cleared).toEqual(["cleared"]);
  expect(client.hasError()).toBe(false);
  expect(sentMessages(instances[0]).at(-1)).toEqual({
    filename: "patch-1.js",
    rerun: 1,
    type: "vifx:delivered",
  });
});

test("hmr client forwards console output, keeping what was logged before the socket opened", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const client = loadHmrClient({
    globals: { __VIFX_HMR_URL: "ws://localhost:8081/hot", globalEvalWithSourceUrl: () => {} },
    webSocket: FakeWebSocket,
  });
  client.enable();

  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;
  client.log("log", ["early", { feed: "top", list: [1, 2] }]);
  client.log("warn", [circular, null, undefined, () => 1]);
  expect(instances[0]?.sent).toEqual([]);

  open(instances[0]);
  client.log("error", ["late"]);

  expect(sentMessages(instances[0])).toEqual([
    { data: ["early", '{feed: "top", list: [1, 2]}'], level: "log", type: "log" },
    {
      data: ['{name: "loop", self: [Circular]}', "null", "undefined", "[Function anonymous]"],
      level: "warn",
      type: "log",
    },
    { data: ["late"], level: "error", type: "log" },
  ]);
});

test("hmr client reconnects, says which bundle it runs, and reloads when told it is stale", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const timers: Array<() => void> = [];
  const reloads: string[] = [];
  const globals: Record<string, unknown> = {
    __VIFX_HMR_STATE: { seq: 4, session: "server-a" },
    __VIFX_HMR_URL: "ws://localhost:8081/hot",
    __vifxDevRuntime: {
      applyPatch: () => true,
      clientId: "app-1",
      fullRefresh: (reason: string) => reloads.push(reason),
      lastRerunIds: [],
    },
    globalEvalWithSourceUrl: () => {},
  };

  const client = loadHmrClient({ globals, timers, webSocket: FakeWebSocket });
  client.enable();
  open(instances[0]);
  expect(sentMessages(instances[0])).toEqual([
    { clientId: "app-1", seq: 4, session: "server-a", type: "vifx:hello" },
  ]);

  // A patch moves the app one save forward.
  instances[0]?.onmessage?.({
    data: JSON.stringify({
      body: { changedIds: [], code: "", filename: "patch-5.js", seq: 5 },
      type: "vifx:patch",
    }),
  });

  // The server goes away: the client tries again on its own...
  instances[0]?.onclose?.();
  expect(timers).toHaveLength(1);
  timers[0]?.();
  expect(instances).toHaveLength(2);
  open(instances[1]);
  // ...and reports the save it is at, patches included.
  expect(sentMessages(instances[1])).toEqual([
    { clientId: "app-1", seq: 5, session: "server-a", type: "vifx:hello" },
  ]);

  instances[1]?.onmessage?.({
    data: JSON.stringify({ body: { reason: "The dev server restarted" }, type: "vifx:reload" }),
  });
  expect(reloads).toEqual(["The dev server restarted"]);
});

test("hmr client does not reconnect outside the dev engine", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const timers: Array<() => void> = [];
  const client = loadHmrClient({
    globals: { __VIFX_HMR_URL: "ws://localhost:8081/hot", globalEvalWithSourceUrl: () => {} },
    timers,
    webSocket: FakeWebSocket,
  });
  client.enable();
  open(instances[0]);

  // Registry-format Fast Refresh: a client that missed deltas cannot catch up.
  instances[0]?.onclose?.();
  expect(timers).toHaveLength(0);
});

test("hmr client stays inert without an injected socket url", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const client = loadHmrClient({
    globals: { globalEvalWithSourceUrl: () => {} },
    webSocket: FakeWebSocket,
  });

  client.enable();
  expect(instances).toHaveLength(0);
});

test("hmr client closes the socket on disable", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const client = loadHmrClient({
    globals: { __VIFX_HMR_URL: "ws://localhost:8081/hot", globalEvalWithSourceUrl: () => {} },
    webSocket: FakeWebSocket,
  });

  client.enable();
  expect(instances[0]?.closed).toBe(false);
  client.disable();
  expect(instances[0]?.closed).toBe(true);
  expect(client.isEnabled()).toBe(false);
});
