import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { isVifxError } from "@vifx/errors";
import { isSourceCompileError, summarizeBuildError } from "./build-error.ts";

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
  /** Emits a Metro `update` delta ({@link VifxHotUpdate}) over `/hot`. */
  broadcastUpdate: (update: VifxHotUpdate) => void;
  broadcastUpdateDone: () => void;
  broadcastUpdateStart: (options?: { isInitialUpdate?: boolean }) => void;
  clientCount: () => number;
  close: () => Promise<void>;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  /** Whether this app's socket is still open. */
  isConnected: (client: VifxHotClient) => boolean;
  /** Sends one message to a single connected app (see {@link VifxHotChannelOptions}). */
  sendTo: (client: VifxHotClient, message: { body?: unknown; type: string }) => void;
}

/** Opaque handle of one connected app. */
export type VifxHotClient = object;

/**
 * Per-app hooks. Metro's protocol is broadcast-only; the dev engine also needs
 * to hear from each app (which modules it holds) and to address it alone.
 */
export interface VifxHotChannelOptions {
  onDisconnect?: (client: VifxHotClient) => void;
  /** A JSON message sent by an app. Anything that is not JSON is dropped. */
  onMessage?: (client: VifxHotClient, message: unknown) => void;
}

/**
 * Formats an arbitrary build failure as a Metro HMR `error` body, matching the
 * `FormattedError` shape produced by Metro's `formatBundlingError`.
 */
export function createHotErrorPayload(error: unknown): VifxHotErrorPayload {
  // A compile error of the user's source, in the shape Metro sends it: the app
  // (LogBox) parses "TransformError SyntaxError: <file>: <message> (l:c)" and
  // its code frame into the syntax-error screen.
  const summary = summarizeBuildError(error);
  if (isSourceCompileError(summary)) {
    return {
      errors: [{ description: summary.split("\n", 1)[0] ?? summary }],
      message: summary,
      type: "TransformError",
    };
  }

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
export function createHotChannel(options: VifxHotChannelOptions = {}): VifxHotChannel {
  const websocketServer = new WebSocketServer({ clientTracking: false, noServer: true });
  const clients = new Set<WebSocket>();
  let closed = false;

  websocketServer.on("connection", (socket: WebSocket) => {
    clients.add(socket);

    const removeClient = () => {
      if (clients.delete(socket)) {
        options.onDisconnect?.(socket);
      }
    };
    socket.once("close", removeClient);
    socket.on("error", removeClient);
    socket.on("message", (data) => {
      if (!options.onMessage) {
        return;
      }
      let message: unknown;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(new Uint8Array(data));
        message = JSON.parse(bytes.toString("utf8"));
      } catch {
        return;
      }
      options.onMessage(socket, message);
    });
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
    broadcastUpdate(update) {
      broadcast({ body: update, type: "update" });
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
    isConnected(client) {
      const socket = client as WebSocket;
      return clients.has(socket) && socket.readyState === socket.OPEN;
    },
    sendTo(client, message) {
      const socket = client as WebSocket;
      if (clients.has(socket) && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
  };
}
