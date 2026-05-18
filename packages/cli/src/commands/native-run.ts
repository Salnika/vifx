import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  createNativeCommandPlan,
  detectNativeHost,
  diagnoseNativeRuntimeTargets,
  runNativeCommandPlan,
  startNativeBundleServer,
  validateNativeHost,
  type NativeCommandExecutionResult,
  type VifxNativeBundleServer,
  type VifxNativeCommandPlan,
} from "@vifx/native-artifacts";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import { resolveNativeTargets } from "../lib/native-targets.ts";
import type { CliResult } from "../types.ts";
import {
  prepareConfiguredNativeTargets,
  type NativePrepareTargetsResult,
} from "./native-prepare.ts";

const require = createRequire(import.meta.url);
const DEFAULT_IOS_BUNDLE_SERVER_HOST = "127.0.0.1";
const DEFAULT_IOS_BUNDLE_SERVER_PORT = 8081;

const NATIVE_RUN_HELP = `Usage: vifx native run [path] --platform ios|android [options]

Prepares native artifacts, validates host and runtime readiness, then builds, installs, and launches a native host.

Expo iOS note:
  When Vifx detects an Expo project on iOS, it uses the current Debug simulator path:
  Expo prebuild (when needed), pod install (when needed), a local Vifx bundle server on port 8081,
  then xcodebuild + simctl without Metro.

Options:
  --platform        Native platform. Required: ios or android.
  --dry-run         Optional preview mode without executing host commands.
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

interface NativeRunCommandStep {
  args: string[];
  command: string;
  cwd: string;
  label: string;
}

interface NativeRunCommandStepResult {
  command: string;
  exitCode: number;
  label: string;
  stderr: string;
  stdout: string;
}

interface NativeRunBundleServerPlan {
  bundleUrl: string;
  host: string;
  port: number;
  statusUrl: string;
  url: string;
}

const NATIVE_RUN_STRATEGY_GENERIC = "generic";
const NATIVE_RUN_STRATEGY_EXPO_IOS_DEBUG = "expo-ios-debug-server";

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

function formatCommandStep(step: NativeRunCommandStep) {
  return `  ${step.label}:\n    ${[step.command, ...step.args].map(quoteShellArg).join(" ")}`;
}

function formatBundleServerPlan(plan: NativeRunBundleServerPlan) {
  return [`  URL: ${plan.url}`, `  Bundle: ${plan.bundleUrl}`, `  Status: ${plan.statusUrl}`].join(
    "\n",
  );
}

function describePreparationSource(prepared: NativePrepareTargetsResult | null) {
  if (!prepared) {
    return "skipped";
  }

  return prepared.configFile ?? "inferred Expo defaults";
}

function resolvePreparedManifestPath(options: {
  outDirFlag?: string;
  platform: "ios" | "android";
  prepared: NativePrepareTargetsResult | null;
}) {
  const preparedResult = options.prepared?.results[0];
  if (preparedResult) {
    return preparedResult.manifest.manifestPath;
  }

  if (!options.outDirFlag) {
    return undefined;
  }

  return path.join(options.outDirFlag, "vifx-native-manifest.json");
}

function isExpoIosDebugStrategy(options: {
  platform: "ios" | "android";
  prepared: NativePrepareTargetsResult | null;
  resolvedTargets: Awaited<ReturnType<typeof resolveNativeTargets>>;
}) {
  const viteMode = options.prepared?.viteMode ?? options.resolvedTargets?.viteMode;
  return options.platform === "ios" && viteMode === "expo";
}

function assertExpoIosDebugConfiguration(options: {
  configuration?: string;
  destination?: string;
}) {
  if (options.configuration && options.configuration !== "Debug") {
    throw new VifxError({
      code: "VIFX_NATIVE_EXPO_IOS_DEBUG_REQUIRED",
      docsPath: "/reference/native#expo-ios-simulator",
      hint: "Use the default Debug simulator build for the current Expo iOS no-Metro path.",
      message: `Expo iOS native run does not support configuration "${options.configuration}" yet.`,
    });
  }

  if (options.destination && !options.destination.includes("Simulator")) {
    throw new VifxError({
      code: "VIFX_NATIVE_EXPO_IOS_SIMULATOR_REQUIRED",
      docsPath: "/reference/native#expo-ios-simulator",
      hint: 'Use the default simulator destination or pass a destination that contains "Simulator".',
      message: `Expo iOS native run does not support destination "${options.destination}" yet.`,
    });
  }
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

function isNativeHostMissingError(error: unknown) {
  return error instanceof VifxError && error.code === "VIFX_NATIVE_HOST_MISSING";
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasIosHost(projectRoot: string) {
  try {
    await detectNativeHost({
      platform: "ios",
      projectRoot,
    });
    return true;
  } catch (error) {
    if (isNativeHostMissingError(error)) {
      return false;
    }

    throw error;
  }
}

async function needsIosPodsInstall(projectRoot: string) {
  const iosRoot = path.join(projectRoot, "ios");
  const podfilePath = path.join(iosRoot, "Podfile");
  if (!(await pathExists(podfilePath))) {
    return false;
  }

  const podfileLockPath = path.join(iosRoot, "Podfile.lock");
  const manifestLockPath = path.join(iosRoot, "Pods", "Manifest.lock");
  if (!(await pathExists(podfileLockPath)) || !(await pathExists(manifestLockPath))) {
    return true;
  }

  const [podfileLock, manifestLock] = await Promise.all([
    readFile(podfileLockPath, "utf8"),
    readFile(manifestLockPath, "utf8"),
  ]);
  return podfileLock !== manifestLock;
}

function resolveExpoCliEntry(projectRoot: string) {
  try {
    return require.resolve("@expo/cli/build/bin/cli", {
      paths: [projectRoot],
    });
  } catch {
    try {
      return require.resolve("expo/bin/cli", {
        paths: [projectRoot],
      });
    } catch (error) {
      throw new VifxError({
        code: "VIFX_EXPO_CLI_NOT_FOUND",
        cause: error,
        docsPath: "/reference/native#expo-ios-simulator",
        hint: "Install Expo dependencies before running vifx native run for Expo projects.",
        message: `Could not resolve the local Expo CLI from "${projectRoot}".`,
      });
    }
  }
}

async function createExpoIosBootstrapPlan(projectRoot: string): Promise<NativeRunCommandStep[]> {
  const bootstrapSteps: NativeRunCommandStep[] = [];
  const iosHostExists = await hasIosHost(projectRoot);

  if (!iosHostExists) {
    bootstrapSteps.push({
      args: [resolveExpoCliEntry(projectRoot), "prebuild", "--platform", "ios", "--no-install"],
      command: process.execPath,
      cwd: projectRoot,
      label: "Generate iOS host with Expo prebuild",
    });
  }

  if (!iosHostExists || (await needsIosPodsInstall(projectRoot))) {
    bootstrapSteps.push({
      args: ["install"],
      command: "pod",
      cwd: path.join(projectRoot, "ios"),
      label: "Install CocoaPods dependencies",
    });
  }

  return bootstrapSteps;
}

function executeCommandStep(step: NativeRunCommandStep) {
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    encoding: "utf8",
  });
  const exitCode = result.status ?? 1;
  const executed = {
    command: [step.command, ...step.args].join(" "),
    exitCode,
    label: step.label,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  } satisfies NativeRunCommandStepResult;

  if (exitCode !== 0) {
    throw new VifxError({
      code: "VIFX_NATIVE_COMMAND_FAILED",
      details: {
        command: step.command,
        exitCode,
        label: step.label,
      },
      docsPath: "/reference/cli#vifx-native-run",
      hint: "Review the command output, fix the native host issue, and rerun vifx native run.",
      message: `Native run step failed: ${step.label}.`,
    });
  }

  return executed;
}

function createExpoIosBundleServerPlan() {
  const baseUrl = `http://${DEFAULT_IOS_BUNDLE_SERVER_HOST}:${DEFAULT_IOS_BUNDLE_SERVER_PORT}`;
  return {
    bundleUrl: `${baseUrl}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false`,
    host: DEFAULT_IOS_BUNDLE_SERVER_HOST,
    port: DEFAULT_IOS_BUNDLE_SERVER_PORT,
    statusUrl: `${baseUrl}/status`,
    url: baseUrl,
  } satisfies NativeRunBundleServerPlan;
}

