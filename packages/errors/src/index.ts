import type { VifxDiagnosticData, VifxJsonObject } from "@vifx/types";

export const VIFX_DOCS_BASE_URL = "https://vifx.dev";

export const VIFX_ERROR_CODES = [
  "VIFX_INTERNAL_ERROR",
  "VIFX_CONFIG_NOT_FOUND",
  "VIFX_CONFIG_INVALID",
  "VIFX_CONFIG_LOAD_FAILED",
  "VIFX_RESOLVE_NOT_FOUND",
  "VIFX_RESOLVE_AMBIGUOUS_PLATFORM_FILE",
  "VIFX_ASSET_INVALID_SCALE",
  "VIFX_SOURCEMAP_INVALID",
  "VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION",
  "VIFX_MIGRATION_UNSAFE_CHANGE",
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
