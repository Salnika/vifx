import path from "node:path";
import {
  diagnoseNativeRuntimeTargets,
  diagnoseNativeToolchain,
  validateNativeHost,
  type NativeToolchainCheck,
  type VifxNativeHostCheck,
} from "@vifx/native-artifacts";
import { VifxError } from "@vifx/errors";
import { parseFlags } from "../lib/args.ts";
import type { CliResult } from "../types.ts";

const NATIVE_DOCTOR_HELP = `Usage: vifx native doctor [path] --platform ios|android [--manifest <path>] [--device <selector>] [--json]

Validates native host markers, prepared Vifx manifests, signing hints, local toolchain readiness, and runtime target readiness.

Options:
  --platform  Native platform. Required: ios or android.
  --manifest  Prepared native manifest path. Defaults to .vifx/native/<platform>/vifx-native-manifest.json.
  --device    Runtime target selector. iOS defaults to booted; Android defaults to any authorized adb device.
  --json      Output machine-readable diagnostics.
  --help      Show this message.
`;

function validatePlatform(value: string | undefined) {
  if (value === "ios" || value === "android") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_NATIVE_INVALID_PLATFORM",
    docsPath: "/reference/cli#vifx-native-doctor",
    hint: "Pass --platform ios or --platform android.",
    message: "Native doctor requires an explicit platform.",
  });
}

function formatCheck(check: NativeToolchainCheck | VifxNativeHostCheck) {
  return `  ${check.status.toUpperCase()} ${check.name}: ${check.message}${
    check.hint ? ` Hint: ${check.hint}` : ""
  }`;
}

export async function runNativeDoctorCommand(argv: string[], cwd: string): Promise<CliResult> {
  const parsed = parseFlags(argv, {
    booleanFlags: ["help", "json"],
    stringFlags: ["device", "manifest", "platform"],
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
      stdout: NATIVE_DOCTOR_HELP,
      stderr: "",
    };
  }

  const projectRoot = path.resolve(cwd, parsed.positional[0] ?? ".");
  const platform = validatePlatform(
    typeof parsed.flags.platform === "string" ? parsed.flags.platform : undefined,
  );
  const manifestPath =
    typeof parsed.flags.manifest === "string" ? parsed.flags.manifest : undefined;
  const device = typeof parsed.flags.device === "string" ? parsed.flags.device : undefined;
  const host = await validateNativeHost({
    manifestPath,
    platform,
    projectRoot,
  });
  const toolchain = await diagnoseNativeToolchain({
    platform,
    projectRoot,
  });
  const runtime = await diagnoseNativeRuntimeTargets({
    device,
    platform,
    projectRoot,
  });
  const status =
    host.status === "warn" ||
    toolchain.checks.some((check) => check.status === "warn") ||
    runtime.checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";

  if (parsed.flags.json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          host,
          platform,
          projectRoot,
          runtime,
          status,
          toolchain,
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
      "Vifx Native Doctor",
      "",
      `Project root: ${projectRoot}`,
      `Platform: ${platform}`,
      `Status: ${status}`,
      "",
      "Host diagnostics:",
      ...host.checks.map(formatCheck),
      "",
      "Toolchain diagnostics:",
      ...toolchain.checks.map(formatCheck),
      "",
      "Runtime target diagnostics:",
      ...runtime.checks.map(formatCheck),
    ].join("\n"),
    stderr: "",
  };
}
