import { access } from "node:fs/promises";
import path from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { VifxError } from "@vifx/errors";
import { reactNative } from "@vifx/vite-plugin-react-native";
import type { VifxBundlePlatform, VifxExpoPluginOptions } from "@vifx/types";

const EXPO_APP_CONFIG_NAMES = [
  "app.json",
  "app.config.ts",
  "app.config.mts",
  "app.config.js",
  "app.config.mjs",
] as const;
const EXPO_DEV_CLIENT_ID = "\0vifx:expo-dev-client";
const EXPO_DEV_CLIENT_PUBLIC_ID = "/@vifx/expo-dev-client";
const EXPO_DEV_ROOT_ELEMENT_ID = "root";
const WEB_RUNTIME_BROWSER_GLOBALS_KEY = "__VIFX_BROWSER_GLOBALS__";

export interface StartExpoDevServerOptions extends Omit<VifxExpoPluginOptions, "platform"> {
  host?: string;
  platform: VifxBundlePlatform;
  port?: number;
}

export interface VifxExpoDevServer {
  close: () => Promise<void>;
  fastRefresh: false;
  hmr: "vite-browser";
  host: string;
  nativeRuntime: false;
  platform: VifxBundlePlatform;
  port: number;
  projectRoot: string;
  server: ViteDevServer;
  url: string;
}

function resolvePublicEnv(
  explicitEnv: Record<string, string> | undefined,
  processEnv: NodeJS.ProcessEnv | undefined,
  prefix: string,
) {
  const source = explicitEnv ?? processEnv ?? {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([name, value]) => name.startsWith(prefix) && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function isPathLikeSpecifier(specifier: string) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("../") ||
    specifier.startsWith("./")
  );
}

function resolveDevEntrySpecifier(projectRoot: string, entry: string) {
  if (!isPathLikeSpecifier(entry)) {
    return entry;
  }

  const absoluteEntryPath = toPosixPath(path.resolve(projectRoot, entry));
  return absoluteEntryPath.startsWith("/")
    ? `/@fs${absoluteEntryPath}`
    : `/@fs/${absoluteEntryPath}`;
}

