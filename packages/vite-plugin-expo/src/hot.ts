import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { isVifxError } from "@vifx/errors";

const HOT_SOCKET_PATHNAME = "/hot";
const HOT_SOCKET_CLOSE_GOING_AWAY = 1001;

/**
 * Metro HMR protocol messages, mirrored verbatim from
 * `metro-runtime/src/modules/types.flow.js` so React Native's built-in
 * `HMRClient` can parse them without translation.
 *
 * This channel only ever emits `update-start`, `update-done`, and `error`
 * around full rebuilds. The `update` message (granular module deltas) is part
 * of the protocol envelope but is reserved for the dev serializer follow-up;
 * nothing in this module produces it.
 */
export interface VifxHotModule {
  module: [number, string];
  sourceMappingURL: string | null;
  sourceURL: string | null;
}

export interface VifxHotUpdate {
  added: VifxHotModule[];
  deleted: number[];
  isInitialUpdate: boolean;
  modified: VifxHotModule[];
  revisionId: string;
}

export interface VifxHotErrorDescription {
  description: string;
  filename?: string;
  lineNumber?: number;
}

export interface VifxHotErrorPayload {
  errors: VifxHotErrorDescription[];
  message: string;
  type: string;
}

export type VifxHotMessage =
  | { body: { isInitialUpdate: boolean }; type: "update-start" }
  | { body: VifxHotErrorPayload; type: "error" }
  | { body: VifxHotUpdate; type: "update" }
  | { type: "update-done" };

export interface VifxHotChannel {
  broadcastError: (payload: VifxHotErrorPayload) => void;
  broadcastUpdateDone: () => void;
  broadcastUpdateStart: (options?: { isInitialUpdate?: boolean }) => void;
  clientCount: () => number;
  close: () => Promise<void>;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

/**
 * Formats an arbitrary build failure as a Metro HMR `error` body, matching the
 * `FormattedError` shape produced by Metro's `formatBundlingError`.
 */
export function createHotErrorPayload(error: unknown): VifxHotErrorPayload {
  if (isVifxError(error)) {
    return {
      errors: [{ description: error.message }],
      message: error.stack ?? error.message,
      type: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      errors: [{ description: error.message }],
      message: error.stack ?? error.message,
      type: error.name === "Error" ? "InternalError" : error.name,
    };
  }

  const message = String(error);
  return {
    errors: [{ description: message }],
    message,
    type: "InternalError",
  };
}

/**
 * Creates the `/hot` WebSocket channel for the Expo Go dev server. The channel
 * runs in `noServer` mode: the owning HTTP server forwards `upgrade` events to
 * {@link VifxHotChannel.handleUpgrade}, which claims `/hot` connections and
 * leaves every other pathname untouched.
 */
export function createHotChannel(): VifxHotChannel {
  const websocketServer = new WebSocketServer({ clientTracking: false, noServer: true });
  const clients = new Set<WebSocket>();
  let closed = false;

  websocketServer.on("connection", (socket: WebSocket) => {
    clients.add(socket);

    const removeClient = () => {
      clients.delete(socket);
    };
    socket.once("close", removeClient);
    socket.on("error", removeClient);
  });

  const broadcast = (message: VifxHotMessage) => {
    const serialized = JSON.stringify(message);

    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) {
        socket.send(serialized);
      }
    }
  };

  return {
    broadcastError(payload) {
      broadcast({ body: payload, type: "error" });
    },
    broadcastUpdateDone() {
      broadcast({ type: "update-done" });
    },
    broadcastUpdateStart(options) {
      broadcast({
        body: { isInitialUpdate: options?.isInitialUpdate ?? false },
        type: "update-start",
      });
    },
    clientCount() {
      return clients.size;
    },
    close() {
      if (closed) {
        return Promise.resolve();
      }

      closed = true;
      for (const socket of clients) {
        socket.close(HOT_SOCKET_CLOSE_GOING_AWAY, "Vifx dev server is shutting down.");
      }
      clients.clear();

      return new Promise<void>((resolve, reject) => {
        websocketServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
    handleUpgrade(request, socket, head) {
      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      if (requestUrl.pathname !== HOT_SOCKET_PATHNAME) {
        return false;
      }

      if (closed) {
        socket.destroy();
        return true;
      }

      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request);
      });
      return true;
    },
  };
}
