import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VifxError, toVifxError } from "@vifx/errors";
import type {
  VifxBundlePlatform,
  VifxBundleTargetConfig,
  VifxConfig,
  VifxConfigInput,
  VifxExpoOptions,
  VifxLogLevel,
  VifxLoggerConfig,
  VifxPlatform,
  VifxProjectType,
  VifxReactNativeCompatMode,
  VifxResolverConfig,
  VifxViteConfig,
  VifxVitePluginMode,
} from "@vifx/types";

export const VIFX_CONFIG_FILENAMES = [
  "vifx.config.ts",
  "vifx.config.mts",
  "vifx.config.js",
  "vifx.config.mjs",
] as const;

export const VIFX_DEFAULT_PLATFORMS: readonly VifxPlatform[] = ["ios", "android"];
export const VIFX_DEFAULT_RESOLVER_EXTENSIONS = ["tsx", "ts", "jsx", "js", "json"] as const;
export const VIFX_DEFAULT_RESOLVER_CONDITIONS: readonly string[] = [];
export const VIFX_DEFAULT_RESOLVER_MAIN_FIELDS = ["react-native", "module", "main"] as const;
export const VIFX_DEFAULT_LOG_LEVEL: VifxLogLevel = "info";
export const VIFX_DEFAULT_DOCS_BASE_URL = "https://vifx.dev";
export const VIFX_DEFAULT_EXPO_PUBLIC_ENV_PREFIX = "EXPO_PUBLIC_";
export const VIFX_DEFAULT_VITE_ENTRY = "./index.js";

export interface LoadVifxConfigOptions {
  cwd?: string;
  configFile?: string;
  optional?: boolean;
}

export interface LoadVifxConfigResult {
  config: VifxConfig;
  filePath?: string;
}

const VALID_PLATFORMS = new Set<VifxPlatform>(["ios", "android", "native", "web"]);
const VALID_BUNDLE_PLATFORMS = new Set<VifxBundlePlatform>(["ios", "android"]);
const VALID_PROJECT_TYPES = new Set<VifxProjectType>([
  "expo",
  "react-native",
  "workspace-package",
  "unknown",
]);
const VALID_LOG_LEVELS = new Set<VifxLogLevel>(["error", "warn", "info", "debug"]);
const VALID_VITE_PLUGIN_MODES = new Set<VifxVitePluginMode>(["none", "react-native", "expo"]);
const VALID_REACT_NATIVE_COMPAT_MODES = new Set<VifxReactNativeCompatMode>(["none", "web"]);

const TOP_LEVEL_KEYS = new Set([
  "projectRoot",
  "platforms",
  "projectType",
  "expo",
  "expoOptions",
  "reactNative",
  "vite",
  "resolver",
  "logger",
  "docsBaseUrl",
]);

const RESOLVER_KEYS = new Set(["extensions", "conditions", "mainFields"]);
const LOGGER_KEYS = new Set(["level", "json"]);
const EXPO_OPTIONS_KEYS = new Set(["appConfigPath", "inspectExportPath", "publicEnvPrefix"]);
const VITE_KEYS = new Set(["mode", "targets"]);
const VITE_TARGET_KEYS = new Set([
  "aliases",
  "babelInPackages",
  "entry",
  "hermes",
  "jsxInPackages",
  "outDir",
  "platform",
  "reactNativeCompat",
  "shimJsxRuntime",
  "shimReact",
  "shimReactNative",
]);

export function defineVifxConfig<T extends VifxConfigInput>(config: T) {
  return config;
}

export async function findVifxConfig(cwd = process.cwd()) {
  for (const fileName of VIFX_CONFIG_FILENAMES) {
    const filePath = resolve(cwd, fileName);

    if (await fileExists(filePath)) {
      return filePath;
    }
  }

  return undefined;
}

