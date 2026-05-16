import { formatVifxError, serializeVifxError, toVifxError } from "@vifx/errors";
import { runBuildCommand } from "./commands/build.ts";
import { runCompatRunCommand } from "./commands/compat-run.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import { runHermesCompileCommand } from "./commands/hermes-compile.ts";
import { runInitCommand } from "./commands/init.ts";
import { runInspectCommand } from "./commands/inspect.ts";
import { runMetroInspectCommand } from "./commands/metro-inspect.ts";
import { runMigrateCommand } from "./commands/migrate.ts";
import { runRunCommand } from "./commands/run.ts";
import type { CliResult, ExecuteCliOptions } from "./types.ts";
import { runViteInitCommand } from "./commands/vite-init.ts";

const ROOT_HELP = `vifx

Usage:
  vifx <command> [options]

Commands:
  build [path]                  Build Vifx bundle targets from vifx.config.*.
  run [path]                    Serve a built Vifx runtime locally.
  doctor [path]                 Check project readiness.
  init [path]                   Generate a first-pass vifx.config.ts.
  inspect [path]                Inspect first-pass project primitives.
  compat run [options]          Run compatibility cases with the vifx adapter.
  metro inspect [path]          Inspect captured Metro reference artifacts.
  vite init [path]              Generate a first-pass vite.config.ts for RN or Expo.
  migrate expo <path>           Prepare an Expo project for Vifx experiments.
  migrate react-native <path>   Prepare a React Native project for Vifx experiments.
  hermes compile [options]      Compile a bundle to Hermes bytecode.

Options:
  --help     Show command help.
  --version  Print the CLI version.
`;

const CLI_VERSION = "0.0.0";

function ok(stdout: string): CliResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  };
}

function fail(stderr: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
  };
}

function shouldRenderJsonError(argv: string[]) {
  return argv.includes("--json");
}

export async function executeCli(
  argv: string[],
  options: ExecuteCliOptions = {},
): Promise<CliResult> {
  const cwd = options.cwd ?? options.env?.INIT_CWD ?? process.cwd();
  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      return ok(ROOT_HELP);
    }

    if (argv[0] === "--version") {
      return ok(CLI_VERSION);
    }

    if (argv[0] === "doctor") {
      return await runDoctorCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "build") {
      return await runBuildCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "run") {
      return await runRunCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "init") {
      return await runInitCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "inspect") {
      return await runInspectCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "compat") {
      if (argv[1] === "run") {
        return await runCompatRunCommand(argv.slice(2));
      }

      return fail(`Unknown compat subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "metro") {
      if (argv[1] === "inspect") {
        return await runMetroInspectCommand(argv.slice(2), cwd);
      }

      return fail(`Unknown metro subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "vite") {
      if (argv[1] === "init") {
        return await runViteInitCommand(argv.slice(2), cwd);
      }

      return fail(`Unknown vite subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "migrate") {
      if (argv[1] === "expo") {
        return await runMigrateCommand("expo", argv.slice(2), cwd);
      }

      if (argv[1] === "react-native") {
        return await runMigrateCommand("react-native", argv.slice(2), cwd);
      }

      return fail(`Unknown migrate subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "hermes") {
      if (argv[1] === "compile") {
        return await runHermesCompileCommand(argv.slice(2), cwd);
      }

      return fail(`Unknown hermes subcommand.\n\n${ROOT_HELP}`);
    }

    return fail(`Unknown command "${argv[0]}".\n\n${ROOT_HELP}`);
  } catch (error) {
    const vifxError = toVifxError(error);
    return fail(
      shouldRenderJsonError(argv)
        ? JSON.stringify(serializeVifxError(vifxError), null, 2)
        : formatVifxError(vifxError),
    );
  }
}

export * from "./types.ts";
