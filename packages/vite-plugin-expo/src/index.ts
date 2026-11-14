import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  build,
  createServer as createViteServer,
  type InlineConfig,
  type Plugin,
  type ViteDevServer,
} from "@voidzero-dev/vite-plus-core";
import {
  collectAssetGroup,
  createAssetServerUrl,
  isSupportedAssetFile,
} from "@vifx/asset-registry";
import { VifxError } from "@vifx/errors";
import { invalidateResolverPath, resolveProjectImportSpecifier } from "@vifx/platform-resolver";
import { symbolicateStackFrame } from "@vifx/source-map-tools";
import {
  extractMetroStagingUserSlices,
  mergeWithVifx,
  prepareUserViteConfig,
} from "@vifx/vite-config-bridge";
import {
  buildModuleRegistryBundle,
  buildVifxPluginPipeline,
  computeHmrUpdate,
  createReactNativeTransformCache,
  reactNative,
  resolveBuildMinify,
  resolveBundleMode,
  resolveOutputOptions,
  VIFX_HMR_STATE_GLOBAL,
  VIFX_HMR_URL_GLOBAL,
} from "@vifx/vite-plugin-react-native";
import type { TransformCache } from "@vifx/vite-plugin-react-native";
import type {
  VifxBuildAssetArtifact,
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxCycleCacheStats,
  VifxDiagnosticData,
  VifxExpoPluginOptions,
  VifxJsonObject,
  VifxJsonValue,
  VifxPlatform,
  VifxRebuildPhaseTimings,
  VifxRebuildReport,
  VifxSerializedModule,
} from "@vifx/types";
import {
  createDevClientLaunchUrl,
  negotiateManifestResponse,
  resolveDevClientScheme,
} from "./dev-client.ts";
import { resolveExpoAppConfig } from "./app-config.ts";
import { summarizeBuildError } from "./build-error.ts";
import { DEV_BUNDLE_SCOPE, startExpoDevEngine, type ExpoDevEngine } from "./dev-engine.ts";
import { createDevtools, type VifxExpoDevtools } from "./devtools.ts";
import { createHotChannel, createHotErrorPayload, type VifxHotClient } from "./hot.ts";
import { createBundleWatcher } from "./watch.ts";
import { createExpoGoMessageChannel } from "./websocket.ts";

export {
  createDevClientLaunchUrl,
  negotiateManifestResponse,
  resolveDevClientScheme,
} from "./dev-client.ts";
export type { ManifestNegotiationRequest, NegotiatedManifestResponse } from "./dev-client.ts";
export {
  EXPO_DYNAMIC_CONFIG_NAMES,
  EXPO_STATIC_CONFIG_NAMES,
  resolveExpoAppConfig,
  type ResolveExpoAppConfigOptions,
  type ResolvedExpoAppConfig,
} from "./app-config.ts";