function renderExpoDevHtml() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <link rel="icon" href="data:," />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Vifx Expo Dev</title>",
    "    <style>",
    `      html, body, #${EXPO_DEV_ROOT_ELEMENT_ID} { height: 100%; }`,
    "      body { margin: 0; }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <div id="${EXPO_DEV_ROOT_ELEMENT_ID}"></div>`,
    `    <script type="module" src="${EXPO_DEV_CLIENT_PUBLIC_ID}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderExpoDevClient(entrySpecifier: string) {
  return [
    "const nativeModuleCache = new Map();",
    "",
    "function createNativeModuleProxy(moduleName) {",
    "  const cachedModule = nativeModuleCache.get(moduleName);",
    "  if (cachedModule) {",
    "    return cachedModule;",
    "  }",
    "",
    "  const moduleProxy = new Proxy(",
    "    {",
    "      addListener() { return { remove() {} }; },",
    "      addProxiedListener() { return { remove() {} }; },",
    "      getConstants() {",
    "        if (moduleName === 'SourceCode') {",
    "          return { scriptURL: typeof window !== 'undefined' ? window.location.href : '' };",
    "        }",
    "        return {};",
    "      },",
    "      removeListeners() {},",
    "      removeProxiedListeners() {},",
    "    },",
    "    {",
    "      get(target, property) {",
    "        if (property in target) {",
    "          return target[property];",
    "        }",
    "        if (property === 'name') {",
    "          return moduleName;",
    "        }",
    "        return () => undefined;",
    "      },",
    "    },",
    "  );",
    "",
    "  nativeModuleCache.set(moduleName, moduleProxy);",
    "  return moduleProxy;",
    "}",
    "",
    "if (!globalThis.nativeModuleProxy) {",
    "  globalThis.nativeModuleProxy = new Proxy({}, {",
    "    get(_target, property) {",
    "      return typeof property === 'string' ? createNativeModuleProxy(property) : undefined;",
    "    },",
    "  });",
    "}",
    "",
    "if (!globalThis.__fbBatchedBridgeConfig) {",
    "  globalThis.__fbBatchedBridgeConfig = { remoteModuleConfig: [] };",
    "}",
    "",
    "if (!globalThis.__turboModuleProxy) {",
    "  globalThis.__turboModuleProxy = (moduleName) => createNativeModuleProxy(moduleName);",
    "}",
    "",
    "if (!globalThis.ErrorUtils) {",
    "  let globalErrorHandler = (error, isFatal) => {",
    "    if (isFatal) {",
    "      console.error(error);",
    "      return;",
    "    }",
    "    console.warn(error);",
    "  };",
    "  globalThis.ErrorUtils = {",
    "    getGlobalHandler() { return globalErrorHandler; },",
    "    setGlobalHandler(handler) {",
    "      if (typeof handler === 'function') {",
    "        globalErrorHandler = handler;",
    "      }",
    "    },",
    "    reportError(error) { globalErrorHandler(error, false); },",
    "    reportFatalError(error) { globalErrorHandler(error, true); },",
    "  };",
    "}",
    "",
    "if (!globalThis.ExpoDomWebView) {",
    "  globalThis.ExpoDomWebView = { expoModulesProxy: globalThis.nativeModuleProxy };",
    "}",
    "",
    `if (!globalThis.${WEB_RUNTIME_BROWSER_GLOBALS_KEY} && typeof window !== 'undefined') {`,
    `  globalThis.${WEB_RUNTIME_BROWSER_GLOBALS_KEY} = {`,
    "    Blob: window.Blob,",
    "    FormData: window.FormData,",
    "    Headers: window.Headers,",
    "    ReadableStream: window.ReadableStream,",
    "    Request: window.Request,",
    "    Response: window.Response,",
    "    TextDecoder: window.TextDecoder,",
    "    TextEncoder: window.TextEncoder,",
    "    URL: window.URL,",
    "    URLSearchParams: window.URLSearchParams,",
    "  };",
    "}",
    "",
    `await import(${JSON.stringify(entrySpecifier)});`,
    "",
    "const runtime = globalThis.__VIFX_WEB_RUNTIME__;",
    "if (runtime && typeof runtime.mount === 'function') {",
    `  runtime.mount(${JSON.stringify(EXPO_DEV_ROOT_ELEMENT_ID)});`,
    "}",
    "",
    "if (import.meta.hot) {",
    "  import.meta.hot.accept();",
    "}",
    "",
  ].join("\n");
}

function expoDevRuntimePlugin(projectRoot: string, entry: string): Plugin {
  const entrySpecifier = resolveDevEntrySpecifier(projectRoot, entry);

  return {
    name: "vifx:expo-dev-runtime",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const method = request.method ?? "GET";
        if (method !== "GET" && method !== "HEAD") {
          next();
          return;
        }

        const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
        if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/index.html") {
          next();
          return;
        }

        try {
          const html = await server.transformIndexHtml(requestUrl.pathname, renderExpoDevHtml());

          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
          });

          if (method === "HEAD") {
            response.end();
            return;
          }

          response.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
    load(id) {
      if (id !== EXPO_DEV_CLIENT_ID) {
        return null;
      }

      return renderExpoDevClient(entrySpecifier);
    },
    resolveId(source) {
      if (source === EXPO_DEV_CLIENT_PUBLIC_ID || source === "@vifx/expo-dev-client") {
        return EXPO_DEV_CLIENT_ID;
      }

      return null;
    },
  };
}

export async function findExpoAppConfig(projectRoot: string, explicitPath?: string) {
  if (explicitPath) {
    const resolvedPath = path.resolve(projectRoot, explicitPath);
    if (await pathExists(resolvedPath)) {
      return resolvedPath;
    }

    throw new VifxError({
      code: "VIFX_EXPO_CONFIG_NOT_FOUND",
      message: `Could not find Expo app config "${explicitPath}".`,
      hint: "Pass an existing app.json or app.config.* path.",
      docsPath: "/reference/packages#vifxvite-plugin-expo",
    });
  }

  for (const fileName of EXPO_APP_CONFIG_NAMES) {
    const candidatePath = path.join(projectRoot, fileName);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new VifxError({
    code: "VIFX_EXPO_CONFIG_NOT_FOUND",
    message: `No Expo app config was found in "${projectRoot}".`,
    hint: `Create one of: ${EXPO_APP_CONFIG_NAMES.join(", ")}.`,
    docsPath: "/reference/packages#vifxvite-plugin-expo",
  });
}

export function expo(options: VifxExpoPluginOptions): Plugin[] {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const publicEnvPrefix = options.publicEnvPrefix ?? "EXPO_PUBLIC_";
  const publicEnv = resolvePublicEnv(
    options.publicEnv,
    options.env ?? process.env,
    publicEnvPrefix,
  );

  return [
    {
      name: "vifx:expo",
      enforce: "pre",
      async config() {
        const appConfigPath = await findExpoAppConfig(projectRoot, options.appConfigPath);
        const defineEntries = Object.fromEntries(
          Object.entries(publicEnv).flatMap(([name, value]) => [
            [`import.meta.env.${name}`, JSON.stringify(value)],
            [`process.env.${name}`, JSON.stringify(value)],
          ]),
        );

        return {
          define: {
            __EXPO_APP_CONFIG_PATH__: JSON.stringify(path.relative(projectRoot, appConfigPath)),
            ...defineEntries,
          },
        };
      },
      load(id) {
        if (id !== "\0vifx:expo") {
          return null;
        }

        return [
          'import { AppRegistry } from "react-native";',
          "",
          "export function registerRootComponent(component) {",
          '  AppRegistry.registerComponent("main", () => component);',
          "",
          "  if (typeof document !== 'undefined') {",
          "    const rootTag = document.getElementById('root');",
          "    if (!rootTag) {",
          "      throw new Error('Required HTML element with id \"root\" was not found in the document HTML.');",
          "    }",
          "",
          '    AppRegistry.runApplication("main", { rootTag });',
          "  }",
          "",
          "  return component;",
          "}",
          "const Expo = { registerRootComponent };",
          "export default Expo;",
        ].join("\n");
      },
      resolveId(source) {
        if (source === "expo") {
          return "\0vifx:expo";
        }

        return null;
      },
    },
    reactNative({
      ...options,
      projectRoot,
    }),
  ];
}

export async function startExpoDevServer(
  options: StartExpoDevServerOptions,
): Promise<VifxExpoDevServer> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const entry = options.entry ?? "./index.js";
  const host = options.host ?? "127.0.0.1";
  // When no port is provided, pass 0 to let the OS assign a free port.
  // strictPort must only be true when the caller explicitly requested a specific port;
  // otherwise Vite throws instead of falling back to the next available port.
  const port = options.port ?? 0;
  const strictPort = options.port !== undefined;
  const server = await createServer({
    appType: "custom",
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      expoDevRuntimePlugin(projectRoot, entry),
      ...expo({
        ...options,
        entry,
        platform: options.platform,
        projectRoot,
        reactNativeCompat: "web",
        resolvePlatform: "web",
      }),
    ],
    publicDir: false,
    root: projectRoot,
    server: {
      host,
      port,
      strictPort,
    },
  });

  await server.listen();

  // Use the address actually bound by the OS, not the requested port.
  const address = server.httpServer?.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    close: () => server.close(),
    fastRefresh: false,
    hmr: "vite-browser",
    host,
    nativeRuntime: false,
    platform: options.platform,
    port: actualPort,
    projectRoot,
    server,
    url: `http://${displayHost}:${actualPort}`,
  };
}
