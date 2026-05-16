import path from "node:path";
import { promises as fs } from "node:fs";
import { inspectProject } from "@vifx/compat-runner";
import type { PlannedFileChange } from "../types.ts";

interface PackageJson {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function withTrailingNewline(contents: string) {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

function createTargetsSection() {
  return [
    "  targets: [",
    "    {",
    '      platform: "ios",',
    '      entry: "./index.js",',
    "      hermes: false,",
    "    },",
    "    {",
    '      platform: "android",',
    '      entry: "./index.js",',
    "      hermes: false,",
    "    },",
    "  ],",
  ];
}

export function buildVifxConfigTemplate(projectType: "expo" | "react-native" | "unknown") {
  const expoSection =
    projectType === "expo"
      ? [
          "  expo: {",
          "    enabled: true,",
          "    updates: {",
          "      inspectOnly: true,",
          "    },",
          "  },",
        ]
      : ["  expo: {", "    enabled: false,", "  },"];

  return withTrailingNewline(
    [
      'import { defineVifxConfig } from "@vifx/core";',
      "",
      "export default defineVifxConfig({",
      "  projectRoot: process.cwd(),",
      ...createTargetsSection(),
      ...expoSection,
      "  resolver: {",
      '    conditions: ["react-native", "import", "require", "default"],',
      "  },",
      "  experimental: {",
      "    vite: false,",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

export function buildViteConfigTemplate() {
  return withTrailingNewline(
    [
      'import { defineConfig } from "vite";',
      "",
      "export default defineConfig({",
      "  resolve: {",
      '    conditions: ["react-native", "import", "module", "default"],',
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

async function readPackageJson(projectRoot: string) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const contents = await fs.readFile(packageJsonPath, "utf8");
  return {
    path: packageJsonPath,
    before: contents,
    data: JSON.parse(contents) as PackageJson,
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
    kind: "update" as const,
    path: path.relative(projectRoot, path.join(projectRoot, "package.json")) || "package.json",
    before,
    after,
  };
}

function addMissingVifxMetadata(packageJson: PackageJson, options: { withVite: boolean }) {
  const scripts = { ...packageJson.scripts };
  const devDependencies = { ...packageJson.devDependencies };

  const requiredScripts: Record<string, string> = {
    "vifx:doctor": "vifx doctor",
    "vifx:compat": "vifx compat run --adapter vifx",
    "vifx:inspect": "vifx inspect",
  };

  if (options.withVite) {
    requiredScripts["vifx:vite"] = "vite --config vite.config.ts";
    if (!devDependencies.vite) {
      devDependencies.vite = "latest";
    }
  }

  for (const [scriptName, command] of Object.entries(requiredScripts)) {
    if (!scripts[scriptName]) {
      scripts[scriptName] = command;
    }
  }

  for (const dependencyName of ["@vifx/cli", "@vifx/compat", "@vifx/compat-runner", "@vifx/core"]) {
    if (!devDependencies[dependencyName]) {
      devDependencies[dependencyName] = "workspace:*";
    }
  }

  return {
    ...packageJson,
    scripts,
    devDependencies,
  };
}

export async function planInit(projectRoot: string, options: { force?: boolean }) {
  const inspection = await inspectProject(projectRoot);
  const changes: PlannedFileChange[] = [];
  const relativeConfigPath = "vifx.config.ts";

  if (!inspection.vifxConfigPath || options.force) {
    const before = inspection.vifxConfigPath
      ? await fs.readFile(path.join(projectRoot, inspection.vifxConfigPath), "utf8")
      : null;

    changes.push({
      kind: before ? "update" : "create",
      path: relativeConfigPath,
      before,
      after: buildVifxConfigTemplate(inspection.projectType),
    });
  }

  return {
    projectRoot,
    changes,
  };
}

export async function planMigration(
  projectRoot: string,
  kind: "expo" | "react-native",
  options: { withVite: boolean },
) {
  const inspection = await inspectProject(projectRoot);

  if (kind === "expo" && inspection.projectType !== "expo") {
    throw new Error(
      `Expected an Expo project at ${projectRoot}, but detected "${inspection.projectType}".`,
    );
  }

  if (kind === "react-native" && inspection.projectType !== "react-native") {
    throw new Error(
      `Expected a React Native project at ${projectRoot}, but detected "${inspection.projectType}".`,
    );
  }

  const changes: PlannedFileChange[] = [];
  const packageJson = await readPackageJson(projectRoot);
  const updatedPackageJson = addMissingVifxMetadata(packageJson.data, {
    withVite: options.withVite,
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
      kind: "create",
      path: "vifx.config.ts",
      before: null,
      after: buildVifxConfigTemplate(inspection.projectType),
    });
  }

  if (options.withVite && !inspection.viteConfigPath) {
    changes.push({
      kind: "create",
      path: "vite.config.ts",
      before: null,
      after: buildViteConfigTemplate(),
    });
  }

  const installCommand = getPackageManagerCommand(inspection.packageManager);
  const nextSteps = [
    `Run ${installCommand} in ${path.relative(process.cwd(), projectRoot) || "."}.`,
    "Run vifx doctor to confirm the project state.",
    "Run vifx compat run --adapter vifx to validate the first-pass Vifx adapter.",
  ];
  const rollbackSteps = [
    "Revert package.json to its previous contents.",
    "Delete vifx.config.ts if you do not want to keep the generated config.",
    ...(options.withVite
      ? ["Delete vite.config.ts if the generated Vite config is not needed."]
      : []),
  ];

  return {
    projectRoot,
    changes,
    nextSteps,
    rollbackSteps,
  };
}