function createBundleServerLifetime(server: VifxNativeBundleServer) {
  return new Promise<number>((resolve) => {
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }

      settled = true;
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      resolve(exitCode);
    };

    const handleSignal = () => {
      if (!server.server.listening) {
        finish(0);
        return;
      }

      server.close().then(
        () => finish(0),
        () => finish(1),
      );
    };

    server.server.once("close", () => finish(0));
    server.server.once("error", () => finish(1));
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
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
  const configuration =
    typeof parsed.flags.configuration === "string" ? parsed.flags.configuration : undefined;
  const destination =
    typeof parsed.flags.destination === "string" ? parsed.flags.destination : undefined;
  const outDirFlag =
    typeof parsed.flags["out-dir"] === "string" ? parsed.flags["out-dir"] : undefined;
  const prepared = shouldPrepare
    ? await prepareConfiguredNativeTargets({
        configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
        outDir: outDirFlag,
        platform,
        projectRoot: inputProjectRoot,
      })
    : null;
  const resolvedTargets = shouldPrepare
    ? null
    : await resolveNativeTargets({
        configFile: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
        optional: true,
        projectRoot: inputProjectRoot,
      });
  const projectRoot = prepared?.projectRoot ?? resolvedTargets?.projectRoot ?? inputProjectRoot;
  const manifestPath = resolvePreparedManifestPath({
    outDirFlag,
    platform,
    prepared,
  });
  const runtimeDiagnostics = await diagnoseNativeRuntimeTargets({
    device: typeof parsed.flags.device === "string" ? parsed.flags.device : undefined,
    platform,
    projectRoot,
  });

  if (
    isExpoIosDebugStrategy({
      platform,
      prepared,
      resolvedTargets,
    })
  ) {
    assertExpoIosDebugConfiguration({
      configuration,
      destination,
    });

    const bootstrapSteps = await createExpoIosBootstrapPlan(projectRoot);
    const bundleServerPlan = createExpoIosBundleServerPlan();
    const canPlanHostCommands = bootstrapSteps.length === 0;
    const hostValidation = canPlanHostCommands
      ? await validateNativeHost({
          manifestPath,
          platform,
          projectRoot,
        })
      : null;
    const plans = canPlanHostCommands
      ? await createPlanSet({
          androidApplicationId:
            typeof parsed.flags["application-id"] === "string"
              ? parsed.flags["application-id"]
              : undefined,
          appPath:
            typeof parsed.flags["app-path"] === "string" ? parsed.flags["app-path"] : undefined,
          bundleId:
            typeof parsed.flags["bundle-id"] === "string" ? parsed.flags["bundle-id"] : undefined,
          configuration,
          destination,
          device: typeof parsed.flags.device === "string" ? parsed.flags.device : undefined,
          platform,
          projectRoot,
          scheme: typeof parsed.flags.scheme === "string" ? parsed.flags.scheme : undefined,
          variant: typeof parsed.flags.variant === "string" ? parsed.flags.variant : undefined,
        })
      : null;

    if (dryRun) {
      const payload = {
        bundleServer: bundleServerPlan,
        dryRun: true,
        execution: null,
        hostBootstrap: bootstrapSteps,
        hostValidation,
        platform,
        preparation: prepared,
        projectRoot,
        runtimeDiagnostics,
        steps: plans,
        strategy: NATIVE_RUN_STRATEGY_EXPO_IOS_DEBUG,
      };

      if (parsed.flags.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(payload, null, 2),
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
          `Strategy: ${NATIVE_RUN_STRATEGY_EXPO_IOS_DEBUG}`,
          `Preparation: ${prepared?.results[0]?.manifest.manifestPath ?? "skipped"}`,
          `Config: ${describePreparationSource(prepared)}`,
          `Host diagnostics: ${hostValidation?.status ?? "pending bootstrap"}`,
          `Runtime diagnostics: ${
            runtimeDiagnostics.checks.some((check) => check.status === "warn") ? "warn" : "pass"
          }`,
          "",
          "[bundle-server]",
          formatBundleServerPlan(bundleServerPlan),
          "",
          "[bootstrap]",
          bootstrapSteps.length > 0
            ? bootstrapSteps.map((step) => formatCommandStep(step)).join("\n")
            : "  No host bootstrap steps required.",
          "",
          "[build/install/launch]",
          plans
            ? [
                "[build]",
                formatPlan(plans.build),
                "",
                "[install]",
                formatPlan(plans.install),
                "",
                "[launch]",
                formatPlan(plans.launch),
              ].join("\n")
            : "  Host plan is pending bootstrap because no iOS host exists yet.",
          "",
          "Dry run only. No native host command was executed.",
        ].join("\n"),
        stderr: "",
      };
    }

    const bootstrapExecution = bootstrapSteps.map((step) => executeCommandStep(step));
    const validatedHost = await validateNativeHost({
      manifestPath,
      platform,
      projectRoot,
    });
    const resolvedPlans =
      plans ??
      (await createPlanSet({
        androidApplicationId:
          typeof parsed.flags["application-id"] === "string"
            ? parsed.flags["application-id"]
            : undefined,
        appPath:
          typeof parsed.flags["app-path"] === "string" ? parsed.flags["app-path"] : undefined,
        bundleId:
          typeof parsed.flags["bundle-id"] === "string" ? parsed.flags["bundle-id"] : undefined,
        configuration,
        destination,
        device: typeof parsed.flags.device === "string" ? parsed.flags.device : undefined,
        platform,
        projectRoot,
        scheme: typeof parsed.flags.scheme === "string" ? parsed.flags.scheme : undefined,
        variant: typeof parsed.flags.variant === "string" ? parsed.flags.variant : undefined,
      }));
    const buildExecution = runNativeCommandPlan(resolvedPlans.build);
    const installExecution = runNativeCommandPlan(resolvedPlans.install);
    const bundleServer = await startNativeBundleServer({
      host: bundleServerPlan.host,
      manifestPath,
      platform,
      port: bundleServerPlan.port,
      projectRoot,
    });

    try {
      const launchExecution = runNativeCommandPlan(resolvedPlans.launch);
      const waitUntilExit = createBundleServerLifetime(bundleServer);
      const payload = {
        bundleServer: {
          bundleUrl: bundleServer.bundleUrl,
          host: bundleServer.host,
          port: bundleServer.port,
          statusUrl: `${bundleServer.url}/status`,
          url: bundleServer.url,
        },
        dryRun: false,
        execution: {
          bootstrap: bootstrapExecution,
          build: buildExecution,
          install: installExecution,
          launch: launchExecution,
        },
        hostBootstrap: bootstrapSteps,
        hostValidation: validatedHost,
        platform,
        preparation: prepared,
        projectRoot,
        runtimeDiagnostics,
        steps: resolvedPlans,
        strategy: NATIVE_RUN_STRATEGY_EXPO_IOS_DEBUG,
      };

      if (parsed.flags.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(payload, null, 2),
          stderr: "",
          waitUntilExit,
        };
      }

      return {
        exitCode: 0,
        stdout: [
          "Vifx Native Run",
          "",
          `Project root: ${projectRoot}`,
          `Platform: ${platform}`,
          `Strategy: ${NATIVE_RUN_STRATEGY_EXPO_IOS_DEBUG}`,
          `Preparation: ${prepared?.results[0]?.manifest.manifestPath ?? "skipped"}`,
          `Config: ${describePreparationSource(prepared)}`,
          `Host diagnostics: ${validatedHost.status}`,
          `Runtime diagnostics: ${
            runtimeDiagnostics.checks.some((check) => check.status === "warn") ? "warn" : "pass"
          }`,
          "",
          "[bundle-server]",
          `  URL: ${bundleServer.url}`,
          `  Bundle: ${bundleServer.bundleUrl}`,
          `  Status: ${bundleServer.url}/status`,
          "",
          "[bootstrap]",
          bootstrapSteps.length > 0
            ? bootstrapSteps.map((step) => formatCommandStep(step)).join("\n")
            : "  No host bootstrap steps required.",
          "",
          "[build]",
          formatPlan(resolvedPlans.build),
          "",
          "[install]",
          formatPlan(resolvedPlans.install),
          "",
          "[launch]",
          formatPlan(resolvedPlans.launch),
          "",
          "Executed. Press Ctrl+C to stop the Vifx native bundle server.",
        ].join("\n"),
        stderr: "",
        waitUntilExit,
      };
    } catch (error) {
      await bundleServer.close().catch(() => undefined);
      throw error;
    }
  }

  const hostValidation = await validateNativeHost({
    manifestPath,
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
    configuration,
    destination,
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
          strategy: NATIVE_RUN_STRATEGY_GENERIC,
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
      `Strategy: ${NATIVE_RUN_STRATEGY_GENERIC}`,
      `Preparation: ${prepared?.results[0]?.manifest.manifestPath ?? "skipped"}`,
      `Config: ${describePreparationSource(prepared)}`,
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