export function normalizeVifxConfig(input: VifxConfigInput = {}): VifxConfig {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const platforms = normalizePlatforms(input.platforms ?? [...VIFX_DEFAULT_PLATFORMS], "platforms");
  const resolver = normalizeResolverConfig(input.resolver);
  const logger = normalizeLoggerConfig(input.logger);
  const docsBaseUrl = normalizeDocsBaseUrl(input.docsBaseUrl ?? VIFX_DEFAULT_DOCS_BASE_URL);
  const projectType = input.projectType ?? inferProjectType(input);
  const expo = input.expo ?? projectType === "expo";
  const reactNative =
    input.reactNative ??
    (expo || projectType === "react-native" || platforms.some((platform) => platform !== "web"));
  const expoOptions = normalizeExpoOptions(input.expoOptions);
  const vite = normalizeViteConfig(input.vite, {
    expo,
    platforms,
    reactNative,
  });

  return {
    projectRoot,
    platforms,
    projectType,
    expo,
    expoOptions,
    reactNative,
    vite,
    resolver,
    logger,
    docsBaseUrl,
  };
}

export function validateVifxConfig(value: unknown, source = "inline config") {
  const config = expectObject(value, source);
  assertAllowedKeys(config, TOP_LEVEL_KEYS, source);

  return normalizeVifxConfig({
    projectRoot:
      config.projectRoot === undefined
        ? undefined
        : expectString(config.projectRoot, source, "projectRoot"),
    platforms:
      config.platforms === undefined
        ? undefined
        : normalizePlatforms(config.platforms, "platforms", source),
    projectType:
      config.projectType === undefined
        ? undefined
        : expectProjectType(config.projectType, source, "projectType"),
    expo: config.expo === undefined ? undefined : expectBoolean(config.expo, source, "expo"),
    expoOptions:
      config.expoOptions === undefined ? undefined : parseExpoOptions(config.expoOptions, source),
    reactNative:
      config.reactNative === undefined
        ? undefined
        : expectBoolean(config.reactNative, source, "reactNative"),
    vite: config.vite === undefined ? undefined : parseViteConfig(config.vite, source),
    resolver:
      config.resolver === undefined ? undefined : parseResolverConfig(config.resolver, source),
    logger: config.logger === undefined ? undefined : parseLoggerConfig(config.logger, source),
    docsBaseUrl:
      config.docsBaseUrl === undefined
        ? undefined
        : expectString(config.docsBaseUrl, source, "docsBaseUrl"),
  });
}

export async function loadVifxConfig(
  options: LoadVifxConfigOptions = {},
): Promise<LoadVifxConfigResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const explicitFilePath =
    options.configFile === undefined ? undefined : resolve(cwd, options.configFile);
  const filePath = explicitFilePath ?? (await findVifxConfig(cwd));

  if (explicitFilePath && !(await fileExists(explicitFilePath))) {
    throw createConfigNotFoundError(explicitFilePath);
  }

  if (!filePath) {
    if (options.optional ?? true) {
      return {
        config: normalizeVifxConfig({
          projectRoot: cwd,
        }),
      };
    }

    throw new VifxError({
      code: "VIFX_CONFIG_NOT_FOUND",
      message: `No Vifx config file was found in "${cwd}".`,
      hint: `Create one of: ${VIFX_CONFIG_FILENAMES.join(", ")}.`,
      details: {
        cwd,
      },
    });
  }

  try {
    const moduleExports = await importConfigModule(filePath, cwd);
    const exportedConfig = resolveConfigExport(moduleExports, filePath);
    const configValue =
      typeof exportedConfig === "object" &&
      exportedConfig !== null &&
      !Array.isArray(exportedConfig)
        ? {
            projectRoot: cwd,
            ...exportedConfig,
          }
        : exportedConfig;

    return {
      config: validateVifxConfig(configValue, filePath),
      filePath,
    };
  } catch (error) {
    if (error instanceof VifxError) {
      throw error;
    }

    throw toVifxError(error, {
      code: "VIFX_CONFIG_LOAD_FAILED",
      message: `Failed to load Vifx config from "${filePath}".`,
      hint: "Ensure the config exports a plain object and has no runtime import errors.",
      details: {
        filePath,
      },
    });
  }
}

