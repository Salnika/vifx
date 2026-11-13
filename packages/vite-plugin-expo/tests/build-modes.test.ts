import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { buildExpoBundle } from "../src/index.ts";
import { createExpoGoTestProject } from "./harness.ts";

async function readBundle(projectRoot: string, outDir: string): Promise<string> {
  return readFile(path.join(projectRoot, outDir, "index.bundle"), "utf8");
}

/**
 * Regression guard for the Expo native production bundle path. Before this was
 * wired, `buildExpoBundle` hard-coded `minify: false` / `format: "es"`, so
 * `vifx export:embed --dev false` on an Expo project shipped a development
 * bundle (no minification, ~2x the size). Production must now minify with Oxc
 * and emit a single IIFE script, while development stays byte-identical to the
 * validated Expo Go corridor output.
 */
test("buildExpoBundle: production minifies to an IIFE; development is unchanged", async () => {
  const project = await createExpoGoTestProject();
  const devOut = ".vifx/expo-dev/ios";
  const prodOut = ".vifx/expo-prod/ios";

  try {
    const dev = await buildExpoBundle({
      entry: "./index.js",
      outDir: devOut,
      platform: "ios",
      projectRoot: project.projectRoot,
      reactNativeCompat: "none",
    });
    const prod = await buildExpoBundle({
      entry: "./index.js",
      mode: "production",
      outDir: prodOut,
      platform: "ios",
      projectRoot: project.projectRoot,
      reactNativeCompat: "none",
    });

    const devCode = await readBundle(project.projectRoot, devOut);
    const prodCode = await readBundle(project.projectRoot, prodOut);

    // Production is genuinely minified -> smaller than the development bundle.
    expect(prod.bundle.sizeBytes).toBeLessThan(dev.bundle.sizeBytes);

    // Both run in a function scope of their own, so no top-level declaration
    // of the bundle lands on the global object. Production is a single
    // minified IIFE; development keeps the readable, unminified scope-hoisted
    // output (one statement per line) between its wrapper lines.
    expect(prodCode.trimStart().startsWith("(function(")).toBe(true);
    expect(devCode.trimStart().startsWith("(function(")).toBe(true);
    expect(devCode).toMatch(/\n\}\)\(\);\n/u);
    expect(devCode.split("\n").length).toBeGreaterThan(prodCode.split("\n").length * 5);

    // Neither flavor may leak top-level ESM statements: Hermes evaluates
    // `index.bundle` as a script, not a module.
    for (const code of [devCode, prodCode]) {
      expect(/^\s*(?:import|export)\s/m.test(code)).toBe(false);
    }
  } finally {
    await rm(project.projectRoot, { force: true, recursive: true });
  }
});
