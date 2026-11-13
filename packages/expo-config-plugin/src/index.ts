import { VifxError } from "@vifx/errors";
// @expo/config-plugins is a CommonJS package whose exports are lazy getters,
// which cjs-module-lexer cannot detect. Named ESM imports therefore fail at
// runtime ("Named export not found"); only the default import is reliable.
import configPlugins from "@expo/config-plugins";
import type { ConfigPlugin } from "@expo/config-plugins";

const { CodeGenerator, withAppBuildGradle, withXcodeProject } = configPlugins;

export interface VifxBundlerProps {
  /**
   * Replacement for `expo export:embed` invoked by the native build scripts.
   * Injected as `BUNDLE_COMMAND` (Xcode) and `bundleCommand` (Gradle).
   */
  bundleCommand?: string;
  /**
   * Path to the Vifx CLI entry used by the native build scripts. Injected as
   * `CLI_PATH` (Xcode) and `cliFile` (Gradle). Platform-specific defaults are
   * used when omitted, so override this only with a path that resolves from
   * both `ios/` (`$PROJECT_DIR/..`) and `android/app/` (`../..`).
   */
  cliPath?: string;
}

export interface ResolvedVifxBundlerProps {
  androidCliFile: string;
  bundleCommand: string;
  iosCliPath: string;
}

export interface MergeResults {
  contents: string;
  didClear: boolean;
  didMerge: boolean;
}

export const VIFX_BUNDLE_PHASE_NAME = "Bundle React Native code and images";
export const VIFX_IOS_TAG = "vifx-bundle-command";
export const VIFX_ANDROID_TAG = "vifx-bundle-command";

const DEFAULT_BUNDLE_COMMAND = "export:embed";
// The built CLI entry: the published @vifx/cli package ships dist/ only.
const DEFAULT_IOS_CLI_PATH = "$PROJECT_DIR/../node_modules/@vifx/cli/dist/bin.mjs";
const DEFAULT_ANDROID_CLI_FILE = "../../node_modules/@vifx/cli/dist/bin.mjs";
const ANDROID_GENERATED_END = `// @generated end ${VIFX_ANDROID_TAG}`;

export function resolveVifxBundlerProps(props?: VifxBundlerProps): ResolvedVifxBundlerProps {
  return {
    androidCliFile: props?.cliPath ?? DEFAULT_ANDROID_CLI_FILE,
    bundleCommand: props?.bundleCommand ?? DEFAULT_BUNDLE_COMMAND,
    iosCliPath: props?.cliPath ?? DEFAULT_IOS_CLI_PATH,
  };
}

/**
 * Prepends marker-guarded `CLI_PATH`/`BUNDLE_COMMAND` exports to the iOS
 * "Bundle React Native code and images" shell script. The Expo template only
 * assigns its own defaults behind `if [[ -z "$CLI_PATH" ]]` guards, so
 * exporting at the top of the script deterministically wins while every user
 * line is preserved. Re-running is a no-op for identical props; changed props
 * replace the previous generated section.
 */
export function mergeVifxIosBundlePhaseScript(
  script: string,
  props?: VifxBundlerProps,
): MergeResults {
  const resolved = resolveVifxBundlerProps(props);
  const newSrc = [
    `export CLI_PATH="${resolved.iosCliPath}"`,
    `export BUNDLE_COMMAND="${resolved.bundleCommand}"`,
  ].join("\n");

  return CodeGenerator.mergeContents({
    anchor: /^/u,
    comment: "#",
    newSrc,
    offset: 0,
    src: script,
    tag: VIFX_IOS_TAG,
  });
}

interface PbxShellScriptBuildPhase {
  isa?: string;
  name?: string;
  shellScript?: string;
}

export interface XcodeProjectLike {
  hash: {
    project: {
      objects: Record<string, Record<string, unknown> | undefined>;
    };
  };
}

function unquotePbxString(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

function isShellScriptBuildPhase(value: unknown): value is PbxShellScriptBuildPhase {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findBundleReactNativePhase(project: XcodeProjectLike) {
  const section = project.hash.project.objects["PBXShellScriptBuildPhase"] ?? {};
  const phases: PbxShellScriptBuildPhase[] = [];

  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith("_comment") || !isShellScriptBuildPhase(value)) {
      continue;
    }

    if (typeof value.name === "string" && unquotePbxString(value.name) === VIFX_BUNDLE_PHASE_NAME) {
      phases.push(value);
    }
  }

  return phases;
}

function parsePbxShellScript(shellScript: string) {
  try {
    return JSON.parse(shellScript) as string;
  } catch (error) {
    throw new VifxError({
      cause: error,
      code: "VIFX_EXPO_PLUGIN_SHELL_SCRIPT_UNREADABLE",
      details: { shellScript },
      docsPath: "/guide/migration#expo-native-builds",
      hint: 'Re-run "npx expo prebuild --clean" to restore the template build phase, or export CLI_PATH and BUNDLE_COMMAND manually in ios/.xcode.env.',
      message: `Could not parse the "${VIFX_BUNDLE_PHASE_NAME}" shell script in the Xcode project.`,
    });
  }
}

/**
 * Locates every "Bundle React Native code and images" shell script build
 * phase in the parsed Xcode project and injects the Vifx `CLI_PATH` and
 * `BUNDLE_COMMAND` exports. Returns `true` when at least one phase changed.
 */