async function importConfigModule(filePath: string, cwd: string) {
  const previousCwd = process.cwd();
  const shouldRestoreCwd = previousCwd !== cwd;

  if (shouldRestoreCwd) {
    process.chdir(cwd);
  }

  try {
    return await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
  } finally {
    if (shouldRestoreCwd) {
      process.chdir(previousCwd);
    }
  }
}

function parseResolverConfig(value: unknown, source: string) {
  const resolver = expectObject(value, `${source} resolver`);
  assertAllowedKeys(resolver, RESOLVER_KEYS, `${source} resolver`);

  return {
    extensions:
      resolver.extensions === undefined
        ? undefined
        : normalizeStringList(resolver.extensions, "resolver.extensions", source),
    conditions:
      resolver.conditions === undefined
        ? undefined
        : normalizeStringList(resolver.conditions, "resolver.conditions", source),
    mainFields:
      resolver.mainFields === undefined
        ? undefined
        : normalizeStringList(resolver.mainFields, "resolver.mainFields", source),
  } satisfies Partial<VifxResolverConfig>;
}

function parseLoggerConfig(value: unknown, source: string) {
  const logger = expectObject(value, `${source} logger`);
  assertAllowedKeys(logger, LOGGER_KEYS, `${source} logger`);

  return {
    level:
      logger.level === undefined ? undefined : expectLogLevel(logger.level, source, "logger.level"),
    json: logger.json === undefined ? undefined : expectBoolean(logger.json, source, "logger.json"),
  } satisfies Partial<VifxLoggerConfig>;
}

function parseExpoOptions(value: unknown, source: string) {
  const expoOptions = expectObject(value, `${source} expoOptions`);
  assertAllowedKeys(expoOptions, EXPO_OPTIONS_KEYS, `${source} expoOptions`);

  return {
    appConfigPath:
      expoOptions.appConfigPath === undefined
        ? undefined
        : normalizePathLikeString(expoOptions.appConfigPath, source, "expoOptions.appConfigPath"),
    inspectExportPath:
      expoOptions.inspectExportPath === undefined
        ? undefined
        : normalizePathLikeString(
            expoOptions.inspectExportPath,
            source,
            "expoOptions.inspectExportPath",
          ),
    publicEnvPrefix:
      expoOptions.publicEnvPrefix === undefined
        ? undefined
        : normalizePathLikeString(
            expoOptions.publicEnvPrefix,
            source,
            "expoOptions.publicEnvPrefix",
          ),
  } satisfies Partial<VifxExpoOptions>;
}

function parseViteConfig(value: unknown, source: string) {
  const vite = expectObject(value, `${source} vite`);
  assertAllowedKeys(vite, VITE_KEYS, `${source} vite`);

  return {
    mode:
      vite.mode === undefined ? undefined : expectVitePluginMode(vite.mode, source, "vite.mode"),
    targets:
      vite.targets === undefined
        ? undefined
        : normalizeBundleTargets(vite.targets, "vite.targets", source),
  } satisfies Partial<VifxViteConfig>;
}

function normalizeResolverConfig(resolver: VifxConfigInput["resolver"]): VifxResolverConfig {
  return {
    extensions: normalizeStringList(
      resolver?.extensions ?? [...VIFX_DEFAULT_RESOLVER_EXTENSIONS],
      "resolver.extensions",
    ),
    conditions: normalizeStringList(
      resolver?.conditions ?? [...VIFX_DEFAULT_RESOLVER_CONDITIONS],
      "resolver.conditions",
      undefined,
      true,
    ),
    mainFields: normalizeStringList(
      resolver?.mainFields ?? [...VIFX_DEFAULT_RESOLVER_MAIN_FIELDS],
      "resolver.mainFields",
    ),
  };
}

