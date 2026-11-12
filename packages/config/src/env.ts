import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Dotenv loading with the semantics of Expo CLI (`@expo/env`), so a project's
 * `.env` files mean the same thing under Vifx as under `expo start` /
 * `expo export`:
 *
 * - files are read in priority order `.env.<mode>.local`, `.env.local`,
 *   `.env.<mode>`, `.env` — the first file to define a key wins;
 * - `.env.local` is skipped in `test` mode, so tests are reproducible;
 * - a variable already present in the environment is never overridden;
 * - `$VAR` / `${VAR}` / `${VAR:-default}` references are expanded;
 * - `EXPO_NO_DOTENV=1` turns the whole mechanism off.
 */

export type VifxEnvRecord = Record<string, string | undefined>;

export interface LoadProjectEnvOptions {
  /**
   * Environment the files are layered under (defaults to `process.env`). Its
   * values always win and feed variable expansion. It is not mutated.
   */
  env?: VifxEnvRecord;
  /** Selects `.env.<mode>` / `.env.<mode>.local`: "development", "production", "test". */
  mode: string;
  projectRoot: string;
}

export interface LoadedProjectEnv {
  /** Variables the files contribute: keys the base environment did not define. */
  env: Record<string, string>;
  /** Files that exist and were read, highest priority first (project-relative). */
  files: string[];
}

const REFERENCE_PATTERN =
  /(\\)?\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/gu;
const MAX_EXPANSION_DEPTH = 8;

/** Dotenv file names for `mode`, highest priority first. */
export function getProjectEnvFileNames(mode: string): string[] {
  return [
    `.env.${mode}.local`,
    // Local overrides are machine-specific; tests must not depend on them.
    ...(mode === "test" ? [] : [".env.local"]),
    `.env.${mode}`,
    ".env",
  ];
}

function isDotenvDisabled(env: VifxEnvRecord) {
  const flag = env.EXPO_NO_DOTENV?.trim().toLowerCase();
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

function expandValue(
  value: string,
  lookup: (name: string) => string | undefined,
  depth = 0,
): string {
  if (depth >= MAX_EXPANSION_DEPTH || !value.includes("$")) {
    return value;
  }

  return value.replace(
    REFERENCE_PATTERN,
    (match, escaped: string | undefined, braced: string | undefined, fallback, bare) => {
      if (escaped) {
        // `\$NAME` is a literal dollar sign.
        return match.slice(1);
      }

      const name = braced ?? (bare as string);
      const resolved = lookup(name);
      if (resolved !== undefined && resolved !== "") {
        return expandValue(resolved, lookup, depth + 1);
      }

      return typeof fallback === "string" ? expandValue(fallback, lookup, depth + 1) : "";
    },
  );
}

/**
 * Reads the project's dotenv files for `mode`. Returns only what the files add
 * on top of the base environment; nothing is written to `process.env` (see
 * {@link applyProjectEnv}).
 */
export async function loadProjectEnv(options: LoadProjectEnvOptions): Promise<LoadedProjectEnv> {
  const baseEnv = options.env ?? process.env;
  if (isDotenvDisabled(baseEnv)) {
    return { env: {}, files: [] };
  }

  const parsed: Record<string, string> = {};
  const files: string[] = [];

  for (const fileName of getProjectEnvFileNames(options.mode)) {
    const source = await readFile(path.join(options.projectRoot, fileName), "utf8").catch(
      () => null,
    );
    if (source === null) {
      continue;
    }

    files.push(fileName);
    for (const [key, value] of Object.entries(parseEnv(source))) {
      // Shell variables win over every file; among files, the first definition
      // (highest priority) wins.
      if (baseEnv[key] === undefined && parsed[key] === undefined && value !== undefined) {
        parsed[key] = value;
      }
    }
  }

  const lookup = (name: string) => baseEnv[name] ?? parsed[name];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    // Any dollar sign still escaped after expansion (`\$10`) is a literal one.
    env[key] = expandValue(value, lookup).replace(/\\\$/gu, "$");
  }

  return { env, files };
}

/**
 * Copies loaded dotenv variables into `target` (defaults to `process.env`)
 * without overriding anything already set there — what Expo CLI does at
 * startup, so `app.config.js` and the bundler both see them.
 */
export function applyProjectEnv(
  loaded: LoadedProjectEnv,
  target: VifxEnvRecord = process.env,
): string[] {
  const applied: string[] = [];

  for (const [key, value] of Object.entries(loaded.env)) {
    if (target[key] === undefined) {
      target[key] = value;
      applied.push(key);
    }
  }

  return applied;
}
