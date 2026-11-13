#!/usr/bin/env node
// Prints the faulting thread of an Apple crash report (.ips): exception,
// then one line per frame (image, symbol). Usage:
//   vp node scripts/dev/crash-frames.mjs <report.ips> [maxFrames]
import { readFile } from "node:fs/promises";

const [reportPath, maxFramesArg] = process.argv.slice(2);
if (!reportPath) {
  console.error("usage: crash-frames.mjs <report.ips> [maxFrames]");
  process.exit(1);
}
const maxFrames = Number(maxFramesArg ?? 40);

const text = await readFile(reportPath, "utf8");
// An .ips file is a one-line JSON header followed by the JSON report.
const body = JSON.parse(text.slice(text.indexOf("\n") + 1));

console.log("exception:", JSON.stringify(body.exception));
if (body.asi) {
  console.log("asi:", JSON.stringify(body.asi));
}
if (body.lastExceptionBacktrace) {
  console.log("lastExceptionBacktrace:");
  printFrames(body.lastExceptionBacktrace);
}

const threads = body.threads ?? [];
const faulting = threads[body.faultingThread] ?? threads.find((thread) => thread.triggered);
console.log(
  `faulting thread #${String(body.faultingThread)}:`,
  faulting?.name ?? faulting?.queue ?? "(unnamed)",
);
printFrames(faulting?.frames ?? []);

function printFrames(frames) {
  for (const [index, frame] of frames.slice(0, maxFrames).entries()) {
    const image = body.usedImages?.[frame.imageIndex]?.name ?? "?";
    const symbol = frame.symbol ?? `0x${Number(frame.imageOffset ?? 0).toString(16)}`;
    console.log(`  ${String(index).padStart(2)}  ${image}  ${symbol}`);
  }
}
