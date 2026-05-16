import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  build,
  transformWithEsbuild,
  type InlineConfig,
  type Plugin,
  type TransformResult,
} from "vite";
import {
  collectAssetGroup,
  isSupportedAssetFile,
  supportedAssetExtensions,
} from "@vifx/asset-registry";
import { VifxError } from "@vifx/errors";
import { compileHermesBytecode } from "@vifx/hermes-tools";
import { resolveReactNativeModule } from "@vifx/platform-resolver";
import { validateSourceMap } from "@vifx/source-map-tools";
import type {
  VifxBuildAssetArtifact,
  VifxBundleArtifacts,
  VifxPlatform,
  VifxReactNativePluginOptions,
  VifxWebRuntimeArtifact,
} from "@vifx/types";

const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js", "json"] as const;
const COMPAT_PREFIX = "\0vifx:compat:";
const EXPO_ROUTER_ENTRY_ID = "expo-router/entry";
const EXPO_ROUTER_CONTEXT_ID = "expo-router/_ctx";
const EXPO_ROUTER_QUALIFIED_ENTRY_ID = "expo-router/build/qualified-entry";
const EXPO_STATUS_BAR_MODULE_ID = "expo-status-bar/src/StatusBar";
const EXPO_WINTER_URL_ID = "expo/src/winter/url";
const REANIMATED_VALIDATE_WORKLETS_VERSION_ID =
  "react-native-reanimated/scripts/validate-worklets-version";
const SHIM_PREFIX = "\0vifx:shim:";
const TRANSFORM_PREFIX = "\0vifx:transformed:";
const WEB_RUNTIME_BUNDLE_FILE = "bundle.js";
const WEB_RUNTIME_BROWSER_GLOBALS_KEY = "__VIFX_BROWSER_GLOBALS__";
const WEB_RUNTIME_HTML_FILE = "index.html";
const WEB_RUNTIME_ROOT_ELEMENT_ID = "root";
const WEB_RUNTIME_SCRIPT_FILE = "runtime.js";
const WEB_COMPAT_SPECIFIERS = new Set([
  "react-native",
  "react-native/Libraries/BatchedBridge/NativeModules",
  "react-native/Libraries/Core/Devtools/getDevServer",
  "react-native/Libraries/EventEmitter/NativeEventEmitter",
  "react-native/Libraries/NativeModules/specs/NativeSourceCode",
  "react-native/Libraries/Network/FormData",
  "react-native/Libraries/TurboModule/TurboModuleRegistry",
  "react-native/Libraries/Utilities/HMRClient",
]);
const EXPO_MODULES_CORE_DANGEROUS_INTERNAL_ID = "expo-modules-core/src/polyfill/dangerous-internal";
const EXPO_ROUTER_FILE_EXTENSION_PATTERN = /\.[jt]sx?$/u;
const EXPO_ROUTER_PLATFORM_EXTENSIONS = new Set(["android", "ios", "native", "web"]);
const projectBabelRuntimeCache = new Map<string, Promise<ProjectBabelRuntime | null>>();

interface ReactNativePluginState {
  aliases: Record<string, string>;
  assetExtensions: string[];
  assetFiles: Set<string>;
  babelInPackages: string[];
  conditions: string[];
  entry: string;
  extensions: string[];
  jsxInPackages: string[];
  platform: VifxReactNativePluginOptions["platform"];
  projectRoot: string;
  reactNativeCompat: NonNullable<VifxReactNativePluginOptions["reactNativeCompat"]>;
  resolvePlatform: VifxPlatform;
  shimJsxRuntime: boolean;
  shimReact: boolean;
  shimReactNative: boolean;
}

interface ProjectBabelRuntime {
  presetPath: string;
  transformAsync: (
    code: string,
    options: Record<string, unknown>,
  ) => Promise<{
    code?: string | null;
    map?: unknown;
  } | null>;
}

interface ExpoRouterContextEntry {
  contextKey: string;
  resolvedFilePath: string;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

function dedupe(items: readonly string[]) {
  return [...new Set(items)];
}

function normalizeAssetExtensions(extensions?: string[]) {
  return dedupe((extensions ?? [...supportedAssetExtensions]).map((extension) => extension.trim()));
}

function normalizeConditions(platform: VifxPlatform, extraConditions?: string[]) {
  if (platform === "web") {
    return dedupe(["browser", "web", ...(extraConditions ?? []), "import", "default"]);
  }

  return dedupe(["react-native", platform, ...(extraConditions ?? []), "import", "default"]);
}

function normalizeExtensions(extensions?: string[]) {
  return dedupe((extensions ?? [...DEFAULT_EXTENSIONS]).map((extension) => extension.trim()));
}

function stripQuery(filePath: string) {
  return filePath.replace(/[?#].*$/u, "");
}

function isPathLikeSpecifier(specifier: string) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("../") ||
    specifier.startsWith("./")
  );
}

function createShimId(name: string) {
  return `${SHIM_PREFIX}${name}`;
}

function createCompatId(name: string) {
  return `${COMPAT_PREFIX}${name}`;
}

function createTransformId(filePath: string) {
  return `${TRANSFORM_PREFIX}${filePath}`;
}

function resolveCompatId(
  source: string,
  state: Pick<ReactNativePluginState, "reactNativeCompat" | "resolvePlatform">,
) {
  if (state.reactNativeCompat === "web" && WEB_COMPAT_SPECIFIERS.has(source)) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_ROUTER_CONTEXT_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_WINTER_URL_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === REANIMATED_VALIDATE_WORKLETS_VERSION_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_ROUTER_ENTRY_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_ROUTER_QUALIFIED_ENTRY_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === "@expo/metro-runtime") {
    return createCompatId(source);
  }

  return null;
}

