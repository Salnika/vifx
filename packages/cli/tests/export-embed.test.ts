import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { afterEach } from "vite-plus/test";
import { parseExportEmbedArgs } from "../src/commands/export-embed.ts";
import {
  rebaseSourceMapSources,
  rewriteTrailingSourceMapComment,
} from "../src/commands/export-embed.ts";
import { executeCli } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function listFilesRecursively(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(root, entryPath)));
      continue;
    }

    files.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
  }

  return files.sort();
}

test("export:embed parses the full Metro-compatible flag set", () => {
  const args = parseExportEmbedArgs([
    "./project",
    "--entry-file",
    "./index.js",
    "--platform",
    "android",
    "--dev",
    "false",
    "--bundle-output",
    "/tmp/out/index.android.bundle",
    "--sourcemap-output",
    "/tmp/out/index.android.bundle.map",
    "--assets-dest",
    "/tmp/out/res",
    "--minify",
    "true",
    "--reset-cache",
    "--config",
    "vifx.config.ts",
    "--verbose",
    "--json",
  ]);

  expect(args.errors).toEqual([]);
  expect(args.warnings).toEqual([]);
  expect(args.projectPath).toBe("./project");
  expect(args.entryFile).toBe("./index.js");
  expect(args.platform).toBe("android");
  expect(args.dev).toBe(false);
  expect(args.bundleOutput).toBe("/tmp/out/index.android.bundle");
  expect(args.sourcemapOutput).toBe("/tmp/out/index.android.bundle.map");
  expect(args.assetsDest).toBe("/tmp/out/res");
  expect(args.minify).toBe(true);
  expect(args.resetCache).toBe(true);
  expect(args.configFile).toBe("vifx.config.ts");
  expect(args.verbose).toBe(true);
  expect(args.json).toBe(true);
});

test("export:embed parses --dev and --minify in space, inline, and bare forms", () => {
  expect(parseExportEmbedArgs(["--dev", "false"]).dev).toBe(false);
  expect(parseExportEmbedArgs(["--dev=false"]).dev).toBe(false);
  expect(parseExportEmbedArgs(["--dev", "true"]).dev).toBe(true);
  expect(parseExportEmbedArgs(["--dev"]).dev).toBe(true);
  expect(parseExportEmbedArgs([]).dev).toBe(true);

  expect(parseExportEmbedArgs(["--minify", "false"]).minify).toBe(false);
  expect(parseExportEmbedArgs(["--minify=true"]).minify).toBe(true);
  expect(parseExportEmbedArgs(["--minify"]).minify).toBe(true);
  expect(parseExportEmbedArgs([]).minify).toBeUndefined();

  // A bare --dev followed by a non-boolean token leaves the token alone.
  const args = parseExportEmbedArgs(["--dev", "./project"]);
  expect(args.dev).toBe(true);
  expect(args.projectPath).toBe("./project");
});

test("export:embed warns on unknown flags instead of failing", () => {
  const args = parseExportEmbedArgs([
    "--unknown-bool-like",
    "--unknown-with-value",
    "some-value",
    "--unknown-inline=thing",
    "-x",
  ]);

  expect(args.errors).toEqual([]);
  expect(args.warnings).toEqual([
    "Ignoring unknown flag --unknown-bool-like.",
    "Ignoring unknown flag --unknown-with-value some-value.",
    "Ignoring unknown flag --unknown-inline thing.",
    "Ignoring unknown flag -x.",
  ]);
  expect(args.projectPath).toBeUndefined();
});

test("export:embed consumes values of known but unsupported Metro flags", () => {
  const args = parseExportEmbedArgs([
    "--max-workers",
    "4",
    "--bundle-encoding",
    "utf8",
    "--sourcemap-use-absolute-path",
    "--read-global-cache",
    "./project",
  ]);

  expect(args.errors).toEqual([]);
  expect(args.projectPath).toBe("./project");
  expect(args.warnings).toHaveLength(4);
  for (const warning of args.warnings) {
    expect(warning).toContain("has no effect in vifx export:embed");
  }
});

test("export:embed records an error when a value flag is missing its value", () => {
  const args = parseExportEmbedArgs(["--bundle-output"]);

  expect(args.errors).toEqual(["Flag --bundle-output requires a value."]);
});

test("export:embed warns about extra positional arguments", () => {
  const args = parseExportEmbedArgs(["./project", "extra"]);

  expect(args.projectPath).toBe("./project");
  expect(args.warnings).toEqual(['Ignoring unexpected positional argument "extra".']);
});

test("rewriteTrailingSourceMapComment only touches the trailing comment", () => {
  const bundle =
    'var x = "//# sourceMappingURL=fake.map";\ncode();\n//# sourceMappingURL=index.bundle.map\n';

  expect(rewriteTrailingSourceMapComment(bundle, "main.jsbundle.map")).toBe(
    'var x = "//# sourceMappingURL=fake.map";\ncode();\n//# sourceMappingURL=main.jsbundle.map\n',
  );
  expect(rewriteTrailingSourceMapComment(bundle, undefined)).toBe(
    'var x = "//# sourceMappingURL=fake.map";\ncode();\n',
  );
  expect(rewriteTrailingSourceMapComment("code();\n", "main.jsbundle.map")).toBe(
    "code();\n//# sourceMappingURL=main.jsbundle.map\n",
  );
});

