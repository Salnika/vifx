import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createDevMiddleware } from "@react-native/dev-middleware";
import { toVifxError } from "@vifx/errors";
import type { VifxJsonObject, VifxJsonValue } from "@vifx/types";

const INSPECTOR_PAGES_LIST_PATH = "/json/list";

type ConnectNextFunction = (error?: unknown) => void;
type ConnectMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: ConnectNextFunction,
) => void;

export interface VifxDevtoolsLogger {
  error: (...message: string[]) => void;
  info: (...message: string[]) => void;
  warn: (...message: string[]) => void;
}

export interface VifxDevtoolsWebSocketServer {
  clients?: Set<{ terminate: () => void }>;
  close: (callback?: (error?: Error) => void) => void;
  emit: (eventName: string, ...args: unknown[]) => boolean;
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (client: unknown) => void,
  ) => void;
}

/**
 * Launches the React Native DevTools frontend on the host machine. Mirrors
 * `@react-native/dev-middleware`'s (unstable) `DevToolLauncher`.
 */
export interface VifxDevtoolsToolLauncher {
  launchDebuggerAppWindow: (url: string) => Promise<void>;
  launchDebuggerShell?: (url: string, windowKey: string) => Promise<void>;
  prepareDebuggerShell?: () => Promise<{ code: string }>;
}

export interface VifxCreateDevtoolsOptions {
  broadcast: (method: string, params?: VifxJsonValue) => void;
  logger?: VifxDevtoolsLogger;
  projectRoot: string;
  serverBaseUrl: string;
  symbolicate?: (stack: VifxJsonValue[]) => Promise<VifxJsonValue[]>;
  /**
   * Overrides how the DevTools frontend is opened. Defaults to
   * dev-middleware's launcher (standalone DevTools shell, Chrome fallback).
   */
  toolLauncher?: VifxDevtoolsToolLauncher;
}

export interface VifxExpoDevtools {
  close: () => Promise<void>;
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  inspectorProxyUrl: string;
  websocketEndpoints: Record<string, VifxDevtoolsWebSocketServer>;
}

function createConsoleDevtoolsLogger(): VifxDevtoolsLogger {
  return {
    error: (...message) => {
      console.error(...message);
    },
    info: (...message) => {
      console.info(...message);
    },
    warn: (...message) => {
      console.warn(...message);
    },
  };
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getRequestPathname(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://vifx.local").pathname;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function readJsonRequestBody(request: IncomingMessage): Promise<VifxJsonValue | undefined> {
  const body = await readRequestBody(request).catch(() => "");
  if (body === "") {
    return undefined;
  }

  try {
    return JSON.parse(body) as VifxJsonValue;
  } catch {
    return undefined;
  }
}

function writeDevtoolsJsonResponse(
  response: ServerResponse,
  statusCode: number,
  body: VifxJsonValue,
) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeDevtoolsTextResponse(response: ServerResponse, statusCode: number, body: string) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

function resolveMiddlewareErrorStatusCode(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    for (const value of [candidate.statusCode, candidate.status]) {
      if (typeof value === "number" && value >= 400 && value <= 599) {
        return value;
      }
    }
  }

  return 500;
}

function formatStackFrame(frame: VifxJsonValue) {
  if (!isJsonObject(frame)) {
    return JSON.stringify(frame);
  }

  const methodName = typeof frame.methodName === "string" ? frame.methodName : "<unknown>";
  const file =
    typeof frame.file === "string"
      ? frame.file
      : typeof frame.source === "string"
        ? frame.source
        : "<unknown file>";
  const line = typeof frame.lineNumber === "number" ? frame.lineNumber : null;
  const column = typeof frame.column === "number" ? frame.column : null;
  const position =
    line === null ? "" : `:${String(line)}${column === null ? "" : `:${String(column)}`}`;

  return `${methodName} (${file}${position})`;
}

function formatClientLogEntry(entry: VifxJsonValue): {
  level: "error" | "info" | "warn";
  message: string;
} {
  if (!isJsonObject(entry)) {
    return { level: "info", message: `[expo-client] ${JSON.stringify(entry)}` };
  }

  const level = entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : "info";
  const body = Array.isArray(entry.body) ? entry.body : null;
  const message = body
    ? body.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")
    : JSON.stringify(entry);

  return { level, message: `[expo-client] ${message}` };
}

/**
 * dev-middleware prepares the standalone DevTools shell as soon as it is
 * created, and its default launcher refuses to run under `NODE_ENV=test`. A
 * test run that injects no launcher gets an inert one, so no test ever spawns
 * or downloads the debugger shell.
 */
const INERT_TOOL_LAUNCHER: VifxDevtoolsToolLauncher = {
  launchDebuggerAppWindow: async () => {},
  prepareDebuggerShell: async () => ({ code: "not_implemented" }),
};

function resolveToolLauncher(toolLauncher: VifxDevtoolsToolLauncher | undefined) {
  if (toolLauncher) {
    return toolLauncher;
  }

  return process.env.NODE_ENV === "test" ? INERT_TOOL_LAUNCHER : undefined;
}

