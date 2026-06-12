import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { symbolicateStackFrame } from "@vifx/source-map-tools";
import type { VifxBundlePlatform, VifxJsonObject, VifxJsonValue } from "@vifx/types";
import { WebSocketServer, type WebSocket } from "ws";

const METRO_MESSAGE_PROTOCOL_VERSION = 2;
const METRO_STATUS_BODY = "packager-status:running";

export interface StartMetroDevServerOptions {
  bundleBaseNames: string[];
  bundleSource: string;
  host: string;
  onRequest?: (line: string) => void;
  platform: VifxBundlePlatform;
  port: number;
  projectRoot: string;
  sourceMapPath: string | null;
  sourceMapSource: string | null;
  strictPort: boolean;
}

export interface VifxMetroDevServer {
  broadcast(method: string, params?: VifxJsonValue): void;
  bundleUrl: string;
  close(): Promise<void>;
  host: string;
  messageClientCount(): number;
  messageSocketUrl: string;
  platform: VifxBundlePlatform;
  port: number;
  projectRoot: string;
  server: Server;
  sourceMapUrl: string | null;
  statusUrl: string;
  url: string;
}

interface MetroMessageClient {
  id: string;
  query: string;
  socket: WebSocket;
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeMetroSocketMessage(message: VifxJsonObject) {
  return JSON.stringify({
    ...message,
    version: METRO_MESSAGE_PROTOCOL_VERSION,
  });
}

function parseMetroSocketMessage(data: string) {
  try {
    const parsed = JSON.parse(data) as VifxJsonValue;
    if (!isJsonObject(parsed)) {
      return null;
    }

    const { version, ...message } = parsed;
    return version === METRO_MESSAGE_PROTOCOL_VERSION ? message : null;
  } catch {
    return null;
  }
}

function messageIsBroadcast(message: VifxJsonObject) {
  return (
    typeof message.method === "string" &&
    message.id === undefined &&
    (message.target === undefined || message.target === null)
  );
}

function messageHasRequestTarget(message: VifxJsonObject): message is VifxJsonObject & {
  id?: VifxJsonValue;
  method: string;
  target: string;
} {
  return typeof message.method === "string" && typeof message.target === "string";
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

function createMetroMessageChannel() {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const clients = new Map<string, MetroMessageClient>();
  let nextClientId = 1;

  const sendToClient = (client: MetroMessageClient | undefined, message: VifxJsonObject) => {
    if (!client || client.socket.readyState !== client.socket.OPEN) {
      return;
    }

    client.socket.send(serializeMetroSocketMessage(message));
  };

  const broadcastToClients = (senderClientId: string | null, message: VifxJsonObject | string) => {
    const serializedMessage =
      typeof message === "string" ? message : serializeMetroSocketMessage(message);

    for (const [clientId, client] of clients) {
      if (clientId === senderClientId || client.socket.readyState !== client.socket.OPEN) {
        continue;
      }

      client.socket.send(serializedMessage);
    }
  };

  const handleServerRequest = (client: MetroMessageClient, message: VifxJsonObject) => {
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
      for (const [peerClientId, peerClient] of clients) {
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

  const handleClientPayload = (client: MetroMessageClient, data: string) => {
    const message = parseMetroSocketMessage(data);
    if (!message) {
      return;
    }

    if (messageIsBroadcast(message)) {
      // Metro relays client-originated broadcasts to every peer except the
      // sender; mirror that so clients never receive their own broadcasts.
      broadcastToClients(client.id, data);
      return;
    }

    if (messageHasRequestTarget(message)) {
      if (message.target === "server") {
        handleServerRequest(client, message);
        return;
      }

      sendToClient(clients.get(message.target), {
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
      sendToClient(clients.get(message.id.clientId), {
        id: message.id.requestId,
        ...(message.error === undefined ? {} : { error: message.error }),
        ...(message.result === undefined ? {} : { result: message.result }),
      });
    }
  };

  const registerClient = (socket: WebSocket, request: IncomingMessage) => {
    const client: MetroMessageClient = {
      id: `vifx-${String(nextClientId)}`,
      query: new URL(request.url ?? "/", "http://vifx.local").searchParams.toString(),
      socket,
    };
    nextClientId += 1;
    clients.set(client.id, client);

    socket.on("message", (data: Buffer | Buffer[] | string) => {
      const payload =
        typeof data === "string"
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : data.toString("utf8");
      handleClientPayload(client, payload);
    });
    socket.once("close", () => clients.delete(client.id));
    socket.once("error", () => clients.delete(client.id));
  };

  return {
    broadcast(method: string, params?: VifxJsonValue) {
      broadcastToClients(null, {
        method,
        ...(params === undefined ? {} : { params }),
      });
    },
    clientCount() {
      return clients.size;
    },
    close() {
      for (const client of clients.values()) {
        client.socket.close();
      }
      clients.clear();
      webSocketServer.close();
    },
    handleUpgrade(request: IncomingMessage, socket: NodeJS.ReadableStream, head: Buffer) {
      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      if (requestUrl.pathname !== "/message") {
        return false;
      }

      webSocketServer.handleUpgrade(
        request,
        socket as Parameters<WebSocketServer["handleUpgrade"]>[1],
        head,
        (webSocket) => registerClient(webSocket, request),
      );
      return true;
    },
  };
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function readStackFrameNumber(frame: VifxJsonObject, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = frame[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(Math.trunc(value), 1);
    }
  }

  return fallback;
}

async function symbolicateStack(options: {
  sourceMapPath: string | null;
  stack: VifxJsonValue[];
}): Promise<VifxJsonValue[]> {
  const sourceMapPath = options.sourceMapPath;
  if (!sourceMapPath) {
    return options.stack;
  }

  return await Promise.all(
    options.stack.map(async (frame): Promise<VifxJsonValue> => {
      if (!isJsonObject(frame)) {
        return frame;
      }

      const line = readStackFrameNumber(frame, ["lineNumber", "line"], 1);
      const column = readStackFrameNumber(frame, ["column", "columnNumber"], 1);
      const symbolicated = await symbolicateStackFrame({
        column,
        line,
        sourceMapPath,
      }).catch(() => null);

      if (!symbolicated?.found || !symbolicated.source) {
        return frame;
      }

      return {
        ...frame,
        column: symbolicated.column ?? column,
        columnNumber: symbolicated.column ?? column,
        file: symbolicated.source,
        lineNumber: symbolicated.line ?? line,
        source: symbolicated.source,
      };
    }),
  );
}

function normalizeBundleBaseNames(bundleBaseNames: string[]) {
  const baseNames = new Set<string>(["index"]);
  for (const baseName of bundleBaseNames) {
    const trimmed = baseName.replace(/^\.?\//u, "").trim();
    if (trimmed.length > 0) {
      baseNames.add(trimmed);
    }
  }

  return baseNames;
}

function matchBundleBaseName(pathname: string, baseNames: Set<string>) {
  if (!pathname.endsWith(".bundle")) {
    return null;
  }

  const requestedBaseName = pathname.replace(/^\//u, "").replace(/\.bundle$/u, "");
  return baseNames.has(requestedBaseName) ? requestedBaseName : null;
}

function matchSourceMapBaseName(pathname: string, baseNames: Set<string>) {
  if (!pathname.endsWith(".map")) {
    return null;
  }

  const requestedBaseName = pathname
    .replace(/^\//u, "")
    .replace(/\.map$/u, "")
    .replace(/\.bundle$/u, "");
  return baseNames.has(requestedBaseName) ? requestedBaseName : null;
}

function formatRequestLog(method: string, requestUrl: URL) {
  const parameters = [...requestUrl.searchParams.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  return parameters.length > 0
    ? `${method} ${requestUrl.pathname} (${parameters})`
    : `${method} ${requestUrl.pathname}`;
}

function writeTextResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
  headOnly: boolean,
) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });

  if (headOnly) {
    response.end();
    return;
  }

  response.end(body);
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function listen(server: Server, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function listenWithPortFallback(
  server: Server,
  host: string,
  port: number,
  strictPort: boolean,
) {
  try {
    await listen(server, host, port);
  } catch (error) {
    if (strictPort || port === 0 || !isAddressInUseError(error)) {
      throw error;
    }

    await listen(server, host, 0);
  }
}

export async function startMetroDevServer(
  options: StartMetroDevServerOptions,
): Promise<VifxMetroDevServer> {
  const baseNames = normalizeBundleBaseNames(options.bundleBaseNames);
  const primaryBaseName = options.bundleBaseNames[0]?.replace(/^\.?\//u, "") || "index";
  const messageChannel = createMetroMessageChannel();
  const logRequest = (line: string) => options.onRequest?.(line);

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      logRequest(formatRequestLog(method, requestUrl));

      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        response.writeHead(405, {
          Allow: "GET, HEAD, POST",
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Method Not Allowed");
        return;
      }

      const headOnly = method === "HEAD";

      if (requestUrl.pathname === "/status") {
        writeTextResponse(response, 200, METRO_STATUS_BODY, "text/plain; charset=utf-8", headOnly);
        return;
      }

      if (method === "POST" && requestUrl.pathname === "/symbolicate") {
        const body = await readRequestBody(request).catch(() => "{}");
        let parsed: { stack?: VifxJsonValue[] };
        try {
          parsed = JSON.parse(body || "{}") as { stack?: VifxJsonValue[] };
        } catch {
          parsed = {};
        }

        const stack = await symbolicateStack({
          sourceMapPath: options.sourceMapPath,
          stack: Array.isArray(parsed.stack) ? parsed.stack : [],
        });

        writeTextResponse(
          response,
          200,
          JSON.stringify({ stack }),
          "application/json; charset=utf-8",
          false,
        );
        return;
      }

      if (method !== "POST" && matchBundleBaseName(requestUrl.pathname, baseNames)) {
        writeTextResponse(
          response,
          200,
          options.bundleSource,
          "application/javascript; charset=utf-8",
          headOnly,
        );
        return;
      }

      if (
        method !== "POST" &&
        options.sourceMapSource !== null &&
        matchSourceMapBaseName(requestUrl.pathname, baseNames)
      ) {
        writeTextResponse(
          response,
          200,
          options.sourceMapSource,
          "application/json; charset=utf-8",
          headOnly,
        );
        return;
      }

      writeTextResponse(response, 404, "Not Found", "text/plain; charset=utf-8", headOnly);
    } catch (error) {
      response.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error instanceof Error ? error.message : "Internal Server Error");
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (!messageChannel.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await listenWithPortFallback(server, options.host, options.port, options.strictPort);

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : options.port;
  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const url = `http://${displayHost}:${String(actualPort)}`;

  return {
    broadcast: (method, params) => messageChannel.broadcast(method, params),
    bundleUrl: `${url}/${primaryBaseName}.bundle?platform=${options.platform}&dev=true`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        messageChannel.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    host: options.host,
    messageClientCount: () => messageChannel.clientCount(),
    messageSocketUrl: `${url.replace(/^http:/u, "ws:")}/message`,
    platform: options.platform,
    port: actualPort,
    projectRoot: options.projectRoot,
    server,
    sourceMapUrl: options.sourceMapSource !== null ? `${url}/${primaryBaseName}.bundle.map` : null,
    statusUrl: `${url}/status`,
    url,
  };
}
