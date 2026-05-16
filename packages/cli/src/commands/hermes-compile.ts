import path from "node:path";
import { compileHermesBytecode, formatHermesCompileResult } from "@vifx/hermes-tools";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const HERMES_COMPILE_HELP = `Usage: vifx hermes compile --input <bundle> --output <file> [--source-map <file>] [--compiler <path>] [--json]

Compiles a JavaScript bundle to Hermes bytecode when a Hermes compiler is available.

Options:
  --input       Input JavaScript bundle path.
  --output      Output bytecode file path.
  --source-map  Optional output source map path.
  --compiler    Optional explicit Hermes compiler path.
  --json        Output machine-readable JSON.
  --help        Show this message.
`;

export async function runHermesCompileCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["compiler", "input", "output", "source-map"],
    aliases: {
      "-h": "--help",
    },
  });

  if (parsed.errors.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: parsed.errors.join("\n"),
    };
  }

  if (parsed.flags.help) {
    return {
      exitCode: 0,
      stdout: HERMES_COMPILE_HELP,
      stderr: "",
    };
  }

  const input = parsed.flags.input as string | undefined;
  const output = parsed.flags.output as string | undefined;

  if (!input || !output) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Missing required --input or --output.\n\n${HERMES_COMPILE_HELP}`,
    };
  }

  const result = await compileHermesBytecode({
    compilerPath: parsed.flags.compiler as string | undefined,
    cwd,
    inputBundlePath: path.resolve(cwd, input),
    outputBytecodePath: path.resolve(cwd, output),
    sourceMapPath: parsed.flags["source-map"]
      ? path.resolve(cwd, parsed.flags["source-map"] as string)
      : undefined,
  });

  return {
    exitCode: 0,
    stdout: parsed.flags.json ? JSON.stringify(result, null, 2) : formatHermesCompileResult(result),
    stderr: "",
  };
}
