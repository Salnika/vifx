import path from "node:path";
import {
  createNativeCommandPlan,
  runNativeCommandPlan,
  type VifxNativeAction,
  type VifxNativeCommandPlan,
  type VifxNativeCommandStep,
} from "@vifx/native-artifacts";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

export const NATIVE_ROOT_HELP = `Usage: vifx native <command> [path] [options]

Commands:
  doctor [path]               Validate native host and toolchain readiness.
  prepare [path]              Prepare native-ready iOS/Android artifacts.
  build [path]                Build a detected iOS or Android host.
  install [path]              Install a built native app.
  launch [path]               Launch an installed native app.
  run [path]                  Prepare, diagnose, build, install, and launch.

Lifecycle options:
  --platform ios|android      Native platform to operate on. Required for build/install/launch/run.
  --dry-run                   Optional preview mode without executing native commands.
  --json                      Output machine-readable command plans.

Run vifx native prepare --help or vifx native build --help for command-specific options.
`;

const NATIVE_LIFECYCLE_HELP = `Usage: vifx native <build|install|launch> [path] --platform ios|android [options]

Plans and optionally executes native host lifecycle commands.

Options:
  --platform        Native platform. Required: ios or android.
  --dry-run         Optional preview mode without executing native commands.
  --json            Output machine-readable command plan and execution status.
  --scheme          iOS scheme override.
  --configuration   iOS build configuration. Default: Debug.
  --destination     iOS xcodebuild destination. Default: generic/platform=iOS Simulator.
  --device          Simulator/device selector for install or launch. Default: booted.
  --bundle-id       iOS bundle id override for launch.
  --application-id  Android application id override for launch.
  --variant         Android variant. Default: Debug.
  --app-path        App bundle or APK path override for install.
  --help            Show this message.
`;

function validateLifecyclePlatform(value: string | undefined) {
  if (value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_NATIVE_INVALID_PLATFORM",
    docsPath: "/reference/cli#vifx-native-build-install-launch",
    hint: "Pass --platform ios or --platform android.",
    message: "Native build, install, and launch require an explicit platform.",
  });
}

function quoteShellArg(value: string) {
  if (/^[\w./:=+-]+$/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatStep(step: VifxNativeCommandStep) {
  return [step.command, ...step.args].map(quoteShellArg).join(" ");
}

function formatPlan(plan: VifxNativeCommandPlan, options: { dryRun: boolean }) {
  return [
    `[${plan.platform}]`,
    `  Host: ${path.relative(plan.host.projectRoot, plan.host.hostRoot) || "."}`,
    ...plan.steps.flatMap((step) => [`  ${step.label}:`, `    ${formatStep(step)}`]),
    options.dryRun ? "  Dry run only. No native command was executed." : "  Executed.",
  ].join("\n");
}

export async function runNativeLifecycleCommand(
  action: VifxNativeAction,
  argv: string[],
  cwd: string,
): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["dry-run", "help", "json"],
    stringFlags: [
      "app-path",
      "application-id",
      "bundle-id",
      "configuration",
      "destination",
      "device",
      "platform",
      "scheme",
      "variant",
    ],
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
      stdout: NATIVE_LIFECYCLE_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const platform = validateLifecyclePlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const plan = await createNativeCommandPlan({
    action,
    androidApplicationId:
      typeof parsed.flags["application-id"] === "string"
        ? parsed.flags["application-id"]
        : undefined,
    appPath: typeof parsed.flags["app-path"] === "string" ? parsed.flags["app-path"] : undefined,
    bundleId: typeof parsed.flags["bundle-id"] === "string" ? parsed.flags["bundle-id"] : undefined,
    configuration:
      typeof parsed.flags.configuration === "string" ? parsed.flags.configuration : undefined,
    destination:
      typeof parsed.flags.destination === "string" ? parsed.flags.destination : undefined,
    device: typeof parsed.flags.device === "string" ? parsed.flags.device : undefined,
    platform,
    projectRoot,
    scheme: typeof parsed.flags.scheme === "string" ? parsed.flags.scheme : undefined,
    variant: typeof parsed.flags.variant === "string" ? parsed.flags.variant : undefined,
  });
  const dryRun = Boolean(parsed.flags["dry-run"]);
  const execution = dryRun ? null : runNativeCommandPlan(plan);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          action,
          dryRun,
          execution,
          plan,
          projectRoot,
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  return {
    exitCode: 0,
    stdout: [
      `Vifx Native ${action.slice(0, 1).toUpperCase()}${action.slice(1)}`,
      "",
      formatPlan(plan, { dryRun }),
    ].join("\n"),
    stderr: "",
  };
}
