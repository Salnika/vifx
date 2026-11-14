import { promises as fs } from "node:fs";
import path from "node:path";
import { inspectProject } from "@vifx/compat-runner";
import { VifxError } from "@vifx/errors";
import codemodsPackage from "../package.json" with { type: "json" };

export interface PlannedFileChange {
  after: string;
  before: string | null;
  kind: "create" | "update";
  path: string;
}

export interface InitPlan {
  changes: PlannedFileChange[];
  projectRoot: string;
}

export interface MigrationPlan {
  changes: PlannedFileChange[];
  nextSteps: string[];
  projectRoot: string;
  rollbackSteps: string[];
}

export interface SetupPlan {
  appDirectory: boolean;
  changes: PlannedFileChange[];
  detectedExpoVersion: string | null;
  detectedProjectType: "expo" | "react-native" | "unknown";
  detectedReactNativeVersion: string | null;
  experimentalEmbed: boolean;
  expoGo: boolean;
  expoRouter: boolean;
  iosHostPresent: boolean;
  projectRoot: string;
  webPreviewConfigured: boolean;
  withViteConfig: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  main?: string;
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
}

interface ExpoSetupTemplateOptions {
  aliases?: Record<string, string>;
  appDirectory: boolean;
  babelInPackages?: string[];
  entry: string;
  expoRouter: boolean;
  iosHostPresent: boolean;
  jsxInPackages?: string[];
  reactNativeCompat?: "web";
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
  webPreviewConfigured: boolean;
}