function resolveCompatPath(
  filePath: string,
  state: Pick<ReactNativePluginState, "reactNativeCompat">,
) {
  if (state.reactNativeCompat !== "web") {
    return null;
  }

  const normalizedPath = toPosixPath(stripQuery(filePath));
  if (
    normalizedPath.endsWith("/node_modules/expo-router/_ctx.js") ||
    normalizedPath.endsWith("/node_modules/expo-router/_ctx.web.js")
  ) {
    return createCompatId(EXPO_ROUTER_CONTEXT_ID);
  }

  if (normalizedPath.endsWith("/node_modules/expo-status-bar/src/StatusBar.ts")) {
    return createCompatId(EXPO_STATUS_BAR_MODULE_ID);
  }

  if (normalizedPath.endsWith("/node_modules/expo/src/winter/url.ts")) {
    return createCompatId(EXPO_WINTER_URL_ID);
  }

  if (
    normalizedPath.endsWith(
      "/node_modules/react-native-reanimated/scripts/validate-worklets-version.js",
    )
  ) {
    return createCompatId(REANIMATED_VALIDATE_WORKLETS_VERSION_ID);
  }

  if (
    normalizedPath.endsWith("/node_modules/expo-router/entry.js") ||
    normalizedPath.endsWith("/node_modules/expo-router/entry-classic.js")
  ) {
    return createCompatId(EXPO_ROUTER_ENTRY_ID);
  }

  if (normalizedPath.endsWith("/node_modules/expo-router/build/qualified-entry.js")) {
    return createCompatId(EXPO_ROUTER_QUALIFIED_ENTRY_ID);
  }

  if (
    normalizedPath.endsWith("/node_modules/expo-modules-core/src/polyfill/dangerous-internal.ts")
  ) {
    return createCompatId(EXPO_MODULES_CORE_DANGEROUS_INTERNAL_ID);
  }

  return null;
}

function resolveShimId(
  source: string,
  state: Pick<ReactNativePluginState, "shimJsxRuntime" | "shimReact" | "shimReactNative">,
) {
  switch (source) {
    case "react":
      return state.shimReact ? createShimId(source) : null;
    case "react-native":
      return state.shimReactNative ? createShimId(source) : null;
    case "react/jsx-dev-runtime":
    case "react/jsx-runtime":
      return state.shimJsxRuntime ? createShimId(source) : null;
    default:
      return null;
  }
}

function renderShim(id: string, platform: VifxReactNativePluginOptions["platform"]) {
  const shimName = id.slice(SHIM_PREFIX.length);

  switch (shimName) {
    case "react":
      return [
        "export const Fragment = Symbol.for('react.fragment');",
        "export function createElement(type, props, ...children) {",
        "  return { type, props: { ...(props ?? {}), children } };",
        "}",
        "const React = { Fragment, createElement };",
        "export default React;",
      ].join("\n");
    case "react/jsx-runtime":
    case "react/jsx-dev-runtime":
      return [
        "export const Fragment = Symbol.for('react.fragment');",
        "export function jsx(type, props) {",
        "  return { type, props: props ?? {} };",
        "}",
        "export const jsxs = jsx;",
        "export const jsxDEV = jsx;",
      ].join("\n");
    case "react-native":
      return [
        "export const AppRegistry = {",
        "  registerComponent(name, loader) {",
        "    return { loader, name };",
        "  },",
        "};",
        `export const Platform = { OS: ${JSON.stringify(platform)}, select(value) {`,
        `  return value?.[${JSON.stringify(platform)}] ?? value?.native ?? value?.default ?? null;`,
        "} };",
        "const ReactNative = { AppRegistry, Platform };",
        "export default ReactNative;",
      ].join("\n");
    default:
      return null;
  }
}

function parseExpoRouterFileName(fileName: string) {
  const extensionMatch = fileName.match(EXPO_ROUTER_FILE_EXTENSION_PATTERN);
  if (!extensionMatch) {
    return null;
  }

  const scriptExtension = extensionMatch[0];
  const baseNameWithMaybePlatform = fileName.slice(0, -scriptExtension.length);
  const segments = baseNameWithMaybePlatform.split(".");
  const maybePlatform = segments.at(-1);

  if (maybePlatform && EXPO_ROUTER_PLATFORM_EXTENSIONS.has(maybePlatform)) {
    return {
      baseName: segments.slice(0, -1).join("."),
      platform: maybePlatform,
      scriptExtension,
    };
  }

  return {
    baseName: baseNameWithMaybePlatform,
    platform: null,
    scriptExtension,
  };
}

function shouldIgnoreExpoRouterFile(relativePath: string) {
  const normalizedPath = toPosixPath(relativePath);
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? normalizedPath;

  if (!EXPO_ROUTER_FILE_EXTENSION_PATTERN.test(fileName)) {
    return true;
  }

  if (/\+api(?:\.[^.]+)?\.[jt]sx?$/u.test(fileName)) {
    return true;
  }

  if (/^\+middleware\.[jt]sx?$/u.test(fileName)) {
    return true;
  }

  if (segments.length === 1 && /^\+(html|native-intent)\.[jt]sx?$/u.test(fileName)) {
    return true;
  }

  return false;
}

function selectExpoRouterRouteFile(
  candidates: Array<{ platform: string | null; resolvedFilePath: string }>,
  platform: VifxPlatform,
) {
  const exactMatch = candidates.find((candidate) => candidate.platform === platform);
  if (exactMatch) {
    return exactMatch;
  }

  if (platform !== "web") {
    const nativeMatch = candidates.find((candidate) => candidate.platform === "native");
    if (nativeMatch) {
      return nativeMatch;
    }
  }

  return candidates.find((candidate) => candidate.platform === null) ?? null;
}

async function resolveExpoRouterAppRoot(projectRoot: string) {
  for (const candidate of ["app", "src/app"]) {
    if (await pathExists(path.join(projectRoot, candidate))) {
      return candidate;
    }
  }

  return "app";
}

async function collectExpoRouterSourceFiles(appRootDir: string) {
  const collectedFilePaths: string[] = [];

  if (!(await pathExists(appRootDir))) {
    return collectedFilePaths;
  }

  async function visitDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visitDirectory(entryPath);
        continue;
      }

      if (entry.isFile()) {
        collectedFilePaths.push(entryPath);
      }
    }
  }

  await visitDirectory(appRootDir);
  return collectedFilePaths;
}

