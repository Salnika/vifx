import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("validateVifxConfig rejects unknown keys with a readable error", () => {
  expect(() =>
    validateVifxConfig({
      platforms: ["ios"],
      unknownKey: true,
    }),
  ).toThrowError(/Unknown config key "unknownKey"/);
});
