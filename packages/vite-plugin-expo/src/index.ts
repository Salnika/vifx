import { access } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { VifxError } from "@vifx/errors";
import { reactNative } from "@vifx/vite-plugin-react-native";
import type { VifxExpoPluginOptions } from "@vifx/types";

const EXPO_APP_CONFIG_NAMES = [
  "app.json",
  "app.config.ts",
  "app.config.mts",
  "app.config.js",
  "app.config.mjs",
] as const;

function resolvePublicEnv(
  explicitEnv: Record<string, string> | undefined,
  processEnv: NodeJS.ProcessEnv | undefined,
  prefix: string,
) {
  const source = explicitEnv ?? processEnv ?? {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([name, value]) => name.startsWith(prefix) && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findExpoAppConfig(projectRoot: string, explicitPath?: string) {
  if (explicitPath) {
    const resolvedPath = path.resolve(projectRoot, explicitPath);
    if (await pathExists(resolvedPath)) {
      return resolvedPath;
    }

    throw new VifxError({
      code: "VIFX_EXPO_CONFIG_NOT_FOUND",
      message: `Could not find Expo app config "${explicitPath}".`,
      hint: "Pass an existing app.json or app.config.* path.",
      docsPath: "/reference/packages#vifxvite-plugin-expo",
    });
  }

  for (const fileName of EXPO_APP_CONFIG_NAMES) {
    const candidatePath = path.join(projectRoot, fileName);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new VifxError({
    code: "VIFX_EXPO_CONFIG_NOT_FOUND",
    message: `No Expo app config was found in "${projectRoot}".`,
    hint: `Create one of: ${EXPO_APP_CONFIG_NAMES.join(", ")}.`,
    docsPath: "/reference/packages#vifxvite-plugin-expo",
  });
}

export function expo(options: VifxExpoPluginOptions): Plugin[] {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const publicEnvPrefix = options.publicEnvPrefix ?? "EXPO_PUBLIC_";
  const publicEnv = resolvePublicEnv(
    options.publicEnv,
    options.env ?? process.env,
    publicEnvPrefix,
  );

  return [
    {
      name: "vifx:expo",
      enforce: "pre",
      async config() {
        const appConfigPath = await findExpoAppConfig(projectRoot, options.appConfigPath);
        const defineEntries = Object.fromEntries(
          Object.entries(publicEnv).flatMap(([name, value]) => [
            [`import.meta.env.${name}`, JSON.stringify(value)],
            [`process.env.${name}`, JSON.stringify(value)],
          ]),
        );

        return {
          define: {
            __EXPO_APP_CONFIG_PATH__: JSON.stringify(path.relative(projectRoot, appConfigPath)),
            ...defineEntries,
          },
        };
      },
      load(id) {
        if (id !== "\0vifx:expo") {
          return null;
        }

        return [
          'import { AppRegistry } from "react-native";',
          "",
          "export function registerRootComponent(component) {",
          '  AppRegistry.registerComponent("main", () => component);',
          "",
          "  if (typeof document !== 'undefined') {",
          "    const rootTag = document.getElementById('root');",
          "    if (!rootTag) {",
          "      throw new Error('Required HTML element with id \"root\" was not found in the document HTML.');",
          "    }",
          "",
          '    AppRegistry.runApplication("main", { rootTag });',
          "  }",
          "",
          "  return component;",
          "}",
          "const Expo = { registerRootComponent };",
          "export default Expo;",
        ].join("\n");
      },
      resolveId(source) {
        if (source === "expo") {
          return "\0vifx:expo";
        }

        return null;
      },
    },
    reactNative({
      ...options,
      projectRoot,
    }),
  ];
}