async function buildExpoRouterContextEntries(options: {
  platform: VifxPlatform;
  projectRoot: string;
}): Promise<ExpoRouterContextEntry[]> {
  const appRootRelative = await resolveExpoRouterAppRoot(options.projectRoot);
  const appRootDir = path.join(options.projectRoot, appRootRelative);
  const sourceFilePaths = await collectExpoRouterSourceFiles(appRootDir);
  const routeCandidates = new Map<
    string,
    Array<{
      platform: string | null;
      resolvedFilePath: string;
    }>
  >();

  for (const sourceFilePath of sourceFilePaths) {
    const relativePath = relativeFrom(appRootDir, sourceFilePath);
    if (shouldIgnoreExpoRouterFile(relativePath)) {
      continue;
    }

    const directory = path.posix.dirname(relativePath);
    const parsedFileName = parseExpoRouterFileName(path.posix.basename(relativePath));
    if (!parsedFileName) {
      continue;
    }

    const normalizedRelativePath =
      directory === "."
        ? `${parsedFileName.baseName}${parsedFileName.scriptExtension}`
        : `${directory}/${parsedFileName.baseName}${parsedFileName.scriptExtension}`;
    const contextKey = `./${normalizedRelativePath}`;
    const existingCandidates = routeCandidates.get(contextKey) ?? [];

    existingCandidates.push({
      platform: parsedFileName.platform,
      resolvedFilePath: sourceFilePath,
    });
    routeCandidates.set(contextKey, existingCandidates);
  }

  const resolvedEntries: ExpoRouterContextEntry[] = [];
  for (const [contextKey, candidates] of [...routeCandidates.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const selectedCandidate = selectExpoRouterRouteFile(candidates, options.platform);
    if (!selectedCandidate) {
      continue;
    }

    resolvedEntries.push({
      contextKey,
      resolvedFilePath: selectedCandidate.resolvedFilePath,
    });
  }

  return resolvedEntries;
}

async function renderExpoRouterContext(
  state: Pick<ReactNativePluginState, "platform" | "projectRoot">,
) {
  const entries = await buildExpoRouterContextEntries({
    platform: state.platform,
    projectRoot: state.projectRoot,
  });
  const importLines = entries.map((entry, index) => {
    return `import * as routeModule${index} from ${JSON.stringify(entry.resolvedFilePath)};`;
  });
  const moduleMapLines = entries.map((entry, index) => {
    return `  ${JSON.stringify(entry.contextKey)}: routeModule${index},`;
  });

  return [
    ...importLines,
    "",
    "const modules = {",
    ...moduleMapLines,
    "};",
    "",
    "function requireContext(key) {",
    "  const moduleValue = modules[key];",
    "  if (!moduleValue) {",
    '    throw new Error(`Cannot find route module "${key}" in the Vifx Expo Router context.`);',
    "  }",
    "",
    "  return moduleValue;",
    "}",
    "",
    "export const ctx = Object.assign(requireContext, {",
    "  id: 'vifx-expo-router-context',",
    "  keys() {",
    "    return Object.keys(modules);",
    "  },",
    "  resolve(key) {",
    "    if (!(key in modules)) {",
    '      throw new Error(`Cannot resolve route module "${key}" in the Vifx Expo Router context.`);',
    "    }",
    "",
    "    return key;",
    "  },",
    "  __add() {},",
    "  __delete() {},",
    "});",
    "",
  ].join("\n");
}

async function renderCompat(
  id: string,
  state: Pick<ReactNativePluginState, "platform" | "projectRoot">,
) {
  const compatName = id.slice(COMPAT_PREFIX.length);

  switch (compatName) {
    case "react-native":
      return [
        'import * as ReactNativeWeb from "react-native-web";',
        "",
        'export * from "react-native-web";',
        "const baseAppRegistry = ReactNativeWeb.AppRegistry;",
        "",
        "function getRuntimeState() {",
        "  const existingState = globalThis.__VIFX_WEB_RUNTIME__;",
        "  if (existingState) {",
        "    return existingState;",
        "  }",
        "",
        "  const state = {",
        "    lastMountedAppKey: null,",
        "    lastRegisteredAppKey: null,",
        "    mountedRootElementId: null,",
        "    registeredAppKeys: [],",
        "    mount(rootElementId = 'root') {",
        "      const appKey =",
        "        state.lastRegisteredAppKey ?? state.registeredAppKeys[state.registeredAppKeys.length - 1] ?? null;",
        "",
        "      if (!appKey) {",
        '        throw new Error("No React Native app was registered during the Vifx runtime bootstrap.");',
        "      }",
        "",
        "      if (typeof document === 'undefined') {",
        '        throw new Error("The Vifx web runtime requires a browser document.");',
        "      }",
        "",
        "      const rootTag = document.getElementById(rootElementId);",
        "      if (!rootTag) {",
        '        throw new Error(`Required HTML element with id "${rootElementId}" was not found.`);',
        "      }",
        "",
        "      if (state.lastMountedAppKey === appKey && state.mountedRootElementId === rootElementId) {",
        "        return appKey;",
        "      }",
        "",
        "      AppRegistry.runApplication(appKey, { rootTag });",
        "      return appKey;",
        "    },",
        "  };",
        "",
        "  globalThis.__VIFX_WEB_RUNTIME__ = state;",
        "  return state;",
        "}",
        "",
        "const runtimeState = getRuntimeState();",
        "",
        "function rememberAppKey(appKey) {",
        "  if (!runtimeState.registeredAppKeys.includes(appKey)) {",
        "    runtimeState.registeredAppKeys.push(appKey);",
        "  }",
        "",
        "  runtimeState.lastRegisteredAppKey = appKey;",
        "  return appKey;",
        "}",
        "",
        "export const AppRegistry = {",
        "  getAppKeys() {",
        "    return baseAppRegistry.getAppKeys();",
        "  },",
        "  getApplication(appKey, appParameters) {",
        "    return baseAppRegistry.getApplication(appKey, appParameters);",
        "  },",
        "  registerComponent(appKey, componentProvider) {",
        "    rememberAppKey(appKey);",
        "    return baseAppRegistry.registerComponent(appKey, componentProvider);",
        "  },",
        "  registerConfig(config) {",
        "    for (const entry of config ?? []) {",
        "      if (entry?.appKey) {",
        "        rememberAppKey(entry.appKey);",
        "      }",
        "    }",
        "",
        "    return baseAppRegistry.registerConfig(config);",
        "  },",
        "  registerRunnable(appKey, run) {",
        "    rememberAppKey(appKey);",
        "    return baseAppRegistry.registerRunnable(appKey, run);",
        "  },",
        "  runApplication(appKey, appParameters) {",
        "    rememberAppKey(appKey);",
        "    runtimeState.lastMountedAppKey = appKey;",
        "    runtimeState.mountedRootElementId = appParameters?.rootTag?.id ?? null;",
        "    return baseAppRegistry.runApplication(appKey, appParameters);",
        "  },",
        "  setComponentProviderInstrumentationHook(hook) {",
        "    return baseAppRegistry.setComponentProviderInstrumentationHook(hook);",
        "  },",
        "  setWrapperComponentProvider(provider) {",
        "    return baseAppRegistry.setWrapperComponentProvider(provider);",
        "  },",
        "  unmountApplicationComponentAtRootTag(rootTag) {",
        "    return baseAppRegistry.unmountApplicationComponentAtRootTag(rootTag);",
        "  },",
        "};",
        "",
        "export const BackHandler = {",
        "  addEventListener() {",
        "    return {",
        "      remove() {},",
        "    };",
        "  },",
        "  exitApp() {},",
        "  removeEventListener() {},",
        "};",
        "",
        "const NativeUnimoduleProxy = {",
        "  callMethod() {",
        "    return Promise.resolve(undefined);",
        "  },",
        "  exportedMethods: {},",
        "  modulesConstants: {},",
        "};",
        "",
        "export const NativeModules = {",
        "  ...(ReactNativeWeb.NativeModules ?? {}),",
        "  NativeUnimoduleProxy,",
        "};",
        "",
        "export const TurboModuleRegistry = {",
        "  get() {",
        "    return null;",
        "  },",
        "  getEnforcing() {",
        "    return {};",
        "  },",
        "};",
        "",
        "export const Networking = {};",
        "",
        "export function useAnimatedValue(initialValue) {",
        "  return {",
        "    __vifxAnimatedValue: initialValue,",
        "    setValue() {},",
        "  };",
        "}",
        "",
        "const ReactNativeCompat = {",
        "  ...ReactNativeWeb,",
        "  AppRegistry,",
        "  BackHandler,",
        "  NativeModules,",
        "  Networking,",
        "  TurboModuleRegistry,",
        "  useAnimatedValue,",
        "};",
        "",
        "export default ReactNativeCompat;",
      ].join("\n");
    case "react-native/Libraries/BatchedBridge/NativeModules":
      return [
        'import { NativeModules as ReactNativeWebNativeModules } from "react-native-web";',
        "",
        "export const NativeModules = globalThis.nativeModuleProxy ?? ReactNativeWebNativeModules ?? {};",
        "export default NativeModules;",
      ].join("\n");
    case "react-native/Libraries/Core/Devtools/getDevServer":
      return [
        "export default function getDevServer() {",
        "  if (typeof window !== 'undefined') {",
        "    return {",
        "      bundleLoadedFromServer: false,",
        "      url: window.location.origin,",
        "    };",
        "  }",
        "",
        "  return {",
        "    bundleLoadedFromServer: false,",
        "    url: '',",
        "  };",
        "}",
      ].join("\n");
    case "react-native/Libraries/EventEmitter/NativeEventEmitter":
      return [
        'import { NativeEventEmitter } from "react-native-web";',
        "",
        "export default NativeEventEmitter;",
      ].join("\n");
    case "react-native/Libraries/NativeModules/specs/NativeSourceCode":
      return [
        "export const SourceCode = {",
        "  getConstants() {",
        "    return {",
        "      scriptURL: typeof window !== 'undefined' ? window.location.href : '',",
        "    };",
        "  },",
        "};",
        "",
        "export default SourceCode;",
      ].join("\n");
    case "react-native/Libraries/Network/FormData":
      return [
        "const FormDataCompat = globalThis.FormData;",
        "",
        "export default FormDataCompat;",
      ].join("\n");
    case "react-native/Libraries/TurboModule/TurboModuleRegistry":
      return [
        "export function get() {",
        "  return null;",
        "}",
        "",
        "export function getEnforcing() {",
        "  return {};",
        "}",
        "",
        "const TurboModuleRegistry = {",
        "  get,",
        "  getEnforcing,",
        "};",
        "",
        "export default TurboModuleRegistry;",
      ].join("\n");
    case "react-native/Libraries/Utilities/HMRClient":
      return [
        "const HMRClient = {",
        "  disable() {},",
        "  enable() {},",
        "  hasError() {",
        "    return false;",
        "  },",
        "  isEnabled() {",
        "    return false;",
        "  },",
        "  registerBundle() {},",
        "  setup() {},",
        "};",
        "",
        "export default HMRClient;",
      ].join("\n");
    case "@expo/metro-runtime":
      return ["export {};", ""].join("\n");
    case EXPO_ROUTER_ENTRY_ID:
      return [
        'import React from "react";',
        'import { ExpoRoot } from "expo-router/build/ExpoRoot";',
        'import { Head } from "expo-router/build/head";',
        'import { renderRootComponent } from "expo-router/build/renderRootComponent";',
        'import { ctx } from "expo-router/_ctx";',
        "",
        "export function App() {",
        "  return React.createElement(",
        "    Head.Provider,",
        "    null,",
        "    React.createElement(ExpoRoot, { context: ctx }),",
        "  );",
        "}",
        "",
        "renderRootComponent(App);",
        "",
      ].join("\n");
    case EXPO_ROUTER_CONTEXT_ID:
      return await renderExpoRouterContext(state);
    case EXPO_ROUTER_QUALIFIED_ENTRY_ID:
      return [
        'import React from "react";',
        'import { ExpoRoot } from "expo-router/build/ExpoRoot";',
        'import { Head } from "expo-router/build/head";',
        'import { ctx } from "expo-router/_ctx";',
        "",
        "export function App() {",
        "  return React.createElement(",
        "    Head.Provider,",
        "    null,",
        "    React.createElement(ExpoRoot, { context: ctx }),",
        "  );",
        "}",
        "",
      ].join("\n");
    case EXPO_STATUS_BAR_MODULE_ID:
      return [
        `export { StatusBar, setStatusBarBackgroundColor, setStatusBarHidden, setStatusBarNetworkActivityIndicatorVisible, setStatusBarStyle, setStatusBarTranslucent } from ${JSON.stringify(path.join(state.projectRoot, "node_modules", "expo-status-bar", "src", "NativeStatusBarWrapper.tsx"))};`,
        "",
      ].join("\n");
    case EXPO_WINTER_URL_ID:
      return [
        `const browserGlobals = globalThis.${WEB_RUNTIME_BROWSER_GLOBALS_KEY} ?? {};`,
        "export const URL = browserGlobals.URL ?? globalThis.URL ?? (typeof window !== 'undefined' ? window.URL : undefined);",
        "export const URLSearchParams = browserGlobals.URLSearchParams ?? globalThis.URLSearchParams ?? (typeof window !== 'undefined' ? window.URLSearchParams : undefined);",
        "",
      ].join("\n");
    case REANIMATED_VALIDATE_WORKLETS_VERSION_ID:
      return [
        "export default function validateWorkletsVersion() {",
        "  return { ok: true };",
        "}",
        "",
      ].join("\n");
    case EXPO_MODULES_CORE_DANGEROUS_INTERNAL_ID:
      return [
        "class EventEmitter {",
        "  addListener() {",
        "    return {",
        "      remove() {},",
        "    };",
        "  }",
        "  emit() {}",
        "  listenerCount() {",
        "    return 0;",
        "  }",
        "  removeAllListeners() {}",
        "  removeListener() {}",
        "}",
        "",
        "class NativeModule {}",
        "class SharedObject {}",
        "class SharedRef {}",
        "",
        "function randomUuid(fallbackValue) {",
        "  return globalThis.crypto?.randomUUID?.() ?? fallbackValue;",
        "}",
        "",
        "export { EventEmitter, NativeModule, SharedObject, SharedRef };",
        "",
        "export function installExpoGlobalPolyfill() {",
        "  if (globalThis.expo) {",
        "    return;",
        "  }",
        "",
        "  globalThis.expo = {",
        "    EventEmitter,",
        "    NativeModule,",
        "    SharedObject,",
        "    SharedRef,",
        "    cacheDir: undefined,",
        "    documentsDir: undefined,",
        "    expoModulesCoreVersion: undefined,",
        "    getViewConfig() {",
        "      return null;",
        "    },",
        "    modules: globalThis.ExpoDomWebView?.expoModulesProxy ?? {},",
        "    async reloadAppAsync() {",
        "      if (typeof window !== 'undefined') {",
        "        window.location.reload();",
        "      }",
        "    },",
        "    uuidv4() {",
        "      return randomUuid('00000000-0000-4000-8000-000000000000');",
        "    },",
        "    uuidv5() {",
        "      return randomUuid('00000000-0000-5000-8000-000000000000');",
        "    },",
        "  };",
        "}",
      ].join("\n");
    default:
      return null;
  }
}

function normalizeAliases(aliases?: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(aliases ?? {}).sort(([left], [right]) => right.length - left.length),
  );
}

