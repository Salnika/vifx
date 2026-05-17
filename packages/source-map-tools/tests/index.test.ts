import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  assertValidSourceMap,
  compareSourceMaps,
  symbolicateStackFrame,
  validateSourceMap,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "fixtures");

test("validateSourceMap validates a Metro-style source map fixture", async () => {
  const result = await validateSourceMap({
    sourceMapPath: path.join(FIXTURE_ROOT, "metro.index.map.json"),
  });

  expect(result.valid).toBe(true);
  expect(result.sourceCount).toBe(1);
  expect(result.sources).toEqual(["src/App.tsx"]);
});

test("assertValidSourceMap throws a structured error for invalid maps", async () => {
  await expect(
    assertValidSourceMap({
      sourceMapPath: path.join(FIXTURE_ROOT, "invalid.index.map.json"),
    }),
  ).rejects.toMatchObject({
    code: "VIFX_SOURCEMAP_INVALID",
    details: {
      warnings: expect.arrayContaining([
        "Source map does not include any sources.",
        "Source map does not include any mappings.",
      ]),
    },
  });
});

test("validateSourceMap reports malformed map files as invalid results", async () => {
  const result = await validateSourceMap({
    sourceMapPath: path.join(FIXTURE_ROOT, "malformed.index.map.txt"),
  });

  expect(result.valid).toBe(false);
  expect(result.sourceCount).toBe(0);
  expect(result.warnings[0]).toContain("Source map could not be read or parsed:");

  await expect(
    assertValidSourceMap({
      sourceMapPath: path.join(FIXTURE_ROOT, "malformed.index.map.txt"),
    }),
  ).rejects.toMatchObject({
    code: "VIFX_SOURCEMAP_INVALID",
  });
});

test("symbolicateStackFrame resolves the original source location", async () => {
  const frame = await symbolicateStackFrame({
    sourceMapPath: path.join(FIXTURE_ROOT, "metro.index.map.json"),
    line: 1,
    column: 1,
  });

  expect(frame.found).toBe(true);
  expect(frame.source).toBe("src/App.tsx");
  expect(frame.line).toBe(1);
  expect(frame.column).toBe(1);
});

test("compareSourceMaps reports normalized source differences", async () => {
  const result = await compareSourceMaps({
    leftSourceMapPath: path.join(FIXTURE_ROOT, "metro.index.map.json"),
    rightSourceMapPath: path.join(FIXTURE_ROOT, "vite.index.map.json"),
  });

  expect(result.commonSources).toEqual([]);
  expect(result.leftOnlySources).toEqual(["src/App.tsx"]);
  expect(result.rightOnlySources).toEqual(["src/main.ts"]);
  expect(result.mappingMatches).toBe(true);
});
