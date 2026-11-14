import { chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  compileHermesBytecode,
  detectHermesCompiler,
  formatHermesCompileResult,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "fixtures");

test("detectHermesCompiler reports unavailable when no compiler can be found", async () => {
  const result = await detectHermesCompiler({
    cwd: FIXTURE_ROOT,
    env: {
      PATH: "",
    },
  });

  expect(result.available).toBe(false);
  expect(result.path).toBe(null);
});

test("detectHermesCompiler finds the hermes-compiler that react-native depends on", async () => {
  // React Native 0.88 ships hermesc in the hermes-compiler package, not in
  // react-native/sdks/hermesc, and puts nothing in node_modules/.bin.
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-hermes-rn-"));
  const platformDirectory = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" }[
    process.platform as "darwin" | "linux" | "win32"
  ];
  const binaryName = process.platform === "win32" ? "hermesc.exe" : "hermesc";
  const compilerDirectory = path.join(
    projectRoot,
    "node_modules",
    "hermes-compiler",
    "hermesc",
    platformDirectory,
  );
  await mkdir(path.join(projectRoot, "node_modules", "react-native"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "node_modules", "react-native", "package.json"),
    '{"name":"react-native","version":"0.88.1"}',
  );
  await mkdir(compilerDirectory, { recursive: true });
  await writeFile(
    path.join(projectRoot, "node_modules", "hermes-compiler", "package.json"),
    '{"name":"hermes-compiler"}',
  );
  await writeFile(path.join(compilerDirectory, binaryName), "#!/bin/sh\n");
  await chmod(path.join(compilerDirectory, binaryName), 0o755);

  const result = await detectHermesCompiler({ cwd: projectRoot, env: { PATH: "" } });

  expect(result).toEqual({
    available: true,
    path: path.join(await realpath(compilerDirectory), binaryName),
    source: "react-native",
  });
});

test("compileHermesBytecode fails gracefully without a Hermes compiler", async () => {
  await expect(
    compileHermesBytecode({
      cwd: FIXTURE_ROOT,
      env: {
        PATH: "",
      },
      inputBundlePath: "input.bundle.js",
      outputBytecodePath: "output/index.hbc",
    }),
  ).rejects.toMatchObject({
    code: "VIFX_HERMES_UNAVAILABLE",
    docsPath: "/reference/errors#VIFX_HERMES_UNAVAILABLE",
    name: "VifxError",
  });
});

test("compileHermesBytecode uses a provided Hermes compiler and writes bytecode output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-hermes-"));
  const compilerPath = path.join(tempRoot, "hermesc");
  const outputPath = path.join(tempRoot, "dist/index.hbc");
  const sourceMapPath = path.join(tempRoot, "dist/index.hbc.map");

  await writeFile(
    compilerPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('-out');",
      "const outputPath = args[outputIndex + 1];",
      "const emitSourceMap = args.includes('-output-source-map');",
      "const inputPath = args.at(-1);",
      "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
      "const input = fs.readFileSync(inputPath, 'utf8');",
      "fs.writeFileSync(outputPath, `HBC:${input}`);",
      "if (emitSourceMap) {",
      '  fs.writeFileSync(`${outputPath}.map`, \'{"version":3,"file":"index.hbc","sources":["bundle.js"],"names":[],"mappings":"AAAA","sourcesContent":["globalThis.__vifx = \\\\\\"bundle\\\\\\";"]}\');',
      "}",
      "",
    ].join("\n"),
  );
  await chmod(compilerPath, 0o755);

  const result = await compileHermesBytecode({
    compilerPath,
    inputBundlePath: path.join(FIXTURE_ROOT, "input.bundle.js"),
    outputBytecodePath: outputPath,
    sourceMapPath,
  });

  expect(result.bytesWritten).toBeGreaterThan(0);
  expect((await stat(outputPath)).size).toBeGreaterThan(0);
  expect(await readFile(outputPath, "utf8")).toContain("HBC:");
  expect(await readFile(sourceMapPath, "utf8")).toContain('"version":3');
  expect(formatHermesCompileResult(result)).toContain("Vifx Hermes Compile");
  expect(result.command).not.toContain("-O");

  // Release bytecode is optimized, as React Native's own build scripts do it.
  const optimized = await compileHermesBytecode({
    compilerPath,
    inputBundlePath: path.join(FIXTURE_ROOT, "input.bundle.js"),
    optimize: true,
    outputBytecodePath: outputPath,
  });
  expect(optimized.command).toContain("-O");
});