function normalizeLoggerConfig(logger: VifxConfigInput["logger"]): VifxLoggerConfig {
  return {
    level: expectLogLevel(logger?.level ?? VIFX_DEFAULT_LOG_LEVEL, "config", "logger.level"),
    json: logger?.json ?? false,
  };
}

function normalizeExpoOptions(expoOptions: VifxConfigInput["expoOptions"]): VifxExpoOptions {
  return {
    appConfigPath: expoOptions?.appConfigPath,
    inspectExportPath: expoOptions?.inspectExportPath,
    publicEnvPrefix: expoOptions?.publicEnvPrefix ?? VIFX_DEFAULT_EXPO_PUBLIC_ENV_PREFIX,
  };
}

function normalizeViteConfig(
  vite: VifxConfigInput["vite"],
  context: {
    expo: boolean;
    platforms: VifxPlatform[];
    reactNative: boolean;
  },
): VifxViteConfig {
  const requestedTargets = vite?.targets
    ? normalizeBundleTargets(vite.targets, "vite.targets")
    : undefined;
  const inferredMode =
    vite?.mode ??
    (requestedTargets
      ? context.expo
        ? "expo"
        : context.reactNative
          ? "react-native"
          : "none"
      : "none");
  const mode = expectVitePluginMode(inferredMode, "config", "vite.mode");

  if (mode === "none") {
    return {
      mode,
      targets: [],
    };
  }

  const targetPlatforms = context.platforms.filter(
    (platform): platform is VifxBundlePlatform => platform === "ios" || platform === "android",
  );

  return {
    mode,
    targets:
      requestedTargets ??
      targetPlatforms.map((platform) => ({
        entry: VIFX_DEFAULT_VITE_ENTRY,
        hermes: false,
        outDir: `dist/vite/${platform}`,
        platform,
      })),
  };
}

function normalizeBundleTargets(value: unknown, fieldName: string, source = "config") {
  if (!Array.isArray(value)) {
    throw invalidConfig(source, fieldName, "Expected an array of Vite bundle targets.");
  }

  if (value.length === 0) {
    throw invalidConfig(source, fieldName, "Expected at least one Vite bundle target.");
  }

  return dedupeByKey(
    value.map((target, index) => {
      const parsedTarget = expectObject(target, `${source} ${fieldName}[${index}]`);
      assertAllowedKeys(parsedTarget, VITE_TARGET_KEYS, `${source} ${fieldName}[${index}]`);

      return {
        aliases:
          parsedTarget.aliases === undefined
            ? undefined
            : normalizeStringRecord(parsedTarget.aliases, source, `${fieldName}[${index}].aliases`),
        babelInPackages:
          parsedTarget.babelInPackages === undefined
            ? undefined
            : normalizeStringList(
                parsedTarget.babelInPackages,
                `${fieldName}[${index}].babelInPackages`,
                source,
              ),
        entry: normalizePathLikeString(parsedTarget.entry, source, `${fieldName}[${index}].entry`),
        hermes:
          parsedTarget.hermes === undefined
            ? false
            : expectBoolean(parsedTarget.hermes, source, `${fieldName}[${index}].hermes`),
        jsxInPackages:
          parsedTarget.jsxInPackages === undefined
            ? undefined
            : normalizeStringList(
                parsedTarget.jsxInPackages,
                `${fieldName}[${index}].jsxInPackages`,
                source,
              ),
        outDir:
          parsedTarget.outDir === undefined
            ? undefined
            : normalizePathLikeString(parsedTarget.outDir, source, `${fieldName}[${index}].outDir`),
        platform: expectBundlePlatform(
          parsedTarget.platform,
          source,
          `${fieldName}[${index}].platform`,
        ),
        reactNativeCompat:
          parsedTarget.reactNativeCompat === undefined
            ? undefined
            : expectReactNativeCompatMode(
                parsedTarget.reactNativeCompat,
                source,
                `${fieldName}[${index}].reactNativeCompat`,
              ),
        shimJsxRuntime:
          parsedTarget.shimJsxRuntime === undefined
            ? undefined
            : expectBoolean(
                parsedTarget.shimJsxRuntime,
                source,
                `${fieldName}[${index}].shimJsxRuntime`,
              ),
        shimReact:
          parsedTarget.shimReact === undefined
            ? undefined
            : expectBoolean(parsedTarget.shimReact, source, `${fieldName}[${index}].shimReact`),
        shimReactNative:
          parsedTarget.shimReactNative === undefined
            ? undefined
            : expectBoolean(
                parsedTarget.shimReactNative,
                source,
                `${fieldName}[${index}].shimReactNative`,
              ),
      } satisfies VifxBundleTargetConfig;
    }),
    (target) =>
      [
        target.platform,
        target.entry,
        target.outDir ?? "",
        target.hermes ? "1" : "0",
        target.reactNativeCompat ?? "",
        JSON.stringify(target.aliases ?? {}),
        (target.babelInPackages ?? []).join(","),
        (target.jsxInPackages ?? []).join(","),
        target.shimReact === undefined ? "" : target.shimReact ? "1" : "0",
        target.shimReactNative === undefined ? "" : target.shimReactNative ? "1" : "0",
        target.shimJsxRuntime === undefined ? "" : target.shimJsxRuntime ? "1" : "0",
      ].join(":"),
  );
}

