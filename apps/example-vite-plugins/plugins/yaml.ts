import type { Plugin } from "vite";

/**
 * Plugin 3 of 3 — a **non-JS asset loader** for `.yaml` / `.yml` imports.
 *
 * The app does `import config from "./app-config.yaml"` and reads fields off the
 * parsed object. This plugin's `transform` intercepts `.yaml` files, parses them
 * (a tiny dependency-free flat `key: value` parser — enough for the example),
 * and re-emits them as an ES module exporting the data as the default export.
 *
 * This is the exact shape of `@rollup/plugin-yaml`: it lets a build import a
 * data file as if it were code. We inline a self-contained parser instead of
 * pulling the community package so the example builds fully offline in this
 * vendored worktree — but the plugin contract (claim `.yaml`, return a JS
 * module) is identical, so swapping in `@rollup/plugin-yaml` is a one-line
 * change. Values from the YAML end up as string literals in the bundle, so
 * grepping for them proves the loader ran.
 */

/** Minimal flat `key: value` YAML parser. Values are kept as strings. */
function parseFlatYaml(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/#.*$/u, "").trimEnd();
    if (line.trim() === "") {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    // Strip matching surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") {
      result[key] = value;
    }
  }
  return result;
}

export function yamlPlugin(): Plugin {
  return {
    name: "example:yaml",
    transform(code, id) {
      // Strip any Vite query suffix (e.g. `?used`) before matching the path.
      const cleanId = id.split("?")[0] ?? id;
      if (!cleanId.endsWith(".yaml") && !cleanId.endsWith(".yml")) {
        return null;
      }
      const data = parseFlatYaml(code);
      return {
        code: `export default ${JSON.stringify(data)};\n`,
        map: { mappings: "" },
      };
    },
  };
}
