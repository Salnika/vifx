import { constants as fsConstants, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { VifxError } from "@vifx/errors";

const execFileAsync = promisify(execFile);

export interface DetectHermesCompilerOptions {
  compilerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface HermesCompilerDetection {
  available: boolean;
  path: string | null;
  source: "cwd" | "env" | "explicit" | "path" | "unavailable";
}

export interface CompileHermesBytecodeOptions {
  compilerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inputBundlePath: string;
  outputBytecodePath: string;
  sourceMapPath?: string;
}

export interface CompileHermesBytecodeResult {
  bytesWritten: number;
  command: string[];
  compilerPath: string;
  outputBytecodePath: string;
  sourceMapPath?: string;
}

async function isExecutable(filePath: string) {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findInPath(binaryName: string, env: NodeJS.ProcessEnv | undefined) {
  const pathEntries = (env?.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const entry of pathEntries) {
    const candidatePath = path.join(entry, binaryName);
    if (await isExecutable(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function findInWorkingTree(startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidatePath = path.join(currentDirectory, "node_modules/.bin/hermesc");
    if (await isExecutable(candidatePath)) {
      return candidatePath;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

export async function detectHermesCompiler(
  options: DetectHermesCompilerOptions = {},
): Promise<HermesCompilerDetection> {
  if (options.compilerPath) {
    if (!(await isExecutable(options.compilerPath))) {
      return {
        available: false,
        path: null,
        source: "explicit",
      };
    }

    return {
      available: true,
      path: options.compilerPath,
      source: "explicit",
    };
  }

  const environmentCompiler = options.env?.HERMES_CLI ?? options.env?.HERMESC;
  if (environmentCompiler && (await isExecutable(environmentCompiler))) {
    return {
      available: true,
      path: environmentCompiler,
      source: "env",
    };
  }

  const workingDirectoryCompiler = await findInWorkingTree(options.cwd ?? process.cwd());
  if (workingDirectoryCompiler) {
    return {
      available: true,
      path: workingDirectoryCompiler,
      source: "cwd",
    };
  }

  const pathCompiler =
    (await findInPath("hermesc", options.env)) ?? (await findInPath("hermes", options.env));
  if (pathCompiler) {
    return {
      available: true,
      path: pathCompiler,
      source: "path",
    };
  }

  return {
    available: false,
    path: null,
    source: "unavailable",
  };
}

export async function compileHermesBytecode(
  options: CompileHermesBytecodeOptions,
): Promise<CompileHermesBytecodeResult> {
  const inputBundlePath = path.resolve(options.cwd ?? process.cwd(), options.inputBundlePath);
  const outputBytecodePath = path.resolve(options.cwd ?? process.cwd(), options.outputBytecodePath);
  const sourceMapPath = options.sourceMapPath
    ? path.resolve(options.cwd ?? process.cwd(), options.sourceMapPath)
    : undefined;

  if (!(await fileExists(inputBundlePath))) {
    throw new VifxError({
      code: "VIFX_HERMES_INPUT_MISSING",
      hint: "Pass an existing JavaScript bundle path to --input.",
      message: `Bundle input "${inputBundlePath}" does not exist.`,
      details: {
        inputBundlePath,
      },
    });
  }

  const compiler = await detectHermesCompiler(options);
  if (!compiler.available || !compiler.path) {
    throw new VifxError({
      code: "VIFX_HERMES_UNAVAILABLE",
      hint: "Install Hermes and make hermesc available in PATH, HERMES_CLI, or node_modules/.bin.",
      message: "Unable to find a Hermes compiler in the current environment.",
      details: {
        cwd: path.resolve(options.cwd ?? process.cwd()),
      },
    });
  }

  await fs.mkdir(path.dirname(outputBytecodePath), { recursive: true });
  const command = [compiler.path, "-emit-binary", "-out", outputBytecodePath];

  if (sourceMapPath) {
    command.push("-output-source-map");
  }

  command.push(inputBundlePath);

  try {
    await execFileAsync(compiler.path, command.slice(1), {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
    });
  } catch (error) {
    throw new VifxError({
      code: "VIFX_HERMES_COMPILE_FAILED",
      cause: error,
      hint: "Run the Hermes compiler manually with the same bundle to inspect the underlying failure.",
      message: error instanceof Error ? error.message : "Hermes compilation failed.",
      details: {
        command: command.join(" "),
        compilerPath: compiler.path,
        inputBundlePath,
        outputBytecodePath,
      },
    });
  }

  if (!(await fileExists(outputBytecodePath))) {
    throw new VifxError({
      code: "VIFX_HERMES_OUTPUT_MISSING",
      hint: "Check the Hermes compiler arguments and output permissions.",
      message: `Hermes compilation finished without creating "${outputBytecodePath}".`,
      details: {
        command: command.join(" "),
        outputBytecodePath,
      },
    });
  }

  if (sourceMapPath) {
    const defaultSourceMapPath = `${outputBytecodePath}.map`;
    if (await fileExists(defaultSourceMapPath)) {
      await fs.mkdir(path.dirname(sourceMapPath), { recursive: true });
      await fs.rename(defaultSourceMapPath, sourceMapPath);
    }
  }

  const outputStats = await fs.stat(outputBytecodePath);

  return {
    bytesWritten: outputStats.size,
    command,
    compilerPath: compiler.path,
    outputBytecodePath,
    sourceMapPath,
  };
}

export function formatHermesCompileResult(result: CompileHermesBytecodeResult) {
  return [
    "Vifx Hermes Compile",
    "",
    `Compiler: ${result.compilerPath}`,
    `Output: ${result.outputBytecodePath}`,
    `Bytes: ${String(result.bytesWritten)}`,
    ...(result.sourceMapPath ? [`Source map: ${result.sourceMapPath}`] : []),
    `Command: ${result.command.join(" ")}`,
  ].join(os.EOL);
}