function normalizePlatforms(value: unknown, fieldName: string, source = "config") {
  if (!Array.isArray(value)) {
    throw invalidConfig(source, fieldName, "Expected an array of platforms.");
  }

  const platforms = dedupe(
    value.map((platform, index) => expectPlatform(platform, source, `${fieldName}[${index}]`)),
  );

  if (platforms.length === 0) {
    throw invalidConfig(source, fieldName, "Expected at least one platform.");
  }

  return platforms;
}

function normalizeStringList(
  value: unknown,
  fieldName: string,
  source = "config",
  allowEmpty = false,
) {
  if (!Array.isArray(value)) {
    throw invalidConfig(source, fieldName, "Expected an array of strings.");
  }

  const items = dedupe(
    value.map((item, index) => normalizeString(item, source, `${fieldName}[${index}]`)),
  );

  if (!allowEmpty && items.length === 0) {
    throw invalidConfig(source, fieldName, "Expected at least one string value.");
  }

  return items;
}

function normalizeString(value: unknown, source: string, fieldName: string) {
  const normalized = expectString(value, source, fieldName).trim().replace(/^\./, "");

  if (normalized.length === 0) {
    throw invalidConfig(source, fieldName, "Expected a non-empty string.");
  }

  return normalized;
}

function normalizePathLikeString(value: unknown, source: string, fieldName: string) {
  const normalized = expectString(value, source, fieldName).trim();

  if (normalized.length === 0) {
    throw invalidConfig(source, fieldName, "Expected a non-empty string.");
  }

  return normalized;
}

function normalizeStringRecord(value: unknown, source: string, fieldName: string) {
  const record = expectObject(value, `${source} ${fieldName}`);

  return Object.fromEntries(
    Object.entries(record).map(([key, entryValue]) => [
      key,
      normalizePathLikeString(entryValue, source, `${fieldName}.${key}`),
    ]),
  );
}

function normalizeDocsBaseUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Unsupported protocol");
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    throw invalidConfig("config", "docsBaseUrl", "Expected an absolute HTTP(S) URL.");
  }
}

function inferProjectType(input: VifxConfigInput): VifxProjectType {
  if (input.vite?.mode === "expo" || input.expo) {
    return "expo";
  }

  if (input.vite?.mode === "react-native" || input.reactNative) {
    return "react-native";
  }

  return "unknown";
}