export function createDevtools(options: VifxCreateDevtoolsOptions): VifxExpoDevtools {
  const logger = options.logger ?? createConsoleDevtoolsLogger();
  const devMiddleware = createDevMiddleware({
    logger,
    serverBaseUrl: options.serverBaseUrl,
    unstable_toolLauncher: resolveToolLauncher(options.toolLauncher) as Parameters<
      typeof createDevMiddleware
    >[0]["unstable_toolLauncher"],
  });
  const middleware = devMiddleware.middleware as ConnectMiddleware;
  const websocketEndpoints = devMiddleware.websocketEndpoints as unknown as Record<
    string,
    VifxDevtoolsWebSocketServer
  >;

  const respondToMiddlewareError = (
    error: unknown,
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    const vifxError = toVifxError(error, {
      code: "VIFX_DEVTOOLS_MIDDLEWARE_FAILED",
      message: `React Native DevTools middleware failed for "${getRequestPathname(request)}".`,
    });
    const statusCode = resolveMiddlewareErrorStatusCode(error);

    if (statusCode >= 500) {
      logger.error(`[vifx] ${vifxError.message}`);
    }

    if (!response.headersSent) {
      writeDevtoolsTextResponse(response, statusCode, `${vifxError.message}\n`);
    } else if (!response.writableEnded) {
      response.end();
    }
  };

  const runDevMiddleware = (request: IncomingMessage, response: ServerResponse) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (handled: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        response.off("finish", onResponseDone);
        response.off("close", onResponseDone);
        resolve(handled);
      };

      function onResponseDone() {
        settle(true);
      }

      response.once("finish", onResponseDone);
      response.once("close", onResponseDone);

      try {
        middleware(request, response, (error?: unknown) => {
          if (error == null) {
            settle(false);
            return;
          }

          respondToMiddlewareError(error, request, response);
          settle(true);
        });
      } catch (error) {
        respondToMiddlewareError(error, request, response);
        settle(true);
      }
    });

  const handleReloadRequest = (response: ServerResponse) => {
    options.broadcast("reload");
    writeDevtoolsTextResponse(response, 200, "OK\n");
  };

  const handleOpenUrlRequest = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJsonRequestBody(request);
    const url = isJsonObject(body) && typeof body.url === "string" ? body.url : null;

    if (url === null) {
      logger.warn('[vifx] Ignored /open-url request without a string "url" field.');
    } else {
      logger.info(`[vifx] App requested opening URL (not opened by vifx): ${url}`);
    }

    writeDevtoolsJsonResponse(response, 200, { opened: false, url });
  };

  const handleOpenStackFrameRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    const body = await readJsonRequestBody(request);

    if (!isJsonObject(body)) {
      logger.warn("[vifx] Ignored /open-stack-frame request without a JSON stack frame body.");
      writeDevtoolsJsonResponse(response, 200, { frame: null });
      return;
    }

    let frame: VifxJsonValue = body;
    if (options.symbolicate) {
      try {
        const symbolicated = await options.symbolicate([body]);
        frame = symbolicated[0] ?? body;
      } catch (error) {
        logger.warn(`[vifx] Stack frame symbolication failed: ${toVifxError(error).message}`);
      }
    }

    logger.info(`[vifx] App stack frame: ${formatStackFrame(frame)}`);
    writeDevtoolsJsonResponse(response, 200, { frame });
  };

  const handleLogsRequest = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJsonRequestBody(request);
    const entries = Array.isArray(body) ? body : [];

    for (const entry of entries) {
      const { level, message } = formatClientLogEntry(entry);
      logger[level](message);
    }

    writeDevtoolsJsonResponse(response, 200, { received: entries.length });
  };

  return {
    async close() {
      await Promise.all(
        Object.values(websocketEndpoints).map(async (endpoint) => {
          for (const client of endpoint.clients ?? []) {
            client.terminate();
          }

          await new Promise<void>((resolve) => {
            endpoint.close(() => resolve());
          });
        }),
      );
    },
    async handleRequest(request, response) {
      const method = request.method ?? "GET";
      const pathname = getRequestPathname(request);

      if (pathname === "/reload" && (method === "GET" || method === "POST")) {
        handleReloadRequest(response);
        return true;
      }

      if (method === "POST") {
        if (pathname === "/open-url") {
          await handleOpenUrlRequest(request, response);
          return true;
        }

        if (pathname === "/open-stack-frame") {
          await handleOpenStackFrameRequest(request, response);
          return true;
        }

        if (pathname === "/logs") {
          await handleLogsRequest(request, response);
          return true;
        }
      }

      return await runDevMiddleware(request, response);
    },
    handleUpgrade(request, socket, head) {
      const endpoint = websocketEndpoints[getRequestPathname(request)];
      if (!endpoint) {
        return false;
      }

      endpoint.handleUpgrade(request, socket, head, (client) => {
        endpoint.emit("connection", client, request);
      });
      return true;
    },
    inspectorProxyUrl: `${options.serverBaseUrl}${INSPECTOR_PAGES_LIST_PATH}`,
    websocketEndpoints,
  };
}
