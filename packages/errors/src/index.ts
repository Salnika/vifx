import type { VifxDiagnosticData, VifxJsonObject } from "@vifx/types";

export const VIFX_DOCS_BASE_URL = "https://vifx.dev";

export const VIFX_ERROR_CODES = [
  "VIFX_INTERNAL_ERROR",
  "VIFX_ASSET_INVALID_SCALE",
  "VIFX_ASSET_NOT_FOUND",
  "VIFX_ASSET_UNSUPPORTED_TYPE",
  "VIFX_BUILD_INVALID_PLATFORM",
  "VIFX_BUILD_TARGET_NOT_FOUND",
  "VIFX_BUILD_TARGETS_MISSING",
  "VIFX_COMPAT_INVALID_LIBRARY_CASE",
  "VIFX_CONFIG_INVALID",
  "VIFX_CONFIG_LOAD_FAILED",
  "VIFX_CONFIG_MISSING",
  "VIFX_CONFIG_NOT_FOUND",
  "VIFX_CORE_MISSING_PRIMITIVE",
  "VIFX_DEV_BUNDLE_NOT_FOUND",
  "VIFX_DEV_INVALID_PLATFORM",
  "VIFX_DEV_INVALID_PORT",
  "VIFX_DEV_PLATFORM_REQUIRED",
  "VIFX_DEV_REQUIRES_REACT_NATIVE",
  "VIFX_DEV_TARGET_NOT_FOUND",
  "VIFX_DEV_TARGETS_MISSING",
  "VIFX_DEVTOOLS_MIDDLEWARE_FAILED",
  "VIFX_EXPERIMENTAL_EXPO",
  "VIFX_EXPO_CONFIG_NOT_FOUND",
  "VIFX_EXPO_DEV_CLIENT_SIGNING_UNSUPPORTED",
  "VIFX_EXPO_DEV_INVALID_PLATFORM",
  "VIFX_EXPO_DEV_INVALID_PORT",
  "VIFX_EXPO_DEV_PLATFORM_REQUIRED",
  "VIFX_EXPO_DEV_REQUIRES_EXPO_MODE",
  "VIFX_EXPO_DEV_REQUIRES_WEB_COMPAT",
  "VIFX_EXPO_DEV_TARGET_NOT_FOUND",
  "VIFX_EXPO_DEV_TARGETS_MISSING",
  "VIFX_EXPO_DEV_WATCH_UNAVAILABLE",
  "VIFX_EXPO_EXPORT_DUPLICATE_PLATFORM",
  "VIFX_EXPO_EXPORT_INVALID_PLATFORM",
  "VIFX_EXPO_EXPORT_NOT_FOUND",
  "VIFX_EXPO_EXPORT_REQUIRES_EXPO_MODE",
  "VIFX_EXPO_EXPORT_TARGET_NOT_FOUND",
  "VIFX_EXPO_EXPORT_TARGETS_MISSING",
  "VIFX_EXPO_PLUGIN_BUNDLE_PHASE_NOT_FOUND",
  "VIFX_EXPO_PLUGIN_GRADLE_LANGUAGE_UNSUPPORTED",
  "VIFX_EXPO_PLUGIN_GRADLE_REACT_BLOCK_UNTERMINATED",
  "VIFX_EXPO_PLUGIN_SHELL_SCRIPT_UNREADABLE",
  "VIFX_EXPO_SMOKE_INVALID_ASSET_LIMIT",
  "VIFX_EXPO_SMOKE_REQUIRES_EXPO_MODE",
  "VIFX_EXPO_SMOKE_WEBSOCKET_UNAVAILABLE",
  "VIFX_EXPORT_EMBED_BUNDLE_OUTPUT_REQUIRED",
  "VIFX_EXPORT_EMBED_INVALID_FLAG",
  "VIFX_EXPORT_EMBED_INVALID_PLATFORM",
  "VIFX_EXPORT_EMBED_PROJECT_NOT_FOUND",
  "VIFX_HERMES_COMPILE_FAILED",
  "VIFX_HERMES_INPUT_MISSING",
  "VIFX_HERMES_OUTPUT_MISSING",
  "VIFX_HERMES_UNAVAILABLE",
  "VIFX_MIGRATION_UNSAFE_CHANGE",
  "VIFX_MONOREPO_EXPERIMENTAL",
  "VIFX_NO_ISSUES",
  "VIFX_PROD_ASSET_VARIANT_MISSING",
  "VIFX_PROD_ASSET_WRITE_FAILED",
  "VIFX_PROJECT_EXPERIMENTAL_EXPO_SDK",
  "VIFX_PROJECT_INVALID_APP_JSON",
  "VIFX_PROJECT_INVALID_PACKAGE_JSON",
  "VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION",
  "VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE",
  "VIFX_RESOLVE_INVALID_PACKAGE_JSON",
  "VIFX_RESOLVE_INVALID_SPECIFIER",
  "VIFX_RESOLVE_NOT_FOUND",
  "VIFX_RUN_INVALID_PLATFORM",
  "VIFX_RUN_INVALID_PORT",
  "VIFX_RUN_PLATFORM_REQUIRED",
  "VIFX_RUN_REQUIRES_WEB_COMPAT",
  "VIFX_RUN_RUNTIME_MISSING",
  "VIFX_RUN_RUNTIME_NOT_FOUND",
  "VIFX_RUN_TARGET_NOT_FOUND",
  "VIFX_RUN_TARGETS_MISSING",
  "VIFX_SOURCEMAP_INVALID",
  "VIFX_SETUP_APP_JSON_REQUIRED",
  "VIFX_SETUP_CONFIRMATION_REQUIRED",
  "VIFX_SETUP_EXPO_ONLY",
  "VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST",
  "VIFX_UNSUPPORTED_METRO_SERIALIZER",
  "VIFX_VITE_BUNDLE_MISSING",
] as const;

