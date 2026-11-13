import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import * as xcode from "xcode";
import {
  applyVifxToXcodeProject,
  mergeVifxAppBuildGradle,
  mergeVifxIosBundlePhaseScript,
  resolveVifxBundlerProps,
  VIFX_BUNDLE_PHASE_NAME,
  withVifxBundler,
  type XcodeProjectLike,
} from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "fixtures");

interface AppliedConfig {
  mods?: Record<
    string,
    Record<string, ((config: unknown) => Promise<{ modResults: unknown }>) | undefined> | undefined
  >;
  name: string;
  slug: string;
}

function applyPlugin(props?: { bundleCommand?: string; cliPath?: string }) {
  return withVifxBundler({ name: "app", slug: "app" }, props) as unknown as AppliedConfig;
}

async function readFixture(fileName: string) {
  return await readFile(path.join(FIXTURE_ROOT, fileName), "utf8");
}

function parsePbxprojFixture() {
  const project = xcode.project(path.join(FIXTURE_ROOT, "expo-template.project.pbxproj"));

  project.parseSync();

  return project;
}

test("resolveVifxBundlerProps applies the fixed export:embed contract by default", () => {
  expect(resolveVifxBundlerProps()).toEqual({
    androidCliFile: "../../node_modules/@vifx/cli/dist/bin.mjs",
    bundleCommand: "export:embed",
    iosCliPath: "$PROJECT_DIR/../node_modules/@vifx/cli/dist/bin.mjs",
  });
});

test("iOS bundle phase script gains marker-guarded CLI_PATH/BUNDLE_COMMAND exports", async () => {
  const script = await readFixture("expo-template.bundle-phase.sh");
  const merged = mergeVifxIosBundlePhaseScript(script);

  expect(merged.didMerge).toBe(true);
  expect(merged.contents).toMatchSnapshot();
});

test("iOS bundle phase merge is idempotent", async () => {
  const script = await readFixture("expo-template.bundle-phase.sh");
  const first = mergeVifxIosBundlePhaseScript(script);
  const second = mergeVifxIosBundlePhaseScript(first.contents);

  expect(second.didMerge).toBe(false);
  expect(second.contents).toBe(first.contents);
});

test("iOS bundle phase merge replaces the generated section when props change", async () => {
  const script = await readFixture("expo-template.bundle-phase.sh");
  const first = mergeVifxIosBundlePhaseScript(script);
  const second = mergeVifxIosBundlePhaseScript(first.contents, {
    bundleCommand: "custom:embed",
    cliPath: "$PROJECT_DIR/../tools/custom-cli.mjs",
  });

  expect(second.didClear).toBe(true);
  expect(second.contents).toContain('export CLI_PATH="$PROJECT_DIR/../tools/custom-cli.mjs"');
  expect(second.contents).toContain('export BUNDLE_COMMAND="custom:embed"');
  expect(second.contents).not.toContain(
    'export CLI_PATH="$PROJECT_DIR/../node_modules/@vifx/cli/dist/bin.mjs"',
  );
  expect(second.contents.match(/@generated begin/gu)).toHaveLength(1);
  // The template fallback guards survive untouched below the generated block.
  expect(second.contents).toContain('if [[ -z "$CLI_PATH" ]]; then');
});

test("Xcode project fixture is patched in place and serializes deterministically", () => {
  const project = parsePbxprojFixture();
  const didChange = applyVifxToXcodeProject(project as XcodeProjectLike);

  expect(didChange).toBe(true);
  expect(project.writeSync()).toMatchSnapshot();
});

test("Xcode project patch is idempotent across repeated prebuilds", () => {
  const project = parsePbxprojFixture();

  applyVifxToXcodeProject(project as XcodeProjectLike);

  const firstPass = project.writeSync();
  const didChangeAgain = applyVifxToXcodeProject(project as XcodeProjectLike);

  expect(didChangeAgain).toBe(false);
  expect(project.writeSync()).toBe(firstPass);
});

test("Xcode project without the bundle phase raises a structured error", () => {
  const project: XcodeProjectLike = {
    hash: { project: { objects: { PBXShellScriptBuildPhase: {} } } },
  };
  let caught: unknown;

  try {
    applyVifxToXcodeProject(project);
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    code: "VIFX_EXPO_PLUGIN_BUNDLE_PHASE_NOT_FOUND",
    name: "VifxError",
  });
});

