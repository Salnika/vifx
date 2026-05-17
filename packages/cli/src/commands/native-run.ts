import path from "node:path";
import {
  createNativeCommandPlan,
  diagnoseNativeRuntimeTargets,
  runNativeCommandPlan,
  validateNativeHost,
  type NativeCommandExecutionResult,
  type VifxNativeCommandPlan,
} from "@vifx/native-artifacts";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";
import { prepareConfiguredNativeTargets } from "./native-prepare.ts";

const NATIVE_RUN_HELP = `Usage: vifx native run [path] --platform ios|android [options]

Prepares native artifacts, validates host and runtime readiness, then builds, installs, and launches a native host.

Options:
  --platform        Native platform. Required: ios or android.
  --dry-run         Prepare artifacts and print native command plans without executing host commands.
  --no-prepare      Skip artifact preparation and use the existing manifest.
  --config          Use a specific Vifx config file during preparation.
  --out-dir         Write prepared native artifacts to this directory.
  --json            Output machine-readable orchestration results.
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

interface NativeRunPlanSet {
  build: VifxNativeCommandPlan;
  install: VifxNativeCommandPlan;
  launch: VifxNativeCommandPlan;
}

function validatePlatform(value: string | undefined) {
  if (value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_NATIVE_INVALID_PLATFORM",
    docsPath: "/reference/cli#vifx-native-run",
    hint: "Pass --platform ios or --platform android.",
    message: "Native run requires an explicit platform.",
  });
}

function quoteShellArg(value: string) {
  if (/^[\w./:=+-]+$/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatPlan(plan: VifxNativeCommandPlan) {
  return plan.steps
    .map(
      (step) =>
        `  ${step.label}:\n    ${[step.command, ...step.args].map(quoteShellArg).join(" ")}`,
    )
    .join("\n");
}

async function createPlanSet(options: {
  androidApplicationId?: string;
  appPath?: string;
  bundleId?: string;
  configuration?: string;
  destination?: string;
  device?: string;
  platform: "ios" | "android";
  projectRoot: string;
  scheme?: string;
  variant?: string;
}): Promise<NativeRunPlanSet> {
  const common = {
    androidApplicationId: options.androidApplicationId,
    appPath: options.appPath,
    bundleId: options.bundleId,
    configuration: options.configuration,
    destination: options.destination,
    device: options.device,
    platform: options.platform,
    projectRoot: options.projectRoot,
    scheme: options.scheme,
    variant: options.variant,
  };

  return {
    build: await createNativeCommandPlan({
      ...common,
      action: "build",
    }),
    install: await createNativeCommandPlan({
      ...common,
      action: "install",
    }),
    launch: await createNativeCommandPlan({
      ...common,
      action: "launch",
    }),
  };
}

function executePlanSet(plans: NativeRunPlanSet) {
  return {
    build: runNativeCommandPlan(plans.build),
    install: runNativeCommandPlan(plans.install),
    launch: runNativeCommandPlan(plans.launch),
  } satisfies Record<keyof NativeRunPlanSet, NativeCommandExecutionResult>;
}

export async function runNativeRunCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["dry-run", "help", "json", "no-prepare"],
    stringFlags: [
      "app-path",
      "application-id",
      "bundle-id",
      "config",
      "configuration",
      "destination",
      "device",
      "out-dir",
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
      stdout: NATIVE_RUN_HELP,
      stderr: "",
    };
  }

  const inputProjectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const platform = validatePlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const dryRun = Boolean(parsed.flags["dry-run"]);
  const shouldPrepare = !parsed.flags["no-prepare"];
  const prepared = shouldPrepare
    ? await prepareConfiguredNativeTargets({
        configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
        outDir: typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined,
        platform,
        projectRoot: inputProjectRoot,
      })
    : null;
  const projectRoot = prepared?.projectRoot ?? inputProjectRoot;
  const preparedResult = prepared?.results[0] ?? null;
  const hostValidation = await validateNativeHost({
    manifestPath: preparedResult?.manifest.manifestPath,
    platform,
    projectRoot,
  });
  const runtimeDiagnostics = await diagnoseNativeRuntimeTargets({
    device: typeof parsed.flags.device === "string" ? parsed.flags.device : undefined,
    platform,
    projectRoot,
  });
  const plans = await createPlanSet({
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
  const execution = dryRun ? null : executePlanSet(plans);

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          dryRun,
          execution,
          hostValidation,
          platform,
          preparation: prepared,
          projectRoot,
          runtimeDiagnostics,
          steps: plans,
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
      "Vifx Native Run",
      "",
      `Project root: ${projectRoot}`,
      `Platform: ${platform}`,
      `Preparation: ${preparedResult ? preparedResult.manifest.manifestPath : "skipped"}`,
      `Host diagnostics: ${hostValidation.status}`,
      `Runtime diagnostics: ${
        runtimeDiagnostics.checks.some((check) => check.status === "warn") ? "warn" : "pass"
      }`,
      "",
      "[build]",
      formatPlan(plans.build),
      "",
      "[install]",
      formatPlan(plans.install),
      "",
      "[launch]",
      formatPlan(plans.launch),
      "",
      dryRun ? "Dry run only. No native host command was executed." : "Executed.",
    ].join("\n"),
    stderr: "",
  };
}