export type KnownVifxErrorCode = (typeof VIFX_ERROR_CODES)[number];
export type VifxErrorCode = KnownVifxErrorCode | (string & {});

export interface VifxErrorOptions extends Omit<VifxDiagnosticData, "code"> {
  code: VifxErrorCode;
  cause?: unknown;
}

export interface SerializedVifxError {
  name: string;
  code: string;
  message: string;
  hint?: string;
  docsPath?: string;
  docsUrl?: string;
  details?: VifxJsonObject;
  stack?: string;
  causeMessage?: string;
}

function defaultDocsPath(code: string) {
  return `/errors/${code}`;
}

export class VifxError extends Error {
  readonly code: VifxErrorCode;
  readonly hint?: string;
  readonly docsPath?: string;
  readonly details?: VifxJsonObject;

  constructor(options: VifxErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = "VifxError";
    this.code = options.code;
    this.hint = options.hint;
    this.docsPath = options.docsPath ?? defaultDocsPath(options.code);
    this.details = options.details;
  }

  get summary() {
    return this.message;
  }

  get docsUrl() {
    return resolveVifxDocsUrl(this.docsPath);
  }

  toJSON() {
    return serializeVifxError(this);
  }
}

export function isVifxError(error: unknown): error is VifxError {
  if (error instanceof VifxError) {
    return true;
  }

  return (
    error instanceof Error &&
    error.name === "VifxError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export function resolveVifxDocsUrl(docsPath?: string, docsBaseUrl = VIFX_DOCS_BASE_URL) {
  if (!docsPath) {
    return undefined;
  }

  try {
    if (docsPath.startsWith("http://") || docsPath.startsWith("https://")) {
      return new URL(docsPath).toString();
    }

    return new URL(docsPath, docsBaseUrl).toString();
  } catch {
    return docsPath;
  }
}

export function serializeVifxError(
  error: VifxError,
  options: {
    includeStack?: boolean;
    docsBaseUrl?: string;
  } = {},
): SerializedVifxError {
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    hint: error.hint,
    docsPath: error.docsPath,
    docsUrl: resolveVifxDocsUrl(error.docsPath, options.docsBaseUrl),
    details: error.details,
    stack: options.includeStack ? error.stack : undefined,
    causeMessage:
      error.cause instanceof Error
        ? error.cause.message
        : typeof error.cause === "string"
          ? error.cause
          : undefined,
  };
}

export function formatVifxError(
  error: unknown,
  options: {
    includeStack?: boolean;
    docsBaseUrl?: string;
  } = {},
) {
  const vifxError = toVifxError(error);
  const lines = [`[${vifxError.code}] ${vifxError.message}`];

  if (vifxError.hint) {
    lines.push(`Hint: ${vifxError.hint}`);
  }

  const docsUrl = resolveVifxDocsUrl(vifxError.docsPath, options.docsBaseUrl);
  if (docsUrl) {
    lines.push(`Docs: ${docsUrl}`);
  }

  if (options.includeStack && vifxError.stack) {
    lines.push(vifxError.stack);
  }

  return lines.join("\n");
}

export function toVifxError(error: unknown, fallback: Partial<VifxErrorOptions> = {}) {
  if (isVifxError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = fallback.message ?? error.message ?? "An unexpected error occurred.";

    return new VifxError({
      code: fallback.code ?? "VIFX_INTERNAL_ERROR",
      message,
      hint: fallback.hint,
      docsPath: fallback.docsPath,
      details: fallback.details,
      cause: error,
    });
  }

  return new VifxError({
    code: fallback.code ?? "VIFX_INTERNAL_ERROR",
    message: fallback.message ?? "An unexpected non-error value was thrown.",
    hint: fallback.hint,
    docsPath: fallback.docsPath,
    details:
      fallback.details ??
      ({
        thrownValue: describeThrownValue(error),
      } satisfies VifxJsonObject),
  });
}

function describeThrownValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