export function applyVifxToXcodeProject(project: XcodeProjectLike, props?: VifxBundlerProps) {
  const phases = findBundleReactNativePhase(project);

  if (phases.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_PLUGIN_BUNDLE_PHASE_NOT_FOUND",
      docsPath: "/guide/migration#expo-native-builds",
      hint: 'Expected a "Bundle React Native code and images" PBXShellScriptBuildPhase, which "npx expo prebuild" generates. Re-run prebuild or add the phase before applying @vifx/expo-config-plugin.',
      message: `No "${VIFX_BUNDLE_PHASE_NAME}" build phase was found in the Xcode project.`,
    });
  }

  let didChange = false;

  for (const phase of phases) {
    if (typeof phase.shellScript !== "string") {
      continue;
    }

    const script = parsePbxShellScript(phase.shellScript);
    const merged = mergeVifxIosBundlePhaseScript(script, props);

    if (merged.didMerge || merged.didClear) {
      phase.shellScript = JSON.stringify(merged.contents);
      didChange = true;
    }
  }

  return didChange;
}

function countUncommentedBraces(line: string) {
  let delta = 0;
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index]!;

    if (quote) {
      if (current === "\\") {
        index += 1;
      } else if (current === quote) {
        quote = null;
      }

      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }

    if (current === "/" && line[index + 1] === "/") {
      break;
    }

    if (current === "{") {
      delta += 1;
    } else if (current === "}") {
      delta -= 1;
    }
  }

  return delta;
}

function findReactBlockClosingLine(lines: string[]) {
  const openIndex = lines.findIndex((line) => /^\s*react\s*\{/u.test(line));

  if (openIndex === -1) {
    return null;
  }

  let depth = 0;

  for (let index = openIndex; index < lines.length; index += 1) {
    depth += countUncommentedBraces(lines[index]!);

    if (depth <= 0) {
      return { closeIndex: index, openIndex };
    }
  }

  throw new VifxError({
    code: "VIFX_EXPO_PLUGIN_GRADLE_REACT_BLOCK_UNTERMINATED",
    docsPath: "/guide/migration#expo-native-builds",
    hint: "The react { ... } block in android/app/build.gradle never closes. Fix the Gradle file before applying @vifx/expo-config-plugin.",
    message: "Could not locate the end of the react {} block in android/app/build.gradle.",
  });
}

/**
 * Injects marker-guarded `cliFile`/`bundleCommand` assignments into the
 * `react {}` block of android/app/build.gradle. The generated section is
 * appended at the end of the block because Gradle applies the last assignment,
 * letting Vifx win over the template defaults without touching user lines.
 * When no `react {}` block exists, a complete marker-wrapped block is appended
 * to the end of the file. Re-running is a no-op for identical props; changed
 * props replace the previous generated section.
 */
export function mergeVifxAppBuildGradle(contents: string, props?: VifxBundlerProps): MergeResults {
  const resolved = resolveVifxBundlerProps(props);
  const sanitized = CodeGenerator.removeGeneratedContents(contents, VIFX_ANDROID_TAG);
  const base = sanitized ?? contents;
  const lines = base.split("\n");
  const reactBlock = findReactBlockClosingLine(lines);
  const indent = "    ";
  const assignments = [
    `${indent}cliFile = file(${JSON.stringify(resolved.androidCliFile)})`,
    `${indent}bundleCommand = ${JSON.stringify(resolved.bundleCommand)}`,
  ];
  const markerIndent = reactBlock ? indent : "";
  const body = reactBlock ? assignments.join("\n") : ["react {", ...assignments, "}"].join("\n");
  const header = CodeGenerator.createGeneratedHeaderComment(
    body,
    VIFX_ANDROID_TAG,
    `${markerIndent}//`,
  );

  if (contents.includes(header)) {
    return { contents, didClear: false, didMerge: false };
  }

  const generated = [header, ...body.split("\n"), `${markerIndent}${ANDROID_GENERATED_END}`];

  if (reactBlock) {
    lines.splice(reactBlock.closeIndex, 0, ...generated);

    return { contents: lines.join("\n"), didClear: sanitized !== null, didMerge: true };
  }

  const trailing = base.endsWith("\n") ? "" : "\n";

  return {
    contents: `${base}${trailing}${generated.join("\n")}\n`,
    didClear: sanitized !== null,
    didMerge: true,
  };
}

/**
 * Expo config plugin that permanently points the generated native build
 * scripts at the Vifx bundler instead of Metro:
 *
 * - iOS: exports `CLI_PATH` and `BUNDLE_COMMAND` at the top of the
 *   "Bundle React Native code and images" Xcode build phase.
 * - Android: sets `cliFile` and `bundleCommand` inside the `react {}` block
 *   of android/app/build.gradle.
 *
 * Both modifications are marker-guarded and idempotent, so they survive
 * repeated `expo prebuild` runs and prop changes without duplicating content.
 */
export const withVifxBundler: ConfigPlugin<VifxBundlerProps | undefined> = (config, props) => {
  let next = withXcodeProject(config, (xcodeConfig) => {
    applyVifxToXcodeProject(xcodeConfig.modResults as unknown as XcodeProjectLike, props);

    return xcodeConfig;
  });

  next = withAppBuildGradle(next, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new VifxError({
        code: "VIFX_EXPO_PLUGIN_GRADLE_LANGUAGE_UNSUPPORTED",
        details: { language: gradleConfig.modResults.language },
        docsPath: "/guide/migration#expo-native-builds",
        hint: 'Set cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs") and bundleCommand = "export:embed" inside react {} of android/app/build.gradle.kts manually.',
        message: "@vifx/expo-config-plugin only supports Groovy android/app/build.gradle files.",
      });
    }

    gradleConfig.modResults.contents = mergeVifxAppBuildGradle(
      gradleConfig.modResults.contents,
      props,
    ).contents;

    return gradleConfig;
  });

  return next;
};

export default withVifxBundler;
