import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vite-plus/test";

// The published @vifx/* packages build with the Vite+ core
// (`@voidzero-dev/vite-plus-core`). Declaring it as `vite: npm:@voidzero-dev/...`
// makes npm, Yarn classic, Bun and pnpm's hoisted linker put it at the app's
// `node_modules/vite`. Once the app installs its own Vite (a vite.config.vifx.ts
// needs it), the alias is nested again under every @vifx package that declares
// it, and each of them loads its own copy. These tests keep the core under its
// own name and out of the app's `vite`.

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const VITE_PLUS_CORE = "@voidzero-dev/vite-plus-core";
const PUBLISHED_DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

interface PackageManifest {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PublishedPackage {
  directory: string;
  manifest: PackageManifest;
}

async function readPublishedPackages(): Promise<PublishedPackage[]> {
  const entries = await readdir(PACKAGES_ROOT, { withFileTypes: true });
  const packages: PublishedPackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(PACKAGES_ROOT, entry.name);
    const manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    ) as PackageManifest;

    if (!manifest.private) {
      packages.push({ directory, manifest });
    }
  }

  return packages;
}

async function readSourceFiles(directory: string): Promise<Map<string, string>> {
  const sourceRoot = path.join(directory, "src");
  const files = new Map<string, string>();

  for (const relativePath of await readdir(sourceRoot, { recursive: true })) {
    if (/\.[cm]?tsx?$/u.test(relativePath)) {
      files.set(relativePath, await readFile(path.join(sourceRoot, relativePath), "utf8"));
    }
  }

  return files;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

// Import statements (one or several lines), `export … from`, side-effect imports,
// and `import("…")` calls or types. Statements must start a line and comment
// lines are skipped: doc comments and codemod templates show a user's own
// vite.config.vifx.ts, which does import "vite".
function importsSpecifier(source: string, specifier: RegExp): boolean {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/u.test(line))
    .join("\n");
  const quoted = String.raw`["'](?:${specifier.source})["']`;
  const patterns = [
    String.raw`^[ \t]*(?:import|export)\b[^;'"]*?\bfrom[ \t]*${quoted}`,
    String.raw`^[ \t]*import[ \t]*${quoted}`,
    String.raw`\bimport\(\s*${quoted}\s*\)`,
  ];
  return patterns.some((pattern) => new RegExp(pattern, "mu").test(code));
}

const BARE_VITE = /vite(?:\/[^"']*)?/u;
const VITE_PLUS_CORE_IMPORT = new RegExp(
  String.raw`${escapeRegExp(VITE_PLUS_CORE)}(?:/[^"']*)?`,
  "u",
);

test("the import matcher sees the forms the sources use", () => {
  expect(importsSpecifier('import { build } from "vite";', BARE_VITE)).toBe(true);
  expect(importsSpecifier('import {\n  build,\n  type Plugin,\n} from "vite";', BARE_VITE)).toBe(
    true,
  );
  expect(importsSpecifier('import { dev } from "vite/rolldown/experimental";', BARE_VITE)).toBe(
    true,
  );
  expect(importsSpecifier('type P = import("vite").Plugin;', BARE_VITE)).toBe(true);
  expect(importsSpecifier('import "vite";', BARE_VITE)).toBe(true);
  expect(importsSpecifier('import { defineConfig } from "vite-plus";', BARE_VITE)).toBe(false);
  expect(importsSpecifier('if (source.startsWith("vite/")) {}', BARE_VITE)).toBe(false);
  expect(importsSpecifier(' * import { defineConfig } from "vite";', BARE_VITE)).toBe(false);
  expect(
    importsSpecifier(`const lines = [\n  'import { defineConfig } from "vite";',\n];`, BARE_VITE),
  ).toBe(false);
  expect(
    importsSpecifier(`import { build } from "${VITE_PLUS_CORE}";`, VITE_PLUS_CORE_IMPORT),
  ).toBe(true);
  expect(
    importsSpecifier(
      `import { dev } from "${VITE_PLUS_CORE}/rolldown/experimental";`,
      VITE_PLUS_CORE_IMPORT,
    ),
  ).toBe(true);
});

test("the published packages are found", async () => {
  const names = (await readPublishedPackages()).map((entry) => entry.manifest.name);

  expect(names).toEqual(
    expect.arrayContaining([
      "@vifx/cli",
      "@vifx/vite-config-bridge",
      "@vifx/vite-plugin-expo",
      "@vifx/vite-plugin-react-native",
    ]),
  );
});

test("no published package declares vite or an npm: alias", async () => {
  const offenders: string[] = [];

  for (const { manifest } of await readPublishedPackages()) {
    for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name === "vite" || range.startsWith("npm:")) {
          offenders.push(`${manifest.name} ${field}.${name}: ${range}`);
        }
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("no published package imports vite by the bare name", async () => {
  const offenders: string[] = [];

  for (const { directory, manifest } of await readPublishedPackages()) {
    for (const [file, source] of await readSourceFiles(directory)) {
      if (importsSpecifier(source, BARE_VITE)) {
        offenders.push(`${manifest.name}: src/${file}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("packages that import the Vite+ core declare it as a dependency", async () => {
  const importers: string[] = [];
  const undeclared: string[] = [];

  for (const { directory, manifest } of await readPublishedPackages()) {
    const sources = [...(await readSourceFiles(directory)).values()];
    if (!sources.some((source) => importsSpecifier(source, VITE_PLUS_CORE_IMPORT))) {
      continue;
    }

    importers.push(manifest.name);
    if (manifest.dependencies?.[VITE_PLUS_CORE] === undefined) {
      undeclared.push(manifest.name);
    }
  }

  expect(importers).toEqual(
    expect.arrayContaining([
      "@vifx/vite-config-bridge",
      "@vifx/vite-plugin-expo",
      "@vifx/vite-plugin-react-native",
    ]),
  );
  expect(undeclared).toEqual([]);
});

test("the catalog keeps the Vite+ core, the vite alias and vite-plus on one version", async () => {
  const workspace = await readFile(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const catalog = /^catalog:\n((?:[ \t]+\S.*\n|[ \t]*\n)*)/mu.exec(workspace)?.[1] ?? "";
  const catalogValue = (key: string) =>
    new RegExp(String.raw`^[ \t]+"?${escapeRegExp(key)}"?:[ \t]*(\S+)[ \t]*$`, "mu").exec(
      catalog,
    )?.[1];

  const vitePlus = catalogValue("vite-plus");
  expect(vitePlus).toMatch(/^\d+\.\d+\.\d+/u);
  expect(catalogValue(VITE_PLUS_CORE)).toBe(vitePlus);
  expect(catalogValue("vite")).toBe(`npm:${VITE_PLUS_CORE}@${vitePlus}`);
});
