import { serializeVifxError, toVifxError, type SerializedVifxError } from "@vifx/errors";
import chalk from "chalk";
import { createConsola, type ConsolaInstance, type ConsolaReporter } from "consola";
import logSymbols from "log-symbols";
import ora, { type Ora } from "ora";

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

export interface VifxDisplayItem {
  label: string;
  value: string | number | boolean | null | undefined;
}

export interface VifxSpinnerOptions {
  enabled?: boolean;
  silent?: boolean;
  stream?: NodeJS.WritableStream;
  text: string;
}

interface ResolvedLoggerOptions {
  name?: string;
  level: VifxLoggerLevel;
  verbose: boolean;
  json: boolean;
  stream: VifxWritableStream;
  errorStream: VifxWritableStream;
}

type VifxConsolaType = "debug" | "error" | "info" | "warn";

interface VifxConsolaPayload {
  vifxRecord: VifxLogRecord;
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

function isVifxLogRecord(value: unknown): value is VifxLogRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "timestamp" in value &&
    "level" in value &&
    "message" in value
  );
}

function isVifxConsolaPayload(value: unknown): value is VifxConsolaPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "vifxRecord" in value &&
    isVifxLogRecord((value as VifxConsolaPayload).vifxRecord)
  );
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

function formatLogSymbol(level: VifxLoggerLevel) {
  if (level === "error") {
    return logSymbols.error;
  }

  if (level === "warn") {
    return logSymbols.warning;
  }

  if (level === "debug") {
    return chalk.gray("-");
  }

  return logSymbols.info;
}

function formatLevel(level: VifxLoggerLevel) {
  if (level === "error") {
    return chalk.red("error");
  }

  if (level === "warn") {
    return chalk.yellow("warn");
  }

  if (level === "debug") {
    return chalk.gray("debug");
  }

  return chalk.cyan("info");
}

function formatPrettyRecord(record: VifxLogRecord, verbose: boolean) {
  const prefix = [formatLogSymbol(record.level), formatLevel(record.level)];

  if (record.logger) {
    prefix.push(chalk.gray(record.logger));
  }

  if (record.error?.code) {
    prefix.push(chalk.gray(record.error.code));
  }

  const lines = [`${prefix.join(" ")} ${record.message}`.trim()];

  if (record.error?.hint) {
    lines.push(`${chalk.gray("hint")} ${record.error.hint}`);
  }

  if (record.error?.docsUrl) {
    lines.push(`${chalk.gray("docs")} ${record.error.docsUrl}`);
  }

  if (verbose && record.context) {
    lines.push(`${chalk.gray("context")} ${serializeUnknownValue(record.context)}`);
  }

  if (verbose && record.error?.stack) {
    lines.push(record.error.stack);
  }

  return `${lines.join("\n")}\n`;
}

function formatJsonRecord(record: VifxLogRecord) {
  return `${serializeUnknownValue(record)}\n`;
}

function getRecordStream(record: VifxLogRecord, options: ResolvedLoggerOptions) {
  return record.level === "error" || record.level === "warn" ? options.errorStream : options.stream;
}

function toConsolaType(level: VifxLoggerLevel): VifxConsolaType {
  if (level === "debug") {
    return "debug";
  }

  if (level === "error") {
    return "error";
  }

  if (level === "warn") {
    return "warn";
  }

  return "info";
}

function createPrettyConsola(options: ResolvedLoggerOptions): ConsolaInstance {
  const reporter: ConsolaReporter = {
    log(logObject) {
      const payload = logObject.args.find(isVifxConsolaPayload);
      const record = payload?.vifxRecord;

      if (!record) {
        return;
      }

      getRecordStream(record, options).write(formatPrettyRecord(record, options.verbose));
    },
  };

  return createConsola({
    fancy: true,
    level: Number.POSITIVE_INFINITY,
    reporters: [reporter],
  });
}

function dispatchPrettyRecord(consola: ConsolaInstance, record: VifxLogRecord) {
  const type = toConsolaType(record.level);
  const payload: VifxConsolaPayload = { vifxRecord: record };

  if (type === "debug") {
    consola.debug(payload);
    return;
  }

  if (type === "error") {
    consola.error(payload);
    return;
  }

  if (type === "warn") {
    consola.warn(payload);
    return;
  }

  consola.info(payload);
}

export function formatVifxHeader(title: string, subtitle?: string) {
  return [chalk.bold(title), subtitle ? chalk.gray(subtitle) : undefined]
    .filter(Boolean)
    .join("\n");
}

export function formatVifxKeyValues(items: VifxDisplayItem[]) {
  const filteredItems = items.filter((item) => item.value !== undefined && item.value !== null);
  const labelWidth = Math.max(0, ...filteredItems.map((item) => item.label.length));

  return filteredItems
    .map((item) => {
      const label = chalk.gray(item.label.padEnd(labelWidth));

      return `${label}  ${String(item.value)}`;
    })
    .join("\n");
}

export function formatVifxInfo(message: string) {
  return `${logSymbols.info} ${message}`;
}

export function formatVifxSuccess(message: string) {
  return `${logSymbols.success} ${message}`;
}

export function formatVifxWarning(message: string) {
  return `${logSymbols.warning} ${message}`;
}

/**
 * Dims a fragment (gray) for low-emphasis inline labels — e.g. the phase labels
 * in a one-line rebuild instrumentation report. Honors chalk's own NO_COLOR /
 * TTY detection, so piped/`--json` output stays plain.
 */
export function formatVifxMuted(text: string) {
  return chalk.gray(text);
}

export function createSpinner(options: VifxSpinnerOptions): Ora {
  return ora({
    color: "cyan",
    // Ora's default discardStdin puts stdin in raw mode while spinning and
    // restores the *previous* (cooked) mode on succeed()/stop(). That stop runs
    // after a long-lived command (e.g. `expo dev`) has already installed its own
    // raw-mode keybindings, silently reverting them — keys then echo as cooked
    // line input and never fire. Leaving stdin alone keeps interactive
    // keybindings working; transient build spinners don't need to mute input.
    discardStdin: false,
    isEnabled: options.enabled,
    isSilent: options.silent,
    stream: options.stream ?? process.stderr,
    text: options.text,
  });
}

export function createLogger(options: VifxLoggerOptions = {}): VifxLogger {
  const resolvedOptions = resolveLoggerOptions(options);
  const prettyConsola = createPrettyConsola(resolvedOptions);

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

    if (!resolvedOptions.json) {
      dispatchPrettyRecord(prettyConsola, record);
      return;
    }

    getRecordStream(record, resolvedOptions).write(formatJsonRecord(record));
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