test("Expo template app/build.gradle gains vifx assignments at the end of react {}", async () => {
  const gradle = await readFixture("expo-template.app.build.gradle");
  const merged = mergeVifxAppBuildGradle(gradle);

  expect(merged.didMerge).toBe(true);
  expect(merged.contents).toMatchSnapshot();

  // Vifx assignments must come after the template assignments so the last
  // Gradle assignment wins inside the react extension block.
  const templateCliFileIndex = merged.contents.indexOf("cliFile = new File");
  const vifxCliFileIndex = merged.contents.indexOf(
    'cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs")',
  );

  expect(templateCliFileIndex).toBeGreaterThan(-1);
  expect(vifxCliFileIndex).toBeGreaterThan(templateCliFileIndex);
  expect(merged.contents).toContain("autolinkLibrariesWithApp()");
});

test("app/build.gradle merge is idempotent", async () => {
  const gradle = await readFixture("expo-template.app.build.gradle");
  const first = mergeVifxAppBuildGradle(gradle);
  const second = mergeVifxAppBuildGradle(first.contents);

  expect(second.didMerge).toBe(false);
  expect(second.contents).toBe(first.contents);
});

test("app/build.gradle merge replaces the generated section when props change", async () => {
  const gradle = await readFixture("expo-template.app.build.gradle");
  const first = mergeVifxAppBuildGradle(gradle);
  const second = mergeVifxAppBuildGradle(first.contents, {
    bundleCommand: "custom:embed",
    cliPath: "../../tools/custom-cli.mjs",
  });

  expect(second.didClear).toBe(true);
  expect(second.contents).toContain('cliFile = file("../../tools/custom-cli.mjs")');
  expect(second.contents).toContain('bundleCommand = "custom:embed"');
  expect(second.contents.match(/@generated begin/gu)).toHaveLength(1);
});

test("app/build.gradle without a react {} block gains a marker-wrapped block", async () => {
  const gradle = await readFixture("no-react-block.app.build.gradle");
  const merged = mergeVifxAppBuildGradle(gradle);

  expect(merged.didMerge).toBe(true);
  expect(merged.contents).toMatchSnapshot();

  const rerun = mergeVifxAppBuildGradle(merged.contents);

  expect(rerun.didMerge).toBe(false);
  expect(rerun.contents).toBe(merged.contents);
});

test("withVifxBundler registers the ios xcodeproj and android appBuildGradle mods", () => {
  const config = applyPlugin();

  expect(typeof config.mods?.["ios"]?.["xcodeproj"]).toBe("function");
  expect(typeof config.mods?.["android"]?.["appBuildGradle"]).toBe("function");
});

test("withVifxBundler ios mod patches the parsed Xcode project through the plugin API", async () => {
  const config = applyPlugin();
  const project = parsePbxprojFixture();
  const result = await config.mods?.["ios"]?.["xcodeproj"]?.({
    ...config,
    modRawConfig: { name: "app", slug: "app" },
    modRequest: {},
    modResults: project,
  });
  const patched = result?.modResults as XcodeProjectLike;
  const section = patched.hash.project.objects["PBXShellScriptBuildPhase"] ?? {};
  const phase = Object.entries(section).find(([key]) => !key.endsWith("_comment"))?.[1] as {
    shellScript: string;
  };

  expect(JSON.parse(phase.shellScript)).toContain('export BUNDLE_COMMAND="export:embed"');
});

test("withVifxBundler android mod merges app/build.gradle contents through the plugin API", async () => {
  const config = applyPlugin({ bundleCommand: "export:embed" });
  const gradle = await readFixture("expo-template.app.build.gradle");
  const result = await config.mods?.["android"]?.["appBuildGradle"]?.({
    ...config,
    modRawConfig: { name: "app", slug: "app" },
    modRequest: {},
    modResults: { contents: gradle, language: "groovy", path: "android/app/build.gradle" },
  });
  const modResults = result?.modResults as { contents: string };

  expect(modResults.contents).toContain('bundleCommand = "export:embed"');
  expect(modResults.contents).toContain("@generated begin vifx-bundle-command");
});

test("withVifxBundler android mod rejects Kotlin DSL build files with a structured error", async () => {
  const config = applyPlugin();

  await expect(
    config.mods?.["android"]?.["appBuildGradle"]?.({
      ...config,
      modRawConfig: { name: "app", slug: "app" },
      modRequest: {},
      modResults: { contents: "", language: "kt", path: "android/app/build.gradle.kts" },
    }),
  ).rejects.toMatchObject({
    code: "VIFX_EXPO_PLUGIN_GRADLE_LANGUAGE_UNSUPPORTED",
    name: "VifxError",
  });
});

test("the bundle phase constant matches the Xcode template phase name", () => {
  expect(VIFX_BUNDLE_PHASE_NAME).toBe("Bundle React Native code and images");
});