test("export:embed --help prints usage", async () => {
  const result = await executeCli(["export:embed", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx export:embed");
  expect(result.stdout).toContain("--bundle-output");
  expect(result.stdout).toContain("--assets-dest");
});

test("export:embed fails with a structured error without --bundle-output", async () => {
  const result = await executeCli(["export:embed", "--platform", "android", "--json"]);

  expect(result.exitCode).toBe(1);
  const serialized = JSON.parse(result.stderr) as { code: string };
  expect(serialized.code).toBe("VIFX_EXPORT_EMBED_BUNDLE_OUTPUT_REQUIRED");
});

test("export:embed rejects unsupported platforms", async () => {
  const result = await executeCli([
    "export:embed",
    "--platform",
    "windows",
    "--bundle-output",
    "/tmp/never-written.bundle",
    "--json",
  ]);

  expect(result.exitCode).toBe(1);
  const serialized = JSON.parse(result.stderr) as { code: string };
  expect(serialized.code).toBe("VIFX_EXPORT_EMBED_INVALID_PLATFORM");
});

test("export:embed writes the Android bundle, source map, and prod assets", async () => {
  const tempRoot = await createTemporaryDirectory("vifx-cli-export-embed-");
  const projectRoot = path.join(tempRoot, "rn-bare-basic");
  const outputRoot = path.join(tempRoot, "output");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), projectRoot, { recursive: true });

  const bundleOutput = path.join(outputRoot, "android", "index.android.bundle");
  const sourcemapOutput = path.join(outputRoot, "android", "index.android.bundle.map");
  const assetsDest = path.join(outputRoot, "res");

  const result = await executeCli([
    "export:embed",
    projectRoot,
    "--entry-file",
    "./index.js",
    "--platform",
    "android",
    "--dev",
    "false",
    "--bundle-output",
    bundleOutput,
    "--sourcemap-output",
    sourcemapOutput,
    "--assets-dest",
    assetsDest,
    "--minify",
    "false",
    "--reset-cache",
    "--max-workers",
    "2",
    "--unknown-future-flag",
    "value",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);

  const parsed = JSON.parse(result.stdout) as {
    assets: { assetsDest: string; count: number; writtenFiles: string[] } | null;
    bundleOutput: string;
    dev: boolean;
    minify: boolean;
    mode: string;
    platform: string;
    sourcemapOutput: string | null;
    warnings: string[];
  };

  expect(parsed.platform).toBe("android");
  expect(parsed.dev).toBe(false);
  expect(parsed.minify).toBe(false);
  expect(parsed.mode).toBe("production");
  expect(parsed.bundleOutput).toBe(bundleOutput);
  expect(parsed.sourcemapOutput).toBe(sourcemapOutput);
  expect(parsed.assets?.assetsDest).toBe(assetsDest);
  expect(parsed.assets?.count).toBe(1);
  expect(parsed.warnings.some((warning) => warning.includes("--unknown-future-flag"))).toBe(true);

  expect((await stat(bundleOutput)).isFile()).toBe(true);
  expect((await stat(sourcemapOutput)).isFile()).toBe(true);

  const bundleContents = await readFile(bundleOutput, "utf8");
  expect(bundleContents.trimEnd().split("\n").at(-1)).toBe(
    "//# sourceMappingURL=index.android.bundle.map",
  );

  // raw/keep.xml keeps the assets from Android's resource shrinking, as Metro does.
  expect(await listFilesRecursively(assetsDest)).toEqual([
    "assetmap.json",
    "drawable-mdpi/src_assets_icon.svg",
    "raw/keep.xml",
  ]);

  const sourceMap = JSON.parse(await readFile(sourcemapOutput, "utf8")) as {
    sources: string[];
    version: number;
  };
  expect(sourceMap.version).toBe(3);
  // Sources stay relative to the written map, so tools open the real files.
  expect(
    sourceMap.sources.map((source) => path.resolve(path.dirname(sourcemapOutput), source)),
  ).toContain(path.join(projectRoot, "index.js"));
});

test("rebaseSourceMapSources re-relativizes sources for the map's new location", () => {
  const map = JSON.stringify({
    mappings: "",
    names: [],
    sourceRoot: "",
    sources: ["../../../src/app.tsx", "/abs/vendor.js", "webpack://pkg/file.js", ""],
    version: 3,
  });

  expect(
    JSON.parse(rebaseSourceMapSources(map, "/project/.vifx/export-embed/ios", "/project/build/ios"))
      .sources,
  ).toEqual(["../../src/app.tsx", "/abs/vendor.js", "webpack://pkg/file.js", ""]);
  expect(rebaseSourceMapSources(map, "/same", "/same")).toBe(map);
});

test("export-embed alias writes the iOS asset layout", async () => {
  const tempRoot = await createTemporaryDirectory("vifx-cli-export-embed-ios-");
  const projectRoot = path.join(tempRoot, "rn-bare-basic");
  const outputRoot = path.join(tempRoot, "output");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), projectRoot, { recursive: true });

  const bundleOutput = path.join(outputRoot, "main.jsbundle");
  const assetsDest = path.join(outputRoot, "app");

  const result = await executeCli([
    "export-embed",
    projectRoot,
    "--platform",
    "ios",
    "--dev",
    "true",
    "--bundle-output",
    bundleOutput,
    "--assets-dest",
    assetsDest,
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Vifx Export Embed");
  expect(result.stdout).toContain(`Bundle: ${bundleOutput}`);
  expect(result.stderr).not.toContain("production semantics pending");

  expect((await stat(bundleOutput)).isFile()).toBe(true);
  const assetFiles = await listFilesRecursively(assetsDest);
  expect(assetFiles).toEqual(["assetmap.json", "assets/src/assets/icon.svg"]);
  // The intermediate build out dir must never leak into the prod asset layout.
  expect(assetFiles.some((file) => file.includes(".vifx"))).toBe(false);

  // Without --sourcemap-output the bundle has no dangling source map comment.
  const bundleContents = await readFile(bundleOutput, "utf8");
  expect(bundleContents).not.toContain("//# sourceMappingURL=");
});