function normalizeJsxInPackages(packages?: string[]) {
  return dedupe((packages ?? []).map((value) => value.trim()).filter(Boolean));
}

function normalizeBabelInPackages(packages?: string[]) {
  return dedupe((packages ?? []).map((value) => value.trim()).filter(Boolean));
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function joinSpecifier(base: string, suffix: string) {
  if (suffix === "") {
    return base;
  }

  if (base.endsWith("/") || suffix.startsWith("/")) {
    return `${base}${suffix}`;
  }

  return `${base}/${suffix}`;
}

function applyAliases(source: string, aliases: Record<string, string>, projectRoot: string) {
  for (const [from, to] of Object.entries(aliases)) {
    if (source !== from && !source.startsWith(`${from}/`)) {
      continue;
    }

    const suffix = source === from ? "" : source.slice(from.length);
    const candidate = joinSpecifier(to, suffix);

    if (isPathLikeSpecifier(candidate)) {
      const absolutePath = path.resolve(projectRoot, candidate);
      const relativePath = relativeFrom(projectRoot, absolutePath);
      return relativePath === "." ? "./" : `./${relativePath}`;
    }

    return candidate;
  }

  return null;
}

function shouldTransformJsxFile(id: string, jsxInPackages: string[]) {
  if (!id.includes("/node_modules/") || !id.endsWith(".js")) {
    return false;
  }

  const normalizedId = toPosixPath(stripQuery(id));
  return jsxInPackages.some((packageName) =>
    normalizedId.includes(`/node_modules/${packageName}/`),
  );
}

function shouldTransformExpoPackageSource(
  id: string,
  state: Pick<ReactNativePluginState, "reactNativeCompat" | "resolvePlatform">,
) {
  if (state.reactNativeCompat !== "web" || state.resolvePlatform !== "web") {
    return false;
  }

  if (!id.includes("/node_modules/")) {
    return false;
  }

  const normalizedId = toPosixPath(stripQuery(id));
  if (!/\.(jsx?|tsx?)$/u.test(normalizedId)) {
    return false;
  }

  return (
    normalizedId.includes("/node_modules/expo/") ||
    normalizedId.includes("/node_modules/expo-") ||
    normalizedId.includes("/node_modules/@expo/")
  );
}

function inferEsbuildLoader(id: string) {
  const normalizedId = toPosixPath(stripQuery(id));

  if (normalizedId.endsWith(".tsx")) {
    return "tsx" as const;
  }

  if (normalizedId.endsWith(".ts")) {
    return "ts" as const;
  }

  if (normalizedId.endsWith(".jsx")) {
    return "jsx" as const;
  }

  return "jsx" as const;
}

function shouldTransformWithProjectBabel(id: string, babelInPackages: string[]) {
  if (!id.includes("/node_modules/")) {
    return false;
  }

  const normalizedId = toPosixPath(stripQuery(id));
  return babelInPackages.some((packageName) =>
    normalizedId.includes(`/node_modules/${packageName}/`),
  );
}

async function loadProjectBabelRuntime(projectRoot: string): Promise<ProjectBabelRuntime | null> {
  const cached = projectBabelRuntimeCache.get(projectRoot);
  if (cached) {
    return cached;
  }

  const runtimePromise = (async () => {
    try {
      const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
      const babel = requireFromProject("@babel/core") as {
        transformAsync?: ProjectBabelRuntime["transformAsync"];
      };

      if (typeof babel.transformAsync !== "function") {
        return null;
      }

      let presetPath: string;
      try {
        presetPath = requireFromProject.resolve("babel-preset-expo");
      } catch {
        presetPath = requireFromProject.resolve("@react-native/babel-preset");
      }

      return {
        presetPath,
        transformAsync: babel.transformAsync,
      } satisfies ProjectBabelRuntime;
    } catch {
      return null;
    }
  })();

  projectBabelRuntimeCache.set(projectRoot, runtimePromise);
  return runtimePromise;
}

function createReactNativePlugin(state: ReactNativePluginState): Plugin {
  return {
    name: "vifx:react-native",
    enforce: "pre",
    config() {
      return {
        assetsInclude: state.assetExtensions.map((extension) => `**/*.${extension}`),
        define: {
          __DEV__: "false",
          global: "globalThis",
        },
        resolve: {
          conditions: state.conditions,
        },
      };
    },
    async load(id) {
      if (id.startsWith(COMPAT_PREFIX)) {
        return await renderCompat(id, state);
      }

      if (id.startsWith(TRANSFORM_PREFIX)) {
        const originalId = id.slice(TRANSFORM_PREFIX.length);
        const loader = inferEsbuildLoader(originalId);
        const transformed = await transformWithEsbuild(
          await readFile(originalId, "utf8"),
          originalId,
          {
            jsx: loader === "jsx" || loader === "tsx" ? "automatic" : undefined,
            loader,
            sourcemap: true,
          },
        );

        return transformed.code;
      }

      const compatPathId = resolveCompatPath(id, state);
      if (compatPathId) {
        return await renderCompat(compatPathId, state);
      }

      if (!id.startsWith(SHIM_PREFIX)) {
        return null;
      }

      return renderShim(id, state.platform);
    },
    async transform(code, id, _options): Promise<TransformResult | null> {
      const compatPathId = resolveCompatPath(id, state);
      if (compatPathId) {
        const compatCode = await renderCompat(compatPathId, state);
        if (compatCode !== null) {
          return {
            code: compatCode,
            map: null,
          };
        }
      }

      if (shouldTransformWithProjectBabel(id, state.babelInPackages)) {
        const runtime = await loadProjectBabelRuntime(state.projectRoot);

        if (runtime) {
          const transformed = await runtime.transformAsync(code, {
            babelrc: false,
            configFile: false,
            filename: id,
            presets: [runtime.presetPath],
            sourceMaps: true,
          });

          if (transformed?.code) {
            return {
              code: transformed.code,
              map: (transformed.map as TransformResult["map"]) ?? null,
            };
          }
        }
      }

      if (
        !shouldTransformJsxFile(id, state.jsxInPackages) &&
        !shouldTransformExpoPackageSource(id, state)
      ) {
        return null;
      }

      const loader = inferEsbuildLoader(id);
      const transformed = await transformWithEsbuild(code, id, {
        jsx: loader === "jsx" || loader === "tsx" ? "automatic" : undefined,
        loader,
        sourcemap: true,
      });

      return {
        code: transformed.code,
        map: transformed.map ?? null,
      };
    },
    async resolveId(source, importer) {
      const aliasedSource = applyAliases(source, state.aliases, state.projectRoot);
      if (aliasedSource && aliasedSource !== source) {
        source = aliasedSource;
      }

      const compatId = resolveCompatId(source, state);
      if (compatId) {
        return compatId;
      }

      const shimId = resolveShimId(source, state);
      if (shimId) {
        return shimId;
      }

      if (
        source.startsWith(SHIM_PREFIX) ||
        source.startsWith("\0") ||
        source.startsWith("data:") ||
        source.startsWith("vite/")
      ) {
        return null;
      }

      const fromFile = importer
        ? importer.startsWith(TRANSFORM_PREFIX)
          ? stripQuery(importer.slice(TRANSFORM_PREFIX.length))
          : stripQuery(importer)
        : path.resolve(state.projectRoot, state.entry);

      try {
        const resolved = await resolveReactNativeModule({
          conditions: state.conditions,
          extensions: [...state.extensions, ...state.assetExtensions],
          fromFile,
          platform: state.resolvePlatform,
          projectRoot: state.projectRoot,
          specifier: source,
        });
        const resolvedPath = stripQuery(resolved.filePath);

        if (isSupportedAssetFile(resolvedPath, state.assetExtensions)) {
          state.assetFiles.add(resolvedPath);
        }

        const compatPathId = resolveCompatPath(resolvedPath, state);
        if (compatPathId) {
          return compatPathId;
        }

        if (
          shouldTransformJsxFile(resolvedPath, state.jsxInPackages) ||
          shouldTransformExpoPackageSource(resolvedPath, state)
        ) {
          return createTransformId(resolvedPath);
        }

        return resolvedPath;
      } catch {
        return null;
      }
    },
  };
}

async function collectBuildAssets(options: {
  assetFilePaths: string[];
  outDir: string;
  projectRoot: string;
}): Promise<VifxBuildAssetArtifact[]> {
  const assets: VifxBuildAssetArtifact[] = [];

  for (const sourceFilePath of options.assetFilePaths) {
    const descriptor = await collectAssetGroup({
      filePath: sourceFilePath,
      projectRoot: options.projectRoot,
    });
    const emittedFilePath = path.join(
      options.outDir,
      "assets",
      `${descriptor.name}.${descriptor.type}`,
    );
    const sizeBytes = (await stat(emittedFilePath)).size;

    assets.push({
      emittedPath: relativeFrom(options.projectRoot, emittedFilePath),
      hash: descriptor.hash,
      height: descriptor.height,
      httpServerLocation: descriptor.httpServerLocation,
      name: descriptor.name,
      scales: [...descriptor.scales],
      sizeBytes,
      sourceFilePath: relativeFrom(options.projectRoot, sourceFilePath),
      type: descriptor.type,
      width: descriptor.width,
    });
  }

  return assets.sort((left, right) => left.emittedPath.localeCompare(right.emittedPath));
}

async function buildSourceMapArtifact(projectRoot: string, sourceMapPath: string) {
  if (!(await pathExists(sourceMapPath))) {
    return null;
  }

  const validation = await validateSourceMap({ sourceMapPath });

  return {
    path: relativeFrom(projectRoot, sourceMapPath),
    sourceCount: validation.sourceCount,
    valid: validation.valid,
    warnings: validation.warnings,
  };
}

async function ensureBundleExists(bundlePath: string) {
  if (await pathExists(bundlePath)) {
    return;
  }

  throw new VifxError({
    code: "VIFX_VITE_BUNDLE_MISSING",
    message: `Expected a Vite bundle at "${bundlePath}".`,
    hint: "Ensure the entry file exists and the Vifx React Native plugin is installed in the Vite build.",
    docsPath: "/reference/packages#vifxvite-plugin-react-native",
  });
}

export function reactNative(options: VifxReactNativePluginOptions): Plugin {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const state: ReactNativePluginState = {
    aliases: normalizeAliases(options.aliases),
    assetExtensions: normalizeAssetExtensions(options.assetExtensions),
    assetFiles: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    conditions: normalizeConditions(
      options.resolvePlatform ?? options.platform,
      options.conditions,
    ),
    entry: options.entry ?? "./index.js",
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    platform: options.platform,
    projectRoot,
    reactNativeCompat: options.reactNativeCompat ?? "none",
    resolvePlatform: options.resolvePlatform ?? options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? true,
    shimReact: options.shimReact ?? true,
    shimReactNative: options.shimReactNative ?? true,
  };

  return createReactNativePlugin(state);
}

async function createBuildInputEntry(projectRoot: string, absoluteOutDir: string, entry: string) {
  const localEntryPath = path.resolve(projectRoot, entry);
  if (isPathLikeSpecifier(entry) || (await pathExists(localEntryPath))) {
    return localEntryPath;
  }

  const generatedEntryPath = path.join(
    path.dirname(absoluteOutDir),
    "__vifx-entry__",
    `${path.basename(absoluteOutDir)}.js`,
  );
  await mkdir(path.dirname(generatedEntryPath), { recursive: true });
  await writeFile(generatedEntryPath, `import ${JSON.stringify(entry)};\n`, "utf8");
  return generatedEntryPath;
}

async function resolveWebPreviewDependency(options: {
  conditions?: string[];
  extensions?: string[];
  fromFile: string;
  projectRoot: string;
  specifier: string;
}) {
  const resolved = await resolveReactNativeModule({
    conditions: normalizeConditions("web", options.conditions),
    extensions: normalizeExtensions(options.extensions),
    fromFile: options.fromFile,
    platform: "web",
    projectRoot: options.projectRoot,
    specifier: options.specifier,
  });

  return stripQuery(resolved.filePath);
}

async function createExpoRouterWebPreviewEntry(options: {
  conditions?: string[];
  extensions?: string[];
  outDir: string;
  platform: VifxReactNativePluginOptions["platform"];
  projectRoot: string;
}) {
  const generatedEntryDir = path.join(path.dirname(options.outDir), "__vifx-entry__");
  const generatedEntryPath = path.join(
    generatedEntryDir,
    `${path.basename(options.outDir)}-expo-router-preview.mjs`,
  );
  const generatedContextPath = path.join(
    generatedEntryDir,
    `${path.basename(options.outDir)}-expo-router-context.mjs`,
  );

  await mkdir(generatedEntryDir, { recursive: true });
  await writeFile(
    generatedContextPath,
    await renderExpoRouterContext({
      platform: options.platform,
      projectRoot: options.projectRoot,
    }),
    "utf8",
  );

  const reactPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    projectRoot: options.projectRoot,
    specifier: "react",
  });
  const expoRootPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    projectRoot: options.projectRoot,
    specifier: "expo-router/build/ExpoRoot",
  });
  const headPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    projectRoot: options.projectRoot,
    specifier: "expo-router/build/head",
  });
  const renderRootComponentPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    projectRoot: options.projectRoot,
    specifier: "expo-router/build/renderRootComponent",
  });

  await writeFile(
    generatedEntryPath,
    [
      `import React from ${JSON.stringify(reactPath)};`,
      `import { ExpoRoot } from ${JSON.stringify(expoRootPath)};`,
      `import { Head } from ${JSON.stringify(headPath)};`,
      `import { renderRootComponent } from ${JSON.stringify(renderRootComponentPath)};`,
      `import { ctx } from ${JSON.stringify(generatedContextPath)};`,
      "",
      "export function App() {",
      "  return React.createElement(",
      "    Head.Provider,",
      "    null,",
      "    React.createElement(ExpoRoot, { context: ctx }),",
      "  );",
      "}",
      "",
      "renderRootComponent(App);",
      "",
    ].join("\n"),
    "utf8",
  );

  return generatedEntryPath;
}

