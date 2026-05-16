import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
});
