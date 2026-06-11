import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { build, createServer as createViteServer, type Plugin, type ViteDevServer } from "vite";
import {
  collectAssetGroup,
  createAssetServerUrl,
  isSupportedAssetFile,
} from "@vifx/asset-registry";
import { VifxError } from "@vifx/errors";
import { symbolicateStackFrame } from "@vifx/source-map-tools";
import { reactNative } from "@vifx/vite-plugin-react-native";
import type {
  VifxBuildAssetArtifact,
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxExpoPluginOptions,
  VifxJsonObject,
  VifxJsonValue,
} from "@vifx/types";
import { createDevtools, type VifxExpoDevtools } from "./devtools.ts";

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
const CONFIG_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".lottie",
  ".png",
  ".webp",
]);
const EXPO_DEV_SERVER_MESSAGE_PROTOCOL_VERSION = 2;
const EXPO_DEV_SERVER_WEBSOCKET_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface StartExpoDevServerOptions extends Omit<VifxExpoPluginOptions, "platform"> {
  host?: string;
  platform: VifxBundlePlatform;
  port?: number;
  publicHost?: string;
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

export interface VifxExpoGoDevServer {
  bundleUrl: string;
  close: () => Promise<void>;
  eventsSocketUrl: string;
  expoGoUrl: string;
  fastRefresh: false;
  hmr: "reload";
  host: string;
  hostUri: string;
  hotSocketUrl?: string;
  inspectorProxyUrl?: string;
  manifestUrl: string;
  messageSocketUrl: string;
  metro: false;
  nativeRuntime: true;
  platform: VifxBundlePlatform;
  port: number;
  projectRoot: string;
  server: HttpServer;
  sourceMapUrl: string | null;
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

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

function isJsonObject(value: unknown): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readJsonFileIfExists(filePath: string) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return JSON.parse(await readFile(filePath, "utf8")) as VifxJsonValue;
}

async function readPackageJson(projectRoot: string) {
  const packageJson = await readJsonFileIfExists(path.join(projectRoot, "package.json"));
  return isJsonObject(packageJson) ? packageJson : {};
}

function readStringRecordValue(record: VifxJsonObject, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readDependencyVersion(packageJson: VifxJsonObject, dependencyName: string) {
  for (const fieldName of ["dependencies", "devDependencies", "peerDependencies"]) {
    const field = packageJson[fieldName];
    if (!isJsonObject(field)) {
      continue;
    }

    const version = readStringRecordValue(field, dependencyName);
    if (version) {
      return version;
    }
  }

  return null;
}

function normalizeVersionRange(versionRange: string | null) {
  return versionRange?.replace(/^[^\d]*/u, "") || null;
}

function normalizeExpoSdkRuntimeVersion(versionRange: string | null) {
  const normalizedVersion = normalizeVersionRange(versionRange);
  const majorVersion = normalizedVersion?.match(/^(\d+)/u)?.[1];

  return majorVersion ? `${majorVersion}.0.0` : normalizedVersion;
}

function resolveExpoSdkVersion(exp: VifxJsonObject, packageJson: VifxJsonObject) {
  return normalizeExpoSdkRuntimeVersion(
    typeof exp.sdkVersion === "string"
      ? exp.sdkVersion
      : readDependencyVersion(packageJson, "expo"),
  );
}

function resolveRuntimeVersion(exp: VifxJsonObject, packageJson: VifxJsonObject) {
  const runtimeVersion = exp.runtimeVersion;
  if (typeof runtimeVersion === "string" && runtimeVersion.length > 0) {
    return runtimeVersion;
  }

  const sdkVersion = resolveExpoSdkVersion(exp, packageJson);

  return sdkVersion ? `exposdk:${sdkVersion}` : "vifx-development";
}

async function readExpoAppManifest(projectRoot: string, appConfigPath?: string) {
  const packageJson = await readPackageJson(projectRoot);
  const packageName = readStringRecordValue(packageJson, "name") ?? "vifx-expo-app";
  const fallback = {
    name: packageName,
    slug: packageName,
  } satisfies VifxJsonObject;

  const configPath = await findExpoAppConfig(projectRoot, appConfigPath).catch(() => null);
  if (!configPath || path.basename(configPath) !== "app.json") {
    return {
      exp: fallback,
      packageJson,
    };
  }

  const appJson = await readJsonFileIfExists(configPath);
  if (!isJsonObject(appJson)) {
    return {
      exp: fallback,
      packageJson,
    };
  }

  const expoConfig = appJson.expo;
  return {
    exp: {
      ...fallback,
      ...(isJsonObject(expoConfig) ? expoConfig : appJson),
    },
    packageJson,
  };
}

function stripKnownEntryExtension(entry: string) {
  return entry.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

function normalizeMainModuleName(entry: string) {
  const moduleName = stripKnownEntryExtension(
    entry.startsWith("./") ? entry.slice("./".length) : entry,
  );

  return moduleName.replace(/^\/+/u, "");
}

function readBooleanExperiment(exp: VifxJsonObject, name: string) {
  const experiments = exp.experiments;
  if (!isJsonObject(experiments)) {
    return false;
  }

  return experiments[name] === true;
}

function resolveRouterRoot(projectRoot: string, entry: string) {
  if (entry !== "expo-router/entry") {
    return null;
  }

  return pathExists(path.join(projectRoot, "app")).then((exists) => (exists ? "app" : null));
}

export async function createExpoGoBundleUrlPath(options: {
  dev?: boolean;
  exp?: VifxJsonObject;
  hermes?: boolean;
  mainModuleName: string;
  platform: VifxBundlePlatform;
  projectRoot?: string;
  routerRoot?: string | null;
}) {
  const queryParams = new URLSearchParams({
    dev: String(options.dev ?? true),
    hot: "false",
    platform: options.platform,
  });

  if (options.hermes) {
    queryParams.set("transform.engine", "hermes");
    queryParams.set("transform.bytecode", "1");
  }

  const routerRoot =
    options.routerRoot ??
    (options.projectRoot
      ? await resolveRouterRoot(options.projectRoot, options.mainModuleName)
      : null);
  if (routerRoot) {
    queryParams.set("transform.routerRoot", routerRoot);
  }

  if (options.exp && readBooleanExperiment(options.exp, "reactCompiler")) {
    queryParams.set("transform.reactCompiler", "true");
  }

  return `/${encodeURI(options.mainModuleName)}.bundle?${queryParams.toString()}`;
}

function createExpoGoSourceMapUrlPath(bundleUrlPath: string) {
  return bundleUrlPath.replace(".bundle?", ".map?");
}

function getLanAddress() {
  for (const networkInterface of Object.values(networkInterfaces())) {
    for (const address of networkInterface ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "127.0.0.1";
}

function resolveDisplayHost(host: string, publicHost?: string) {
  const explicitPublicHost = publicHost?.trim();
  if (explicitPublicHost) {
    return explicitPublicHost;
  }

  const packagerHost = process.env.REACT_NATIVE_PACKAGER_HOSTNAME?.trim();
  if (packagerHost) {
    return packagerHost;
  }

  if (host === "0.0.0.0" || host === "::") {
    return getLanAddress();
  }

  return host === "localhost" ? "127.0.0.1" : host;
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  body: VifxJsonValue,
  headers: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    "Cache-Control": "private, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "expo-protocol-version": "0",
    "expo-sfv-version": "0",
    ...headers,
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeTextResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

function writeMethodNotAllowed(response: ServerResponse) {
  response.writeHead(405, {
    Allow: "GET, HEAD, POST",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end("Method not allowed\n");
}

function isConfigAssetPath(value: string) {
  if (!value.startsWith("./") && !value.startsWith("../")) {
    return false;
  }

  return CONFIG_ASSET_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function encodeAssetPath(assetPath: string) {
  return assetPath
    .replace(/^\.\//u, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function rewriteConfigAssetUrls(value: VifxJsonValue, assetBaseUrl: string): VifxJsonValue {
  if (typeof value === "string") {
    return isConfigAssetPath(value) ? `${assetBaseUrl}/assets/${encodeAssetPath(value)}` : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteConfigAssetUrls(item, assetBaseUrl));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      rewriteConfigAssetUrls(nestedValue, assetBaseUrl),
    ]),
  );
}

function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".otf":
      return "font/otf";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function resolveSafeChildPath(root: string, requestPathname: string) {
  const encodedAssetPath = requestPathname.replace(/^\/assets\/?/u, "");
  if (!encodedAssetPath) {
    return null;
  }

  const assetPath = encodedAssetPath
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join(path.sep);
  const absoluteAssetPath = path.resolve(root, assetPath);
  const relativePath = path.relative(root, absoluteAssetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absoluteAssetPath;
}

async function resolveServedAssetPath(options: {
  emittedAssetsRoot: string;
  projectRoot: string;
  requestPathname: string;
}) {
  const candidateRoots = [options.emittedAssetsRoot, options.projectRoot];

  for (const candidateRoot of candidateRoots) {
    const candidatePath = resolveSafeChildPath(candidateRoot, options.requestPathname);
    if (!candidatePath) {
      continue;
    }

    const candidateStat = await stat(candidatePath).catch(() => null);
    if (candidateStat?.isFile()) {
      return candidatePath;
    }
  }

  return null;
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
  projectRoot: string;
  sourceMapPath: string | null;
  stack: VifxJsonValue[];
}) {
  if (!options.sourceMapPath) {
    return options.stack;
  }

  const absoluteSourceMapPath = path.resolve(options.projectRoot, options.sourceMapPath);

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
        sourceMapPath: absoluteSourceMapPath,
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

function buildManifest(options: {
  assets: VifxBuildAssetArtifact[];
  bundleUrl: string;
  exp: VifxJsonObject;
  hostUri: string;
  mainModuleName: string;
  packageJson: VifxJsonObject;
  platform: VifxBundlePlatform;
  projectRoot: string;
}) {
  const eas = options.exp.extra;
  const easProject: VifxJsonObject =
    isJsonObject(eas) && isJsonObject(eas.eas) && typeof eas.eas.projectId === "string"
      ? { projectId: eas.eas.projectId }
      : {};
  const slug = typeof options.exp.slug === "string" ? options.exp.slug : "expo-app";
  const assetBaseUrl = new URL(options.bundleUrl).origin;
  const expoClient = rewriteConfigAssetUrls(options.exp, assetBaseUrl);
  const sdkVersion = resolveExpoSdkVersion(options.exp, options.packageJson);
  const assets = options.assets.map((asset) => {
    const url = createAssetServerUrl({
      baseUrl: assetBaseUrl,
      descriptor: {
        hash: asset.hash ?? "",
        httpServerLocation: asset.httpServerLocation,
        name: asset.name,
        type: asset.type,
      },
      platform: options.platform,
    });
    const key = asset.hash ?? `${asset.httpServerLocation}/${asset.name}.${asset.type}`;

    return {
      contentType:
        getContentType(`${asset.name}.${asset.type}`).split(";")[0] ?? "application/octet-stream",
      fileExtension: asset.type,
      fileHashes: asset.hash ? [asset.hash] : [],
      fileUris: [url],
      hash: asset.hash ?? null,
      height: asset.height ?? null,
      key,
      name: asset.name,
      scales: asset.scales,
      type: asset.type,
      url,
      width: asset.width ?? null,
    };
  });

  const manifest: VifxJsonObject = {
    assets,
    createdAt: new Date().toISOString(),
    extra: {
      eas: easProject,
      expoClient: {
        ...(isJsonObject(expoClient) ? expoClient : options.exp),
        hostUri: options.hostUri,
        ...(sdkVersion ? { sdkVersion } : {}),
      },
      expoGo: {
        debuggerHost: options.hostUri,
        developer: {
          projectRoot: options.projectRoot,
          tool: "vifx",
        },
        mainModuleName: options.mainModuleName,
        packagerOpts: {
          dev: true,
        },
      },
      scopeKey: `@vifx/${slug}`,
    },
    id: randomUUID(),
    launchAsset: {
      contentType: "application/javascript",
      fileExtension: "bundle",
      key: "bundle",
      url: options.bundleUrl,
    },
    metadata: {
      generatedBy: "vifx",
      platform: options.platform,
    },
    runtimeVersion: resolveRuntimeVersion(options.exp, options.packageJson),
    ...(sdkVersion ? { sdkVersion } : {}),
  };

  return manifest;
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
  const resolvePlatform = options.resolvePlatform ?? options.platform;
  const shimExpoPackage = options.reactNativeCompat === "web" || resolvePlatform === "web";
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
        if (source === "expo" && shimExpoPackage) {
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

async function readSourceMapArtifact(projectRoot: string, sourceMapPath: string) {
  if (!(await pathExists(sourceMapPath))) {
    return null;
  }

  const sourceMapJson = (await readJsonFileIfExists(sourceMapPath)) as VifxJsonObject | null;
  const sources = Array.isArray(sourceMapJson?.sources) ? sourceMapJson.sources : [];

  return {
    path: relativeFrom(projectRoot, sourceMapPath),
    sourceCount: sources.length,
    valid: sourceMapJson?.version === 3,
    warnings: [],
  };
}

async function collectEmittedExpoAssets(options: {
  absoluteOutDir: string;
  projectRoot: string;
}): Promise<VifxBuildAssetArtifact[]> {
  const emittedAssetsRoot = path.join(options.absoluteOutDir, "assets");
  const entries = await readdir(emittedAssetsRoot, { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  const seenAssetKeys = new Set<string>();
  const assets: VifxBuildAssetArtifact[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const entryParentPath =
      "parentPath" in entry && typeof entry.parentPath === "string"
        ? entry.parentPath
        : emittedAssetsRoot;
    const emittedAssetPath = path.join(entryParentPath, entry.name);
    if (!isSupportedAssetFile(emittedAssetPath)) {
      continue;
    }

    const descriptor = await collectAssetGroup({
      filePath: emittedAssetPath,
      projectRoot: options.absoluteOutDir,
    });
    const assetKey = `${descriptor.httpServerLocation}/${descriptor.name}.${descriptor.type}`;
    if (seenAssetKeys.has(assetKey)) {
      continue;
    }

    seenAssetKeys.add(assetKey);
    const emittedPath = path.join(
      options.absoluteOutDir,
      descriptor.httpServerLocation.replace(/^\/assets\/?/u, "assets/"),
      `${descriptor.name}.${descriptor.type}`,
    );
    const assetStats = await stat(emittedPath);

    assets.push({
      emittedPath: relativeFrom(options.projectRoot, emittedPath),
      hash: descriptor.hash,
      height: descriptor.height,
      httpServerLocation: descriptor.httpServerLocation,
      name: descriptor.name,
      scales: [...descriptor.scales],
      sizeBytes: assetStats.size,
      sourceFilePath: relativeFrom(options.projectRoot, emittedPath),
      type: descriptor.type,
      width: descriptor.width,
    });
  }

  return assets.sort((left, right) => left.emittedPath.localeCompare(right.emittedPath));
}

function resolveProjectImportSpecifiers(projectRoot: string, specifiers: string[]) {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));

  return specifiers.filter((specifier) => {
    try {
      requireFromProject.resolve(specifier);
      return true;
    } catch {
      return false;
    }
  });
}

async function createExpoBuildInputEntry(projectRoot: string, outDir: string, entry: string) {
  const inputPath = path.join(outDir, "__vifx_expo_entry__.js");
  const importSpecifier = isPathLikeSpecifier(entry)
    ? `./${relativeFrom(path.dirname(inputPath), path.resolve(projectRoot, entry))}`
    : entry;
  const preludeSpecifiers = resolveProjectImportSpecifiers(projectRoot, [
    "@react-native/js-polyfills/error-guard",
  ]);

  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(
    inputPath,
    [
      ...preludeSpecifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
      `import ${JSON.stringify(importSpecifier)};`,
      "",
    ].join("\n"),
    "utf8",
  );

  return inputPath;
}

export async function buildExpoBundle(
  options: VifxExpoPluginOptions,
): Promise<VifxBundleArtifacts> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const entry = options.entry ?? "./index.js";
  const outDir = options.outDir ?? `.vifx/expo/${options.platform}`;
  const absoluteOutDir = path.resolve(projectRoot, outDir);
  const inputEntry = await createExpoBuildInputEntry(projectRoot, absoluteOutDir, entry);

  await build({
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      emptyOutDir: true,
      minify: false,
      outDir,
      rollupOptions: {
        input: inputEntry,
        output: {
          assetFileNames: "assets/[name][extname]",
          chunkFileNames: "chunks/[name].js",
          entryFileNames: "index.bundle",
          format: "es",
        },
      },
      sourcemap: true,
      target: "es2020",
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      ...expo({
        ...options,
        entry,
        projectRoot,
      }),
    ],
    publicDir: false,
    root: projectRoot,
  });

  const bundlePath = path.join(absoluteOutDir, "index.bundle");
  const sourceMapPath = `${bundlePath}.map`;
  const appConfigPath = await findExpoAppConfig(projectRoot, options.appConfigPath).catch(
    () => undefined,
  );
  const bundleStats = await stat(bundlePath);
  const assets = await collectEmittedExpoAssets({
    absoluteOutDir,
    projectRoot,
  });

  return {
    appConfigPath: appConfigPath ? relativeFrom(projectRoot, appConfigPath) : undefined,
    assets,
    bundle: {
      path: relativeFrom(projectRoot, bundlePath),
      sizeBytes: bundleStats.size,
    },
    entry,
    mode: "expo",
    platform: options.platform,
    projectRoot,
    runtime: null,
    sourceMap: await readSourceMapArtifact(projectRoot, sourceMapPath),
  };
}

interface ExpoGoSocketClient {
  buffer: Buffer;
  id: string;
  query: string;
  socket: Duplex;
}

type ExpoGoSocketFrame =
  | {
      payload: Buffer;
      type: "ping";
    }
  | {
      payload: string;
      type: "text";
    }
  | {
      type: "close";
    };

function createWebSocketAcceptHeader(key: string) {
  return createHash("sha1")
    .update(`${key}${EXPO_DEV_SERVER_WEBSOCKET_ACCEPT_GUID}`)
    .digest("base64");
}

function writeWebSocketHandshake(socket: Duplex, key: string) {
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Connection: Upgrade",
      "Upgrade: websocket",
      `Sec-WebSocket-Accept: ${createWebSocketAcceptHeader(key)}`,
      "",
      "",
    ].join("\r\n"),
  );
}

function writeWebSocketFrame(socket: Duplex, opcode: number, payload: Buffer | string = "") {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header: Buffer;

  if (body.byteLength < 126) {
    header = Buffer.from([0x80 | opcode, body.byteLength]);
  } else if (body.byteLength <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.byteLength, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.byteLength), 2);
  }

  socket.write(Buffer.concat([header, body]));
}

function writeWebSocketText(socket: Duplex, body: string) {
  writeWebSocketFrame(socket, 0x1, body);
}

function writeWebSocketPong(socket: Duplex, body: Buffer) {
  writeWebSocketFrame(socket, 0xa, body);
}

function writeWebSocketClose(socket: Duplex) {
  if (socket.destroyed) {
    return;
  }

  writeWebSocketFrame(socket, 0x8);
  socket.end();
}

function readWebSocketFrames(buffer: Buffer) {
  const frames: ExpoGoSocketFrame[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.byteLength) {
    const firstByte = buffer[offset]!;
    const secondByte = buffer[offset + 1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + headerLength + 2 > buffer.byteLength) {
        break;
      }

      payloadLength = buffer.readUInt16BE(offset + headerLength);
      headerLength += 2;
    } else if (payloadLength === 127) {
      if (offset + headerLength + 8 > buffer.byteLength) {
        break;
      }

      const bigPayloadLength = buffer.readBigUInt64BE(offset + headerLength);
      if (bigPayloadLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame payload is too large.");
      }

      payloadLength = Number(bigPayloadLength);
      headerLength += 8;
    }

    const maskLength = masked ? 4 : 0;
    const payloadStart = offset + headerLength + maskLength;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > buffer.byteLength) {
      break;
    }

    const payload = Buffer.from(buffer.subarray(payloadStart, payloadEnd));
    if (masked) {
      const maskStart = offset + headerLength;
      for (let index = 0; index < payload.byteLength; index += 1) {
        payload[index] = payload[index]! ^ buffer[maskStart + (index % 4)]!;
      }
    }

    if (opcode === 0x1) {
      frames.push({
        payload: payload.toString("utf8"),
        type: "text",
      });
    } else if (opcode === 0x8) {
      frames.push({
        type: "close",
      });
    } else if (opcode === 0x9) {
      frames.push({
        payload,
        type: "ping",
      });
    }

    offset = payloadEnd;
  }

  return {
    frames,
    rest: buffer.subarray(offset),
  };
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

function getWebSocketHeader(request: IncomingMessage, name: string) {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

function createExpoGoMessageChannel() {
  let nextClientId = 1;
  const messageClients = new Map<string, ExpoGoSocketClient>();
  const eventClients = new Map<string, ExpoGoSocketClient>();

  const cleanupClient = (client: ExpoGoSocketClient, clients: Map<string, ExpoGoSocketClient>) => {
    clients.delete(client.id);
  };

  const sendToClient = (client: ExpoGoSocketClient | undefined, message: VifxJsonObject) => {
    if (!client || client.socket.destroyed) {
      return;
    }

    writeWebSocketText(client.socket, serializeExpoGoSocketMessage(message));
  };

  const broadcastToMessageClients = (
    senderClientId: string | null,
    message: VifxJsonObject | string,
  ) => {
    const serializedMessage =
      typeof message === "string" ? message : serializeExpoGoSocketMessage(message);

    for (const [clientId, client] of messageClients) {
      if (clientId === senderClientId || client.socket.destroyed) {
        continue;
      }

      writeWebSocketText(client.socket, serializedMessage);
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
    const key = getWebSocketHeader(request, "sec-websocket-key");
    if (!key) {
      socket.destroy();
      return;
    }

    writeWebSocketHandshake(socket, key);

    const client: ExpoGoSocketClient = {
      buffer: head.byteLength > 0 ? Buffer.from(head) : Buffer.alloc(0),
      id: `vifx-${String(nextClientId)}`,
      query: new URL(request.url ?? "/", "http://vifx.local").searchParams.toString(),
      socket,
    };
    nextClientId += 1;

    const clients = endpoint === "message" ? messageClients : eventClients;
    clients.set(client.id, client);

    const cleanup = () => cleanupClient(client, clients);
    socket.once("close", cleanup);
    socket.once("end", cleanup);
    socket.once("error", cleanup);
    socket.on("data", (chunk: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);

      let frames: ExpoGoSocketFrame[];
      try {
        const parsed = readWebSocketFrames(client.buffer);
        frames = parsed.frames;
        client.buffer = Buffer.from(parsed.rest);
      } catch {
        writeWebSocketClose(socket);
        return;
      }

      for (const frame of frames) {
        if (frame.type === "close") {
          writeWebSocketClose(socket);
        } else if (frame.type === "ping") {
          writeWebSocketPong(socket, frame.payload);
        } else if (endpoint === "message") {
          handleMessageClientPayload(client, frame.payload);
        } else {
          handleEventsClientPayload(frame.payload);
        }
      }
    });

    if (client.buffer.byteLength > 0) {
      socket.emit("data", Buffer.alloc(0));
    }
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
        writeWebSocketClose(client.socket);
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

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function isManifestPath(pathname: string) {
  return pathname === "/" || pathname === "/manifest" || pathname === "/index.exp";
}

function isBundlePath(pathname: string) {
  return pathname.endsWith(".bundle");
}

function isSourceMapPath(pathname: string) {
  return pathname.endsWith(".map") || pathname.endsWith(".bundle.map");
}

async function listen(server: HttpServer, host: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function startExpoGoDevServer(
  options: StartExpoDevServerOptions,
): Promise<VifxExpoGoDevServer> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const strictPort = options.port !== undefined;
  const entry = options.entry ?? "./index.js";
  const mainModuleName = normalizeMainModuleName(entry);
  const { exp, packageJson } = await readExpoAppManifest(projectRoot, options.appConfigPath);
  const bundle = await buildExpoBundle({
    ...options,
    entry,
    outDir: options.outDir ?? `.vifx/expo-go/${options.platform}`,
    projectRoot,
    publicEnvPrefix: options.publicEnvPrefix,
    reactNativeCompat: "none",
    resolvePlatform: options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? false,
    shimReact: options.shimReact ?? false,
    shimReactNative: options.shimReactNative ?? false,
  });
  const bundleUrlPath = await createExpoGoBundleUrlPath({
    exp,
    hermes: options.hermes,
    mainModuleName,
    platform: options.platform,
    projectRoot,
  });
  const sourceMapUrlPath = createExpoGoSourceMapUrlPath(bundleUrlPath);
  const emittedAssetsRoot = path.join(projectRoot, path.dirname(bundle.bundle.path), "assets");
  const messageChannel = createExpoGoMessageChannel();
  let devtools: VifxExpoDevtools | null = null;

  const server = createHttpServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      writeMethodNotAllowed(response);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
    const displayHost = resolveDisplayHost(host, options.publicHost);
    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : port;
    const baseUrl = `http://${displayHost}:${String(actualPort)}`;
    const hostUri = `${displayHost}:${String(actualPort)}`;
    const bundleUrl = `${baseUrl}${bundleUrlPath}`;

    if (isManifestPath(requestUrl.pathname)) {
      writeJsonResponse(
        response,
        200,
        buildManifest({
          bundleUrl,
          assets: bundle.assets,
          exp,
          hostUri,
          mainModuleName,
          packageJson,
          platform: options.platform,
          projectRoot,
        }),
        {
          "expo-manifest-filters": "",
          "expo-protocol-version": "1",
          "expo-server-defined-headers": "",
        },
      );
      return;
    }

    if (requestUrl.pathname === "/status") {
      writeTextResponse(response, 200, "packager-status:running", "text/plain; charset=utf-8");
      return;
    }

    if (isBundlePath(requestUrl.pathname)) {
      const bundleSource = await readFile(path.resolve(projectRoot, bundle.bundle.path), "utf8");
      writeTextResponse(response, 200, bundleSource, "application/javascript; charset=utf-8");
      return;
    }

    if (isSourceMapPath(requestUrl.pathname) && bundle.sourceMap) {
      const sourceMap = await readFile(path.resolve(projectRoot, bundle.sourceMap.path), "utf8");
      writeTextResponse(response, 200, sourceMap, "application/json; charset=utf-8");
      return;
    }

    if (requestUrl.pathname.startsWith("/assets/")) {
      const assetPath = await resolveServedAssetPath({
        emittedAssetsRoot,
        projectRoot,
        requestPathname: requestUrl.pathname,
      });
      if (assetPath) {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": getContentType(assetPath),
        });
        response.end(await readFile(assetPath));
        return;
      }
    }

    if (requestUrl.pathname === "/symbolicate" && method === "POST") {
      const body = await readRequestBody(request).catch(() => "{}");
      const parsed = JSON.parse(body || "{}") as { stack?: VifxJsonValue[] };
      const stack = await symbolicateStack({
        projectRoot,
        sourceMapPath: bundle.sourceMap?.path ?? null,
        stack: Array.isArray(parsed.stack) ? parsed.stack : [],
      });

      writeJsonResponse(response, 200, {
        stack,
      });
      return;
    }

    if (devtools && (await devtools.handleRequest(request, response))) {
      return;
    }

    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found\n");
  });
  server.on("upgrade", (request, socket, head) => {
    if (devtools?.handleUpgrade(request, socket, head)) {
      return;
    }

    if (!messageChannel.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await listen(server, host, strictPort ? port : 0);

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const displayHost = resolveDisplayHost(host, options.publicHost);
  const baseUrl = `http://${displayHost}:${String(actualPort)}`;
  const hostUri = `${displayHost}:${String(actualPort)}`;

  devtools = createDevtools({
    broadcast: (method, params) => messageChannel.broadcast(method, params),
    projectRoot,
    serverBaseUrl: baseUrl,
    symbolicate: (stack) =>
      symbolicateStack({
        projectRoot,
        sourceMapPath: bundle.sourceMap?.path ?? null,
        stack,
      }),
  });

  return {
    bundleUrl: `${baseUrl}${bundleUrlPath}`,
    close: async () => {
      await devtools?.close();
      messageChannel.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    eventsSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/events`,
    expoGoUrl: `exp://${hostUri}`,
    fastRefresh: false,
    hmr: "reload",
    host,
    hostUri,
    inspectorProxyUrl: devtools.inspectorProxyUrl,
    manifestUrl: `${baseUrl}/manifest`,
    messageSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/message`,
    metro: false,
    nativeRuntime: true,
    platform: options.platform,
    port: actualPort,
    projectRoot,
    server,
    sourceMapUrl: bundle.sourceMap ? `${baseUrl}${sourceMapUrlPath}` : null,
    url: baseUrl,
  };
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
  const server = await createViteServer({
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
