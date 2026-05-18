import { serializeVifxError, toVifxError, type SerializedVifxError } from "@vifx/errors";

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type VifxLoggerLevel = keyof typeof LOG_LEVEL_PRIORITY;

export interface VifxLogContext {
  [key: string]: unknown;
}

export interface VifxWritableStream {
  write(chunk: string): unknown;
}

export interface VifxLoggerOptions {
  name?: string;
  level?: VifxLoggerLevel;
  verbose?: boolean;
  debug?: boolean;
  silent?: boolean;
  json?: boolean;
  stream?: VifxWritableStream;
  errorStream?: VifxWritableStream;
}

export interface VifxLogRecord {
  timestamp: string;
  level: VifxLoggerLevel;
  logger?: string;
  message: string;
  context?: VifxLogContext;
  error?: SerializedVifxError;
}

export interface VifxLogger {
  readonly level: VifxLoggerLevel;
  readonly options: Readonly<ResolvedLoggerOptions>;
  error(message: string | Error, context?: VifxLogContext): void;
  warn(message: string | Error, context?: VifxLogContext): void;
  info(message: string | Error, context?: VifxLogContext): void;
  debug(message: string | Error, context?: VifxLogContext): void;
}

interface ResolvedLoggerOptions {
  name?: string;
  level: VifxLoggerLevel;
  verbose: boolean;
  json: boolean;
  stream: VifxWritableStream;
  errorStream: VifxWritableStream;
}

function createWritableStream(write: (chunk: string) => unknown): VifxWritableStream {
  return {
    write,
  };
}

function defaultStream() {
  return createWritableStream((chunk) => process.stdout.write(chunk));
}

function defaultErrorStream() {
  return createWritableStream((chunk) => process.stderr.write(chunk));
}

function resolveLoggerLevel(options: VifxLoggerOptions): VifxLoggerLevel {
  if (options.silent) {
    return "error";
  }

  if (options.debug || process.env.VIFX_DEBUG === "true") {
    return "debug";
  }

  return options.level ?? "info";
}

function resolveLoggerOptions(options: VifxLoggerOptions): ResolvedLoggerOptions {
  const verbose = options.verbose ?? process.env.VIFX_VERBOSE === "true";

  return {
    name: options.name,
    level: resolveLoggerLevel(options),
    verbose,
    json: options.json ?? false,
    stream: options.stream ?? defaultStream(),
    errorStream: options.errorStream ?? options.stream ?? defaultErrorStream(),
  };
}

function shouldLog(level: VifxLoggerLevel, threshold: VifxLoggerLevel) {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold];
}

function serializeUnknownValue(value: unknown) {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_, current: unknown) => {
      if (typeof current === "bigint") {
        return current.toString();
      }

      if (typeof current === "function") {
        return `[Function ${(current as { name?: string }).name ?? "anonymous"}]`;
      }

      if (typeof current === "symbol") {
        return current.toString();
      }

      if (current instanceof Error) {
        return serializeVifxError(toVifxError(current), { includeStack: true });
      }

      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) {
          return "[Circular]";
        }

        seen.add(current);
      }

      return current;
    },
    2,
  );
}

function formatPrettyRecord(record: VifxLogRecord, verbose: boolean) {
  const prefix = [`[${record.level.toUpperCase()}]`];

  if (record.logger) {
    prefix.push(record.logger);
  }

  if (record.error?.code) {
    prefix.push(`[${record.error.code}]`);
  }

  const lines = [`${prefix.join(" ")} ${record.message}`.trim()];

  if (record.error?.hint) {
    lines.push(`Hint: ${record.error.hint}`);
  }

  if (record.error?.docsUrl) {
    lines.push(`Docs: ${record.error.docsUrl}`);
  }

  if (verbose && record.context) {
    lines.push(`Context: ${serializeUnknownValue(record.context)}`);
  }

  if (verbose && record.error?.stack) {
    lines.push(record.error.stack);
  }

  return `${lines.join("\n")}\n`;
}

function formatJsonRecord(record: VifxLogRecord) {
  return `${serializeUnknownValue(record)}\n`;
}

export function createLogger(options: VifxLoggerOptions = {}): VifxLogger {
  const resolvedOptions = resolveLoggerOptions(options);

  function emit(level: VifxLoggerLevel, input: string | Error, context?: VifxLogContext) {
    if (!shouldLog(level, resolvedOptions.level)) {
      return;
    }

    const error = input instanceof Error ? toVifxError(input) : undefined;
    const message = typeof input === "string" ? input : (error?.message ?? "Unexpected error");
    const record: VifxLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      logger: resolvedOptions.name,
      message,
      context,
      error: error
        ? serializeVifxError(error, { includeStack: resolvedOptions.verbose })
        : undefined,
    };

    const line = resolvedOptions.json
      ? formatJsonRecord(record)
      : formatPrettyRecord(record, resolvedOptions.verbose);
    const stream =
      level === "error" || level === "warn" ? resolvedOptions.errorStream : resolvedOptions.stream;

    stream.write(line);
  }

  return {
    level: resolvedOptions.level,
    options: resolvedOptions,
    error: (message, context) => emit("error", message, context),
    warn: (message, context) => emit("warn", message, context),
    info: (message, context) => emit("info", message, context),
    debug: (message, context) => emit("debug", message, context),
  };
}