const EXPO_APP_CONFIG_NAMES = [
  "app.json",
  "app.config.json",
  "app.config.ts",
  "app.config.mts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
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

export interface StartExpoDevServerOptions extends Omit<VifxExpoPluginOptions, "platform"> {
  host?: string;
  platform: VifxBundlePlatform;
  port?: number;
  publicHost?: string;
  /**
   * Called after each dev-server rebuild with its report. Reserved for the
   * instrumentation workstream; nothing invokes it yet.
   * (`transformCacheInstance`/`userViteConfig`/`publicEnv` are already inherited
   * from {@link VifxExpoPluginOptions}.)
   */
  onRebuild?: (report: VifxRebuildReport) => void;
  /**
   * A `console.*` call made by a connected app, forwarded over `/hot` (what
   * Metro prints as `LOG` / `WARN` / `ERROR` lines). Each argument arrives
   * already formatted as a string.
   */
  onClientLog?: (log: { data: string[]; level: string }) => void;
  /** User Vite/Rollup plugins to append. Reserved for the plugin workstream. */
  userPlugins?: Plugin[];
  /** Use the incremental rebuild path. Reserved for the HMR PoC workstream. */
  incremental?: boolean;
  /**
   * Development, default (`hoisted`) format: serve through Rolldown's
   * incremental dev engine — a save is compiled into a Fast Refresh patch
   * instead of a full rebuild. On by default; `false` (or `VIFX_DEV_ENGINE=0`)
   * keeps the rebuild-and-reload loop. The server also falls back to that loop
   * by itself if the engine cannot start.
   */
  devEngine?: boolean;
  /**
   * Resolve as soon as the server listens, building the first bundle in the
   * background (requests wait for it), like `expo start`. Off by default: the
   * start then resolves once the first bundle is built and rejects if it fails.
   */
  lazyStart?: boolean;
}

/**
 * Reserved seam for the Expo Go rebuild closure. `onPhase` (instrumentation) and
 * `incremental` (HMR PoC) are inert today; the closure ignores them so each
 * rebuild behaves exactly as before.
 */
interface ExpoGoRebuildContext {
  onPhase?: (phase: "rebuild" | "apply", ms: number) => void;
  incremental?: boolean;
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
  broadcast?: (method: string, params?: Record<string, unknown>) => void;
  bundleUrl: string;
  close: () => Promise<void>;
  devClientUrl?: string;
  eventsSocketUrl: string;
  expoGoUrl: string;
  fastRefresh: boolean;
  hmr: "fast-refresh" | "reload";
  host: string;
  hostUri: string;
  hotSocketUrl?: string;
  inspectorProxyUrl?: string;
  manifestUrl: string;
  messageSocketUrl: string;
  metro: boolean;
  nativeRuntime: true;
  platform: VifxBundlePlatform;
  port: number;
  projectRoot: string;
  server: HttpServer;
  sourceMapUrl: string | null;
  url: string;
  watching: boolean;
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
  // Static AND dynamic configs (`app.config.js` / `.ts`), resolved the way Expo
  // CLI resolves them; see app-config.ts.
  const { exp, packageJson } = await resolveExpoAppConfig({ appConfigPath, projectRoot });
  return { exp, packageJson };
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
    // Real react-native-web AppRegistry, not a __VIFX_WEB_RUNTIME__ shim. The
    // native-module globals above must be installed before react-native-web is
    // evaluated, so AppRegistry is pulled in with a dynamic import (after the
    // entry) rather than a hoisted static import. The entry registers its root
    // via expo's registerRootComponent (appKey "main") and already calls
    // runApplication when a document is present; we re-run it defensively against
    // the dev root element. The RNW compat AppRegistry memoizes the last mounted
    // appKey/rootTag, so this is a no-op when the entry already mounted.
    `await import(${JSON.stringify(entrySpecifier)});`,
    "",
    `const rootTag = typeof document !== 'undefined' ? document.getElementById(${JSON.stringify(EXPO_DEV_ROOT_ELEMENT_ID)}) : null;`,
    "if (rootTag) {",
    '  const { AppRegistry } = await import("react-native");',
    '  AppRegistry.runApplication("main", { rootTag });',
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
  const resolvePlatform = options.resolvePlatform ?? options.platform;
  const shimExpoPackage = options.reactNativeCompat === "web" || resolvePlatform === "web";

  return [
    {
      name: "vifx:expo",
      enforce: "pre",
      async config() {
        const appConfigPath = await findExpoAppConfig(projectRoot, options.appConfigPath);

        // Only the Expo-specific define lives here. Public env (`EXPO_PUBLIC_*`)
        // and the mode/platform defines come from the single source of truth:
        // the reactNative plugin's config hook (`resolveDefines`), reached via
        // the `reactNative({ ...options })` spread below. This keeps one define
        // table for native and web (ADR-005 / native+web unification).
        return {
          define: {
            __EXPO_APP_CONFIG_PATH__: JSON.stringify(path.relative(projectRoot, appConfigPath)),
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
      onWarning: warnDuplicateAssetScale,
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

/**
 * Import specifiers for the framework modules the generated entry needs. The
 * entry is a generated file outside any package, so a module that is only a
 * dependency of `react-native` / `expo` (isolated installs, e.g. pnpm) is
 * imported by absolute path; hoisted installs keep the bare specifier.
 */
function resolveProjectImportSpecifiers(projectRoot: string, specifiers: string[]) {
  return specifiers
    .map((specifier) => resolveProjectImportSpecifier(projectRoot, specifier))
    .filter((specifier): specifier is string => specifier !== null);
}

async function createExpoBuildInputEntry(projectRoot: string, outDir: string, entry: string) {
  const inputPath = path.join(outDir, "__vifx_expo_entry__.js");
  const importSpecifier = isPathLikeSpecifier(entry)
    ? `./${relativeFrom(path.dirname(inputPath), path.resolve(projectRoot, entry))}`
    : entry;
  // React Native's own polyfill list (`@react-native/js-polyfills`), in its
  // order. `console` routes console.* to the native log (Xcode, logcat) and
  // marks it as polyfilled, which is what makes React Native forward logs to
  // the dev server; without it they only reach an attached debugger.
  const preludeSpecifiers = resolveProjectImportSpecifiers(projectRoot, [
    "@react-native/js-polyfills/console",
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

/**
 * Surfaces a user-Vite-config diagnostic on stderr with the shared `[vifx]`
 * prefix. Only fires when a user `vite.config.vifx.*` collides with a vifx-owned
 * key, so the no-user-config path stays silent (and the bundle byte-identical).
 */
function warnUserViteConfigDiagnostic(diagnostic: VifxDiagnosticData): void {
  const hint = diagnostic.hint ? ` ${diagnostic.hint}` : "";
  console.warn(`[vifx] ${diagnostic.message}${hint}`);
}

/**
 * Surfaces an asset-group duplicate-scale conflict as a warning on stderr.
 * Mirrors Metro, which keeps one variant per scale and continues rather than
 * aborting the build. Wired into `collectAssetGroup` so the dedupe is visible.
 */
function warnDuplicateAssetScale(warning: { message: string }): void {
  console.warn(`[vifx] ${warning.message}`);
}

export async function buildExpoBundle(
  options: VifxExpoPluginOptions & { existingModuleIds?: ReadonlyMap<string, number> },
): Promise<VifxBundleArtifacts> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const entry = options.entry ?? "./index.js";
  const outDir = options.outDir ?? `.vifx/expo/${options.platform}`;
  const absoluteOutDir = path.resolve(projectRoot, outDir);
  const resolvePlatform = options.resolvePlatform ?? options.platform;

  // Load the user `vite.config.vifx.*` once. On the metro path only the safe
  // slices (plugins + filtered resolve/define) are injected; the staging
  // `build.rollupOptions.output` stays vifx-owned. A `resolveRequest` hook is a
  // function, so it rides the config in-process (never the CLI subprocess); the
  // explicit option wins, else the config-declared hook is threaded into the RN
  // plugin via the `expo({...})` spreads below.
  const {
    userResult,
    diagnostics,
    resolveRequest: configResolveRequest,
  } = await prepareUserViteConfig({
    projectRoot,
    configFile: options.userViteConfig,
    command: "build",
    mode: resolveBundleMode(options),
    resolvePlatform,
  });
  const userResolveRequest = options.userResolveRequest ?? configResolveRequest ?? undefined;
  for (const diagnostic of diagnostics) {
    warnUserViteConfigDiagnostic(diagnostic);
  }

  if ((options.moduleFormat ?? "hoisted") === "metro") {
    // Development metro bundles ship the Fast Refresh prelude + the explicit
    // setUpReactRefresh import, and thread the previous build's id map so module
    // ids stay stable across rebuilds (required for /hot deltas to patch the
    // right module). Production metro bundles get neither.
    const metroMode = resolveBundleMode(options);
    // Inject an explicit transform cache so this layer can read snapshotDelta()
    // for the per-cycle hit-rate. Build it with the RN factory so its version
    // key (and on-disk entries/invalidation) is byte-identical to the cache the
    // build would otherwise create on its own — the bundle output is unchanged.
    // A caller-supplied instance (e.g. across rebuilds) wins so the same cache
    // observes every cycle. transformCache:false opts out (no instance, no
    // delta), matching the non-instrumented path.
    const transformCache: TransformCache | undefined =
      options.transformCache === false
        ? undefined
        : ((options.transformCacheInstance as TransformCache | undefined) ??
          createReactNativeTransformCache(projectRoot));
    const stagingSlices = extractMetroStagingUserSlices(userResult, {
      resolvePlatform,
      warn: warnUserViteConfigDiagnostic,
    });
    const registry = await buildModuleRegistryBundle({
      absoluteOutDir,
      entry,
      existingModuleIds: options.existingModuleIds,
      hmr: metroMode !== "production",
      plugins: buildVifxPluginPipeline({
        basePlugins: [
          ...expo({
            ...options,
            entry,
            projectRoot,
            transformCacheInstance: transformCache,
            userResolveRequest,
          }),
        ],
        mode: metroMode,
        includeIndirectEval: false,
        userPlugins: stagingSlices?.userPlugins,
      }),
      projectRoot,
      ...(stagingSlices?.resolve === undefined && stagingSlices?.define === undefined
        ? {}
        : {
            userInlineConfig: {
              ...(stagingSlices?.resolve === undefined ? {} : { resolve: stagingSlices.resolve }),
              ...(stagingSlices?.define === undefined ? {} : { define: stagingSlices.define }),
            },
          }),
    });
    const appConfigPath = await findExpoAppConfig(projectRoot, options.appConfigPath).catch(
      () => undefined,
    );
    const bundleStats = await stat(registry.bundlePath);
    const assets = await collectEmittedExpoAssets({
      absoluteOutDir,
      projectRoot,
    });

    // The per-cycle delta (this rebuild only); cumulative stats() would converge
    // to ~100% on a warm cache and hide what one save actually recomputed.
    const cacheStats: VifxCycleCacheStats | undefined = transformCache?.snapshotDelta();
    const rebuildTimings: VifxRebuildPhaseTimings | undefined = registry.timings
      ? {
          transformMs: registry.timings.transformMs,
          serializeMs: registry.timings.serializeMs,
          writeMs: registry.timings.writeMs,
          totalMs:
            registry.timings.transformMs + registry.timings.serializeMs + registry.timings.writeMs,
        }
      : undefined;

    return {
      appConfigPath: appConfigPath ? relativeFrom(projectRoot, appConfigPath) : undefined,
      assets,
      bundle: {
        path: relativeFrom(projectRoot, registry.bundlePath),
        sizeBytes: bundleStats.size,
      },
      // On the dev metro path cacheStats carries the PER-CYCLE delta (this
      // rebuild only): hits/misses for the cycle, writes = entries computed.
      // The report layer re-derives the VifxCycleCacheStats (with hitRate) from
      // it. errors aren't part of the cycle delta, so they read as 0 here.
      cacheStats: cacheStats
        ? {
            hits: cacheStats.hits,
            misses: cacheStats.misses,
            writes: cacheStats.computed,
            errors: 0,
          }
        : undefined,
      rebuildTimings,
      entry,
      mode: "expo",
      moduleGraph: {
        moduleIds: registry.moduleIds,
        modules: registry.modules,
      },
      platform: options.platform,
      projectRoot,
      runtime: null,
      sourceMap: await readSourceMapArtifact(projectRoot, registry.sourceMapPath),
    };
  }

  await build(
    await createHoistedExpoViteConfig({
      absoluteOutDir,
      entry,
      options,
      outDir,
      projectRoot,
      resolvePlatform,
      userResolveRequest,
      userResult,
    }),
  );

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

/**
 * Resolves the scope-hoisted build's Vite config from plugin options alone
 * (user config loading included), for the dev engine.
 */
async function resolveHoistedExpoViteConfig(
  options: VifxExpoPluginOptions,
): Promise<{ absoluteOutDir: string; viteConfig: InlineConfig }> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const entry = options.entry ?? "./index.js";
  const outDir = options.outDir ?? `.vifx/expo/${options.platform}`;
  const absoluteOutDir = path.resolve(projectRoot, outDir);
  const resolvePlatform = options.resolvePlatform ?? options.platform;
  const {
    userResult,
    diagnostics,
    resolveRequest: configResolveRequest,
  } = await prepareUserViteConfig({
    projectRoot,
    configFile: options.userViteConfig,
    command: "build",
    mode: resolveBundleMode(options),
    resolvePlatform,
  });
  for (const diagnostic of diagnostics) {
    warnUserViteConfigDiagnostic(diagnostic);
  }

  return {
    absoluteOutDir,
    viteConfig: await createHoistedExpoViteConfig({
      absoluteOutDir,
      entry,
      options,
      outDir,
      projectRoot,
      resolvePlatform,
      userResolveRequest: options.userResolveRequest ?? configResolveRequest ?? undefined,
      userResult,
    }),
  };
}

/**
 * The Vite config of the scope-hoisted Expo native bundle (the default
 * format), with the user's `vite.config.vifx.*` merged in. Shared by the
 * one-shot build and by the dev engine, so both bundle through the very same
 * plugins and options.
 */
async function createHoistedExpoViteConfig(input: {
  absoluteOutDir: string;
  entry: string;
  options: VifxExpoPluginOptions;
  outDir: string;
  projectRoot: string;
  resolvePlatform: VifxPlatform;
  userResolveRequest: VifxExpoPluginOptions["userResolveRequest"];
  userResult: Awaited<ReturnType<typeof prepareUserViteConfig>>["userResult"];
}): Promise<InlineConfig> {
  const { absoluteOutDir, entry, options, outDir, projectRoot, resolvePlatform } = input;
  const { userResolveRequest, userResult } = input;
  const inputEntry = await createExpoBuildInputEntry(projectRoot, absoluteOutDir, entry);

  // Production parity for the Expo native bundle path. Development keeps the
  // validated Expo Go corridor output (scope-hoisted ESM, no minify); production
  // (e.g. `vifx export:embed --dev false`) minifies with Oxc and emits a single
  // IIFE script, matching buildReactNativeBundle. The __DEV__/NODE_ENV/EXPO_OS
  // defines are already mode-aware through the reactNative plugin's config hook.
  const mode = resolveBundleMode(options);
  const outputOptions =
    mode === "production"
      ? resolveOutputOptions({
          mode,
          moduleFormat: "hoisted",
          platform: options.platform,
        })
      : { entryFileNames: "index.bundle", format: "es" as const, ...DEV_BUNDLE_SCOPE };

  const hoistedConfig: InlineConfig = {
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      emptyOutDir: true,
      minify: resolveBuildMinify(mode),
      outDir,
      rollupOptions: {
        input: inputEntry,
        output: {
          assetFileNames: "assets/[name][extname]",
          chunkFileNames: "chunks/[name].js",
          ...outputOptions,
        },
      },
      sourcemap: true,
      target: "es2020",
      write: true,
    },
    configFile: false,
    envFile: false,
    logLevel: "silent",
    // The hoisted release path keeps the indirect-eval rewrite in production;
    // see buildVifxPluginPipeline. The user config (plugins + allowed keys) is
    // merged via mergeWithVifx, which keeps vifx physically first and re-imposes
    // the reserved keys.
    plugins: buildVifxPluginPipeline({
      basePlugins: [
        ...expo({
          ...options,
          entry,
          projectRoot,
          userResolveRequest,
        }),
      ],
      mode,
      includeIndirectEval: true,
    }),
    publicDir: false,
    root: projectRoot,
  };

  return mergeWithVifx(userResult, hoistedConfig, {
    resolvePlatform,
    warn: warnUserViteConfigDiagnostic,
  });
}

/**
 * Composes one rebuild report from freshly built artifacts. `rebuildTimings`
 * (transform+serialize+write) come from the metro build; `applyMs` is the
 * HMR diff/broadcast span measured by the caller. `artifacts.cacheStats` on the
 * dev metro path is the PER-CYCLE delta (see buildExpoBundle), so we re-derive
 * `VifxCycleCacheStats` (with hitRate) from it. `changedPaths` is omitted by
 * design (the watcher does not propagate it).
 */
export function composeRebuildReport(input: {
  artifacts: VifxBundleArtifacts;
  applyMs: number;
  cycle: number;
  hmr: VifxRebuildReport["hmr"];
}): VifxRebuildReport {
  const { artifacts, applyMs, cycle, hmr } = input;
  const timings = artifacts.rebuildTimings;
  const transformMs = timings?.transformMs ?? 0;
  const serializeMs = timings?.serializeMs ?? 0;
  const writeMs = timings?.writeMs ?? 0;
  const phases: VifxRebuildPhaseTimings = {
    transformMs,
    serializeMs,
    writeMs,
    applyMs,
    totalMs: transformMs + serializeMs + writeMs + applyMs,
  };

  let cache: VifxCycleCacheStats | undefined;
  if (artifacts.cacheStats) {
    const { hits, misses, writes } = artifacts.cacheStats;
    const lookups = hits + misses;
    cache = {
      hits,
      misses,
      computed: writes,
      hitRate: lookups === 0 ? 0 : hits / lookups,
    };
  }

  return {
    cycle,
    phases,
    ...(cache ? { cache } : {}),
    moduleCount: artifacts.moduleGraph?.modules.length,
    hmr,
  };
}

interface ExpoGoServedBundle {
  assets: VifxBuildAssetArtifact[];
  bundleSource: string;
  sourceMapPath: string | null;
  sourceMapText: string | null;
}

/**
 * Snapshots freshly built bundle artifacts into memory so requests keep being
 * served from the last good build while `emptyOutDir` wipes the output
 * directory during rebuilds.
 */
async function loadExpoGoServedBundle(
  projectRoot: string,
  artifacts: VifxBundleArtifacts,
): Promise<ExpoGoServedBundle> {
  const bundleSource = await readFile(path.resolve(projectRoot, artifacts.bundle.path), "utf8");
  const sourceMapPath = artifacts.sourceMap?.path ?? null;
  const sourceMapText = sourceMapPath
    ? await readFile(path.resolve(projectRoot, sourceMapPath), "utf8").catch(() => null)
    : null;

  return {
    assets: artifacts.assets,
    bundleSource,
    sourceMapPath,
    sourceMapText,
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

/** AppRegistry's `Running "main" with {...}` line (both wordings RN has used). */
const APP_REGISTRY_STARTUP_LOG = /^Running (?:application )?"[^"]*" with /u;

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
  const outDir = options.outDir ?? `.vifx/expo-go/${options.platform}`;
  // One persistent transform cache shared by the initial build and every
  // rebuild, so snapshotDelta() observes each save cycle in isolation. Built
  // with the canonical version key, so output stays byte-identical to the
  // non-injected path; transformCache:false opts out (no per-cycle hit-rate).
  const transformCacheInstance =
    options.transformCache === false
      ? undefined
      : ((options.transformCacheInstance as TransformCache | undefined) ??
        createReactNativeTransformCache(projectRoot, {
          // The rebuild-everything loop asks for every module on each save;
          // the dev engine only ever re-transforms what changed.
          memory:
            (options.moduleFormat ?? "hoisted") !== "hoisted" ||
            options.devEngine === false ||
            process.env.VIFX_DEV_ENGINE === "0",
        }));
  const bundleOptions: VifxExpoPluginOptions = {
    ...options,
    entry,
    outDir,
    projectRoot,
    publicEnvPrefix: options.publicEnvPrefix,
    reactNativeCompat: "none",
    resolvePlatform: options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? false,
    shimReact: options.shimReact ?? false,
    shimReactNative: options.shimReactNative ?? false,
    transformCacheInstance,
  };
  const absoluteOutDir = path.resolve(projectRoot, outDir);
  const isDevelopment = resolveBundleMode(bundleOptions) !== "production";
  const isHoistedFormat = (bundleOptions.moduleFormat ?? "hoisted") === "hoisted";
  const messageChannel = createExpoGoMessageChannel();
  let rebuildCycle = 0;
  // When the project watcher last saw a file change; lets the dev engine's
  // update report say how long the save took to reach the app.
  let lastChangeSeenAt = 0;

  // Dev engine (development, default format): each app introduces itself on
  // `/hot`, receives the patches compiled for it and acknowledges them.
  let engine: ExpoDevEngine | null = null;
  const engineClientIds = new Map<VifxHotClient, string>();
  const engineClients = new Map<string, VifxHotClient>();
  const hotChannel = createHotChannel({
    onDisconnect(client) {
      const clientId = engineClientIds.get(client);
      if (clientId !== undefined) {
        engineClientIds.delete(client);
        engineClients.delete(clientId);
        engine?.removeClient(clientId);
      }
    },
    onMessage(client, message) {
      if (typeof message !== "object" || message === null) {
        return;
      }
      const {
        clientId,
        data,
        filename,
        level,
        message: failure,
        reason,
        rerun,
        seq,
        session,
        type,
      } = message as Record<string, unknown>;
      if (type === "log" && typeof level === "string" && Array.isArray(data)) {
        const items = data.map((item) => (typeof item === "string" ? item : String(item)));
        // React Native announces every start with the whole launch payload
        // (the manifest included): noise, which Expo CLI drops as well.
        if (items.length === 1 && APP_REGISTRY_STARTUP_LOG.test(items[0] ?? "")) {
          return;
        }
        options.onClientLog?.({ data: items, level });
        return;
      }
      if (type === "vifx:hello" && typeof clientId === "string") {
        // An app that was already running reconnects as soon as the server
        // listens, which is before its first build is done: answer it then.
        void firstBuild.attempt.then(
          () => {
            if (engine === null || !hotChannel.isConnected(client)) {
              return;
            }
            // A patch is a delta from "every save so far". An app whose bundle
            // came from another server process, or that missed a save while
            // its socket was down, cannot be patched: it gets the current
            // bundle.
            const staleReason =
              session !== engineSession.id
                ? "The dev server restarted"
                : seq !== engineSession.seq
                  ? "The app missed an update while it was disconnected"
                  : null;
            if (staleReason !== null) {
              hotChannel.sendTo(client, { body: { reason: staleReason }, type: "vifx:reload" });
              return;
            }
            engineClientIds.set(client, clientId);
            engineClients.set(clientId, client);
            engine.registerClient(clientId);
          },
          () => undefined,
        );
        return;
      }
      if (engine === null) {
        return;
      }
      if (type === "vifx:delivered" && typeof filename === "string") {
        engine.notifyPatchDelivered(filename);
        settleEngineUpdate({
          hmr: "fast-refresh",
          ...(typeof rerun === "number" ? { moduleCount: rerun } : {}),
        });
      } else if (type === "vifx:reload" && typeof reason === "string") {
        // The app could not apply its patch in place and is reloading itself.
        if (!settleEngineUpdate({ hmr: "reload", reason })) {
          reportEngineUpdate({ hmr: "reload", reason });
        }
      } else if (type === "vifx:failed" && typeof failure === "string") {
        settleEngineUpdate({ error: failure, hmr: "error" });
      }
    },
  });

  type EngineUpdateReport = Pick<
    VifxRebuildReport,
    "changedPaths" | "error" | "hmr" | "moduleCount" | "reason"
  >;

  // The save whose patch is on its way to the apps. It is reported once an app
  // says what it did with it (applied, reloaded, failed), so the line shows
  // the outcome and the time until the edit was on screen; an app that never
  // answers must not hold the report back for long.
  // Identifies this server process and counts the saves its engine processed:
  // written into every served bundle, sent back by the app on `/hot`.
  const engineSession = { id: randomUUID(), seq: 0 };
  const ENGINE_UPDATE_ACK_TIMEOUT_MS = 1500;
  // Set from an engine callback, read from the next one: hence a holder.
  const engineReload: { reason: string | null } = { reason: null };
  let pendingEngineUpdate: { changedPaths: string[]; timer: NodeJS.Timeout } | null = null;
  const settleEngineUpdate = (report: EngineUpdateReport): boolean => {
    if (pendingEngineUpdate === null) {
      return false;
    }
    const { changedPaths, timer } = pendingEngineUpdate;
    pendingEngineUpdate = null;
    clearTimeout(timer);
    reportEngineUpdate({ changedPaths, ...report });
    return true;
  };
  const awaitEngineUpdateOutcome = (changedPaths: string[]) => {
    settleEngineUpdate({ hmr: "fast-refresh" });
    const timer = setTimeout(() => {
      settleEngineUpdate({ hmr: "fast-refresh" });
    }, ENGINE_UPDATE_ACK_TIMEOUT_MS);
    timer.unref();
    pendingEngineUpdate = { changedPaths, timer };
  };

  const reportEngineUpdate = (report: EngineUpdateReport) => {
    rebuildCycle += 1;
    const elapsedMs = performance.now() - lastChangeSeenAt;
    // Only a save seen moments ago is attributed to this update.
    const totalMs = lastChangeSeenAt > 0 && elapsedMs < 2000 ? elapsedMs : 0;
    options.onRebuild?.({
      cycle: rebuildCycle,
      engine: true,
      phases: { transformMs: totalMs, serializeMs: 0, writeMs: 0, totalMs },
      ...report,
    });
  };

  const devEngineWanted =
    isDevelopment &&
    isHoistedFormat &&
    options.devEngine !== false &&
    process.env.VIFX_DEV_ENGINE !== "0";

  // State of the first build. The server listens before it exists (see the
  // end of this function); requests wait on `readiness`.
  let servedBundle!: ExpoGoServedBundle;
  let servedEngineVersion = 0;
  let servedEngineAssetsVersion = 0;
  // The engine's assets live beside its output directory, not in it: Rolldown
  // empties the output on every build (see StartExpoDevEngineOptions).
  const engineAssetsRoot = `${absoluteOutDir}.assets`;
  let prevModuleIds: ReadonlyMap<string, number> | undefined;
  let prevModules: readonly VifxSerializedModule[] = [];
  let ready = false;
  let lastEngineError: string | null = null;
  // The first build. Requests wait on `attempt`; a build that fails because
  // the project does not compile yet is tried again on the next save (see the
  // watcher), which is why the promise is replaceable.
  const firstBuild: { attempt: Promise<void>; failed: boolean } = {
    attempt: Promise.resolve(),
    failed: false,
  };
  const reportFirstBuildFailure = (error: unknown): void => {
    console.error(
      `[vifx] The Expo Go bundle failed to build; it will be built again on the next save.\n${summarizeBuildError(error)}`,
    );
  };
  const startFirstBuild = (): Promise<void> => {
    firstBuild.failed = false;
    const attempt = initialize();
    firstBuild.attempt = attempt;
    // Observed by each request; never an unhandled rejection on its own.
    attempt.catch(() => {
      firstBuild.failed = true;
    });
    return attempt;
  };

  const initialize = async (): Promise<void> => {
    // Why the engine could not start, if it could not: only worth a warning
    // once the classic build shows the project itself compiles.
    let engineStartError: unknown = null;
    if (devEngineWanted) {
      try {
        // The engine's watcher reports real paths. Module ids must be real
        // paths too, or a project reached through a symlink (macOS's /tmp, a
        // linked workspace) would never see its own edits.
        const engineProjectRoot = await realpath(projectRoot).catch(() => projectRoot);
        const engineBuild = await resolveHoistedExpoViteConfig({
          ...bundleOptions,
          fastRefresh: true,
          projectRoot: engineProjectRoot,
          reuseResolverCaches: true,
        });
        engine = await startExpoDevEngine({
          assetsRoot: engineAssetsRoot,
          bundleFileName: "index.bundle",
          onChange: (changedFiles) => {
            lastEngineError = null;
            // The patches of this save (already sent, see onPatch) carry seq + 1.
            engineSession.seq += 1;
            const changedPaths = changedFiles.map((file) =>
              toPosixPath(path.relative(engineProjectRoot, file)),
            );
            // Metro-shaped envelope around the change, for anything listening.
            hotChannel.broadcastUpdateStart();
            const reloadReason = engineReload.reason;
            engineReload.reason = null;
            if (reloadReason !== null) {
              // The engine itself ruled the edit out of Fast Refresh and the
              // apps were told to reload (see onReloadRequired).
              reportEngineUpdate({ changedPaths, hmr: "reload", reason: reloadReason });
              hotChannel.broadcastUpdateDone();
              return;
            }
            if (engineClients.size > 0) {
              // Each connected app has been sent its patch (see onPatch).
              awaitEngineUpdateOutcome(changedPaths);
              hotChannel.broadcastUpdateDone();
              return;
            }
            // No app introduced itself to the engine (one that runs an older
            // bundle, or cannot apply patches): it can only be brought up to
            // date by reloading, once the bundle includes the change.
            void refreshEngineBundle().then(() => {
              messageChannel.broadcast("reload");
              reportEngineUpdate({
                changedPaths,
                hmr: "reload",
                reason: "No app is connected for Fast Refresh",
              });
              hotChannel.broadcastUpdateDone();
            });
          },
          onError: (error) => {
            // The patch and the bundle rebuild both trip over the same broken
            // module: report it once.
            if (error.message === lastEngineError) {
              return;
            }
            lastEngineError = error.message;
            hotChannel.broadcastError(createHotErrorPayload(error));
            // Once, where the caller wants it: its report, else the console.
            const summary = summarizeBuildError(error);
            if (options.onRebuild) {
              reportEngineUpdate({ error: summary, hmr: "error" });
            } else {
              console.error(
                `[vifx] Expo Go update failed; still serving the last good bundle.\n${summary}`,
              );
            }
          },
          onPatch: (patch) => {
            const client = engineClients.get(patch.clientId);
            if (client) {
              hotChannel.sendTo(client, {
                body: {
                  changedIds: patch.changedIds,
                  code: patch.code,
                  filename: patch.filename,
                  // The save count the app is at once it has applied this.
                  seq: engineSession.seq + 1,
                  sourceURL: patch.filename,
                },
                type: "vifx:patch",
              });
            }
          },
          onReloadRequired: (_clientId, reason) => {
            // Reported with the save it belongs to (onChange runs right after).
            engineReload.reason = reason;
            messageChannel.broadcast("reload");
          },
          outputDir: engineBuild.absoluteOutDir,
          projectRoot: engineProjectRoot,
          viteConfig: engineBuild.viteConfig,
        });
      } catch (error) {
        // Never fatal: the classic build below either works (the engine is
        // what failed) or fails on the project's own error, reported once.
        engineStartError = error;
        engine = null;
      }
    }

    if (engine) {
      const first = await engine.getBundle();
      servedEngineVersion = first.version;
      servedEngineAssetsVersion = first.assetsVersion;
      servedBundle = {
        assets: await collectEmittedExpoAssets({ absoluteOutDir: engineAssetsRoot, projectRoot }),
        bundleSource: first.code,
        sourceMapPath: relativeFrom(projectRoot, path.join(absoluteOutDir, "index.bundle.map")),
        // Read from disk on demand: the engine rewrites it with every build.
        sourceMapText: null,
      };
    } else {
      const bundle = await buildExpoBundle(bundleOptions);
      if (engineStartError !== null) {
        console.warn(
          `[vifx] The incremental dev engine could not start; using full rebuilds instead.\n${summarizeBuildError(engineStartError)}`,
        );
      }
      servedBundle = await loadExpoGoServedBundle(projectRoot, bundle);
      prevModuleIds = bundle.moduleGraph?.moduleIds;
      prevModules = bundle.moduleGraph?.modules ?? [];
    }
    ready = true;
  };

  /** Engine mode: adopts the engine's latest bundle (rebuilding it if stale). */
  const refreshEngineBundle = async (): Promise<void> => {
    if (!engine) {
      return;
    }
    try {
      const latest = await engine.getBundle();
      if (latest.version === servedEngineVersion) {
        return;
      }
      servedBundle = {
        ...servedBundle,
        assets:
          latest.assetsVersion === servedEngineAssetsVersion
            ? servedBundle.assets
            : await collectEmittedExpoAssets({ absoluteOutDir: engineAssetsRoot, projectRoot }),
        bundleSource: latest.code,
      };
      servedEngineAssetsVersion = latest.assetsVersion;
      servedEngineVersion = latest.version;
      lastEngineError = null;
    } catch {
      // The build is broken (already reported): keep the last good bundle.
    }
  };

  // Registry Fast Refresh: a development metro-format bundle (bundle.moduleGraph
  // is populated), diffed and re-serialized on every save.
  const fastRefreshMode = !isHoistedFormat && isDevelopment;
  // Either Fast Refresh flavor needs the app to open the `/hot` socket.
  const isHotSocketEnabled = () => fastRefreshMode || engine !== null;
  let hmrRevision = 0;
  const bundleUrlPath = await createExpoGoBundleUrlPath({
    dev: resolveBundleMode(options) !== "production",
    exp,
    hermes: options.hermes,
    mainModuleName,
    platform: options.platform,
    projectRoot,
  });
  const sourceMapUrlPath = createExpoGoSourceMapUrlPath(bundleUrlPath);
  // Read per request: which of the two it is depends on how the build started.
  const emittedAssetsRoot = () => path.join(engine ? engineAssetsRoot : absoluteOutDir, "assets");
  let devtools: VifxExpoDevtools | null = null;

  // Extracted/renamed in the contracts commit so the instrumentation (timing +
  // report) and incremental-HMR workstreams plug into one stable entry point.
  // `_ctx` is the reserved seam (onPhase + incremental); `incremental` is still
  // inert (HMR PoC), `onPhase` is observed here for symmetry but the report is
  // the primary surface.
  const runExpoGoRebuild = async (_ctx: ExpoGoRebuildContext = {}): Promise<void> => {
    hotChannel.broadcastUpdateStart();
    rebuildCycle += 1;
    const cycle = rebuildCycle;

    try {
      const rebuildStartedAt = performance.now();
      const artifacts = await buildExpoBundle({
        ...bundleOptions,
        existingModuleIds: prevModuleIds,
        // The watcher below invalidates the resolver's view of every path it
        // reports, so a rebuild resolves from memory instead of the disk.
        reuseResolverCaches: true,
      });
      // buildExpoBundle's rebuildTimings already sums transform+serialize+write;
      // the wall span around the build is an upper bound on it. Use the measured
      // phase breakdown when present (metro path), else fall back to the wall.
      const rebuildMs = performance.now() - rebuildStartedAt;
      _ctx.onPhase?.("rebuild", rebuildMs);
      servedBundle = await loadExpoGoServedBundle(projectRoot, artifacts);

      // Time the HMR-apply block (diff + broadcast/reload) on its own so the
      // report can attribute applyMs distinctly from the rebuild phases.
      const applyStartedAt = performance.now();
      let hmr: VifxRebuildReport["hmr"] = "reload";
      // In Fast Refresh mode the metro build always populates moduleGraph; the
      // else is the hoisted/non-FR path. Advance prev state together with the
      // diff so it can never desync from servedBundle.
      if (fastRefreshMode && artifacts.moduleGraph) {
        const nextModules = artifacts.moduleGraph.modules;
        hmrRevision += 1;
        const update = computeHmrUpdate({
          next: nextModules,
          previous: prevModules,
          revisionId: String(hmrRevision),
          // The file name becomes the eval source URL, so hot-patched modules
          // get readable stack frames instead of anonymous eval frames.
          sourceUrlFor: (module) => ({ sourceMappingURL: null, sourceURL: module.fileName }),
        });
        prevModules = nextModules;
        prevModuleIds = artifacts.moduleGraph.moduleIds;
        // A deleted module can't be hot-applied; fall back to a full reload.
        if (update.deleted.length > 0) {
          messageChannel.broadcast("reload");
          hmr = "reload";
        } else {
          hotChannel.broadcastUpdate(update);
          hmr = "fast-refresh";
        }
      } else {
        messageChannel.broadcast("reload");
        hmr = "reload";
      }
      hotChannel.broadcastUpdateDone();
      const applyMs = performance.now() - applyStartedAt;
      _ctx.onPhase?.("apply", applyMs);

      // Compose the rebuild report and hand it to the caller (CLI prints it /
      // emits NDJSON). changedPaths is omitted: the watcher does not propagate
      // it into this closure (kept out of watch.ts by design).
      options.onRebuild?.(
        composeRebuildReport({
          artifacts,
          applyMs,
          cycle,
          hmr,
        }),
      );
    } catch (error) {
      hotChannel.broadcastError(createHotErrorPayload(error));
      console.error(
        "[vifx] Expo Go rebuild failed; still serving the last good bundle.",
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      options.onRebuild?.({
        cycle,
        phases: { transformMs: 0, serializeMs: 0, writeMs: 0, totalMs: 0 },
        hmr: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

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

    if (requestUrl.pathname === "/status") {
      // Answered while the first bundle is still building: the packager is up.
      writeTextResponse(response, 200, "packager-status:running", "text/plain; charset=utf-8");
      return;
    }

    try {
      await firstBuild.attempt;
    } catch (error) {
      writeTextResponse(
        response,
        500,
        `vifx could not build the bundle.\n${summarizeBuildError(error)}\n`,
        "text/plain; charset=utf-8",
      );
      return;
    }

    if (isManifestPath(requestUrl.pathname)) {
      await refreshEngineBundle();
      const negotiated = negotiateManifestResponse({
        manifestJson: buildManifest({
          bundleUrl,
          assets: servedBundle.assets,
          exp,
          hostUri,
          mainModuleName,
          packageJson,
          platform: options.platform,
          projectRoot,
        }),
        request: { headers: request.headers },
      });
      response.writeHead(negotiated.status, negotiated.headers);
      response.end(negotiated.body);
      return;
    }

    if (isBundlePath(requestUrl.pathname)) {
      // In Fast Refresh mode, set the /hot socket URL the injected HMR client
      // reads (hmr-client.ts stays inert without it). Prepend with NO trailing
      // newline so the prelude stays on line 0 and the line-keyed source map is
      // unchanged; the hoisted path serves bytes verbatim.
      await refreshEngineBundle();
      const hotState = engine
        ? `globalThis.${VIFX_HMR_STATE_GLOBAL}=${JSON.stringify({ seq: engineSession.seq, session: engineSession.id })};`
        : "";
      const bundleSource = isHotSocketEnabled()
        ? `globalThis.${VIFX_HMR_URL_GLOBAL}=${JSON.stringify(`ws://${hostUri}/hot`)};${hotState}${servedBundle.bundleSource}`
        : servedBundle.bundleSource;
      writeTextResponse(response, 200, bundleSource, "application/javascript; charset=utf-8");
      return;
    }

    if (isSourceMapPath(requestUrl.pathname)) {
      // Engine mode keeps the map on disk (rewritten with each build) instead
      // of holding a second multi-megabyte string in memory.
      const sourceMapText =
        servedBundle.sourceMapText ??
        (engine && servedBundle.sourceMapPath
          ? await readFile(path.resolve(projectRoot, servedBundle.sourceMapPath), "utf8").catch(
              () => null,
            )
          : null);
      if (sourceMapText !== null) {
        writeTextResponse(response, 200, sourceMapText, "application/json; charset=utf-8");
        return;
      }
    }

    if (requestUrl.pathname.startsWith("/assets/")) {
      const assetPath = await resolveServedAssetPath({
        emittedAssetsRoot: emittedAssetsRoot(),
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
        sourceMapPath: servedBundle.sourceMapPath,
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
    if (hotChannel.handleUpgrade(request, socket, head)) {
      return;
    }

    if (devtools?.handleUpgrade(request, socket, head)) {
      return;
    }

    if (!messageChannel.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  const watcher = await createBundleWatcher({
    // Short window: a save is one or two events, and changes that land while a
    // rebuild is running are coalesced into the next one anyway.
    debounceMs: 50,
    // The engine's asset store sits beside the output directory.
    ignore: [outDir, `${outDir}.assets`],
    onEvent: (event) => {
      if (event.type === "change") {
        // Any event may be a file appearing or disappearing (editors save by
        // rename), so the resolver re-reads that directory on the next build.
        const changedPath = path.resolve(projectRoot, event.filePath);
        invalidateResolverPath(changedPath);
        lastChangeSeenAt = performance.now();
        // An asset is not a module the engine can patch: rebuild and reload.
        if (engine && isSupportedAssetFile(changedPath)) {
          void engine
            .requestFullBuild()
            .then(() => messageChannel.broadcast("reload"))
            .catch(() => undefined);
        }
      }
      if (event.type === "watch-error") {
        console.error(
          "[vifx] Expo Go file watching is unavailable; automatic reloads are disabled.",
          event.error instanceof Error ? event.error.message : event.error,
        );
      }
    },
    projectRoot,
    // The dev engine watches the module graph itself; this watcher then only
    // keeps the resolver's view of the disk current (see onEvent).
    // Nothing to rebuild either until the first bundle exists.
    rebuild: async () => {
      if (!ready) {
        // The project did not compile when the server started: now that a
        // file changed, build again, and bring in the apps that were waiting.
        if (firstBuild.failed) {
          await startFirstBuild().then(
            () => {
              messageChannel.broadcast("reload");
            },
            (error: unknown) => {
              reportFirstBuildFailure(error);
            },
          );
        }
        return;
      }
      if (engine === null) {
        await runExpoGoRebuild();
        return;
      }

      // Engine mode: the engine watches the module graph and reports each
      // save itself (see `onChange` above); nothing to do from here.
    },
  });

  await listen(server, host, strictPort ? port : 0);

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const displayHost = resolveDisplayHost(host, options.publicHost);
  const baseUrl = `http://${displayHost}:${String(actualPort)}`;
  const hostUri = `${displayHost}:${String(actualPort)}`;
  const manifestUrl = `${baseUrl}/manifest`;
  const devClientScheme = resolveDevClientScheme(exp);

  devtools = createDevtools({
    broadcast: (method, params) => messageChannel.broadcast(method, params),
    projectRoot,
    serverBaseUrl: baseUrl,
    symbolicate: (stack) =>
      symbolicateStack({
        projectRoot,
        sourceMapPath: ready ? servedBundle.sourceMapPath : null,
        stack,
      }),
  });

  const close = async () => {
    await devtools?.close();
    await watcher.close();
    await engine?.close();
    await hotChannel.close();
    messageChannel.closeAll();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  // The server already answers `/status`; every other request waits for the
  // first bundle. With `lazyStart` the caller gets its URLs right away (like
  // `expo start`) and a failed build is reported on the terminal and to the
  // requests that waited for it. Otherwise the build is awaited here and its
  // failure rejects the start, as it always has.
  const initialized = startFirstBuild();
  if (options.lazyStart === true) {
    initialized.catch(reportFirstBuildFailure);
  } else {
    try {
      await initialized;
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  }
  // Fast Refresh is known for sure once the first build is done; before that,
  // it is what this configuration will use unless the engine cannot start.
  const fastRefreshEnabled = ready ? isHotSocketEnabled() : fastRefreshMode || devEngineWanted;

  return {
    broadcast: (method: string, params?: Record<string, unknown>) => {
      messageChannel.broadcast(method, params as VifxJsonValue | undefined);
    },
    bundleUrl: `${baseUrl}${bundleUrlPath}`,
    close,
    ...(devClientScheme === null
      ? {}
      : { devClientUrl: createDevClientLaunchUrl({ manifestUrl, scheme: devClientScheme }) }),
    eventsSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/events`,
    expoGoUrl: `exp://${hostUri}`,
    fastRefresh: fastRefreshEnabled,
    hmr: fastRefreshEnabled ? "fast-refresh" : "reload",
    host,
    hostUri,
    hotSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/hot`,
    inspectorProxyUrl: devtools.inspectorProxyUrl,
    manifestUrl,
    messageSocketUrl: `${baseUrl.replace(/^http:/u, "ws:")}/message`,
    metro: fastRefreshMode,
    nativeRuntime: true,
    platform: options.platform,
    port: actualPort,
    projectRoot,
    server,
    sourceMapUrl: !ready || servedBundle.sourceMapPath ? `${baseUrl}${sourceMapUrlPath}` : null,
    url: baseUrl,
    watching: watcher.watching,
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

  // The web dev server resolves as `web`, so the bridge allows user
  // `optimizeDeps`/`server` keys; `mergeWithVifx` is a no-op without a user
  // config. The `server` binding is re-applied AFTER the merge because vifx owns
  // the host/port/strictPort the CLI resolved (a user `server` block must not
  // change where we listen).
  const {
    userResult,
    diagnostics,
    resolveRequest: configResolveRequest,
  } = await prepareUserViteConfig({
    projectRoot,
    configFile: options.userViteConfig,
    command: "serve",
    mode: resolveBundleMode(options),
    resolvePlatform: "web",
  });
  const userResolveRequest = options.userResolveRequest ?? configResolveRequest ?? undefined;
  for (const diagnostic of diagnostics) {
    warnUserViteConfigDiagnostic(diagnostic);
  }

  const serverConfig: InlineConfig = {
    appType: "custom",
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: buildVifxPluginPipeline({
      basePlugins: [
        expoDevRuntimePlugin(projectRoot, entry),
        ...expo({
          ...options,
          entry,
          platform: options.platform,
          projectRoot,
          reactNativeCompat: "web",
          resolvePlatform: "web",
          userResolveRequest,
        }),
      ],
      mode: resolveBundleMode(options),
      includeIndirectEval: false,
    }),
    publicDir: false,
    root: projectRoot,
  };

  const mergedServerConfig = mergeWithVifx(userResult, serverConfig, {
    resolvePlatform: "web",
    warn: warnUserViteConfigDiagnostic,
  });
  mergedServerConfig.server = {
    ...mergedServerConfig.server,
    host,
    port,
    strictPort,
  };
  const server = await createViteServer(mergedServerConfig);

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

export {
  createHotChannel,
  createHotErrorPayload,
  type VifxHotChannel,
  type VifxHotErrorDescription,
  type VifxHotErrorPayload,
  type VifxHotMessage,
  type VifxHotModule,
  type VifxHotUpdate,
} from "./hot.ts";
export {
  createBundleWatcher,
  type CreateBundleWatcherOptions,
  type VifxBundleWatcher,
  type VifxBundleWatcherEvent,
} from "./watch.ts";
