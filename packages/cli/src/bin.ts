#!/usr/bin/env node

import { createSpinner } from "@vifx/logger";
import { executeCli } from "./index.ts";

function shouldShowStartupSpinner(argv: string[]) {
  return (
    argv[0] === "expo" &&
    argv[1] === "dev" &&
    !argv.includes("--json") &&
    !argv.includes("--help") &&
    !argv.includes("-h")
  );
}

const spinner = shouldShowStartupSpinner(process.argv.slice(2))
  ? createSpinner({ text: "Starting Vifx Expo dev server" })
  : null;

spinner?.start();

const result = await executeCli(process.argv.slice(2), {
  env: process.env,
});

if (spinner && result.exitCode === 0) {
  spinner.succeed("Vifx Expo dev server ready");
}

if (spinner && result.exitCode !== 0) {
  spinner.fail("Vifx Expo dev server failed");
}

if (result.stdout) {
  process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
}

if (result.stderr) {
  process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
}

if (result.waitUntilExit) {
  const waitExitCode = await result.waitUntilExit;
  process.exit(typeof waitExitCode === "number" ? waitExitCode : result.exitCode);
}

process.exit(result.exitCode);
