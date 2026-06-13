import { createServer, type Server as HttpServer } from "node:http";
import { VifxError } from "@vifx/errors";
import { expect, test } from "vite-plus/test";
import type { VifxHotChannel } from "../src/hot.ts";
import { createHotChannel, createHotErrorPayload } from "../src/hot.ts";

interface TestWebSocket {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: { code?: number; data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  close: () => void;
  readyState: number;
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

interface HotChannelHarness {
  channel: VifxHotChannel;
  close: () => Promise<void>;
  url: string;
}

async function startHotChannelServer(): Promise<HotChannelHarness> {
  const channel = createHotChannel();
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (!channel.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    channel,
    close: async () => {
      await channel.close();
      await closeHttpServer(server);
    },
    url: `ws://127.0.0.1:${String(port)}`,
  };
}

function closeHttpServer(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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

function collectMessages(socket: TestWebSocket) {
  const messages: unknown[] = [];

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      messages.push(JSON.parse(event.data));
    }
  });

  return messages;
}

function waitForClose(socket: TestWebSocket) {
  return new Promise<number | undefined>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out while waiting for a hot-channel condition.");
    }

    await sleep(10);
  }
}

NETWORK_SERVER_TESTS(
  "createHotChannel speaks the Metro HMR envelope around full rebuilds",
  async () => {
    const harness = await startHotChannelServer();

    try {
      const socket = await openWebSocket(`${harness.url}/hot`);
      const messages = collectMessages(socket);

      try {
        await waitFor(() => harness.channel.clientCount() === 1);

        harness.channel.broadcastUpdateStart();
        harness.channel.broadcastUpdateDone();
        harness.channel.broadcastUpdateStart({ isInitialUpdate: true });
        harness.channel.broadcastError({
          errors: [{ description: "Unexpected token" }],
          message: "SyntaxError: Unexpected token",
          type: "SyntaxError",
        });
        await waitFor(() => messages.length === 4);

        expect(messages[0]).toEqual({
          body: { isInitialUpdate: false },
          type: "update-start",
        });
        expect(messages[1]).toEqual({ type: "update-done" });
        expect(messages[2]).toEqual({
          body: { isInitialUpdate: true },
          type: "update-start",
        });
        expect(messages[3]).toEqual({
          body: {
            errors: [{ description: "Unexpected token" }],
            message: "SyntaxError: Unexpected token",
            type: "SyntaxError",
          },
          type: "error",
        });
        // These full-rebuild notifications never carry granular deltas;
        // broadcastUpdate (exercised below) is the only producer of "update".
        expect(
          messages.every(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as { type?: unknown }).type !== "update",
          ),
        ).toBe(true);
      } finally {
        socket.close();
      }
    } finally {
      await harness.close();
    }
  },
);

NETWORK_SERVER_TESTS(
  "createHotChannel broadcasts a granular Fast Refresh update delta",
  async () => {
    const harness = await startHotChannelServer();

    try {
      const socket = await openWebSocket(`${harness.url}/hot`);
      const messages = collectMessages(socket);

      try {
        await waitFor(() => harness.channel.clientCount() === 1);

        const update = {
          added: [],
          deleted: [],
          isInitialUpdate: false,
          modified: [
            {
              module: [3, "__d(function () {}, 3, [], undefined, {});"] as [number, string],
              sourceMappingURL: null,
              sourceURL: "http://host/m3.js",
            },
          ],
          revisionId: "1",
        };
        harness.channel.broadcastUpdate(update);
        await waitFor(() => messages.length === 1);

        // The client consumes message.type === "update" and message.body.modified.
        expect(messages[0]).toEqual({ body: update, type: "update" });
      } finally {
        socket.close();
      }
    } finally {
      await harness.close();
    }
  },
);

NETWORK_SERVER_TESTS("createHotChannel broadcasts to every connected client", async () => {
  const harness = await startHotChannelServer();

  try {
    const firstSocket = await openWebSocket(`${harness.url}/hot`);
    const secondSocket = await openWebSocket(`${harness.url}/hot`);
    const firstMessages = collectMessages(firstSocket);
    const secondMessages = collectMessages(secondSocket);

    try {
      await waitFor(() => harness.channel.clientCount() === 2);

      harness.channel.broadcastUpdateStart();
      harness.channel.broadcastUpdateDone();
      await waitFor(() => firstMessages.length === 2 && secondMessages.length === 2);

      expect(firstMessages).toEqual(secondMessages);

      firstSocket.close();
      await waitFor(() => harness.channel.clientCount() === 1);

      harness.channel.broadcastUpdateDone();
      await waitFor(() => secondMessages.length === 3);

      expect(firstMessages).toHaveLength(2);
    } finally {
      firstSocket.close();
      secondSocket.close();
    }
  } finally {
    await harness.close();
  }
});

NETWORK_SERVER_TESTS("createHotChannel only claims /hot upgrade requests", async () => {
  const harness = await startHotChannelServer();

  try {
    const hotSocket = await openWebSocket(`${harness.url}/hot`);

    try {
      await expect(openWebSocket(`${harness.url}/message`)).rejects.toThrow(/WebSocket failed/u);
      await waitFor(() => harness.channel.clientCount() === 1);
      expect(harness.channel.clientCount()).toBe(1);
    } finally {
      hotSocket.close();
    }
  } finally {
    await harness.close();
  }
});

NETWORK_SERVER_TESTS(
  "createHotChannel close disconnects clients and refuses new connections",
  async () => {
    const harness = await startHotChannelServer();
    const channel = harness.channel;

    try {
      const socket = await openWebSocket(`${harness.url}/hot`);
      const closeCodePromise = waitForClose(socket);
      await waitFor(() => channel.clientCount() === 1);

      await channel.close();
      // Closing twice stays settled instead of throwing.
      await channel.close();

      const closeCode = await closeCodePromise;
      expect(closeCode).toBe(1001);
      expect(channel.clientCount()).toBe(0);

      await expect(openWebSocket(`${harness.url}/hot`)).rejects.toThrow(/WebSocket failed/u);
    } finally {
      await harness.close();
    }
  },
);

test("createHotErrorPayload mirrors Metro's FormattedError shape", () => {
  const vifxError = new VifxError({
    code: "VIFX_VITE_BUNDLE_MISSING",
    message: "The Expo bundle could not be rebuilt.",
  });
  const vifxPayload = createHotErrorPayload(vifxError);
  expect(vifxPayload.type).toBe("VIFX_VITE_BUNDLE_MISSING");
  expect(vifxPayload.errors).toEqual([{ description: "The Expo bundle could not be rebuilt." }]);
  expect(vifxPayload.message).toContain("The Expo bundle could not be rebuilt.");

  const namedError = new TypeError("value is not a function");
  const namedPayload = createHotErrorPayload(namedError);
  expect(namedPayload.type).toBe("TypeError");
  expect(namedPayload.errors).toEqual([{ description: "value is not a function" }]);

  const plainError = new Error("plain failure");
  const plainPayload = createHotErrorPayload(plainError);
  expect(plainPayload.type).toBe("InternalError");
  expect(plainPayload.errors).toEqual([{ description: "plain failure" }]);

  const unknownPayload = createHotErrorPayload("string failure");
  expect(unknownPayload).toEqual({
    errors: [{ description: "string failure" }],
    message: "string failure",
    type: "InternalError",
  });
});
