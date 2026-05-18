import { formatVifxError, serializeVifxError, toVifxError } from "@vifx/errors";
import { runBuildCommand } from "./commands/build.ts";
import { runCompatRunCommand } from "./commands/compat-run.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import {
  EXPO_HELP,
  runExpoAuditCommand,
  runExpoDevCommand,
  runExpoExportCommand,
  runExpoServeCommand,
} from "./commands/expo-audit.ts";
import { runHermesCompileCommand } from "./commands/hermes-compile.ts";
import { runInitCommand } from "./commands/init.ts";
import { runInspectCommand } from "./commands/inspect.ts";
import { runMetroInspectCommand } from "./commands/metro-inspect.ts";
import { MIGRATE_HELP, runMigrateCommand } from "./commands/migrate.ts";
import { runNativeDoctorCommand } from "./commands/native-doctor.ts";
import { NATIVE_ROOT_HELP, runNativeLifecycleCommand } from "./commands/native-lifecycle.ts";
import { runNativePrepareCommand } from "./commands/native-prepare.ts";
import { runNativeRunCommand } from "./commands/native-run.ts";
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
  init [path]                   Generate a vifx.config.ts.
  inspect [path]                Inspect project primitives.
  compat run [options]          Run compatibility cases with the vifx adapter.
  metro inspect [path]          Inspect captured Metro reference artifacts.
  vite init [path]              Generate a Vifx-owned vite.config.vifx.ts for RN or Expo.
  migrate expo <path>           Prepare an Expo project for Vifx experiments.
  migrate react-native <path>   Prepare a React Native project for Vifx experiments.
  expo audit [path]             Audit the Expo without Metro support contract.
  expo dev [path]               Start a bounded Expo browser dev server.
  expo export [path]            Generate a bounded Expo export from Vifx bundles.
  expo serve [path]             Serve a bounded Expo Updates v1 export locally.
  native <command> [path]       Diagnose, prepare, build, install, or launch native hosts.
  hermes compile [options]      Compile a bundle to Hermes bytecode.

Options:
  --verbose  Show detailed diagnostic information.
  --debug    Show internal debug logs.
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

import { parseFlags } from "./lib/args.ts";

export async function executeCli(
  argv: string[],
  options: ExecuteCliOptions = {},
): Promise<CliResult> {
  const cwd = options.cwd ?? options.env?.INIT_CWD ?? process.cwd();

  const globalFlags = parseFlags(argv, {
    booleanFlags: ["verbose", "debug"],
    aliases: {
      "-v": "--verbose",
    },
    ignoreUnknownFlags: true,
  });

  if (globalFlags.flags.verbose) {
    process.env.VIFX_VERBOSE = "true";
  }

  if (globalFlags.flags.debug) {
    process.env.VIFX_DEBUG = "true";
  }

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
      if (argv[1] === undefined || argv[1] === "--help" || argv[1] === "-h") {
        return ok(MIGRATE_HELP);
      }

      if (argv[1] === "expo") {
        return await runMigrateCommand("expo", argv.slice(2), cwd);
      }

      if (argv[1] === "react-native") {
        return await runMigrateCommand("react-native", argv.slice(2), cwd);
      }

      return fail(`Unknown migrate subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "expo") {
      if (argv[1] === undefined || argv[1] === "--help" || argv[1] === "-h") {
        return ok(EXPO_HELP);
      }

      if (argv[1] === "audit") {
        return await runExpoAuditCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "dev") {
        return await runExpoDevCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "export") {
        return await runExpoExportCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "serve") {
        return await runExpoServeCommand(argv.slice(2), cwd);
      }

      return fail(`Unknown expo subcommand.\n\n${ROOT_HELP}`);
    }

    if (argv[0] === "native") {
      if (argv[1] === undefined || argv[1] === "--help" || argv[1] === "-h") {
        return ok(NATIVE_ROOT_HELP);
      }

      if (argv[1] === "prepare") {
        return await runNativePrepareCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "doctor") {
        return await runNativeDoctorCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "run") {
        return await runNativeRunCommand(argv.slice(2), cwd);
      }

      if (argv[1] === "build" || argv[1] === "install" || argv[1] === "launch") {
        return await runNativeLifecycleCommand(argv[1], argv.slice(2), cwd);
      }

      return fail(`Unknown native subcommand.\n\n${ROOT_HELP}`);
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
