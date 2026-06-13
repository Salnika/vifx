import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "vite-plus/test";
import { createExpoGoMessageChannel, type ExpoGoMessageChannel } from "../src/websocket.ts";

interface TestWebSocket {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  close: () => void;
  send: (data: string) => void;
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

interface ChannelHarness {
  channel: ExpoGoMessageChannel;
  close: () => Promise<void>;
  eventsUrl: string;
  messageUrl: string;
}

async function startChannelHarness(): Promise<ChannelHarness> {
  const channel = createExpoGoMessageChannel();
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (!channel.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `ws://127.0.0.1:${String(port)}`;

  return {
    channel,
    close: () =>
      new Promise((resolve, reject) => {
        channel.closeAll();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    eventsUrl: `${baseUrl}/events`,
    messageUrl: `${baseUrl}/message`,
  };
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

function waitForWebSocketClose(socket: TestWebSocket) {
  return new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
  });
}

async function getClientId(socket: TestWebSocket, requestId: string) {
  const pending = waitForWebSocketMessage(socket);
  socket.send(
    JSON.stringify({
      id: requestId,
      method: "getid",
      target: "server",
      version: 2,
    }),
  );
  const reply = JSON.parse(await pending) as { id: string; result: string; version: number };
  return reply.result;
}

const NETWORK_SOCKET_TESTS = (await canListenOnLocalhost()) ? test : test.skip;

NETWORK_SOCKET_TESTS("getid returns a vifx-prefixed client id at protocol version 2", async () => {
  const harness = await startChannelHarness();
  const socket = await openWebSocket(harness.messageUrl);

  try {
    const pending = waitForWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        id: "identity",
        method: "getid",
        target: "server",
        version: 2,
      }),
    );
    const reply = JSON.parse(await pending) as { id: string; result: string; version: number };

    expect(reply.id).toBe("identity");
    expect(reply.version).toBe(2);
    expect(reply.result).toMatch(/^vifx-/u);
    expect(harness.channel.messageClientCount()).toBe(1);
    expect(harness.channel.eventClientCount()).toBe(0);
  } finally {
    socket.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS("getpeers lists other message clients with their query strings", async () => {
  const harness = await startChannelHarness();
  const first = await openWebSocket(`${harness.messageUrl}?role=first`);
  const second = await openWebSocket(`${harness.messageUrl}?role=second`);

  try {
    const secondId = await getClientId(second, "second-id");

    const pending = waitForWebSocketMessage(first);
    first.send(
      JSON.stringify({
        id: "peers",
        method: "getpeers",
        target: "server",
        version: 2,
      }),
    );
    const reply = JSON.parse(await pending) as {
      id: string;
      result: Record<string, string>;
      version: number;
    };

    expect(reply.id).toBe("peers");
    expect(reply.version).toBe(2);
    expect(Object.keys(reply.result)).toEqual([secondId]);
    expect(reply.result[secondId]).toBe("role=second");
  } finally {
    first.close();
    second.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS("routes a request to a peer and the response back to the sender", async () => {
  const harness = await startChannelHarness();
  const caller = await openWebSocket(harness.messageUrl);
  const peer = await openWebSocket(harness.messageUrl);

  try {
    const callerId = await getClientId(caller, "caller-id");
    const peerId = await getClientId(peer, "peer-id");

    const peerRequestPromise = waitForWebSocketMessage(peer);
    const callerResponsePromise = waitForWebSocketMessage(caller);

    caller.send(
      JSON.stringify({
        id: "rpc-1",
        method: "ping",
        params: { value: 7 },
        target: peerId,
        version: 2,
      }),
    );

    const forwarded = JSON.parse(await peerRequestPromise) as {
      id: { clientId: string; requestId: string };
      method: string;
      params: { value: number };
      version: number;
    };

    expect(forwarded.method).toBe("ping");
    expect(forwarded.params.value).toBe(7);
    expect(forwarded.id.clientId).toBe(callerId);
    expect(forwarded.id.requestId).toBe("rpc-1");
    expect(forwarded.version).toBe(2);

    peer.send(
      JSON.stringify({
        id: forwarded.id,
        result: { pong: true },
        version: 2,
      }),
    );

    const response = JSON.parse(await callerResponsePromise) as {
      id: string;
      result: { pong: boolean };
      version: number;
    };

    expect(response.id).toBe("rpc-1");
    expect(response.result.pong).toBe(true);
    expect(response.version).toBe(2);
  } finally {
    caller.close();
    peer.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS(
  "an /events command is broadcast to message clients as a method call",
  async () => {
    const harness = await startChannelHarness();
    const messageSocket = await openWebSocket(harness.messageUrl);
    const eventsSocket = await openWebSocket(harness.eventsUrl);

    try {
      const broadcastPromise = waitForWebSocketMessage(messageSocket);
      eventsSocket.send(
        JSON.stringify({
          command: "reload",
          params: { reason: "events-test" },
          type: "command",
          version: 2,
        }),
      );
      const broadcast = JSON.parse(await broadcastPromise) as {
        method: string;
        params: { reason: string };
        version: number;
      };

      expect(broadcast.method).toBe("reload");
      expect(broadcast.params.reason).toBe("events-test");
      expect(broadcast.version).toBe(2);
      expect(harness.channel.eventClientCount()).toBe(1);
    } finally {
      messageSocket.close();
      eventsSocket.close();
      await harness.close();
    }
  },
);

NETWORK_SOCKET_TESTS("broadcast() fans out to every message client", async () => {
  const harness = await startChannelHarness();
  const first = await openWebSocket(harness.messageUrl);
  const second = await openWebSocket(harness.messageUrl);

  try {
    const firstPromise = waitForWebSocketMessage(first);
    const secondPromise = waitForWebSocketMessage(second);

    harness.channel.broadcast("devMenu", { source: "server" });

    const firstMessage = JSON.parse(await firstPromise) as {
      method: string;
      params: { source: string };
    };
    const secondMessage = JSON.parse(await secondPromise) as {
      method: string;
      params: { source: string };
    };

    expect(firstMessage.method).toBe("devMenu");
    expect(firstMessage.params.source).toBe("server");
    expect(secondMessage.method).toBe("devMenu");
    expect(secondMessage.params.source).toBe("server");
  } finally {
    first.close();
    second.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS("round-trips a broadcast payload larger than 128KB", async () => {
  const harness = await startChannelHarness();
  const sender = await openWebSocket(harness.messageUrl);
  const receiver = await openWebSocket(harness.messageUrl);

  try {
    const value = "x".repeat(200 * 1024);
    const broadcastPromise = waitForWebSocketMessage(receiver);

    sender.send(
      JSON.stringify({
        method: "largePayload",
        params: { value },
        version: 2,
      }),
    );

    const received = JSON.parse(await broadcastPromise) as {
      method: string;
      params: { value: string };
      version: number;
    };

    expect(received.method).toBe("largePayload");
    expect(received.params.value.length).toBe(value.length);
    expect(received.params.value).toBe(value);
    expect(received.version).toBe(2);
  } finally {
    sender.close();
    receiver.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS("removes a client from the registry when it disconnects", async () => {
  const harness = await startChannelHarness();
  const first = await openWebSocket(harness.messageUrl);
  const second = await openWebSocket(harness.messageUrl);

  try {
    await getClientId(first, "first-id");
    await getClientId(second, "second-id");
    expect(harness.channel.messageClientCount()).toBe(2);

    const closed = waitForWebSocketClose(second);
    second.close();
    await closed;

    await expect.poll(() => harness.channel.messageClientCount(), { timeout: 2000 }).toBe(1);
  } finally {
    first.close();
    await harness.close();
  }
});

NETWORK_SOCKET_TESTS("closeAll disconnects every connected client", async () => {
  const harness = await startChannelHarness();
  const messageSocket = await openWebSocket(harness.messageUrl);
  const eventsSocket = await openWebSocket(harness.eventsUrl);

  await getClientId(messageSocket, "message-id");
  expect(harness.channel.messageClientCount()).toBe(1);
  expect(harness.channel.eventClientCount()).toBe(1);

  const messageClosed = waitForWebSocketClose(messageSocket);
  const eventsClosed = waitForWebSocketClose(eventsSocket);

  harness.channel.closeAll();

  await messageClosed;
  await eventsClosed;

  await expect.poll(() => harness.channel.messageClientCount(), { timeout: 2000 }).toBe(0);
  await expect.poll(() => harness.channel.eventClientCount(), { timeout: 2000 }).toBe(0);

  await harness.close();
});
