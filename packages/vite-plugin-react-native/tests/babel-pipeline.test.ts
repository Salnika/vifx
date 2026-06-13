import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { buildReactNativeBundle } from "../src/index.ts";

/**
 * Acceptance ("credibility") tests for the project-derived Babel pipeline.
 *
 * Unlike the mocked-`@babel/core` cases in `index.test.ts`, these wire the
 * synthetic project to the REAL `@babel/core` and a REAL (synthetic) Babel
 * plugin declared by the project's own `babel.config.js`. They prove that
 * Vifx runs the project's actual Babel configuration over BOTH first-party
 * app sources AND library sources — the core promise of Phase 3.
 */

const requireFromHere = createRequire(import.meta.url);

/**
 * Absolute on-disk directory of the real `@babel/core` resolved from this
 * package, independent of the package-manager store layout. Symlinking this
 * into the synthetic project lets the project-resolved `createRequire` load a
 * working `@babel/core` (with its own peer `@babel/*` helpers reachable via
 * the real parent directory).
 */
function realBabelCorePackageDir() {
  const entry = requireFromHere.resolve("@babel/core");
  const marker = `${path.sep}@babel${path.sep}core`;
  const end = entry.indexOf(marker) + marker.length;
  return entry.slice(0, end);
}

async function linkRealBabelCore(projectRoot: string) {
  const babelScope = path.join(projectRoot, "node_modules", "@babel");
  await mkdir(babelScope, { recursive: true });
  await symlink(realBabelCorePackageDir(), path.join(babelScope, "core"), "dir");
}

/**
 * Writes a synthetic, real-executing worklets-shaped Babel plugin into the
 * project. It mirrors what `react-native-worklets/plugin` does at the shape
 * level: any function carrying a `"worklet"` directive gets a `__workletHash`
 * assignment injected as its first statement. The injected value embeds the
 * function name so the test can assert per-source injection.
 */
async function writeWorkletsPlugin(packageRoot: string) {
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ main: "index.js", name: "react-native-worklets", version: "1.0.0" }, null, 2),
  );
  await writeFile(path.join(packageRoot, "index.js"), "module.exports = {};\n");
  await writeFile(
    path.join(packageRoot, "plugin.js"),
    [
      "module.exports = function syntheticWorkletsPlugin() {",
      "  return {",
      '    name: "synthetic-worklets",',
      "    visitor: {",
      "      FunctionDeclaration(nodePath) {",
      "        const directives = nodePath.node.body && nodePath.node.body.directives;",
      "        const isWorklet =",
      "          Array.isArray(directives) &&",
      '          directives.some((directive) => directive.value && directive.value.value === "worklet");',
      "        if (!isWorklet || !nodePath.node.id) {",
      "          return;",
      "        }",
      "        nodePath.node.body.body.unshift({",
      '          type: "ExpressionStatement",',
      "          expression: {",
      '            type: "AssignmentExpression",',
      '            operator: "=",',
      '            left: { type: "Identifier", name: "__workletHash" },',
      '            right: { type: "StringLiteral", value: "WORKLET_" + nodePath.node.id.name },',
      "          },",
      "        });",
      "      },",
      "    },",
      "  };",
      "};",
      "",
    ].join("\n"),
  );
}

test("project Babel runs the project's real worklets plugin over app AND library sources", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-babel-credibility-"));

  await linkRealBabelCore(projectRoot);
  await writeWorkletsPlugin(path.join(projectRoot, "node_modules", "react-native-worklets"));

  // The project declares the worklets plugin directly, the strongest signal
  // for the pipeline's full-project-Babel derivation.
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        dependencies: { "react-native-reanimated": "3.0.0" },
        name: "babel-credibility-project",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(projectRoot, "babel.config.js"),
    'module.exports = { plugins: ["react-native-worklets/plugin"] };\n',
  );

  // Synthetic react-native-reanimated whose UNTRANSPILED source carries a
  // worklet. Imported via a deep path so it bypasses the native compat mock
  // for the bare `react-native-reanimated` specifier and reaches `transform`.
  const reanimatedRoot = path.join(projectRoot, "node_modules", "react-native-reanimated");
  await mkdir(path.join(reanimatedRoot, "src"), { recursive: true });
  await writeFile(
    path.join(reanimatedRoot, "package.json"),
    JSON.stringify(
      { main: "src/index.js", name: "react-native-reanimated", version: "3.0.0" },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(reanimatedRoot, "src", "animation.js"),
    ["export function libraryWorklet() {", '  "worklet";', "  return 1;", "}", ""].join("\n"),
  );

  // First-party app source with its own worklet.
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      'import { libraryWorklet } from "react-native-reanimated/src/animation.js";',
      "",
      "export function appWorklet() {",
      '  "worklet";',
      "  return libraryWorklet();",
      "}",
      "",
      'console.log("worklet entry", appWorklet);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/credibility-ios-worklets",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  // The real project Babel ran over BOTH sources: each function's injected
  // hash, produced by the project's own plugin, is present in the bundle.
  expect(bundleSource).toContain('__workletHash = "WORKLET_appWorklet"');
  expect(bundleSource).toContain('__workletHash = "WORKLET_libraryWorklet"');
});

test("project Babel leaves non-worklet sources untouched (no spurious hashes)", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-babel-noworklet-"));

  await linkRealBabelCore(projectRoot);
  await writeWorkletsPlugin(path.join(projectRoot, "node_modules", "react-native-worklets"));

  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "babel-noworklet-project" }, null, 2),
  );
  await writeFile(
    path.join(projectRoot, "babel.config.js"),
    'module.exports = { plugins: ["react-native-worklets/plugin"] };\n',
  );

  // A plain app function without the worklet directive must pass through the
  // project's real Babel unchanged.
  await writeFile(
    path.join(projectRoot, "index.js"),
    [
      "export function plain() {",
      "  return 7;",
      "}",
      "",
      'console.log("plain entry", plain);',
      "",
    ].join("\n"),
  );

  const bundle = await buildReactNativeBundle({
    entry: "./index.js",
    outDir: ".vifx/credibility-ios-noworklet",
    platform: "ios",
    projectRoot,
  });
  const bundleSource = await readFile(path.join(projectRoot, bundle.bundle.path), "utf8");

  expect(bundleSource).toContain("plain entry");
  expect(bundleSource).not.toContain("__workletHash");
});

test("a broken project babel.config.js surfaces VIFX_BABEL_CONFIG_LOAD_FAILED", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-rn-babel-broken-"));

  await linkRealBabelCore(projectRoot);
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "babel-broken-project" }, null, 2),
  );
  await writeFile(
    path.join(projectRoot, "babel.config.js"),
    'throw new Error("intentionally broken babel config");\n',
  );
  await writeFile(
    path.join(projectRoot, "index.js"),
    ['console.log("broken-config entry");', ""].join("\n"),
  );

  await expect(
    buildReactNativeBundle({
      entry: "./index.js",
      outDir: ".vifx/credibility-ios-broken",
      platform: "ios",
      projectRoot,
    }),
  ).rejects.toThrow(/VIFX_BABEL_CONFIG_LOAD_FAILED|Babel configuration/u);
});
