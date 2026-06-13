import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  build,
  transformWithOxc,
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
import {
  createTransformCache,
  defaultTransformCacheDir,
  type TransformCache,
} from "@vifx/transform-cache";
import type {
  VifxBuildAssetArtifact,
  VifxBundleArtifacts,
  VifxBundleMode,
  VifxModuleFormat,
  VifxPlatform,
  VifxReactNativePluginOptions,
  VifxTransformCacheStats,
  VifxWebRuntimeArtifact,
} from "@vifx/types";
import {
  createBabelPipeline,
  isExpoPackageSourcePath,
  isTransformableJavaScriptPath,
  shouldTransformJsxFile,
  stripQuery,
  toPosixPath,
  type TransformDecision,
} from "./babel/pipeline.ts";
import { loadProjectBabelRuntime } from "./babel/project-config.ts";
import {
  isGatedNativeCompatModule,
  isNativeCompatMockEnabled,
  warnNativeCompatPreviewOnce,
} from "./compat-gate.ts";
import { transformDynamicImport } from "./dynamic/dynamic-import.ts";
import {
  REQUIRE_CONTEXT_PREFIX,
  renderRequireContextModule,
  transformRequireContext,
} from "./dynamic/require-context.ts";
import {
  resolveBuildMinify,
  resolveBundleMode,
  resolveDefines,
  resolveOutputOptions,
} from "./modes.ts";
import { buildModuleRegistryBundle } from "./module-registry/index.ts";
import {
  applyReactRefreshTransform,
  shouldApplyReactRefresh,
  wrapWithRefreshRegistration,
} from "./react-refresh.ts";
import { VIFX_HMR_CLIENT_SOURCE } from "./hmr-client.ts";

export {
  resolveBuildMinify,
  resolveBundleMode,
  resolveDefines,
  resolveOutputOptions,
} from "./modes.ts";
export type {
  VifxResolveBundleModeOptions,
  VifxResolveDefinesOptions,
  VifxResolvedOutputOptions,
  VifxResolveOutputOptionsOptions,
} from "./modes.ts";
export {
  buildModuleRegistryBundle,
  buildModuleRegistryPrelude,
  MODULE_REGISTRY_PRELUDE,
} from "./module-registry/index.ts";
export type {
  BuildModuleRegistryBundleOptions,
  ModuleRegistryBundleResult,
} from "./module-registry/index.ts";

const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js", "json"] as const;
const DEFAULT_NATIVE_MAIN_FIELDS = ["react-native", "main", "module"] as const;
const DEFAULT_WEB_MAIN_FIELDS = ["react-native", "module", "main"] as const;
const DEFAULT_ASSET_EXTENSIONS = supportedAssetExtensions.filter(
  (extension) => extension !== "json",
);
const COMPAT_PREFIX = "\0vifx:compat:";
const EXPO_ROUTER_ENTRY_ID = "expo-router/entry";
const EXPO_ROUTER_CONTEXT_ID = "expo-router/_ctx";
const EXPO_ROUTER_QUALIFIED_ENTRY_ID = "expo-router/build/qualified-entry";
const EXPO_SQLITE_HOOKS_ID = "expo-sqlite/build/hooks";
const EXPO_SQLITE_SQLITE_DATABASE_ID = "expo-sqlite/build/SQLiteDatabase";
const EXPO_STATUS_BAR_MODULE_ID = "expo-status-bar/src/StatusBar";
const EXPO_WINTER_URL_ID = "expo/src/winter/url";
const REANIMATED_NATIVE_COMPAT_ID = "react-native-reanimated";
const REANIMATED_VALIDATE_WORKLETS_VERSION_ID =
  "react-native-reanimated/scripts/validate-worklets-version";
const REACT_NATIVE_WORKLETS_BUNDLE_UNPACKER_ID = "react-native-worklets/src/bundleUnpacker";
const REACT_NATIVE_WORKLETS_RUNTIME_ENTRY_ID = "react-native-worklets/src/workletRuntimeEntry";
const NATIVE_SINGLETON_PACKAGES = ["react", "react-native"] as const;
const NATIVE_SINGLETON_PACKAGE_SET = new Set<string>(NATIVE_SINGLETON_PACKAGES);
const SHIM_PREFIX = "\0vifx:shim:";
const TRANSFORM_PREFIX = "\0vifx:transformed:";
const ASSET_PREFIX = "\0vifx:asset:";
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

/**
 * Bump when the transform pipeline output changes in a way that is not already
 * captured by a tool version (e.g. a change to the OXC option defaults). Mixed
 * into every transform cache key so stale entries are ignored automatically.
 */
const TRANSFORM_CACHE_FORMAT = "1";

type OxcTransformLang = "js" | "jsx" | "ts" | "tsx";

interface ReactNativePluginState {
  aliases: Record<string, string>;
  assetExtensions: string[];
  assetFiles: Set<string>;
  assetRegistryAvailable?: boolean;
  babelInPackages: string[];
  emittedAssetFileNames: Set<string>;
  compatPreview: boolean;
  conditions: string[];
  entry: string;
  extensions: string[];
  jsxInPackages: string[];
  mainFields: string[];
  mode: VifxBundleMode;
  moduleFormat?: VifxModuleFormat;
  platform: VifxReactNativePluginOptions["platform"];
  projectRoot: string;
  reactNativeCompat: NonNullable<VifxReactNativePluginOptions["reactNativeCompat"]>;
  resolvePlatform: VifxPlatform;
  shimJsxRuntime: boolean;
  shimReact: boolean;
  shimReactNative: boolean;
  transformCache: TransformCache | null;
}