function withTrailingNewline(contents: string) {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

const VIFX_VITE_CONFIG_PATH = "vite.config.vifx.ts";
const VIFX_VITE_CONFIG_FILE_NAMES = [
  "vite.config.vifx.ts",
  "vite.config.vifx.mts",
  "vite.config.vifx.js",
  "vite.config.vifx.mjs",
] as const;

function createTargetsSection(options: {
  aliases?: Record<string, string>;
  babelInPackages?: string[];
  compatPreview?: boolean;
  entry: string;
  jsxInPackages?: string[];
  reactNativeCompat?: "web";
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
}) {
  const aliasesLine =
    options.aliases && Object.keys(options.aliases).length > 0
      ? [`        aliases: ${JSON.stringify(options.aliases)},`]
      : [];
  const babelInPackagesLine = options.babelInPackages
    ? [`        babelInPackages: ${JSON.stringify(options.babelInPackages)},`]
    : [];
  const compatPreviewLine = options.compatPreview
    ? [
        "        // compatPreview enables Vifx's JS-only native compat mocks (e.g.",
        "        // react-native-reanimated) so Expo Go boots until real worklets land.",
        "        compatPreview: true,",
      ]
    : [];
  const jsxInPackagesLine = options.jsxInPackages
    ? [`        jsxInPackages: ${JSON.stringify(options.jsxInPackages)},`]
    : [];
  const reactNativeCompatLine = options.reactNativeCompat
    ? [`        reactNativeCompat: ${JSON.stringify(options.reactNativeCompat)},`]
    : [];
  const shimJsxRuntimeLine =
    options.shimJsxRuntime === undefined
      ? []
      : [`        shimJsxRuntime: ${JSON.stringify(options.shimJsxRuntime)},`];
  const shimReactLine =
    options.shimReact === undefined
      ? []
      : [`        shimReact: ${JSON.stringify(options.shimReact)},`];
  const shimReactNativeLine =
    options.shimReactNative === undefined
      ? []
      : [`        shimReactNative: ${JSON.stringify(options.shimReactNative)},`];

  return [
    "      {",
    ...aliasesLine,
    ...babelInPackagesLine,
    ...compatPreviewLine,
    '        platform: "ios",',
    `        entry: ${JSON.stringify(options.entry)},`,
    "        hermes: false,",
    ...jsxInPackagesLine,
    '        outDir: "dist/vite/ios",',
    ...reactNativeCompatLine,
    ...shimJsxRuntimeLine,
    ...shimReactLine,
    ...shimReactNativeLine,
    "      },",
    "      {",
    ...aliasesLine,
    ...babelInPackagesLine,
    ...compatPreviewLine,
    '        platform: "android",',
    `        entry: ${JSON.stringify(options.entry)},`,
    "        hermes: false,",
    ...jsxInPackagesLine,
    '        outDir: "dist/vite/android",',
    ...reactNativeCompatLine,
    ...shimJsxRuntimeLine,
    ...shimReactLine,
    ...shimReactNativeLine,
    "      },",
  ];
}

export function buildVifxConfigTemplate(
  projectType: "expo" | "react-native" | "unknown",
  options: {
    aliases?: Record<string, string>;
    babelInPackages?: string[];
    compatPreview?: boolean;
    entry?: string;
    jsxInPackages?: string[];
    reactNativeCompat?: "web";
    shimJsxRuntime?: boolean;
    shimReact?: boolean;
    shimReactNative?: boolean;
  } = {},
) {
  const viteMode =
    projectType === "expo" ? "expo" : projectType === "react-native" ? "react-native" : "none";
  const expoOptionsSection =
    projectType === "expo"
      ? ["  expoOptions: {", '    publicEnvPrefix: "EXPO_PUBLIC_",', "  },"]
      : [];
  const viteTargetsSection =
    viteMode === "none"
      ? []
      : [
          "    targets: [",
          ...createTargetsSection({
            aliases: options.aliases,
            babelInPackages: options.babelInPackages,
            compatPreview: options.compatPreview,
            entry: options.entry ?? "./index.js",
            jsxInPackages: options.jsxInPackages,
            reactNativeCompat: options.reactNativeCompat,
            shimJsxRuntime: options.shimJsxRuntime,
            shimReact: options.shimReact,
            shimReactNative: options.shimReactNative,
          }),
          "    ],",
        ];

  return withTrailingNewline(
    [
      // Import from @vifx/cli, the package that ships the `vifx` bin, so the
      // generated config needs no dependency beyond the one the app installs.
      'import { defineVifxConfig } from "@vifx/cli";',
      "",
      "// Generated by @vifx/codemods for a conservative Vifx setup.",
      "export default defineVifxConfig({",
      "  projectRoot: process.cwd(),",
      `  projectType: ${JSON.stringify(projectType)},`,
      `  expo: ${projectType === "expo" ? "true" : "false"},`,
      `  reactNative: ${projectType === "unknown" ? "false" : "true"},`,
      "  vite: {",
      `    mode: ${JSON.stringify(viteMode)},`,
      ...viteTargetsSection,
      "  },",
      ...expoOptionsSection,
      "  resolver: {",
      '    conditions: ["react-native", "import", "require", "default"],',
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

export function buildExpoSetupVifxConfigTemplate(options: {
  aliases?: Record<string, string>;
  babelInPackages?: string[];
  compatPreview?: boolean;
  entry: string;
  jsxInPackages?: string[];
  reactNativeCompat?: "web";
  shimJsxRuntime?: boolean;
  shimReact?: boolean;
  shimReactNative?: boolean;
}) {
  return withTrailingNewline(
    [
      "// Generated by @vifx/codemods for a bounded Expo migration-first setup.",
      "export default {",
      "  projectRoot: process.cwd(),",
      '  projectType: "expo",',
      "  expo: true,",
      "  reactNative: true,",
      "  vite: {",
      '    mode: "expo",',
      "    targets: [",
      ...createTargetsSection({
        aliases: options.aliases,
        babelInPackages: options.babelInPackages,
        compatPreview: options.compatPreview,
        entry: options.entry,
        jsxInPackages: options.jsxInPackages,
        reactNativeCompat: options.reactNativeCompat,
        shimJsxRuntime: options.shimJsxRuntime,
        shimReact: options.shimReact,
        shimReactNative: options.shimReactNative,
      }),
      "    ],",
      "  },",
      "  expoOptions: {",
      '    publicEnvPrefix: "EXPO_PUBLIC_",',
      "  },",
      "  resolver: {",
      '    conditions: ["react-native", "import", "require", "default"],',
      "  },",
      "};",
      "",
    ].join("\n"),
  );
}

export function buildViteConfigTemplate(
  projectType: "expo" | "react-native",
  options: { entry?: string } = {},
) {
  const pluginImport =
    projectType === "expo"
      ? 'import { expo } from "@vifx/vite-plugin-expo";'
      : 'import { reactNative } from "@vifx/vite-plugin-react-native";';
  const pluginCall = projectType === "expo" ? "expo" : "reactNative";

  return withTrailingNewline(
    [
      'import { defineConfig } from "vite";',
      pluginImport,
      "",
      "// Generated by @vifx/codemods for bounded Vite experiments only.",
      'const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";',
      "",
      "export default defineConfig({",
      "  plugins: [",
      `    ${pluginCall}({`,
      `      entry: ${JSON.stringify(options.entry ?? "./index.js")},`,
      "      platform,",
      "    }),",
      "  ],",
      "  build: {",
      "    outDir: `dist/vite/${platform}`,",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

export function formatPlannedChanges(changes: PlannedFileChange[]) {
  if (changes.length === 0) {
    return "No file changes.";
  }

  return changes
    .map((change) =>
      [
        `[${change.kind}] ${change.path}`,
        "",
        change.kind === "update" ? "--- before\n+++ after" : "+++ create",
        change.after.trimEnd(),
      ].join("\n"),
    )
    .join("\n\n");
}

export async function applyPlannedChanges(projectRoot: string, changes: PlannedFileChange[]) {
  for (const change of changes) {
    const absolutePath = path.join(projectRoot, change.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, change.after, "utf8");
  }
}

function createPlannedFileChange(options: {
  after: string;
  before: string | null;
  path: string;
}): PlannedFileChange | null {
  if (options.before === options.after) {
    return null;
  }

  return {
    after: options.after,
    before: options.before,
    kind: options.before ? "update" : "create",
    path: options.path,
  };
}

async function readPackageJson(projectRoot: string) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const contents = await fs.readFile(packageJsonPath, "utf8");
  let data: PackageJson;

  try {
    data = JSON.parse(contents) as PackageJson;
  } catch (error) {
    throw new VifxError({
      code: "VIFX_PROJECT_INVALID_PACKAGE_JSON",
      cause: error,
      details: {
        packageJsonPath,
      },
      hint: "Fix package.json before planning Vifx init or migration changes.",
      message: `Invalid package.json syntax at "${packageJsonPath}".`,
    });
  }

  return {
    before: contents,
    data,
  };
}

function getPackageManagerCommand(packageManager: string) {
  if (packageManager === "yarn") {
    return "yarn";
  }

  if (packageManager === "npm") {
    return "npm install";
  }

  if (packageManager === "bun") {
    return "bun install";
  }

  return "pnpm install";
}

function createPackageJsonChange(projectRoot: string, before: string, packageJson: PackageJson) {
  const after = withTrailingNewline(JSON.stringify(packageJson, null, 2));
  if (after === before) {
    return null;
  }

  return {
    after,
    before,
    kind: "update" as const,
    path: path.relative(projectRoot, path.join(projectRoot, "package.json")) || "package.json",
  };
}

// Every @vifx/* package is released at the same version (the fixed group in
// .changeset/config.json), so this package's version is the CLI's and the plugins'.
const VIFX_PACKAGE_RANGE = `^${codemodsPackage.version}`;
// The Vite major the Vifx plugins are built and tested against.
const VITE_PACKAGE_RANGE = "^8.3.0";

function addMissingVifxMetadata(
  packageJson: PackageJson,
  options: { projectType: "expo" | "react-native"; withVite: boolean },
) {
  const scripts = { ...packageJson.scripts };
  const devDependencies = { ...packageJson.devDependencies };

  const requiredScripts: Record<string, string> = {
    "vifx:doctor": "vifx doctor",
    "vifx:inspect": "vifx inspect",
  };

  if (options.withVite) {
    requiredScripts["vifx:vite"] = `vite --config ${VIFX_VITE_CONFIG_PATH}`;
    if (!devDependencies.vite) {
      devDependencies.vite = VITE_PACKAGE_RANGE;
    }
  }

  for (const [scriptName, command] of Object.entries(requiredScripts)) {
    if (!scripts[scriptName]) {
      scripts[scriptName] = command;
    }
  }

  const vifxDependencies = ["@vifx/cli"];
  if (options.withVite) {
    vifxDependencies.push(
      options.projectType === "expo" ? "@vifx/vite-plugin-expo" : "@vifx/vite-plugin-react-native",
    );
  }

  for (const dependencyName of vifxDependencies) {
    if (!devDependencies[dependencyName]) {
      devDependencies[dependencyName] = VIFX_PACKAGE_RANGE;
    }
  }

  return {
    ...packageJson,
    devDependencies,
    scripts,
  };
}

function ensureKnownViteProjectType(projectType: string) {
  if (projectType === "expo" || projectType === "react-native") {
    return projectType;
  }

  throw new VifxError({
    code: "VIFX_MIGRATION_UNSAFE_CHANGE",
    message: `Expected a React Native or Expo project, but detected "${projectType}".`,
    hint: 'Run vifx doctor first, or target a project with an "expo" or "react-native" dependency.',
    docsPath: "/guide/migration",
    details: {
      detectedProjectType: projectType,
    },
  });
}

async function inferViteTargetTemplateOptions(
  projectRoot: string,
  projectType: "expo" | "react-native" | "unknown",
) {
  if (projectType !== "expo") {
    return {
      entry: "./index.js",
    };
  }

  const templateOptions = await detectExpoSetupTemplateOptions(projectRoot);

  return {
    entry: templateOptions.entry,
    reactNativeCompat: templateOptions.reactNativeCompat,
  };
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

async function findExistingVifxViteConfigPath(projectRoot: string) {
  for (const fileName of VIFX_VITE_CONFIG_FILE_NAMES) {
    if (await pathExists(path.join(projectRoot, fileName))) {
      return fileName;
    }
  }

  return null;
}

function stripJsonComments(contents: string) {
  let output = "";
  let inBlockComment = false;
  let inLineComment = false;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < contents.length; index += 1) {
    const current = contents[index]!;
    const next = contents[index + 1];

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
        output += current;
      }

      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }

      continue;
    }

    if (!inString && current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === "\\") {
      escaped = true;
      continue;
    }

    if (current === '"') {
      inString = !inString;
    }
  }

  return output;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readJsonRecordIfExists(filePath: string) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(stripJsonComments(contents)) as Record<string, unknown>;
}

function stripAliasWildcard(value: string) {
  return value.replace(/\/\*$/u, "").replace(/\*$/u, "");
}

function normalizeAliasTarget(value: string) {
  const withoutWildcard = stripAliasWildcard(value);
  const normalized = withoutWildcard === "" ? "." : withoutWildcard;

  if (
    normalized === "." ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    return normalized;
  }

  return `./${normalized}`;
}

async function detectTypeScriptPathAliases(projectRoot: string) {
  const tsconfig = await readJsonRecordIfExists(path.join(projectRoot, "tsconfig.json")).catch(
    () => null,
  );
  const compilerOptions = isJsonRecord(tsconfig?.compilerOptions) ? tsconfig.compilerOptions : null;
  const paths = isJsonRecord(compilerOptions?.paths) ? compilerOptions.paths : null;

  if (!paths) {
    return undefined;
  }

  const aliasEntries: Array<[string, string]> = [];

  for (const [from, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || typeof targets[0] !== "string") {
      continue;
    }

    const aliasFrom = stripAliasWildcard(from);
    if (!aliasFrom) {
      continue;
    }

    aliasEntries.push([aliasFrom, normalizeAliasTarget(targets[0])]);
  }

  const aliases = Object.fromEntries(
    aliasEntries.sort(([left], [right]) => left.localeCompare(right)),
  );

  return Object.keys(aliases).length > 0 ? aliases : undefined;
}

const ENTRY_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx"] as const;

/**
 * The entry Expo CLI bundles: package.json `main` — `expo-router/entry` in the
 * router templates, `index.ts` in the blank TypeScript one — read as a project
 * file when one exists at that path and as a module otherwise, then an `index`
 * file at the root.
 */
async function resolveExpoEntry(
  projectRoot: string,
  packageJson: PackageJson,
  expoRouterApp: boolean,
): Promise<string> {
  const main = packageJson.main?.trim();
  if (main) {
    const relativeMain = main.replace(/^\.\//u, "");
    for (const extension of ENTRY_EXTENSIONS) {
      if (await isFile(path.join(projectRoot, `${relativeMain}${extension}`))) {
        return `./${relativeMain}${extension}`;
      }
    }

    return main;
  }

  for (const extension of ENTRY_EXTENSIONS.slice(1)) {
    if (await isFile(path.join(projectRoot, `index${extension}`))) {
      return `./index${extension}`;
    }
  }

  if (expoRouterApp) {
    return "expo-router/entry";
  }

  // No `main` and no index file: Expo CLI registers the root `App` component
  // through `expo/AppEntry`.
  for (const extension of ENTRY_EXTENSIONS.slice(1)) {
    if (await isFile(path.join(projectRoot, `App${extension}`))) {
      return "expo/AppEntry";
    }
  }

  return "./index.js";
}

async function isFile(filePath: string) {
  return (await fs.stat(filePath).catch(() => null))?.isFile() ?? false;
}

async function detectExpoSetupTemplateOptions(
  projectRoot: string,
): Promise<ExpoSetupTemplateOptions> {
  const packageJson = await readPackageJson(projectRoot);
  const dependencies = {
    ...packageJson.data.dependencies,
    ...packageJson.data.devDependencies,
  };
  const expoRouter = Boolean(dependencies["expo-router"]);
  // Expo Router's routes: `src/app` (the SDK 55+ templates) or `app`.
  const appDirectory =
    (await pathExists(path.join(projectRoot, "src", "app"))) ||
    (await pathExists(path.join(projectRoot, "app")));
  const iosHostPresent = await pathExists(path.join(projectRoot, "ios"));
  const webPreviewConfigured = expoRouter && appDirectory;
  const babelInPackages = [
    "expo",
    "expo-",
    "expo-router",
    "@expo",
    "react-native",
    "react-native-",
    "@react-native",
    "@react-navigation",
  ];
  const jsxInPackages = webPreviewConfigured
    ? ["expo-router", "@react-navigation", "react-native-"]
    : ["react-native-"];

  return {
    aliases: await detectTypeScriptPathAliases(projectRoot),
    appDirectory,
    babelInPackages,
    entry: await resolveExpoEntry(projectRoot, packageJson.data, webPreviewConfigured),
    expoRouter,
    iosHostPresent,
    jsxInPackages,
    reactNativeCompat: webPreviewConfigured ? "web" : undefined,
    shimJsxRuntime: false,
    shimReact: false,
    shimReactNative: false,
    webPreviewConfigured,
  };
}

export async function planViteInit(projectRoot: string, options: { force?: boolean }) {
  const inspection = await inspectProject(projectRoot);
  const projectType = ensureKnownViteProjectType(inspection.projectType);
  const templateOptions = await inferViteTargetTemplateOptions(projectRoot, projectType);
  const changes: PlannedFileChange[] = [];
  const packageJson = await readPackageJson(projectRoot);
  const updatedPackageJson = addMissingVifxMetadata(packageJson.data, {
    projectType,
    withVite: true,
  });
  const packageJsonChange = createPackageJsonChange(
    projectRoot,
    packageJson.before,
    updatedPackageJson,
  );

  if (packageJsonChange) {
    changes.push(packageJsonChange);
  }

  if (!inspection.vifxConfigPath) {
    changes.push({
      after: buildVifxConfigTemplate(projectType, templateOptions),
      before: null,
      kind: "create",
      path: "vifx.config.ts",
    });
  }

  const existingVifxViteConfigPath = path.join(projectRoot, VIFX_VITE_CONFIG_PATH);
  const existingVifxViteConfigPathRelative = await findExistingVifxViteConfigPath(projectRoot);
  const hasVifxViteConfig = Boolean(existingVifxViteConfigPathRelative);
  const existingVifxViteConfigPathAbsolute = existingVifxViteConfigPathRelative
    ? path.join(projectRoot, existingVifxViteConfigPathRelative)
    : existingVifxViteConfigPath;

  if (!hasVifxViteConfig || options.force) {
    const before = hasVifxViteConfig
      ? await fs.readFile(existingVifxViteConfigPathAbsolute, "utf8")
      : null;
    const change = createPlannedFileChange({
      after: buildViteConfigTemplate(projectType, templateOptions),
      before,
      path: existingVifxViteConfigPathRelative ?? VIFX_VITE_CONFIG_PATH,
    });

    if (change) {
      changes.push(change);
    }
  }

  return {
    changes,
    projectRoot,
  } satisfies InitPlan;
}

export async function planInit(projectRoot: string, options: { force?: boolean }) {
  const inspection = await inspectProject(projectRoot);
  const templateOptions = await inferViteTargetTemplateOptions(projectRoot, inspection.projectType);
  const changes: PlannedFileChange[] = [];

  if (!inspection.vifxConfigPath || options.force) {
    const before = inspection.vifxConfigPath
      ? await fs.readFile(path.join(projectRoot, inspection.vifxConfigPath), "utf8")
      : null;

    changes.push({
      after: buildVifxConfigTemplate(inspection.projectType, templateOptions),
      before,
      kind: before ? "update" : "create",
      path: "vifx.config.ts",
    });
  }

  return {
    changes,
    projectRoot,
  } satisfies InitPlan;
}

const VIFX_EXPO_CONFIG_PLUGIN_NAME = "@vifx/expo-config-plugin";

function hasVifxExpoConfigPlugin(plugins: unknown[]) {
  return plugins.some(
    (entry) =>
      entry === VIFX_EXPO_CONFIG_PLUGIN_NAME ||
      (Array.isArray(entry) && entry[0] === VIFX_EXPO_CONFIG_PLUGIN_NAME),
  );
}

async function planExperimentalEmbedAppJsonChange(projectRoot: string) {
  const appJsonPath = path.join(projectRoot, "app.json");

  if (!(await pathExists(appJsonPath))) {
    throw new VifxError({
      code: "VIFX_SETUP_APP_JSON_REQUIRED",
      message: `--experimental-embed requires a static app.json at "${projectRoot}".`,
      hint: `Dynamic app configs are not codemodded. Add "${VIFX_EXPO_CONFIG_PLUGIN_NAME}" to the "plugins" array of your Expo app config manually.`,
      docsPath: "/guide/migration#expo-native-builds",
      details: {
        appJsonPath,
        projectRoot,
      },
    });
  }

  const before = await fs.readFile(appJsonPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(before);
  } catch (error) {
    throw new VifxError({
      code: "VIFX_PROJECT_INVALID_APP_JSON",
      cause: error,
      details: {
        appJsonPath,
      },
      hint: "Fix app.json before planning the experimental embed setup.",
      message: `Invalid app.json syntax at "${appJsonPath}".`,
    });
  }

  if (!isJsonRecord(parsed)) {
    throw new VifxError({
      code: "VIFX_PROJECT_INVALID_APP_JSON",
      details: {
        appJsonPath,
      },
      hint: "Expected app.json to contain a JSON object before planning the experimental embed setup.",
      message: `Invalid app.json shape at "${appJsonPath}".`,
    });
  }

  const root = { ...parsed };
  const expoConfig = isJsonRecord(root.expo) ? { ...root.expo } : null;
  const target = expoConfig ?? root;
  const plugins = Array.isArray(target.plugins) ? [...target.plugins] : [];

  if (hasVifxExpoConfigPlugin(plugins)) {
    return null;
  }

  plugins.push(VIFX_EXPO_CONFIG_PLUGIN_NAME);
  target.plugins = plugins;

  if (expoConfig) {
    root.expo = expoConfig;
  }

  return createPlannedFileChange({
    after: withTrailingNewline(JSON.stringify(root, null, 2)),
    before,
    path: "app.json",
  });
}

function createSetupProjectTypeHint(projectRoot: string, detectedProjectType: string) {
  if (detectedProjectType === "react-native") {
    return `Use "vifx migrate react-native ${projectRoot}" for the manual bare React Native path, or "vifx init ${projectRoot}" to author a config yourself.`;
  }

  return `Use "vifx doctor ${projectRoot}" to verify the project type, or "vifx init ${projectRoot}" if you want to author a config manually.`;
}

export async function planExpoSetup(
  projectRoot: string,
  options: {
    experimentalEmbed?: boolean;
    expoGo?: boolean;
    force?: boolean;
    withViteConfig?: boolean;
  } = {},
): Promise<SetupPlan> {
  const inspection = await inspectProject(projectRoot);

  if (inspection.projectType !== "expo") {
    throw new VifxError({
      code: "VIFX_SETUP_EXPO_ONLY",
      message: `vifx setup currently supports Expo projects only, but detected "${inspection.projectType}" at "${projectRoot}".`,
      hint: createSetupProjectTypeHint(projectRoot, inspection.projectType),
      docsPath: "/guide/migration",
      details: {
        detectedProjectType: inspection.projectType,
        projectRoot,
      },
    });
  }

  const templateOptions = await detectExpoSetupTemplateOptions(projectRoot);
  const changes: PlannedFileChange[] = [];
  const vifxConfigPath = inspection.vifxConfigPath ?? "vifx.config.ts";

  if (!inspection.vifxConfigPath || options.force) {
    const before = inspection.vifxConfigPath
      ? await fs.readFile(path.join(projectRoot, inspection.vifxConfigPath), "utf8")
      : null;
    const change = createPlannedFileChange({
      after: buildExpoSetupVifxConfigTemplate({
        aliases: templateOptions.aliases,
        babelInPackages: templateOptions.babelInPackages,
        compatPreview: options.expoGo ? true : undefined,
        entry: templateOptions.entry,
        jsxInPackages: templateOptions.jsxInPackages,
        reactNativeCompat: options.expoGo ? undefined : templateOptions.reactNativeCompat,
        shimJsxRuntime: templateOptions.shimJsxRuntime,
        shimReact: templateOptions.shimReact,
        shimReactNative: templateOptions.shimReactNative,
      }),
      before,
      path: vifxConfigPath,
    });

    if (change) {
      changes.push(change);
    }
  }

  if (options.withViteConfig) {
    const existingVifxViteConfigPathRelative = await findExistingVifxViteConfigPath(projectRoot);
    const hasVifxViteConfig = Boolean(existingVifxViteConfigPathRelative);
    const existingVifxViteConfigPathAbsolute = existingVifxViteConfigPathRelative
      ? path.join(projectRoot, existingVifxViteConfigPathRelative)
      : path.join(projectRoot, VIFX_VITE_CONFIG_PATH);

    if (!hasVifxViteConfig || options.force) {
      const before = hasVifxViteConfig
        ? await fs.readFile(existingVifxViteConfigPathAbsolute, "utf8")
        : null;
      const change = createPlannedFileChange({
        after: buildViteConfigTemplate("expo", {
          entry: templateOptions.entry,
        }),
        before,
        path: existingVifxViteConfigPathRelative ?? VIFX_VITE_CONFIG_PATH,
      });

      if (change) {
        changes.push(change);
      }
    }
  }

  if (options.experimentalEmbed) {
    const appJsonChange = await planExperimentalEmbedAppJsonChange(projectRoot);

    if (appJsonChange) {
      changes.push(appJsonChange);
    }
  }

  return {
    appDirectory: templateOptions.appDirectory,
    changes,
    detectedExpoVersion: inspection.expoVersion,
    detectedProjectType: inspection.projectType,
    detectedReactNativeVersion: inspection.reactNativeVersion,
    experimentalEmbed: Boolean(options.experimentalEmbed),
    expoGo: Boolean(options.expoGo),
    expoRouter: templateOptions.expoRouter,
    iosHostPresent: templateOptions.iosHostPresent,
    projectRoot,
    webPreviewConfigured: templateOptions.webPreviewConfigured,
    withViteConfig: Boolean(options.withViteConfig),
  } satisfies SetupPlan;
}

export async function planMigration(
  projectRoot: string,
  kind: "expo" | "react-native",
  options: { withVite: boolean },
) {
  const inspection = await inspectProject(projectRoot);
  const templateOptions = await inferViteTargetTemplateOptions(projectRoot, inspection.projectType);

  if (kind === "expo" && inspection.projectType !== "expo") {
    throw new VifxError({
      code: "VIFX_MIGRATION_UNSAFE_CHANGE",
      message: `Expected an Expo project at ${projectRoot}, but detected "${inspection.projectType}".`,
      hint: "Run vifx doctor first, or target a project with an Expo dependency or app config.",
      docsPath: "/guide/migration",
      details: {
        expectedProjectType: kind,
        detectedProjectType: inspection.projectType,
        projectRoot,
      },
    });
  }

  if (kind === "react-native" && inspection.projectType !== "react-native") {
    throw new VifxError({
      code: "VIFX_MIGRATION_UNSAFE_CHANGE",
      message: `Expected a React Native project at ${projectRoot}, but detected "${inspection.projectType}".`,
      hint: 'Run vifx doctor first, or target a project with a "react-native" dependency.',
      docsPath: "/guide/migration",
      details: {
        expectedProjectType: kind,
        detectedProjectType: inspection.projectType,
        projectRoot,
      },
    });
  }

  const changes: PlannedFileChange[] = [];
  if (options.withVite) {
    changes.push(...(await planViteInit(projectRoot, {})).changes);
  } else {
    const packageJson = await readPackageJson(projectRoot);
    const updatedPackageJson = addMissingVifxMetadata(packageJson.data, {
      projectType: kind,
      withVite: false,
    });
    const packageJsonChange = createPackageJsonChange(
      projectRoot,
      packageJson.before,
      updatedPackageJson,
    );

    if (packageJsonChange) {
      changes.push(packageJsonChange);
    }

    if (!inspection.vifxConfigPath) {
      changes.push({
        after: buildVifxConfigTemplate(inspection.projectType, templateOptions),
        before: null,
        kind: "create",
        path: "vifx.config.ts",
      });
    }
  }

  const installCommand = getPackageManagerCommand(inspection.packageManager);

  return {
    changes,
    nextSteps: [
      `Run ${installCommand} in ${path.relative(process.cwd(), projectRoot) || "."}.`,
      "Run vifx doctor to confirm the project state.",
      "Run vifx build to bundle the project with Vifx.",
    ],
    projectRoot,
    rollbackSteps: [
      "Revert package.json to its previous contents.",
      "Delete vifx.config.ts if you do not want to keep the generated config.",
      ...(options.withVite
        ? [`Delete ${VIFX_VITE_CONFIG_PATH} if the generated Vite config is not needed.`]
        : []),
    ],
  } satisfies MigrationPlan;
}
