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
  url: string;
}

function createFakeWebSocket() {
  const instances: FakeSocket[] = [];
  class FakeWebSocket {
    closed = false;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    url: string;
    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as FakeSocket);
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeWebSocket, instances };
}

interface HmrClient {
  disable: () => void;
  enable: () => void;
  hasError: () => boolean;
  isEnabled: () => boolean;
  setup: () => void;
}

function loadHmrClient(options: {
  console?: { error: (message: string) => void };
  globals: Record<string, unknown>;
  webSocket: unknown;
}): HmrClient {
  const body = VIFX_HMR_CLIENT_SOURCE.replace("export default HMRClient;", "return HMRClient;");
  // Self-connect (setTimeout) is suppressed with a no-op so each test drives the
  // lifecycle explicitly through enable()/setup(). `new Function` is the point:
  // it evaluates the injected client source exactly as the device runtime would.
  // eslint-disable-next-line no-implied-eval
  const factory = new Function("globalThis", "WebSocket", "console", "setTimeout", body);
  return factory(
    options.globals,
    options.webSocket,
    options.console ?? console,
    () => 0,
  ) as HmrClient;
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

test("hmr client surfaces bundling errors", () => {
  const { FakeWebSocket, instances } = createFakeWebSocket();
  const errors: string[] = [];
  const globals: Record<string, unknown> = {
    __VIFX_HMR_URL: "ws://localhost:8081/hot",
    globalEvalWithSourceUrl: () => {},
  };

  const client = loadHmrClient({
    console: { error: (message) => errors.push(message) },
    globals,
    webSocket: FakeWebSocket,
  });
  client.enable();
  instances[0]?.onmessage?.({
    data: JSON.stringify({
      body: { errors: [], message: "Unexpected token", type: "SyntaxError" },
      type: "error",
    }),
  });

  expect(errors).toEqual(["[Vifx HMR] Unexpected token"]);
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