async function writeWebRuntimeArtifacts(options: {
  aliases?: Record<string, string>;
  assetExtensions?: string[];
  babelInPackages?: string[];
  conditions?: string[];
  entry: string;
  extensions?: string[];
  jsxInPackages?: string[];
  outDir: string;
  platform: VifxReactNativePluginOptions["platform"];
  projectRoot: string;
  reactNativeCompat: NonNullable<VifxReactNativePluginOptions["reactNativeCompat"]>;
  shimJsxRuntime: boolean;
  shimReact: boolean;
  shimReactNative: boolean;
}): Promise<VifxWebRuntimeArtifact> {
  const previewOutDir = path.join(options.outDir, "runtime");
  const runtimeHtmlPath = path.join(options.outDir, WEB_RUNTIME_HTML_FILE);
  const runtimeScriptPath = path.join(previewOutDir, WEB_RUNTIME_SCRIPT_FILE);
  const previewEntry =
    options.entry === EXPO_ROUTER_ENTRY_ID
      ? await createExpoRouterWebPreviewEntry({
          conditions: options.conditions,
          extensions: options.extensions,
          outDir: options.outDir,
          platform: options.platform,
          projectRoot: options.projectRoot,
        })
      : options.entry;
  const previewState: ReactNativePluginState = {
    aliases: normalizeAliases(options.aliases),
    assetExtensions: normalizeAssetExtensions(options.assetExtensions),
    assetFiles: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    conditions: normalizeConditions("web", options.conditions),
    entry: previewEntry,
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    platform: options.platform,
    projectRoot: options.projectRoot,
    reactNativeCompat: options.reactNativeCompat,
    resolvePlatform: "web",
    shimJsxRuntime: options.shimJsxRuntime,
    shimReact: options.shimReact,
    shimReactNative: options.shimReactNative,
  };
  const previewInputEntry = await createBuildInputEntry(
    options.projectRoot,
    previewOutDir,
    previewEntry,
  );

  await build({
    appType: "custom",
    build: {
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      emptyOutDir: true,
      minify: false,
      outDir: relativeFrom(options.projectRoot, previewOutDir),
      rollupOptions: {
        input: previewInputEntry,
        output: {
          assetFileNames: "assets/[name][extname]",
          chunkFileNames: "chunks/[name].js",
          entryFileNames: WEB_RUNTIME_BUNDLE_FILE,
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
    plugins: [createReactNativePlugin(previewState)],
    publicDir: false,
    root: options.projectRoot,
  });
  await writeFile(
    runtimeScriptPath,
    [
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
      "      addListener() {",
      "        return {",
      "          remove() {},",
      "        };",
      "      },",
      "      addProxiedListener() {",
      "        return {",
      "          remove() {},",
      "        };",
      "      },",
      "      getConstants() {",
      "        if (moduleName === 'SourceCode') {",
      "          return {",
      "            scriptURL: typeof window !== 'undefined' ? window.location.href : '',",
      "          };",
      "        }",
      "",
      "        if (moduleName === 'DeviceInfo') {",
      "          const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 0;",
      "          const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0;",
      "          const screenWidth = typeof window !== 'undefined' ? window.screen?.width ?? windowWidth : windowWidth;",
      "          const screenHeight = typeof window !== 'undefined' ? window.screen?.height ?? windowHeight : windowHeight;",
      "          const scale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;",
      "",
      "          return {",
      "            Dimensions: {",
      "              screen: {",
      "                fontScale: 1,",
      "                height: screenHeight,",
      "                scale,",
      "                width: screenWidth,",
      "              },",
      "              window: {",
      "                fontScale: 1,",
      "                height: windowHeight,",
      "                scale,",
      "                width: windowWidth,",
      "              },",
      "            },",
      "          };",
      "        }",
      "",
      "        if (moduleName === 'PlatformConstants') {",
      "          return {};",
      "        }",
      "",
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
      "",
      "        if (property === 'name') {",
      "          return moduleName;",
      "        }",
      "",
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
      "  globalThis.nativeModuleProxy = new Proxy(",
      "    {},",
      "    {",
      "      get(_target, property) {",
      "        return typeof property === 'string' ? createNativeModuleProxy(property) : undefined;",
      "      },",
      "    },",
      "  );",
      "}",
      "",
      "if (!globalThis.__fbBatchedBridgeConfig) {",
      "  globalThis.__fbBatchedBridgeConfig = {",
      "    remoteModuleConfig: [],",
      "  };",
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
      "",
      "    console.warn(error);",
      "  };",
      "",
      "  globalThis.ErrorUtils = {",
      "    getGlobalHandler() {",
      "      return globalErrorHandler;",
      "    },",
      "    setGlobalHandler(handler) {",
      "      if (typeof handler === 'function') {",
      "        globalErrorHandler = handler;",
      "      }",
      "    },",
      "    reportError(error) {",
      "      globalErrorHandler(error, false);",
      "    },",
      "    reportFatalError(error) {",
      "      globalErrorHandler(error, true);",
      "    },",
      "  };",
      "}",
      "",
      "if (globalThis.RN$useAlwaysAvailableJSErrorHandling !== true) {",
      "  globalThis.RN$useAlwaysAvailableJSErrorHandling = true;",
      "}",
      "",
      "if (!globalThis.ExpoDomWebView) {",
      "  globalThis.ExpoDomWebView = {",
      "    expoModulesProxy: globalThis.nativeModuleProxy,",
      "  };",
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
      "    TextDecoderStream: window.TextDecoderStream,",
      "    TextEncoder: window.TextEncoder,",
      "    TextEncoderStream: window.TextEncoderStream,",
      "    TransformStream: window.TransformStream,",
      "    URL: window.URL,",
      "    URLSearchParams: window.URLSearchParams,",
      "    structuredClone:",
      "      typeof window.structuredClone === 'function' ? window.structuredClone.bind(window) : undefined,",
      "  };",
      "}",
      "",
      "if (typeof window !== 'undefined') {",
      "  const browserFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;",
      "  if (browserFetch) {",
      "    globalThis.fetch = browserFetch;",
      "    window.fetch = browserFetch;",
      "  }",
      "  if (window.Headers) {",
      "    globalThis.Headers = window.Headers;",
      "  }",
      "  if (window.Request) {",
      "    globalThis.Request = window.Request;",
      "  }",
      "  if (window.Response) {",
      "    globalThis.Response = window.Response;",
      "  }",
      "  if (typeof globalThis.eval === 'function') {",
      "    globalThis.eval(",
      `      ${JSON.stringify("var fetch = globalThis.fetch; var Headers = globalThis.Headers; var Request = globalThis.Request; var Response = globalThis.Response;")},`,
      "    );",
      "  }",
      "}",
      "",
      `await import("./${WEB_RUNTIME_BUNDLE_FILE}");`,
      "",
      "const runtime = globalThis.__VIFX_WEB_RUNTIME__;",
      "",
      'if (!runtime || typeof runtime.mount !== "function") {',
      '  throw new Error("The Vifx web runtime was not initialized. Enable reactNativeCompat: \\"web\\" for this target.");',
      "}",
      "",
      `runtime.mount(${JSON.stringify(WEB_RUNTIME_ROOT_ELEMENT_ID)});`,
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    runtimeHtmlPath,
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      '    <link rel="icon" href="data:," />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
      "    <title>Vifx Runtime</title>",
      "    <style>",
      "      html, body, #root { height: 100%; }",
      "      body { margin: 0; }",
      "    </style>",
      "  </head>",
      "  <body>",
      `    <div id="${WEB_RUNTIME_ROOT_ELEMENT_ID}"></div>`,
      `    <script type="module" src="./runtime/${WEB_RUNTIME_SCRIPT_FILE}"></script>`,
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    htmlPath: relativeFrom(options.projectRoot, runtimeHtmlPath),
    rootElementId: WEB_RUNTIME_ROOT_ELEMENT_ID,
    scriptPath: relativeFrom(options.projectRoot, runtimeScriptPath),
  };
}

export async function buildReactNativeBundle(
  options: VifxReactNativePluginOptions,
): Promise<VifxBundleArtifacts> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const entry = options.entry ?? "./index.js";
  const outDir = options.outDir ?? `.vifx/vite/${options.platform}`;
  const absoluteOutDir = path.resolve(projectRoot, outDir);
  const state: ReactNativePluginState = {
    aliases: normalizeAliases(options.aliases),
    assetExtensions: normalizeAssetExtensions(options.assetExtensions),
    assetFiles: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    conditions: normalizeConditions(
      options.resolvePlatform ?? options.platform,
      options.conditions,
    ),
    entry,
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    platform: options.platform,
    projectRoot,
    reactNativeCompat: options.reactNativeCompat ?? "none",
    resolvePlatform: options.resolvePlatform ?? options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? true,
    shimReact: options.shimReact ?? true,
    shimReactNative: options.shimReactNative ?? true,
  };
  const inputEntry = await createBuildInputEntry(projectRoot, absoluteOutDir, entry);
  const buildConfig: InlineConfig = {
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
    plugins: [createReactNativePlugin(state)],
    publicDir: false,
    root: projectRoot,
  };

  await build(buildConfig);

  const bundlePath = path.join(absoluteOutDir, "index.bundle");
  await ensureBundleExists(bundlePath);
  const sourceMapPath = `${bundlePath}.map`;
  const bundleStats = await stat(bundlePath);
  const assets = await collectBuildAssets({
    assetFilePaths: [...state.assetFiles].sort(),
    outDir: absoluteOutDir,
    projectRoot,
  });

  let hermesBytecodePath: string | undefined;
  if (options.hermes) {
    const hermesResult = await compileHermesBytecode({
      compilerPath: options.hermesCompilerPath,
      cwd: projectRoot,
      env: options.env,
      inputBundlePath: bundlePath,
      outputBytecodePath: path.join(absoluteOutDir, "index.hbc"),
    });
    hermesBytecodePath = relativeFrom(projectRoot, hermesResult.outputBytecodePath);
  }

  const runtime =
    state.reactNativeCompat === "web"
      ? await writeWebRuntimeArtifacts({
          aliases: options.aliases,
          assetExtensions: options.assetExtensions,
          babelInPackages: options.babelInPackages,
          conditions: options.conditions,
          entry,
          extensions: options.extensions,
          jsxInPackages: options.jsxInPackages,
          outDir: absoluteOutDir,
          platform: options.platform,
          projectRoot,
          reactNativeCompat: state.reactNativeCompat,
          shimJsxRuntime: state.shimJsxRuntime,
          shimReact: state.shimReact,
          shimReactNative: state.shimReactNative,
        })
      : null;

  return {
    assets,
    bundle: {
      path: relativeFrom(projectRoot, bundlePath),
      sizeBytes: bundleStats.size,
    },
    entry,
    hermesBytecodePath,
    mode: "react-native",
    platform: options.platform,
    projectRoot,
    runtime,
    sourceMap: await buildSourceMapArtifact(projectRoot, sourceMapPath),
  };
}
