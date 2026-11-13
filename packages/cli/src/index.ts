import { formatVifxError, serializeVifxError, toVifxError } from "@vifx/errors";
import packageJson from "../package.json" with { type: "json" };
import { runBuildCommand } from "./commands/build.ts";
import { runCompatRunCommand } from "./commands/compat-run.ts";
import { runDevCommand } from "./commands/dev.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import { EXPO_HELP, runExpoAuditCommand } from "./commands/expo-audit.ts";
import { runExpoDevCommand } from "./commands/expo-dev.ts";
import { runExpoExportCommand } from "./commands/expo-export.ts";
import { runExpoSmokeCommand } from "./commands/expo-smoke.ts";
import { runExportEmbedCommand } from "./commands/export-embed.ts";
import { runHermesCompileCommand } from "./commands/hermes-compile.ts";
import { runInitCommand } from "./commands/init.ts";
import { runInspectCommand } from "./commands/inspect.ts";
import { runMetroInspectCommand } from "./commands/metro-inspect.ts";
import { MIGRATE_HELP, runMigrateCommand } from "./commands/migrate.ts";
import { runRunCommand } from "./commands/run.ts";
import { runSetupCommand } from "./commands/setup.ts";
import type { CliResult, ExecuteCliOptions } from "./types.ts";
import { runViteInitCommand } from "./commands/vite-init.ts";

const ROOT_HELP = `vifx

Usage:
  vifx <command> [options]

Commands:
  setup [path]                  Onboard an existing Expo project with Vifx config.
  expo audit [path]             Audit the Expo no-Metro Vite bundling contract.
  expo dev [path]               Start the Expo Vite bundle dev server.
  expo export [path]            Generate Expo bundle artifacts from Vifx builds.
  expo smoke [path]             Smoke-test the Vifx Expo Go server endpoints.
  doctor [path]                 Check project readiness and support boundaries.
  build [path]                  Build Vifx bundle targets from vifx.config.*.
  dev [path]                    Start a Metro-compatible dev server for bare React Native projects.
  export:embed [path]           Build the release bundle and assets for Xcode/Gradle embedding.
  run [path]                    Serve a built Vifx runtime locally.
  inspect [path]                Inspect project primitives.
  compat run [options]          Run compatibility cases with the vifx adapter.
  metro inspect [path]          Inspect captured Metro reference artifacts.
  init [path]                   Generate a vifx.config.ts.
  vite init [path]              Generate a Vifx-owned vite.config.vifx.ts for advanced RN or Expo usage.
  migrate <kind> <path>         Deprecated legacy manual migration surface.
  hermes compile [options]      Compile a bundle to Hermes bytecode.

Options:
  --verbose  Show detailed diagnostic information.
  --debug    Show internal debug logs.
  --help     Show command help.
  --version  Print the CLI version.
`;

// Inlined at build time, so the published CLI reports the version Changesets wrote.
const CLI_VERSION = packageJson.version;

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

    if (argv[0] === "setup") {
      return await runSetupCommand(argv.slice(1), cwd, {
        confirm: options.confirm,
        interactive: options.interactive,
      });
    }

    if (argv[0] === "build") {
      return await runBuildCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "dev") {
      return await runDevCommand(argv.slice(1), cwd);
    }

    if (argv[0] === "export:embed" || argv[0] === "export-embed") {
      return await runExportEmbedCommand(argv.slice(1), cwd);
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

      if (argv[1] === "smoke") {
        return await runExpoSmokeCommand(argv.slice(2), cwd);
      }

      return fail(`Unknown expo subcommand.\n\n${ROOT_HELP}`);
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

// Re-export the config authoring surface so a generated `vifx.config.ts` can
// `import { defineVifxConfig } from "@vifx/cli"` and resolve it from the one
// package a user actually installs (the one that ships the `vifx` bin). The
// underlying `@vifx/config` is a workspace package that is NOT resolvable from a
// fresh app's node_modules, so importing it directly fails with
// VIFX_CONFIG_LOAD_FAILED in every external project.
export {
  defineVifxConfig,
  findVifxConfig,
  loadVifxConfig,
  normalizeVifxConfig,
  validateVifxConfig,
} from "@vifx/config";
export type { LoadVifxConfigOptions, LoadVifxConfigResult } from "@vifx/config";
export type {
  VifxConfig,
  VifxConfigInput,
  VifxExpoOptions,
  VifxResolverConfig,
  VifxViteConfig,
} from "@vifx/types";
