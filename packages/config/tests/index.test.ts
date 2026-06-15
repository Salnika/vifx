import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vite-plus/test";
import {
  defineVifxConfig,
  loadVifxConfig,
  normalizeVifxConfig,
  validateVifxConfig,
} from "../src/index.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("defineVifxConfig preserves typed config input", () => {
  const config = defineVifxConfig({
    platforms: ["ios", "android"],
    expo: true,
    vite: {
      mode: "expo",
    },
  });

  expect(config.platforms).toEqual(["ios", "android"]);
  expect(config.expo).toBe(true);
  expect(config.vite?.mode).toBe("expo");
});

test("normalizeVifxConfig applies defaults and deduplicates lists", () => {
  const normalized = normalizeVifxConfig({
    projectRoot: "/repo",
    platforms: ["ios", "ios", "android"],
    resolver: {
      extensions: ["tsx", ".tsx", "ts"],
      conditions: ["react-native", "react-native"],
    },
    vite: {
      mode: "react-native",
      targets: [
        {
          aliases: {
            "@": ".",
          },
          babelInPackages: ["react-native", "react-native"],
          entry: "expo-router/entry",
          hermes: false,
          jsxInPackages: ["expo-router", "expo-router"],
          platform: "ios",
          reactNativeCompat: "web",
          shimJsxRuntime: false,
          shimReact: false,
          shimReactNative: false,
        },
      ],
    },
  });

  expect(normalized.platforms).toEqual(["ios", "android"]);
  expect(normalized.resolver.extensions).toEqual(["tsx", "ts"]);
  expect(normalized.resolver.conditions).toEqual(["react-native"]);
  expect(normalized.vite.mode).toBe("react-native");
  expect(normalized.vite.targets).toHaveLength(1);
  expect(normalized.vite.targets[0]).toMatchObject({
    aliases: {
      "@": ".",
    },
    babelInPackages: ["react-native"],
    entry: "expo-router/entry",
    jsxInPackages: ["expo-router"],
    platform: "ios",
    reactNativeCompat: "web",
    shimJsxRuntime: false,
    shimReact: false,
    shimReactNative: false,
  });
  expect(normalized.logger.level).toBe("info");
});

test("loadVifxConfig loads and validates a TypeScript config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vifx-config-"));
  tempDirectories.push(directory);

  await writeFile(
    join(directory, "vifx.config.ts"),
    [
      "export default {",
      '  projectRoot: "/fixture",',
      '  platforms: ["ios", "android"],',
      "  expo: true,",
      "  expoOptions: {",
      '    publicEnvPrefix: "EXPO_PUBLIC_",',
      "  },",
      "  vite: {",
      '    mode: "expo",',
      "  },",
      "  resolver: {",
      '    extensions: ["tsx", "ts", "js"],',
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  const loaded = await loadVifxConfig({
    cwd: directory,
    optional: false,
  });

  expect(loaded.filePath).toBe(join(directory, "vifx.config.ts"));
  expect(loaded.config.projectRoot).toBe("/fixture");
  expect(loaded.config.expo).toBe(true);
  expect(loaded.config.expoOptions.publicEnvPrefix).toBe("EXPO_PUBLIC_");
  expect(loaded.config.vite.mode).toBe("expo");
  expect(loaded.config.resolver.extensions).toEqual(["tsx", "ts", "js"]);
});

test("loadVifxConfig supports every SPECS config filename", async () => {
  for (const fileName of [
    "vifx.config.ts",
    "vifx.config.mts",
    "vifx.config.js",
    "vifx.config.mjs",
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "vifx-config-format-"));
    tempDirectories.push(directory);

    await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
    await writeFile(
      join(directory, fileName),
      [
        "export default {",
        `  projectRoot: ${JSON.stringify(directory)},`,
        '  projectType: "react-native",',
        "  reactNative: true,",
        "};",
        "",
      ].join("\n"),
    );

    const loaded = await loadVifxConfig({
      cwd: directory,
      optional: false,
    });

    expect(loaded.filePath).toBe(join(directory, fileName));
    expect(loaded.config.projectRoot).toBe(directory);
    expect(loaded.config.projectType).toBe("react-native");
    expect(loaded.config.reactNative).toBe(true);
  }
});

test("loadVifxConfig evaluates process.cwd() relative to the requested project root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vifx-config-cwd-"));
  tempDirectories.push(directory);
  const callerDirectory = join(directory, "caller");

  await mkdir(callerDirectory, { recursive: true });
  await writeFile(
    join(directory, "vifx.config.ts"),
    [
      "export default {",
      "  projectRoot: process.cwd(),",
      '  projectType: "expo",',
      "  expo: true,",
      "};",
      "",
    ].join("\n"),
  );

  const previousCwd = process.cwd();
  process.chdir(callerDirectory);

  try {
    const loaded = await loadVifxConfig({
      cwd: directory,
      optional: false,
    });

    expect(await realpath(loaded.config.projectRoot)).toBe(await realpath(directory));
  } finally {
    process.chdir(previousCwd);
  }
});

test("validateVifxConfig rejects unknown keys with a readable error", () => {
  expect(() =>
    validateVifxConfig({
      platforms: ["ios"],
      unknownKey: true,
    }),
  ).toThrowError(/Unknown config key "unknownKey"/);
});

// Reserved contract keys (batch/00): must be accepted by the strict key
// validation so the sibling workstreams that consume them don't get rejected.
test("validateVifxConfig accepts the reserved vite.userConfigFile key", () => {
  const fromPath = validateVifxConfig({
    vite: { mode: "expo", userConfigFile: "vite.config.vifx.ts" },
  });
  expect(fromPath.vite.userConfigFile).toBe("vite.config.vifx.ts");

  const optedOut = validateVifxConfig({ vite: { mode: "expo", userConfigFile: false } });
  expect(optedOut.vite.userConfigFile).toBe(false);
});

test("validateVifxConfig accepts the reserved top-level unifiedEnv key", () => {
  const config = validateVifxConfig({ unifiedEnv: true });
  expect(config.unifiedEnv).toBe(true);
});

test("normalizeVifxConfig keeps its exact shape when the reserved keys are absent", () => {
  const config = normalizeVifxConfig({ platforms: ["ios"] });
  expect(Object.hasOwn(config, "unifiedEnv")).toBe(false);
  expect(Object.hasOwn(config.vite, "userConfigFile")).toBe(false);
});