function expectObject(value: unknown, source: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VifxError({
      code: "VIFX_CONFIG_INVALID",
      message: `Invalid Vifx config in "${source}".`,
      hint: "Export a plain object or wrap one with defineVifxConfig({ ... }).",
      details: {
        source,
      },
    });
  }

  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  source: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new VifxError({
        code: "VIFX_CONFIG_INVALID",
        message: `Unknown config key "${key}" in "${source}".`,
        hint: "Remove the key or add it to a documented Vifx config shape.",
        details: {
          source,
          fieldName: key,
        },
      });
    }
  }
}

function expectString(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string") {
    throw invalidConfig(source, fieldName, "Expected a string.");
  }

  return value;
}

function expectBoolean(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "boolean") {
    throw invalidConfig(source, fieldName, "Expected a boolean.");
  }

  return value;
}

function expectPlatform(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string" || !VALID_PLATFORMS.has(value as VifxPlatform)) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_PLATFORMS).join(", ")}.`,
    );
  }

  return value as VifxPlatform;
}

function expectBundlePlatform(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string" || !VALID_BUNDLE_PLATFORMS.has(value as VifxBundlePlatform)) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_BUNDLE_PLATFORMS).join(", ")}.`,
    );
  }

  return value as VifxBundlePlatform;
}

function expectProjectType(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string" || !VALID_PROJECT_TYPES.has(value as VifxProjectType)) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_PROJECT_TYPES).join(", ")}.`,
    );
  }

  return value as VifxProjectType;
}

function expectLogLevel(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string" || !VALID_LOG_LEVELS.has(value as VifxLogLevel)) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_LOG_LEVELS).join(", ")}.`,
    );
  }

  return value as VifxLogLevel;
}

function expectVitePluginMode(value: unknown, source: string, fieldName: string) {
  if (typeof value !== "string" || !VALID_VITE_PLUGIN_MODES.has(value as VifxVitePluginMode)) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_VITE_PLUGIN_MODES).join(", ")}.`,
    );
  }

  return value as VifxVitePluginMode;
}

function expectReactNativeCompatMode(value: unknown, source: string, fieldName: string) {
  if (
    typeof value !== "string" ||
    !VALID_REACT_NATIVE_COMPAT_MODES.has(value as VifxReactNativeCompatMode)
  ) {
    throw invalidConfig(
      source,
      fieldName,
      `Expected one of: ${Array.from(VALID_REACT_NATIVE_COMPAT_MODES).join(", ")}.`,
    );
  }

  return value as VifxReactNativeCompatMode;
}

function resolveConfigExport(moduleExports: Record<string, unknown>, filePath: string) {
  if ("default" in moduleExports) {
    return moduleExports.default;
  }

  if ("vifxConfig" in moduleExports) {
    return moduleExports.vifxConfig;
  }

  throw new VifxError({
    code: "VIFX_CONFIG_INVALID",
    message: `Config file "${filePath}" does not export a Vifx config object.`,
    hint: "Use `export default defineVifxConfig({ ... })`.",
    details: {
      filePath,
    },
  });
}

function createConfigNotFoundError(filePath: string) {
  return new VifxError({
    code: "VIFX_CONFIG_NOT_FOUND",
    message: `Could not find Vifx config file "${filePath}".`,
    hint: `Supported filenames are: ${VIFX_CONFIG_FILENAMES.join(", ")}.`,
    details: {
      filePath,
    },
  });
}

function invalidConfig(source: string, fieldName: string, message: string) {
  return new VifxError({
    code: "VIFX_CONFIG_INVALID",
    message: `Invalid Vifx config in "${source}" at "${fieldName}".`,
    hint: message,
    details: {
      source,
      fieldName,
    },
  });
}

function dedupe<T>(value: T[]) {
  return [...new Set(value)];
}

function dedupeByKey<T>(value: T[], keySelector: (item: T) => string) {
  const seen = new Set<string>();
  return value.filter((item) => {
    const key = keySelector(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