interface ExpoRouterContextEntry {
  contextKey: string;
  resolvedFilePath: string;
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

function dedupe(items: readonly string[]) {
  return [...new Set(items)];
}

function normalizeAssetExtensions(extensions?: string[]) {
  return dedupe((extensions ?? DEFAULT_ASSET_EXTENSIONS).map((extension) => extension.trim()));
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

function createNativeURLSearchParamsPolyfillLines() {
  return [
    "if (typeof globalThis.URLSearchParams !== 'function') {",
    "  function URLSearchParamsPolyfill(init) {",
    "    this._entries = [];",
    "    var source = init == null ? '' : init;",
    "",
    "    if (typeof source === 'string') {",
    "      var query = source.charAt(0) === '?' ? source.slice(1) : source;",
    "      if (query) {",
    "        var pairs = query.split('&');",
    "        for (var pairIndex = 0; pairIndex < pairs.length; pairIndex++) {",
    "          var pair = pairs[pairIndex];",
    "          if (!pair) continue;",
    "          var parts = pair.split('=');",
    "          var rawKey = parts[0];",
    "          var rawValue = parts.length > 1 ? parts.slice(1).join('=') : '';",
    "          this.append(decodeURIComponent(rawKey.replace(/\\+/g, ' ')), decodeURIComponent(rawValue.replace(/\\+/g, ' ')));",
    "        }",
    "      }",
    "      return;",
    "    }",
    "",
    "    if (source instanceof URLSearchParamsPolyfill || Array.isArray(source)) {",
    "      for (var entryIndex = 0; entryIndex < source.length; entryIndex++) {",
    "        var entry = source[entryIndex];",
    "        if (!entry) continue;",
    "        this.append(entry[0], entry.length > 1 ? entry[1] : '');",
    "      }",
    "      return;",
    "    }",
    "",
    "    if (source && typeof source === 'object') {",
    "      var names = Object.keys(source);",
    "      for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {",
    "        var name = names[nameIndex];",
    "        var value = source[name];",
    "        if (Array.isArray(value)) {",
    "          for (var valueIndex = 0; valueIndex < value.length; valueIndex++) {",
    "            this.append(name, value[valueIndex]);",
    "          }",
    "        } else {",
    "          this.append(name, value);",
    "        }",
    "      }",
    "    }",
    "  }",
    "",
    "  URLSearchParamsPolyfill.prototype.append = function append(name, value) {",
    "    this._entries.push([String(name), String(value)]);",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.delete = function deleteEntry(name) {",
    "    var key = String(name);",
    "    var nextEntries = [];",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      if (this._entries[index][0] !== key) {",
    "        nextEntries.push(this._entries[index]);",
    "      }",
    "    }",
    "    this._entries = nextEntries;",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.get = function get(name) {",
    "    var key = String(name);",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      if (this._entries[index][0] === key) {",
    "        return this._entries[index][1];",
    "      }",
    "    }",
    "    return null;",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.getAll = function getAll(name) {",
    "    var key = String(name);",
    "    var values = [];",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      if (this._entries[index][0] === key) {",
    "        values.push(this._entries[index][1]);",
    "      }",
    "    }",
    "    return values;",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.has = function has(name) {",
    "    var key = String(name);",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      if (this._entries[index][0] === key) {",
    "        return true;",
    "      }",
    "    }",
    "    return false;",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.set = function set(name, value) {",
    "    var key = String(name);",
    "    var nextValue = String(value);",
    "    var replaced = false;",
    "    var nextEntries = [];",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      var entry = this._entries[index];",
    "      if (entry[0] === key) {",
    "        if (!replaced) {",
    "          nextEntries.push([key, nextValue]);",
    "          replaced = true;",
    "        }",
    "      } else {",
    "        nextEntries.push(entry);",
    "      }",
    "    }",
    "    if (!replaced) {",
    "      nextEntries.push([key, nextValue]);",
    "    }",
    "    this._entries = nextEntries;",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.sort = function sort() {",
    "    this._entries.sort(function compare(left, right) {",
    "      return left[0].localeCompare(right[0]);",
    "    });",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.toString = function toString() {",
    "    var parts = [];",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      parts.push(encodeURIComponent(this._entries[index][0]) + '=' + encodeURIComponent(this._entries[index][1]));",
    "    }",
    "    return parts.join('&');",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.keys = function keys() {",
    "    return this._entries.map(function mapKey(entry) { return entry[0]; })[Symbol.iterator]();",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.values = function values() {",
    "    return this._entries.map(function mapValue(entry) { return entry[1]; })[Symbol.iterator]();",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.entries = function entries() {",
    "    return this._entries[Symbol.iterator]();",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype.forEach = function forEach(callback, thisArg) {",
    "    for (var index = 0; index < this._entries.length; index++) {",
    "      callback.call(thisArg, this._entries[index][1], this._entries[index][0], this);",
    "    }",
    "  };",
    "",
    "  URLSearchParamsPolyfill.prototype[Symbol.iterator] = function iterator() {",
    "    return this.entries();",
    "  };",
    "",
    "  globalThis.URLSearchParams = URLSearchParamsPolyfill;",
    "}",
    "",
  ];
}

function createTransformId(filePath: string) {
  return `${TRANSFORM_PREFIX}${filePath}`;
}

function createAssetId(filePath: string) {
  return `${ASSET_PREFIX}${filePath}`;
}

/**
 * Native asset modules register through `@react-native/assets-registry`, a
 * react-native dependency present in every real RN/Expo app. When it cannot be
 * resolved (e.g. a bundle with no react-native installed), we keep Vite's URL
 * string so the build still succeeds instead of failing on an unresolved import.
 * The result is cached on the plugin state.
 */
async function isNativeAssetRegistryAvailable(
  state: Pick<
    ReactNativePluginState,
    | "assetRegistryAvailable"
    | "conditions"
    | "extensions"
    | "mainFields"
    | "projectRoot"
    | "resolvePlatform"
  >,
): Promise<boolean> {
  if (state.assetRegistryAvailable !== undefined) {
    return state.assetRegistryAvailable;
  }

  try {
    await resolveReactNativeModule({
      conditions: state.conditions,
      extensions: state.extensions,
      fromFile: path.join(state.projectRoot, "index.js"),
      mainFields: state.mainFields,
      platform: state.resolvePlatform,
      projectRoot: state.projectRoot,
      specifier: "@react-native/assets-registry/registry",
    });
    state.assetRegistryAvailable = true;
  } catch {
    state.assetRegistryAvailable = false;
  }

  return state.assetRegistryAvailable;
}

/**
 * Renders the runtime module for a native asset import.
 *
 * React Native resolves `require('./image.png')` to a numeric asset id produced
 * by `AssetRegistry.registerAsset(...)`, which `<Image source>` and
 * `Font.loadAsync` expect. Vite's default asset handling instead emits a URL
 * string, which is only valid for the web `<img>`/`<link>` runtime. For native
 * targets we therefore emit every scale variant flat under `assets/` (matching
 * the dev server's flat serving and `collectBuildAssets`'s stat path) and return
 * a module that registers the asset, mirroring Metro's asset modules.
 */
async function renderNativeAssetModule(options: {
  assetExtensions: readonly string[];
  emitFile: (file: { fileName: string; source: Buffer; type: "asset" }) => void;
  emittedFileNames: Set<string>;
  filePath: string;
  projectRoot: string;
}) {
  const group = await collectAssetGroup({
    filePath: options.filePath,
    projectRoot: options.projectRoot,
    supportedExtensions: options.assetExtensions,
  });

  for (const variant of group.variants) {
    const scaleSuffix = variant.scale > 1 ? `@${variant.scale}x` : "";
    const fileName = `assets/${group.name}${scaleSuffix}.${group.type}`;
    if (options.emittedFileNames.has(fileName)) {
      continue;
    }

    options.emittedFileNames.add(fileName);
    options.emitFile({
      fileName,
      source: await readFile(variant.filePath),
      type: "asset",
    });
  }

  const descriptor = {
    __packager_asset: true,
    fileHashes: group.variants.map((variant) => variant.hash),
    hash: group.hash,
    height: group.height,
    httpServerLocation: "/assets",
    name: group.name,
    scales: [...group.scales],
    type: group.type,
    width: group.width,
  };

  return [
    'import { registerAsset } from "@react-native/assets-registry/registry";',
    `export default registerAsset(${JSON.stringify(descriptor)});`,
    "",
  ].join("\n");
}

function resolveCompatId(
  source: string,
  state: Pick<ReactNativePluginState, "compatPreview" | "reactNativeCompat" | "resolvePlatform">,
) {
  if (state.reactNativeCompat === "web" && WEB_COMPAT_SPECIFIERS.has(source)) {
    return createCompatId(source);
  }

  if (
    source === "react-native/Libraries/Core/Devtools/getDevServer" ||
    source === "react-native/Libraries/NativeModules/specs/NativeSourceCode"
  ) {
    return createCompatId(source);
  }

  if (source === EXPO_ROUTER_CONTEXT_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_WINTER_URL_ID) {
    return createCompatId(source);
  }

  if (
    source === REANIMATED_NATIVE_COMPAT_ID &&
    isGatedNativeCompatModule(source) &&
    isNativeCompatMockEnabled(state)
  ) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === REANIMATED_VALIDATE_WORKLETS_VERSION_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform !== "web" && source === REACT_NATIVE_WORKLETS_BUNDLE_UNPACKER_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_ROUTER_ENTRY_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === EXPO_ROUTER_QUALIFIED_ENTRY_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform !== "web" && source === EXPO_SQLITE_SQLITE_DATABASE_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform !== "web" && source === EXPO_SQLITE_HOOKS_ID) {
    return createCompatId(source);
  }

  if (state.resolvePlatform === "web" && source === "@expo/metro-runtime") {
    return createCompatId(source);
  }

  return null;
}

function resolveCompatPath(filePath: string, resolvePlatform: VifxPlatform) {
  const normalizedPath = toPosixPath(stripQuery(filePath));
  if (
    normalizedPath.endsWith("/node_modules/expo-router/_ctx.js") ||
    normalizedPath.endsWith("/node_modules/expo-router/_ctx.web.js")
  ) {
    return createCompatId(EXPO_ROUTER_CONTEXT_ID);
  }

  if (
    normalizedPath.endsWith("/node_modules/react-native/Libraries/Core/Devtools/getDevServer.js")
  ) {
    return createCompatId("react-native/Libraries/Core/Devtools/getDevServer");
  }

  if (
    normalizedPath.endsWith(
      "/node_modules/react-native/Libraries/NativeModules/specs/NativeSourceCode.js",
    ) ||
    normalizedPath.endsWith(
      "/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeSourceCode.js",
    )
  ) {
    return createCompatId("react-native/Libraries/NativeModules/specs/NativeSourceCode");
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

  // Worklets internals are only intercepted on native: the renderer returns
  // native-only shims (and `null` on web). Tagging them as compat virtual
  // modules on web — where `renderCompat` returns `null` — would leave Rollup
  // with an unloadable `\0vifx:compat:` id. Mirror the source-based guard above.
  if (
    resolvePlatform !== "web" &&
    (normalizedPath.endsWith("/node_modules/react-native-worklets/src/bundleUnpacker.ts") ||
      normalizedPath.endsWith("/node_modules/react-native-worklets/lib/module/bundleUnpacker.js"))
  ) {
    return createCompatId(REACT_NATIVE_WORKLETS_BUNDLE_UNPACKER_ID);
  }

  if (
    resolvePlatform !== "web" &&
    (normalizedPath.endsWith("/node_modules/react-native-worklets/src/workletRuntimeEntry.ts") ||
      normalizedPath.endsWith(
        "/node_modules/react-native-worklets/lib/module/workletRuntimeEntry.js",
      ))
  ) {
    return createCompatId(REACT_NATIVE_WORKLETS_RUNTIME_ENTRY_ID);
  }

  if (
    normalizedPath.endsWith("/node_modules/expo-router/entry.js") ||
    normalizedPath.endsWith("/node_modules/expo-router/entry-classic.js")
  ) {
    return createCompatId(EXPO_ROUTER_ENTRY_ID);
  }

  if (normalizedPath.endsWith("/node_modules/expo-sqlite/build/SQLiteDatabase.js")) {
    return createCompatId(EXPO_SQLITE_SQLITE_DATABASE_ID);
  }

  if (normalizedPath.endsWith("/node_modules/expo-sqlite/build/hooks.js")) {
    return createCompatId(EXPO_SQLITE_HOOKS_ID);
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

async function resolveRawTransformedModuleId(options: {
  specifier: string;
  state: Pick<ReactNativePluginState, "platform" | "projectRoot">;
}) {
  return createTransformId(
    stripQuery(
      (
        await resolveReactNativeModule({
          conditions: normalizeConditions(options.state.platform, []),
          extensions: normalizeExtensions(),
          fromFile: path.join(options.state.projectRoot, "index.js"),
          mainFields: normalizeMainFields(options.state.platform, []),
          platform: options.state.platform,
          projectRoot: options.state.projectRoot,
          specifier: options.specifier,
        })
      ).filePath,
    ),
  );
}

function renderReanimatedNativeCompat() {
  return [
    'import * as React from "react";',
    'import * as ReactNative from "react-native";',
    "",
    "const NOOP = () => {};",
    "const ID = (value) => value;",
    "const AnimatedBase = ReactNative.Animated ?? {};",
    "const View = ReactNative.View ?? 'View';",
    "const Text = ReactNative.Text ?? 'Text';",
    "const Image = ReactNative.Image ?? 'Image';",
    "const ScrollView = ReactNative.ScrollView ?? AnimatedBase.ScrollView ?? 'ScrollView';",
    "const FlatList = ReactNative.FlatList ?? AnimatedBase.FlatList ?? 'FlatList';",
    "const processColorBase = ReactNative.processColor ?? ID;",
    "",
    "function notifySafely(notify) {",
    "  try {",
    "    notify();",
    "  } catch {",
    "    // React can reject updates during render. Reanimated accepts these writes,",
    "    // so the compat layer keeps the value update and drops only the repaint.",
    "  }",
    "}",
    "",
    "function createMutableValue(initialValue, notify = NOOP) {",
    "  let currentValue = initialValue;",
    "  const mutable = {",
    "    get value() {",
    "      return currentValue;",
    "    },",
    "    set value(nextValue) {",
    "      currentValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue;",
    "      notifySafely(notify);",
    "    },",
    "    get() {",
    "      return currentValue;",
    "    },",
    "    set(nextValue) {",
    "      mutable.value = nextValue;",
    "    },",
    "    addListener() {",
    "      return -1;",
    "    },",
    "    removeListener() {},",
    "    modify(modifier) {",
    "      mutable.value = typeof modifier === 'function' ? modifier(currentValue) : currentValue;",
    "    },",
    "  };",
    "  return mutable;",
    "}",
    "",
    "function supportsReactHooks() {",
    "  return typeof React.useRef === 'function' && typeof React.useReducer === 'function';",
    "}",
    "",
    "export function useSharedValue(initialValue) {",
    "  if (!supportsReactHooks()) {",
    "    return createMutableValue(initialValue);",
    "  }",
    "",
    "  const valueRef = React.useRef(null);",
    "  const [, forceUpdate] = React.useReducer((value) => value + 1, 0);",
    "  if (valueRef.current === null) {",
    "    valueRef.current = createMutableValue(initialValue, forceUpdate);",
    "  }",
    "  return valueRef.current;",
    "}",
    "",
    "export function makeMutable(initialValue) {",
    "  return createMutableValue(initialValue);",
    "}",
    "",
    "export function useAnimatedStyle(updater) {",
    "  return typeof updater === 'function' ? updater() : updater ?? {};",
    "}",
    "",
    "export function useAnimatedProps(updater) {",
    "  return typeof updater === 'function' ? updater() : updater ?? {};",
    "}",
    "",
    "export function useDerivedValue(processor) {",
    "  const value = typeof processor === 'function' ? processor() : processor;",
    "  return {",
    "    value,",
    "    get() {",
    "      return value;",
    "    },",
    "  };",
    "}",
    "",
    "export function useAnimatedReaction() {}",
    "",
    "export function useAnimatedRef() {",
    "  return typeof React.useRef === 'function' ? React.useRef(null) : { current: null };",
    "}",
    "",
    "export function useEvent(handler) {",
    "  return typeof handler === 'function' ? handler : NOOP;",
    "}",
    "",
    "export function useHandler() {",
    "  return { context: {}, doDependenciesDiffer: false, useWeb: true };",
    "}",
    "",
    "export function useComposedEventHandler(...handlers) {",
    "  return handlers.find((handler) => typeof handler === 'function') ?? NOOP;",
    "}",
    "",
    "export function useAnimatedScrollHandler(handlers) {",
    "  if (typeof handlers === 'function') {",
    "    return handlers;",
    "  }",
    "  return (event) => handlers?.onScroll?.(event);",
    "}",
    "",
    "export function useFrameCallback() {",
    "  return { setActive() {} };",
    "}",
    "",
    "export function useAnimatedSensor() {",
    "  return {",
    "    sensor: {",
    "      value: {",
    "        x: 0,",
    "        y: 0,",
    "        z: 0,",
    "        qw: 0,",
    "        qx: 0,",
    "        qy: 0,",
    "        qz: 0,",
    "        yaw: 0,",
    "        pitch: 0,",
    "        roll: 0,",
    "        interfaceOrientation: 0,",
    "      },",
    "    },",
    "    unregister() {},",
    "    isAvailable: false,",
    "    config: {},",
    "  };",
    "}",
    "",
    "export function useAnimatedKeyboard() {",
    "  return { height: 0, state: 0 };",
    "}",
    "",
    "export function useScrollOffset() {",
    "  return createMutableValue(0);",
    "}",
    "",
    "export const useScrollViewOffset = useScrollOffset;",
    "export function useReducedMotion() {",
    "  return false;",
    "}",
    "",
    "export function runOnJS(fn) {",
    "  return typeof fn === 'function' ? fn : NOOP;",
    "}",
    "",
    "export function runOnUI(fn) {",
    "  return typeof fn === 'function' ? fn : NOOP;",
    "}",
    "",
    "export function createWorkletRuntime() {",
    "  return {};",
    "}",
    "",
    "export function runOnRuntime(_runtime, fn) {",
    "  return typeof fn === 'function' ? fn : NOOP;",
    "}",
    "",
    "export function executeOnUIRuntimeSync(fn) {",
    "  return typeof fn === 'function' ? fn() : undefined;",
    "}",
    "",
    "export const makeShareableCloneRecursive = ID;",
    "export const createSerializable = ID;",
    "export function isWorkletFunction(value) {",
    "  return typeof value === 'function' && value.__workletHash != null;",
    "}",
    "",
    "export function cancelAnimation() {}",
    "",
    "export function withTiming(toValue, _userConfig, callback) {",
    "  callback?.(true, toValue);",
    "  return toValue;",
    "}",
    "",
    "export function withSpring(toValue, _userConfig, callback) {",
    "  callback?.(true, toValue);",
    "  return toValue;",
    "}",
    "",
    "export function withDecay(_userConfig, callback) {",
    "  callback?.(true, 0);",
    "  return 0;",
    "}",
    "",
    "export function withDelay(_delayMs, nextAnimation) {",
    "  return nextAnimation;",
    "}",
    "",
    "export function withRepeat(animation, _numberOfReps, _reverse, callback) {",
    "  callback?.(true, animation);",
    "  return animation;",
    "}",
    "",
    "export function withSequence(...animations) {",
    "  return animations.length > 0 ? animations[animations.length - 1] : 0;",
    "}",
    "",
    "export function withClamp(_config, animation) {",
    "  return animation;",
    "}",
    "",
    "export function defineAnimation(_starting, factory) {",
    "  return typeof factory === 'function' ? factory() : factory;",
    "}",
    "",
    "export function clamp(value, lowerBound, upperBound) {",
    "  return Math.min(Math.max(value, lowerBound), upperBound);",
    "}",
    "",
    "export const Extrapolation = {",
    "  EXTEND: 'extend',",
    "  CLAMP: 'clamp',",
    "  IDENTITY: 'identity',",
    "};",
    "export const Extrapolate = Extrapolation;",
    "export const ColorSpace = {",
    "  RGB: 'RGB',",
    "  HSV: 'HSV',",
    "};",
    "",
    "export function interpolate(value, inputRange, outputRange) {",
    "  if (!Array.isArray(inputRange) || !Array.isArray(outputRange) || inputRange.length === 0 || outputRange.length === 0) {",
    "    return value;",
    "  }",
    "",
    "  if (inputRange.length === 1 || outputRange.length === 1) {",
    "    return outputRange[0];",
    "  }",
    "",
    "  let index = 0;",
    "  while (index < inputRange.length - 2 && value > inputRange[index + 1]) {",
    "    index += 1;",
    "  }",
    "",
    "  const inputMin = inputRange[index];",
    "  const inputMax = inputRange[index + 1];",
    "  const outputMin = outputRange[index] ?? outputRange[0];",
    "  const outputMax = outputRange[index + 1] ?? outputRange[outputRange.length - 1];",
    "  if (inputMax === inputMin) {",
    "    return outputMax;",
    "  }",
    "",
    "  const progress = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);",
    "  return outputMin + progress * (outputMax - outputMin);",
    "}",
    "",
    "export function interpolateColor(_value, _inputRange, outputRange) {",
    "  return Array.isArray(outputRange) ? outputRange[0] : outputRange;",
    "}",
    "",
    "const easingIdentity = (value) => value;",
    "export const Easing = {",
    "  linear: easingIdentity,",
    "  ease: easingIdentity,",
    "  quad: (value) => value * value,",
    "  cubic: (value) => value * value * value,",
    "  poly: () => easingIdentity,",
    "  sin: easingIdentity,",
    "  circle: easingIdentity,",
    "  exp: easingIdentity,",
    "  elastic: () => easingIdentity,",
    "  back: () => easingIdentity,",
    "  bounce: easingIdentity,",
    "  bezier: () => easingIdentity,",
    "  bezierFn: () => easingIdentity,",
    "  steps: () => easingIdentity,",
    "  in: (easing) => easing ?? easingIdentity,",
    "  out: (easing) => easing ?? easingIdentity,",
    "  inOut: (easing) => easing ?? easingIdentity,",
    "};",
    "",
    "export function measure() {",
    "  return { x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0 };",
    "}",
    "",
    "export function scrollTo() {}",
    "export function dispatchCommand() {}",
    "export function setNativeProps() {}",
    "export function getRelativeCoords() {",
    "  return { x: 0, y: 0 };",
    "}",
    "",
    "export const processColor = processColorBase;",
    "export function isColor(value) {",
    "  return typeof value === 'string' || typeof value === 'number';",
    "}",
    "export const convertToRGBA = ID;",
    "export const createAnimatedPropAdapter = ID;",
    "",
    "class BaseAnimationMock {",
    "  duration() { return this; }",
    "  delay() { return this; }",
    "  springify() { return this; }",
    "  damping() { return this; }",
    "  stiffness() { return this; }",
    "  withCallback() { return this; }",
    "  randomDelay() { return this; }",
    "  withInitialValues() { return this; }",
    "  easing() { return this; }",
    "  rotate() { return this; }",
    "  mass() { return this; }",
    "  dampingRatio() { return this; }",
    "  restDisplacementThreshold() { return this; }",
    "  restSpeedThreshold() { return this; }",
    "  overshootClamping() { return this; }",
    "  reduceMotion() { return this; }",
    "  getDelay() { return 0; }",
    "  getDelayFunction() { return NOOP; }",
    "  getDuration() { return 300; }",
    "  getReduceMotion() { return ReduceMotion.System; }",
    "  getAnimationAndConfig() { return [NOOP, {}]; }",
    "  build() { return () => ({ initialValues: {}, animations: {} }); }",
    "}",
    "",
    "function createLayoutAnimation() {",
    "  return new BaseAnimationMock();",
    "}",
    "",
    "export const BaseAnimationBuilder = createLayoutAnimation();",
    "export const ComplexAnimationBuilder = createLayoutAnimation();",
    "export const Keyframe = BaseAnimationMock;",
    "export const BounceIn = createLayoutAnimation();",
    "export const BounceInDown = createLayoutAnimation();",
    "export const BounceInLeft = createLayoutAnimation();",
    "export const BounceInRight = createLayoutAnimation();",
    "export const BounceInUp = createLayoutAnimation();",
    "export const BounceOut = createLayoutAnimation();",
    "export const BounceOutDown = createLayoutAnimation();",
    "export const BounceOutLeft = createLayoutAnimation();",
    "export const BounceOutRight = createLayoutAnimation();",
    "export const BounceOutUp = createLayoutAnimation();",
    "export const FadeIn = createLayoutAnimation();",
    "export const FadeInDown = createLayoutAnimation();",
    "export const FadeInLeft = createLayoutAnimation();",
    "export const FadeInRight = createLayoutAnimation();",
    "export const FadeInUp = createLayoutAnimation();",
    "export const FadeOut = createLayoutAnimation();",
    "export const FadeOutDown = createLayoutAnimation();",
    "export const FadeOutLeft = createLayoutAnimation();",
    "export const FadeOutRight = createLayoutAnimation();",
    "export const FadeOutUp = createLayoutAnimation();",
    "export const FlipInEasyX = createLayoutAnimation();",
    "export const FlipInEasyY = createLayoutAnimation();",
    "export const FlipInXDown = createLayoutAnimation();",
    "export const FlipInXUp = createLayoutAnimation();",
    "export const FlipInYLeft = createLayoutAnimation();",
    "export const FlipInYRight = createLayoutAnimation();",
    "export const FlipOutEasyX = createLayoutAnimation();",
    "export const FlipOutEasyY = createLayoutAnimation();",
    "export const FlipOutXDown = createLayoutAnimation();",
    "export const FlipOutXUp = createLayoutAnimation();",
    "export const FlipOutYLeft = createLayoutAnimation();",
    "export const FlipOutYRight = createLayoutAnimation();",
    "export const JumpingTransition = createLayoutAnimation();",
    "export const CurvedTransition = createLayoutAnimation();",
    "export const EntryExitTransition = createLayoutAnimation();",
    "export const FadingTransition = createLayoutAnimation();",
    "export const Layout = createLayoutAnimation();",
    "export const LightSpeedInLeft = createLayoutAnimation();",
    "export const LightSpeedInRight = createLayoutAnimation();",
    "export const LightSpeedOutLeft = createLayoutAnimation();",
    "export const LightSpeedOutRight = createLayoutAnimation();",
    "export const LinearTransition = createLayoutAnimation();",
    "export const PinwheelIn = createLayoutAnimation();",
    "export const PinwheelOut = createLayoutAnimation();",
    "export const RollInLeft = createLayoutAnimation();",
    "export const RollInRight = createLayoutAnimation();",
    "export const RollOutLeft = createLayoutAnimation();",
    "export const RollOutRight = createLayoutAnimation();",
    "export const RotateInDownLeft = createLayoutAnimation();",
    "export const RotateInDownRight = createLayoutAnimation();",
    "export const RotateInUpLeft = createLayoutAnimation();",
    "export const RotateInUpRight = createLayoutAnimation();",
    "export const RotateOutDownLeft = createLayoutAnimation();",
    "export const RotateOutDownRight = createLayoutAnimation();",
    "export const RotateOutUpLeft = createLayoutAnimation();",
    "export const RotateOutUpRight = createLayoutAnimation();",
    "export const SequencedTransition = createLayoutAnimation();",
    "export const SlideInDown = createLayoutAnimation();",
    "export const SlideInLeft = createLayoutAnimation();",
    "export const SlideInRight = createLayoutAnimation();",
    "export const SlideInUp = createLayoutAnimation();",
    "export const SlideOutDown = createLayoutAnimation();",
    "export const SlideOutLeft = createLayoutAnimation();",
    "export const SlideOutRight = createLayoutAnimation();",
    "export const SlideOutUp = createLayoutAnimation();",
    "export const StretchInX = createLayoutAnimation();",
    "export const StretchInY = createLayoutAnimation();",
    "export const StretchOutX = createLayoutAnimation();",
    "export const StretchOutY = createLayoutAnimation();",
    "export const ZoomIn = createLayoutAnimation();",
    "export const ZoomInDown = createLayoutAnimation();",
    "export const ZoomInEasyDown = createLayoutAnimation();",
    "export const ZoomInEasyUp = createLayoutAnimation();",
    "export const ZoomInLeft = createLayoutAnimation();",
    "export const ZoomInRight = createLayoutAnimation();",
    "export const ZoomInRotate = createLayoutAnimation();",
    "export const ZoomInUp = createLayoutAnimation();",
    "export const ZoomOut = createLayoutAnimation();",
    "export const ZoomOutDown = createLayoutAnimation();",
    "export const ZoomOutEasyDown = createLayoutAnimation();",
    "export const ZoomOutEasyUp = createLayoutAnimation();",
    "export const ZoomOutLeft = createLayoutAnimation();",
    "export const ZoomOutRight = createLayoutAnimation();",
    "export const ZoomOutRotate = createLayoutAnimation();",
    "export const ZoomOutUp = createLayoutAnimation();",
    "",
    "export const SensorType = { ACCELEROMETER: 1, GYROSCOPE: 2, GRAVITY: 3, MAGNETIC_FIELD: 4, ROTATION: 5 };",
    "export const IOSReferenceFrame = { XArbitraryZVertical: 0, XArbitraryCorrectedZVertical: 1, XMagneticNorthZVertical: 2, XTrueNorthZVertical: 3 };",
    "export const InterfaceOrientation = { ROTATION_0: 0, ROTATION_90: 90, ROTATION_180: 180, ROTATION_270: 270 };",
    "export const KeyboardState = { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 };",
    "export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' };",
    "export const ReanimatedLogLevel = { warn: 1, error: 2 };",
    "export const reanimatedVersion = 'vifx-compat';",
    "",
    "export function configureReanimatedLogger() {}",
    "export function enableLayoutAnimations() {}",
    "export function getViewProp() { return undefined; }",
    "export function isConfigured() { return true; }",
    "export function isReanimated3() { return false; }",
    "export function getStaticFeatureFlag() { return false; }",
    "export function setDynamicFeatureFlag() {}",
    "export function isSharedValue(value) {",
    "  return value != null && typeof value === 'object' && 'value' in value;",
    "}",
    "export function setUpTests() {}",
    "export function withReanimatedTimer(callback) { return callback?.(); }",
    "export function advanceAnimationByFrame() {}",
    "export function advanceAnimationByTime() {}",
    "export function getAnimatedStyle(component) { return component?.props?.style ?? {}; }",
    "",
    "export function LayoutAnimationConfig(props) { return props?.children ?? null; }",
    "export const ReducedMotionConfig = LayoutAnimationConfig;",
    "export const PerformanceMonitor = LayoutAnimationConfig;",
    "",
    "export function createAnimatedComponent(component) {",
    "  return typeof AnimatedBase.createAnimatedComponent === 'function'",
    "    ? AnimatedBase.createAnimatedComponent(component)",
    "    : component;",
    "}",
    "",
    "export function addWhitelistedUIProps() {}",
    "export function addWhitelistedNativeProps() {}",
    "",
    "const Animated = {",
    "  ...AnimatedBase,",
    "  View: AnimatedBase.View ?? createAnimatedComponent(View),",
    "  Text: AnimatedBase.Text ?? createAnimatedComponent(Text),",
    "  Image: AnimatedBase.Image ?? createAnimatedComponent(Image),",
    "  ScrollView: AnimatedBase.ScrollView ?? createAnimatedComponent(ScrollView),",
    "  FlatList: AnimatedBase.FlatList ?? createAnimatedComponent(FlatList),",
    "  createAnimatedComponent,",
    "  addWhitelistedUIProps,",
    "  addWhitelistedNativeProps,",
    "  Extrapolate,",
    "  Extrapolation,",
    "  interpolate,",
    "  interpolateColor,",
    "  clamp,",
    "};",
    "",
    "export default Animated;",
    "",
  ].join("\n");
}

async function renderCompat(
  id: string,
  state: Pick<ReactNativePluginState, "platform" | "projectRoot" | "resolvePlatform">,
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
        'import SourceCode from "react-native/Libraries/NativeModules/specs/NativeSourceCode";',
        "",
        "let cachedDevServerURL;",
        "let cachedFullBundleURL;",
        "",
        "export default function getDevServer() {",
        ...(state.resolvePlatform === "web"
          ? [
              "  const windowLocation = typeof window !== 'undefined' ? window.location : undefined;",
              "  if (windowLocation?.href && windowLocation?.origin) {",
              "    return {",
              "      bundleLoadedFromServer: false,",
              "      fullBundleUrl: windowLocation.href,",
              "      url: windowLocation.origin,",
              "    };",
              "  }",
              "",
            ]
          : []),
        "  if (cachedDevServerURL === undefined) {",
        "    const scriptURL = SourceCode.getConstants().scriptURL ?? '';",
        "    const match = scriptURL.match(/^https?:\\/\\/.*?\\//);",
        "    cachedDevServerURL = match ? match[0] : null;",
        "    cachedFullBundleURL = match ? scriptURL : null;",
        "  }",
        "",
        "  return {",
        "    bundleLoadedFromServer: cachedDevServerURL !== null,",
        "    fullBundleUrl: cachedFullBundleURL,",
        "    url: cachedDevServerURL ?? '',",
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
      if (state.resolvePlatform !== "web") {
        return [
          'import Constants from "expo-constants";',
          "",
          `const platform = ${JSON.stringify(state.platform)};`,
          "",
          "function readManifest() {",
          "  return Constants.__unsafeNoWarnManifest2 ?? Constants.manifest2 ?? null;",
          "}",
          "",
          "function readExpoClient(manifest) {",
          "  return Constants.expoConfig ?? manifest?.extra?.expoClient ?? null;",
          "}",
          "",
          "function readHostUri(manifest) {",
          "  return manifest?.extra?.expoGo?.debuggerHost ?? readExpoClient(manifest)?.hostUri ?? null;",
          "}",
          "",
          "function readMainModuleName(manifest) {",
          "  return manifest?.extra?.expoGo?.mainModuleName ?? 'index';",
          "}",
          "",
          "function readScriptURL() {",
          "  const manifest = readManifest();",
          "  const launchAsset = manifest?.launchAsset;",
          "  if (typeof launchAsset?.url === 'string') {",
          "    return launchAsset.url;",
          "  }",
          "",
          "  const hostUri = readHostUri(manifest);",
          "  if (!hostUri) {",
          "    return '';",
          "  }",
          "",
          "  return `http://${hostUri}/${encodeURI(readMainModuleName(manifest))}.bundle?dev=true&hot=false&platform=${platform}`;",
          "}",
          "",
          "export const SourceCode = {",
          "  getConstants() {",
          "    return { scriptURL: readScriptURL() };",
          "  },",
          "};",
          "",
          "export default SourceCode;",
        ].join("\n");
      }

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
      // Real Vifx HMR client (inert unless globalThis.__VIFX_HMR_URL is injected
      // for a dev metro bundle); see hmr-client.ts.
      return VIFX_HMR_CLIENT_SOURCE;
    case "@expo/metro-runtime":
      if (state.resolvePlatform === "web") {
        return ["export {};", ""].join("\n");
      }

      return [
        `import ${JSON.stringify(
          stripQuery(
            (
              await resolveReactNativeModule({
                conditions: normalizeConditions(state.platform, []),
                extensions: normalizeExtensions(),
                fromFile: path.join(state.projectRoot, "index.js"),
                mainFields: normalizeMainFields(state.platform, []),
                platform: state.platform,
                projectRoot: state.projectRoot,
                specifier: "@expo/metro-runtime",
              })
            ).filePath,
          ),
        )};`,
        "",
      ].join("\n");
    case EXPO_ROUTER_ENTRY_ID:
      return [
        ...(state.resolvePlatform === "web" ? [] : createNativeURLSearchParamsPolyfillLines()),
        'import "@expo/metro-runtime";',
        'import { App } from "expo-router/build/qualified-entry";',
        ...(state.resolvePlatform === "web"
          ? [
              'import { renderRootComponent } from "expo-router/build/renderRootComponent";',
              "renderRootComponent(App);",
            ]
          : ['import { registerRootComponent } from "expo";', "registerRootComponent(App);"]),
        "",
      ].join("\n");
    case EXPO_ROUTER_CONTEXT_ID:
      return await renderExpoRouterContext(state);
    case EXPO_ROUTER_QUALIFIED_ENTRY_ID:
      return [
        ...(state.resolvePlatform === "web" ? [] : createNativeURLSearchParamsPolyfillLines()),
        'import React from "react";',
        'import { ExpoRoot } from "expo-router/build/ExpoRoot";',
        'import { Head } from "expo-router/build/head";',
        'import { ctx } from "expo-router/_ctx";',
        'import "expo-router/build/fast-refresh";',
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
    case EXPO_SQLITE_SQLITE_DATABASE_ID:
      return [
        `import * as SQLiteDatabaseNamespace from ${JSON.stringify(
          await resolveRawTransformedModuleId({
            specifier: "expo-sqlite/build/SQLiteDatabase",
            state,
          }),
        )};`,
        "",
        "const SQLiteDatabaseModule = { ...SQLiteDatabaseNamespace };",
        "",
        "const originalOpenDatabaseAsync = SQLiteDatabaseModule.openDatabaseAsync;",
        "",
        "SQLiteDatabaseModule.openDatabaseAsync = async function openDatabaseAsync(...args) {",
        "  return await originalOpenDatabaseAsync(...args);",
        "};",
        "",
        "export const {",
        "  SQLiteDatabase,",
        "  addDatabaseChangeListener,",
        "  backupDatabaseAsync,",
        "  backupDatabaseSync,",
        "  bundledExtensions,",
        "  defaultDatabaseDirectory,",
        "  deleteDatabaseAsync,",
        "  deleteDatabaseSync,",
        "  deserializeDatabaseAsync,",
        "  deserializeDatabaseSync,",
        "  openDatabaseAsync,",
        "  openDatabaseSync,",
        "} = SQLiteDatabaseModule;",
        "",
        "export default SQLiteDatabaseModule;",
        "",
      ].join("\n");
    case EXPO_SQLITE_HOOKS_ID:
      return [
        `import React from "react";`,
        `import * as SQLiteDatabaseModule from ${JSON.stringify(
          await resolveRawTransformedModuleId({
            specifier: "expo-sqlite/build/SQLiteDatabase",
            state,
          }),
        )};`,
        "",
        "const SQLiteContext = React.createContext(null);",
        "",
        "export function deepEqual(a, b) {",
        "  if (a === b) {",
        "    return true;",
        "  }",
        "",
        "  if (a == null || b == null) {",
        "    return false;",
        "  }",
        "",
        '  if (typeof a !== "object" || typeof b !== "object") {',
        "    return false;",
        "  }",
        "",
        "  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => deepEqual(a[key], b[key]));",
        "}",
        "",
        "export function useSQLiteContext() {",
        "  const context = React.useContext(SQLiteContext);",
        "",
        "  if (context == null) {",
        '    throw new Error("useSQLiteContext must be used within a <SQLiteProvider>");',
        "  }",
        "",
        "  return context;",
        "}",
        "",
        "export function importDatabaseFromAssetAsync() {",
        '  throw new Error("importDatabaseFromAssetAsync is not supported in the Vifx SQLite hooks compat.");',
        "}",
        "",
        "function SQLiteProviderNonSuspense(props) {",
        "  const { children, databaseName, directory, onError, onInit, options, assetSource } = props;",
        "  const databaseRef = React.useRef(null);",
        "  const [loading, setLoading] = React.useState(true);",
        "  const [error, setError] = React.useState(null);",
        "",
        "  React.useEffect(() => {",
        "    let cancelled = false;",
        "    async function setup() {",
        "      try {",
        "        const database = await SQLiteDatabaseModule.openDatabaseAsync(databaseName, options, directory);",
        "",
        "        if (cancelled) {",
        "          await database.closeAsync();",
        "          return;",
        "        }",
        "",
        "        if (onInit) {",
        "          await onInit(database);",
        "        }",
        "",
        "        databaseRef.current = database;",
        "        setLoading(false);",
        "      } catch (setupError) {",
        "        if (!cancelled) {",
        "          setError(setupError);",
        "        }",
        "      }",
        "    }",
        "",
        "    void setup();",
        "",
        "    return () => {",
        "      cancelled = true;",
        "      const database = databaseRef.current;",
        "",
        "      if (database) {",
        "        void database.closeAsync().catch(() => {});",
        "      }",
        "    };",
        "  }, [assetSource, databaseName, directory, onInit, options]);",
        "",
        "  if (error) {",
        "    if (onError) {",
        "      onError(error);",
        "    } else {",
        "      throw error;",
        "    }",
        "  }",
        "",
        "  if (loading || !databaseRef.current) {",
        "    return null;",
        "  }",
        "",
        "  return React.createElement(SQLiteContext.Provider, { value: databaseRef.current }, children);",
        "}",
        "",
        "export function SQLiteProvider(props) {",
        "  return React.createElement(SQLiteProviderNonSuspense, props);",
        "}",
        "",
      ].join("\n");
    case EXPO_STATUS_BAR_MODULE_ID:
      return [
        `export { StatusBar, setStatusBarBackgroundColor, setStatusBarHidden, setStatusBarNetworkActivityIndicatorVisible, setStatusBarStyle, setStatusBarTranslucent } from ${JSON.stringify(path.join(state.projectRoot, "node_modules", "expo-status-bar", "src", "NativeStatusBarWrapper.tsx"))};`,
        "",
      ].join("\n");
    case EXPO_WINTER_URL_ID:
      if (state.resolvePlatform !== "web") {
        return [
          `export { URL, URLSearchParams } from ${JSON.stringify(
            await resolveRawTransformedModuleId({
              specifier: EXPO_WINTER_URL_ID,
              state,
            }),
          )};`,
          "",
        ].join("\n");
      }

      return [
        `const browserGlobals = globalThis.${WEB_RUNTIME_BROWSER_GLOBALS_KEY} ?? {};`,
        "export const URL = browserGlobals.URL ?? globalThis.URL ?? (typeof window !== 'undefined' ? window.URL : undefined);",
        "export const URLSearchParams = browserGlobals.URLSearchParams ?? globalThis.URLSearchParams ?? (typeof window !== 'undefined' ? window.URLSearchParams : undefined);",
        "",
      ].join("\n");
    case REANIMATED_NATIVE_COMPAT_ID:
      if (state.resolvePlatform === "web") {
        return null;
      }

      warnNativeCompatPreviewOnce(REANIMATED_NATIVE_COMPAT_ID);
      return renderReanimatedNativeCompat();
    case REANIMATED_VALIDATE_WORKLETS_VERSION_ID:
      return [
        "export default function validateWorkletsVersion() {",
        "  return { ok: true };",
        "}",
        "",
      ].join("\n");
    case REACT_NATIVE_WORKLETS_BUNDLE_UNPACKER_ID:
      if (state.resolvePlatform === "web") {
        return null;
      }

      return [
        "function createWorkletFromInitData(objectToUnpack, closureVariables) {",
        "  const initData = objectToUnpack?.__initData;",
        "  if (!initData || typeof initData.code !== 'string') {",
        "    return null;",
        "  }",
        "",
        "  const worklet = (0, eval)(`(${initData.code})`);",
        "  if (typeof worklet !== 'function') {",
        "    throw new Error('Vifx could not evaluate a Worklets bundle-mode worklet.');",
        "  }",
        "",
        "  worklet.__closure = closureVariables ?? objectToUnpack.__closure ?? {};",
        "  worklet.__workletHash = objectToUnpack.__workletHash;",
        "  worklet.__initData = initData;",
        "  return worklet;",
        "}",
        "",
        "function getWorkletFromMetroRequire(workletHash, closureVariables, objectToUnpack) {",
        "  const metroRequire = globalThis.__r;",
        "  if (typeof metroRequire === 'function') {",
        "    try {",
        "      const metroModule = metroRequire(workletHash);",
        "      const metroFactory = metroModule?.default ?? metroModule;",
        "      if (typeof metroFactory === 'function') {",
        "        return metroFactory(closureVariables);",
        "      }",
        "    } catch (error) {",
        "      const fallbackWorklet = createWorkletFromInitData(objectToUnpack, closureVariables);",
        "      if (fallbackWorklet) {",
        "        return fallbackWorklet;",
        "      }",
        "      throw error;",
        "    }",
        "  }",
        "",
        "  const fallbackWorklet = createWorkletFromInitData(objectToUnpack, closureVariables);",
        "  if (fallbackWorklet) {",
        "    return fallbackWorklet;",
        "  }",
        "",
        "  throw new Error('Vifx could not resolve a Worklets bundle-mode worklet without Metro __r.');",
        "}",
        "",
        "function getWorklet(workletHash, closureVariables, objectToUnpack) {",
        "  return getWorkletFromMetroRequire(workletHash, closureVariables, objectToUnpack);",
        "}",
        "",
        "export function bundleValueUnpacker(objectToUnpack, category, remoteFunctionName) {",
        "  const workletHash = objectToUnpack?.__workletHash;",
        "  if (workletHash !== undefined) {",
        "    return getWorklet(workletHash, objectToUnpack.__closure, objectToUnpack);",
        "  }",
        "",
        "  if (objectToUnpack?.__init !== undefined) {",
        "    return objectToUnpack.__init();",
        "  }",
        "",
        "  if (category === 'RemoteFunction') {",
        "    const remoteFunctionHolder = function remoteFunctionHolder() {",
        "      const label = remoteFunctionName ? `function \\`${remoteFunctionName}\\`` : 'anonymous function';",
        "      throw new Error(`Tried to synchronously call a non-worklet ${label} on the UI thread.`);",
        "    };",
        "    remoteFunctionHolder.__remoteFunction = objectToUnpack;",
        "    return remoteFunctionHolder;",
        "  }",
        "",
        '  throw new Error(`Data type in category "${category}" not recognized by Vifx Worklets unpacker.`);',
        "}",
        "",
      ].join("\n");
    case REACT_NATIVE_WORKLETS_RUNTIME_ENTRY_ID:
      if (state.resolvePlatform === "web") {
        return null;
      }

      return [
        "export function bundleModeInit() {",
        "  // Vifx native bundles do not use Metro's module registry, so Worklets",
        "  // must stay on the legacy init-data path instead of bundle mode.",
        "}",
        "",
        "bundleModeInit();",
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

function normalizeMainFields(resolvePlatform: VifxPlatform, mainFields?: readonly string[]) {
  const normalized = dedupe((mainFields ?? []).map((value) => value.trim()).filter(Boolean));
  const defaults = resolvePlatform === "web" ? DEFAULT_WEB_MAIN_FIELDS : DEFAULT_NATIVE_MAIN_FIELDS;

  if (normalized.length === 0) {
    return [...defaults];
  }

  if (resolvePlatform !== "web" && normalized.join("\0") === DEFAULT_WEB_MAIN_FIELDS.join("\0")) {
    return [...DEFAULT_NATIVE_MAIN_FIELDS];
  }

  return normalized;
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

function readBareSpecifierPackageName(specifier: string) {
  if (
    isPathLikeSpecifier(specifier) ||
    specifier.startsWith("\0") ||
    specifier.startsWith("data:")
  ) {
    return null;
  }

  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    const [scope, name] = segments;
    return scope && name ? `${scope}/${name}` : null;
  }

  return segments[0] ?? null;
}

function shouldResolveFromProjectRoot(specifier: string) {
  const packageName = readBareSpecifierPackageName(specifier);
  return packageName ? NATIVE_SINGLETON_PACKAGE_SET.has(packageName) : false;
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

function shouldTransformExpoPackageSource(
  id: string,
  state: Pick<ReactNativePluginState, "reactNativeCompat" | "resolvePlatform">,
) {
  return isExpoPackageSourcePath(id, state.reactNativeCompat, state.resolvePlatform);
}

function inferOxcTransformLang(id: string): OxcTransformLang {
  const normalizedId = toPosixPath(stripQuery(id));

  if (normalizedId.endsWith(".tsx")) {
    return "tsx";
  }

  if (
    normalizedId.endsWith(".ts") ||
    normalizedId.endsWith(".mts") ||
    normalizedId.endsWith(".cts")
  ) {
    return "ts";
  }

  if (normalizedId.endsWith(".jsx")) {
    return "jsx";
  }

  return "jsx";
}

function createOxcTransformOptions(id: string) {
  const lang = inferOxcTransformLang(id);

  return {
    jsx: lang === "jsx" || lang === "tsx" ? { runtime: "automatic" as const } : undefined,
    lang,
    sourcemap: true,
  };
}

let pluginVersionCache: string | undefined;

function resolvePluginVersion(): string {
  if (pluginVersionCache !== undefined) {
    return pluginVersionCache;
  }

  try {
    const requireFromHere = createRequire(import.meta.url);
    const manifest = requireFromHere("../package.json") as { version?: unknown };
    pluginVersionCache = typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    pluginVersionCache = "unknown";
  }

  return pluginVersionCache;
}

const dependencyVersionCache = new Map<string, string>();

function reactRefreshModuleId(
  id: string,
  state: Pick<ReactNativePluginState, "projectRoot">,
): string {
  const normalizedId = stripQuery(id);
  const relativePath = path.relative(state.projectRoot, normalizedId);
  return toPosixPath(relativePath === "" ? path.basename(normalizedId) : relativePath);
}

function resolveDependencyVersion(name: string, fromUrl = import.meta.url): string {
  const cacheKey = `${fromUrl} ${name}`;
  const cached = dependencyVersionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let version = "unknown";
  try {
    const requireFrom = createRequire(fromUrl);
    const manifest = requireFrom(`${name}/package.json`) as { version?: unknown };
    if (typeof manifest.version === "string") {
      version = manifest.version;
    }
  } catch {
    version = "unknown";
  }

  dependencyVersionCache.set(cacheKey, version);
  return version;
}

function resolveProjectBabelVersion(projectRoot: string): string {
  const projectManifestUrl = pathToFileURL(
    path.join(path.resolve(projectRoot), "package.json"),
  ).href;
  return resolveDependencyVersion("@babel/core", projectManifestUrl);
}

function createTransformCacheForState(options: {
  projectRoot: string;
  transformCache?: boolean;
}): TransformCache | null {
  if (options.transformCache === false) {
    return null;
  }

  const version = [
    TRANSFORM_CACHE_FORMAT,
    `plugin@${resolvePluginVersion()}`,
    `vite@${resolveDependencyVersion("vite")}`,
    `babel@${resolveProjectBabelVersion(options.projectRoot)}`,
  ].join("|");

  return createTransformCache({
    cacheDir: defaultTransformCacheDir(options.projectRoot),
    version,
  });
}

function createReactNativePlugin(state: ReactNativePluginState): Plugin {
  const cache = state.transformCache;

  const cachedTransform = async (
    keyParts: readonly unknown[],
    compute: () => Promise<TransformResult>,
  ): Promise<TransformResult> => {
    if (!cache) {
      return compute();
    }

    const result = await cache.getOrCompute(keyParts, async () => {
      const transformed = await compute();
      return { code: transformed.code, map: transformed.map ?? null };
    });

    if (typeof result === "string") {
      return { code: result, map: null };
    }

    return { code: result.code, map: (result.map as TransformResult["map"]) ?? null };
  };

  const cacheRelativeId = (id: string): string => {
    const normalizedId = toPosixPath(stripQuery(id));
    const relativePath = path.relative(state.projectRoot, normalizedId);
    return relativePath === "" || relativePath.startsWith("..")
      ? normalizedId
      : toPosixPath(relativePath);
  };

  const runOxcTransform = (code: string, id: string): Promise<TransformResult> => {
    const options = createOxcTransformOptions(id);
    return cachedTransform([code, "oxc", options, cacheRelativeId(id)], async () => {
      const transformed = await transformWithOxc(code, id, options);
      return {
        code: transformed.code,
        map: (transformed.map as TransformResult["map"]) ?? null,
      };
    });
  };

  const pipeline = createBabelPipeline({
    babelInPackages: state.babelInPackages,
    isDev: true,
    jsxInPackages: state.jsxInPackages,
    projectRoot: state.projectRoot,
    reactNativeCompat: state.reactNativeCompat,
    resolvePlatform: state.resolvePlatform,
  });

  const transformWithProjectBabel = async (
    code: string,
    id: string,
    decision: Extract<TransformDecision, { strategy: "project-babel" }>,
  ) => {
    const runtime = await loadProjectBabelRuntime(state.projectRoot);

    if (!runtime) {
      return null;
    }

    const baseOptions = {
      babelrc: false,
      caller: {
        bundler: "metro",
        isDev: true,
        isHMREnabled: false,
        isNodeModule: decision.isNodeModule,
        name: "vifx",
        platform: state.resolvePlatform,
        projectRoot: state.projectRoot,
        supportsStaticESM: !decision.isNodeModule,
      },
      filename: id,
      sourceMaps: true,
    };

    const projectConfig =
      decision.configMode === "project-config" ? await pipeline.getProjectBabelConfig() : null;

    let transformOptions: Record<string, unknown>;
    if (projectConfig?.configFilePath) {
      // Run the project's OWN configuration so its real plugins (worklets,
      // nativewind, react-compiler, ...) execute.
      transformOptions = {
        ...baseOptions,
        configFile: projectConfig.configFilePath,
        cwd: state.projectRoot,
        root: state.projectRoot,
      };
    } else if (runtime.presetPath) {
      // Legacy fallback: only the resolved React Native preset runs.
      transformOptions = {
        ...baseOptions,
        configFile: false,
        presets: [runtime.presetPath],
      };
    } else {
      // No project config matched and no preset is installed: project Babel
      // has nothing to contribute, so defer to the OXC fast path.
      return null;
    }

    // 09's pipeline decides the project-Babel options; 06's cache wraps the
    // final compute so identical inputs reuse the on-disk transform result.
    const babelKeyParts = [
      code,
      "babel",
      {
        configFilePath: projectConfig?.configFilePath ?? null,
        configMode: decision.configMode,
        isNodeModule: decision.isNodeModule,
        platform: state.resolvePlatform,
        presetPath: runtime.presetPath ?? null,
      },
      cacheRelativeId(id),
    ] as const;

    const transformed = await cachedTransform(babelKeyParts, async () => {
      const output = await runtime.transformAsync(code, transformOptions);
      return {
        code: output?.code ?? "",
        map: (output?.map as TransformResult["map"]) ?? null,
      };
    });

    if (!transformed.code) {
      return null;
    }

    return transformed satisfies TransformResult;
  };

  return {
    name: "vifx:react-native",
    enforce: "pre",
    config() {
      return {
        assetsInclude: state.assetExtensions.map((extension) => `**/*.${extension}`),
        define: resolveDefines({
          mode: state.mode,
          platform: state.platform,
          resolvePlatform: state.resolvePlatform,
        }),
        resolve: {
          conditions: state.conditions,
          dedupe: [...NATIVE_SINGLETON_PACKAGES],
        },
      };
    },
    async load(id) {
      if (id.startsWith(REQUIRE_CONTEXT_PREFIX)) {
        return await renderRequireContextModule(id);
      }

      if (id.startsWith(ASSET_PREFIX)) {
        return await renderNativeAssetModule({
          assetExtensions: state.assetExtensions,
          emitFile: (file) => {
            this.emitFile(file);
          },
          emittedFileNames: state.emittedAssetFileNames,
          filePath: id.slice(ASSET_PREFIX.length),
          projectRoot: state.projectRoot,
        });
      }

      if (id.startsWith(COMPAT_PREFIX)) {
        return await renderCompat(id, state);
      }

      if (id.startsWith(TRANSFORM_PREFIX)) {
        const originalId = id.slice(TRANSFORM_PREFIX.length);
        const source = await readFile(originalId, "utf8");
        const decision = await pipeline.decideTransform(originalId, source);

        if (decision.strategy === "project-babel") {
          const transformed = await transformWithProjectBabel(source, originalId, decision);
          if (transformed) {
            return transformed.code;
          }

          // No usable project Babel runtime: only fall through to OXC where a
          // JSX-style rule still applies. Files that need no transform (e.g. the
          // module-registry entry glue) pass through untouched so the bundler
          // keeps their native ESM semantics.
          const fallback = await pipeline.decideBabelUnavailableFallback(originalId);
          if (fallback.strategy !== "oxc") {
            return source;
          }
        } else if (decision.strategy !== "oxc") {
          return source;
        }

        const transformed = await runOxcTransform(source, originalId);

        return transformed.code;
      }

      const compatPathId = resolveCompatPath(id, state.resolvePlatform);
      if (compatPathId) {
        return await renderCompat(compatPathId, state);
      }

      if (!id.startsWith(SHIM_PREFIX)) {
        return null;
      }

      return renderShim(id, state.platform);
    },
    async transform(code, id, _options): Promise<TransformResult | null> {
      const applyBaseTransform = async (): Promise<TransformResult | null> => {
        if (!id.startsWith(TRANSFORM_PREFIX)) {
          const compatPathId = resolveCompatPath(id, state.resolvePlatform);
          if (compatPathId) {
            const compatCode = await renderCompat(compatPathId, state);
            if (compatCode !== null) {
              return {
                code: compatCode,
                map: null,
              };
            }
          }
        }

        const decision = await pipeline.decideTransform(id, code);

        if (decision.strategy === "project-babel") {
          // Project source under metro + dev gets React Refresh wired through
          // the project's own Babel runtime, replacing the plain project-babel
          // transform for those files. React Refresh wraps the module body in a
          // factory, so the project Babel preset must first lower ESM `import`
          // statements to CommonJS — without a usable preset (e.g. internal
          // module-registry entry glue in preset-less projects) we skip the
          // wrap and let the normal project-babel/OXC path handle the file.
          const refreshRuntime = await loadProjectBabelRuntime(state.projectRoot);
          if (
            refreshRuntime?.presetPath &&
            shouldApplyReactRefresh({
              options: { mode: state.mode, moduleFormat: state.moduleFormat },
              id,
              projectRoot: state.projectRoot,
            })
          ) {
            const refreshed = await applyReactRefreshTransform({
              code,
              id,
              babel: refreshRuntime,
              platform: state.resolvePlatform,
              projectRoot: state.projectRoot,
            });
            return {
              code: wrapWithRefreshRegistration(refreshed.code, reactRefreshModuleId(id, state)),
              map: null,
            };
          }

          const transformed = await transformWithProjectBabel(code, id, decision);
          if (transformed) {
            return transformed;
          }

          // No usable project Babel runtime: fall back to OXC where a
          // JSX-style rule still applies, mirroring the legacy chain.
          const fallback = await pipeline.decideBabelUnavailableFallback(id);
          if (fallback.strategy !== "oxc") {
            return null;
          }
        } else if (decision.strategy !== "oxc") {
          return null;
        }

        const transformed = await runOxcTransform(code, id);

        return {
          code: transformed.code,
          map: (transformed.map as TransformResult["map"]) ?? null,
        };
      };
      const applyDynamicModuleTransforms = (baseCode: string): string | null => {
        const sourceId = id.startsWith(TRANSFORM_PREFIX) ? id.slice(TRANSFORM_PREFIX.length) : id;
        if (sourceId.startsWith("\0") || !isTransformableJavaScriptPath(sourceId)) {
          return null;
        }

        const filePath = stripQuery(sourceId);
        let currentCode = baseCode;
        let transformed = false;

        const contextResult = transformRequireContext({
          code: currentCode,
          filePath,
          projectRoot: state.projectRoot,
        });
        if (contextResult) {
          currentCode = contextResult.code;
          transformed = true;
        }

        const importResult = transformDynamicImport({
          code: currentCode,
          filePath,
          resolvePlatform: state.resolvePlatform,
        });
        if (importResult) {
          currentCode = importResult.code;
          transformed = true;
        }

        return transformed ? currentCode : null;
      };
      const baseResult = await applyBaseTransform();
      const dynamicCode = applyDynamicModuleTransforms(baseResult?.code ?? code);

      if (dynamicCode === null) {
        return baseResult;
      }

      return {
        code: dynamicCode,
        map: null,
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
        source.startsWith(COMPAT_PREFIX) ||
        source.startsWith(REQUIRE_CONTEXT_PREFIX) ||
        source.startsWith(TRANSFORM_PREFIX)
      ) {
        return source;
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
      const resolverFromFile = shouldResolveFromProjectRoot(source)
        ? path.join(state.projectRoot, "package.json")
        : fromFile;

      try {
        const resolved = await resolveReactNativeModule({
          conditions: state.conditions,
          extensions: [...state.extensions, ...state.assetExtensions],
          fromFile: resolverFromFile,
          mainFields: state.mainFields,
          platform: state.resolvePlatform,
          projectRoot: state.projectRoot,
          specifier: source,
        });
        const resolvedPath = stripQuery(resolved.filePath);

        if (isSupportedAssetFile(resolvedPath, state.assetExtensions)) {
          state.assetFiles.add(resolvedPath);

          // On native, an asset import must resolve to a registered asset id (a
          // number) via AssetRegistry — like Metro — not Vite's default URL
          // string, which breaks `<Image source>` and font loading. The web
          // preview keeps the URL string for the browser runtime, and so does a
          // native build with no resolvable AssetRegistry.
          if (state.resolvePlatform !== "web" && (await isNativeAssetRegistryAvailable(state))) {
            return createAssetId(resolvedPath);
          }
        }

        const compatPathId = resolveCompatPath(resolvedPath, state.resolvePlatform);
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
    emittedAssetFileNames: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    compatPreview: options.compatPreview ?? false,
    conditions: normalizeConditions(
      options.resolvePlatform ?? options.platform,
      options.conditions,
    ),
    entry: options.entry ?? "./index.js",
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    mainFields: normalizeMainFields(
      options.resolvePlatform ?? options.platform,
      options.mainFields,
    ),
    mode: resolveBundleMode(options),
    moduleFormat: options.moduleFormat,
    platform: options.platform,
    projectRoot,
    reactNativeCompat: options.reactNativeCompat ?? "none",
    resolvePlatform: options.resolvePlatform ?? options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? true,
    shimReact: options.shimReact ?? true,
    shimReactNative: options.shimReactNative ?? true,
    transformCache: createTransformCacheForState({
      projectRoot,
      transformCache: options.transformCache,
    }),
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
  mainFields?: string[];
  projectRoot: string;
  specifier: string;
}) {
  const resolved = await resolveReactNativeModule({
    conditions: normalizeConditions("web", options.conditions),
    extensions: normalizeExtensions(options.extensions),
    fromFile: options.fromFile,
    mainFields: normalizeMainFields("web", options.mainFields),
    platform: "web",
    projectRoot: options.projectRoot,
    specifier: options.specifier,
  });

  return stripQuery(resolved.filePath);
}

async function createExpoRouterWebPreviewEntry(options: {
  conditions?: string[];
  extensions?: string[];
  mainFields?: string[];
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
    mainFields: options.mainFields,
    projectRoot: options.projectRoot,
    specifier: "react",
  });
  const expoRootPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    mainFields: options.mainFields,
    projectRoot: options.projectRoot,
    specifier: "expo-router/build/ExpoRoot",
  });
  const headPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    mainFields: options.mainFields,
    projectRoot: options.projectRoot,
    specifier: "expo-router/build/head",
  });
  const renderRootComponentPath = await resolveWebPreviewDependency({
    conditions: options.conditions,
    extensions: options.extensions,
    fromFile: generatedEntryPath,
    mainFields: options.mainFields,
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
  compatPreview?: boolean;
  conditions?: string[];
  entry: string;
  extensions?: string[];
  jsxInPackages?: string[];
  mainFields?: string[];
  mode: VifxBundleMode;
  outDir: string;
  platform: VifxReactNativePluginOptions["platform"];
  projectRoot: string;
  reactNativeCompat: NonNullable<VifxReactNativePluginOptions["reactNativeCompat"]>;
  shimJsxRuntime: boolean;
  shimReact: boolean;
  shimReactNative: boolean;
  transformCache: TransformCache | null;
}): Promise<VifxWebRuntimeArtifact> {
  const previewOutDir = path.join(options.outDir, "runtime");
  const runtimeHtmlPath = path.join(options.outDir, WEB_RUNTIME_HTML_FILE);
  const runtimeScriptPath = path.join(previewOutDir, WEB_RUNTIME_SCRIPT_FILE);
  const previewEntry =
    options.entry === EXPO_ROUTER_ENTRY_ID
      ? await createExpoRouterWebPreviewEntry({
          conditions: options.conditions,
          extensions: options.extensions,
          mainFields: options.mainFields,
          outDir: options.outDir,
          platform: options.platform,
          projectRoot: options.projectRoot,
        })
      : options.entry;
  const previewState: ReactNativePluginState = {
    aliases: normalizeAliases(options.aliases),
    assetExtensions: normalizeAssetExtensions(options.assetExtensions),
    assetFiles: new Set<string>(),
    emittedAssetFileNames: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    compatPreview: options.compatPreview ?? false,
    conditions: normalizeConditions("web", options.conditions),
    entry: previewEntry,
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    mainFields: normalizeMainFields("web", options.mainFields),
    mode: options.mode,
    platform: options.platform,
    projectRoot: options.projectRoot,
    reactNativeCompat: options.reactNativeCompat,
    resolvePlatform: "web",
    shimJsxRuntime: options.shimJsxRuntime,
    shimReact: options.shimReact,
    shimReactNative: options.shimReactNative,
    transformCache: options.transformCache,
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
          ...resolveOutputOptions({
            mode: options.mode,
            moduleFormat: "hoisted",
            platform: "web",
          }),
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
  const transformCache = createTransformCacheForState({
    projectRoot,
    transformCache: options.transformCache,
  });
  const mode = resolveBundleMode(options);
  const moduleFormat = options.moduleFormat ?? "hoisted";
  const state: ReactNativePluginState = {
    aliases: normalizeAliases(options.aliases),
    assetExtensions: normalizeAssetExtensions(options.assetExtensions),
    assetFiles: new Set<string>(),
    emittedAssetFileNames: new Set<string>(),
    babelInPackages: normalizeBabelInPackages(options.babelInPackages),
    compatPreview: options.compatPreview ?? false,
    conditions: normalizeConditions(
      options.resolvePlatform ?? options.platform,
      options.conditions,
    ),
    entry,
    extensions: normalizeExtensions(options.extensions),
    jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    mainFields: normalizeMainFields(
      options.resolvePlatform ?? options.platform,
      options.mainFields,
    ),
    mode,
    moduleFormat,
    platform: options.platform,
    projectRoot,
    reactNativeCompat: options.reactNativeCompat ?? "none",
    resolvePlatform: options.resolvePlatform ?? options.platform,
    shimJsxRuntime: options.shimJsxRuntime ?? true,
    shimReact: options.shimReact ?? true,
    shimReactNative: options.shimReactNative ?? true,
    transformCache,
  };

  if ((options.moduleFormat ?? "hoisted") === "metro") {
    const registry = await buildModuleRegistryBundle({
      absoluteOutDir,
      entry,
      plugins: [createReactNativePlugin(state)],
      projectRoot,
    });
    const bundleStats = await stat(registry.bundlePath);
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
        inputBundlePath: registry.bundlePath,
        outputBytecodePath: path.join(absoluteOutDir, "index.hbc"),
      });
      hermesBytecodePath = relativeFrom(projectRoot, hermesResult.outputBytecodePath);
    }

    return {
      assets,
      bundle: {
        path: relativeFrom(projectRoot, registry.bundlePath),
        sizeBytes: bundleStats.size,
      },
      entry,
      hermesBytecodePath,
      mode: "react-native",
      platform: options.platform,
      projectRoot,
      runtime: null,
      sourceMap: await buildSourceMapArtifact(projectRoot, registry.sourceMapPath),
    };
  }

  const inputEntry = await createBuildInputEntry(projectRoot, absoluteOutDir, entry);
  const buildConfig: InlineConfig = {
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
          entryFileNames: "index.bundle",
          ...resolveOutputOptions({
            mode,
            moduleFormat,
            platform: state.resolvePlatform,
          }),
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

  // Hermes always compiles the emitted index.bundle. In production mode that
  // file is already Oxc-minified by the Vite build, so bytecode is generated
  // from the minified script. Source-map fidelity: index.bundle.map composes
  // transform + minify mappings natively in Rolldown, but no bytecode-level
  // map is produced here, so symbolication of Hermes frames resolves through
  // the JS bundle map only.
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
          compatPreview: state.compatPreview,
          conditions: options.conditions,
          entry,
          extensions: options.extensions,
          jsxInPackages: options.jsxInPackages,
          mainFields: options.mainFields,
          mode,
          outDir: absoluteOutDir,
          platform: options.platform,
          projectRoot,
          reactNativeCompat: state.reactNativeCompat,
          shimJsxRuntime: state.shimJsxRuntime,
          shimReact: state.shimReact,
          shimReactNative: state.shimReactNative,
          transformCache,
        })
      : null;

  const cacheStats: VifxTransformCacheStats | undefined = transformCache?.stats();

  return {
    assets,
    bundle: {
      path: relativeFrom(projectRoot, bundlePath),
      sizeBytes: bundleStats.size,
    },
    cacheStats,
    entry,
    hermesBytecodePath,
    mode: "react-native",
    platform: options.platform,
    projectRoot,
    runtime,
    sourceMap: await buildSourceMapArtifact(projectRoot, sourceMapPath),
  };
}
