import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { VifxJsonObject, VifxJsonValue } from "@vifx/types";

const EXPO_DEV_SERVER_MESSAGE_PROTOCOL_VERSION = 2;

interface ExpoGoSocketClient {
  id: string;
  query: string;
  socket: WebSocket;
}

export interface ExpoGoMessageChannel {
  broadcast: (method: string, params?: VifxJsonValue) => void;
  closeAll: () => void;
  eventClientCount: () => number;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  messageClientCount: () => number;
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function serializeExpoGoSocketMessage(message: VifxJsonObject) {
  return JSON.stringify({
    ...message,
    version: EXPO_DEV_SERVER_MESSAGE_PROTOCOL_VERSION,
  });
}

function parseExpoGoSocketMessage(data: string) {
  try {
    const parsed = JSON.parse(data) as VifxJsonValue;
    if (!isJsonObject(parsed)) {
      return null;
    }

    const { version, ...message } = parsed;
    return version === EXPO_DEV_SERVER_MESSAGE_PROTOCOL_VERSION ? message : null;
  } catch {
    return null;
  }
}

function messageHasRequestTarget(message: VifxJsonObject): message is VifxJsonObject & {
  id?: VifxJsonValue;
  method: string;
  target: string;
} {
  return typeof message.method === "string" && typeof message.target === "string";
}

function messageIsBroadcast(message: VifxJsonObject) {
  return (
    typeof message.method === "string" &&
    message.id === undefined &&
    (message.target === undefined || message.target === null)
  );
}

function messageIsResponse(message: VifxJsonObject): message is VifxJsonObject & {
  id: VifxJsonObject & { clientId: string; requestId: VifxJsonValue };
} {
  return (
    isJsonObject(message.id) &&
    typeof message.id.clientId === "string" &&
    message.id.requestId !== undefined &&
    (message.result !== undefined || message.error !== undefined)
  );
}

function rawDataToString(data: RawData) {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}

/**
 * Implements the Expo dev-server message protocol (version 2) on top of the
 * `ws` library. Frame parsing, masking, fragmentation, ping/pong, and large
 * payload handling are delegated to `ws`; this module owns only the protocol
 * routing:
 *
 * - `/message` clients form a peer mesh. Requests targeting "server" are
 *   answered by RPC (`getid`, `getpeers`); requests targeting another peer are
 *   routed to that peer with the sender's client id wrapped into the request
 *   id, and responses are routed back. Broadcasts (no id, no target) fan out to
 *   every other message client.
 * - `/events` clients issue `command` payloads that are broadcast to all
 *   message clients as method invocations.
 */
export function createExpoGoMessageChannel(): ExpoGoMessageChannel {
  let nextClientId = 1;
  const messageClients = new Map<string, ExpoGoSocketClient>();
  const eventClients = new Map<string, ExpoGoSocketClient>();
  const webSocketServer = new WebSocketServer({ noServer: true });

  const sendToClient = (client: ExpoGoSocketClient | undefined, message: VifxJsonObject) => {
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    client.socket.send(serializeExpoGoSocketMessage(message));
  };

  const broadcastToMessageClients = (
    senderClientId: string | null,
    message: VifxJsonObject | string,
  ) => {
    const serializedMessage =
      typeof message === "string" ? message : serializeExpoGoSocketMessage(message);

    for (const [clientId, client] of messageClients) {
      if (clientId === senderClientId || client.socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      client.socket.send(serializedMessage);
    }
  };

  const handleServerRequest = (client: ExpoGoSocketClient, message: VifxJsonObject) => {
    if (message.id === undefined) {
      return;
    }

    if (message.method === "getid") {
      sendToClient(client, {
        id: message.id,
        result: client.id,
      });
      return;
    }

    if (message.method === "getpeers") {
      const peers: VifxJsonObject = {};
      for (const [peerClientId, peerClient] of messageClients) {
        if (peerClientId !== client.id) {
          peers[peerClientId] = peerClient.query;
        }
      }

      sendToClient(client, {
        id: message.id,
        result: peers,
      });
    }
  };

  const handleMessageClientPayload = (client: ExpoGoSocketClient, data: string) => {
    const message = parseExpoGoSocketMessage(data);
    if (!message) {
      return;
    }

    if (messageIsBroadcast(message)) {
      broadcastToMessageClients(null, data);
      return;
    }

    if (messageHasRequestTarget(message)) {
      if (message.target === "server") {
        handleServerRequest(client, message);
        return;
      }

      sendToClient(messageClients.get(message.target), {
        method: message.method,
        ...(message.id === undefined
          ? {}
          : {
              id: {
                clientId: client.id,
                requestId: message.id,
              },
            }),
        ...(message.params === undefined ? {} : { params: message.params }),
      });
      return;
    }

    if (messageIsResponse(message)) {
      sendToClient(messageClients.get(message.id.clientId), {
        id: message.id.requestId,
        ...(message.error === undefined ? {} : { error: message.error }),
        ...(message.result === undefined ? {} : { result: message.result }),
      });
    }
  };

  const handleEventsClientPayload = (data: string) => {
    const message = parseExpoGoSocketMessage(data);
    if (!message || message.type !== "command" || typeof message.command !== "string") {
      return;
    }

    broadcastToMessageClients(null, {
      method: message.command,
      ...(message.params === undefined ? {} : { params: message.params }),
    });
  };

  const registerClient = (
    endpoint: "events" | "message",
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const client: ExpoGoSocketClient = {
        id: `vifx-${String(nextClientId)}`,
        query: new URL(request.url ?? "/", "http://vifx.local").searchParams.toString(),
        socket: webSocket,
      };
      nextClientId += 1;

      const clients = endpoint === "message" ? messageClients : eventClients;
      clients.set(client.id, client);

      webSocket.on("close", () => clients.delete(client.id));
      webSocket.on("error", () => webSocket.terminate());
      webSocket.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          return;
        }

        const payload = rawDataToString(data);
        if (endpoint === "message") {
          handleMessageClientPayload(client, payload);
        } else {
          handleEventsClientPayload(payload);
        }
      });
    });
  };

  return {
    broadcast(method: string, params?: VifxJsonValue) {
      broadcastToMessageClients(null, {
        method,
        ...(params === undefined ? {} : { params }),
      });
    },
    closeAll() {
      for (const client of [...messageClients.values(), ...eventClients.values()]) {
        client.socket.close();
      }
    },
    eventClientCount() {
      return eventClients.size;
    },
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      if (requestUrl.pathname === "/message") {
        registerClient("message", request, socket, head);
        return true;
      }

      if (requestUrl.pathname === "/events") {
        registerClient("events", request, socket, head);
        return true;
      }

      return false;
    },
    messageClientCount() {
      return messageClients.size;
    },
  };
}
