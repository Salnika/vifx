#!/usr/bin/env node

import { executeCli } from "./index.ts";

const result = await executeCli(process.argv.slice(2), {
  env: process.env,
});

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
