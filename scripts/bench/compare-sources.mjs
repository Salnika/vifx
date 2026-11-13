#!/usr/bin/env node
// Compares the module sets of two bundles through their source maps:
//
//   node scripts/bench/compare-sources.mjs <metro.map> <vifx.map> [--top 25]
//
// Prints, per package, how many modules (and how many source bytes) each
// bundler kept, so a size gap can be traced to the packages that cause it.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { top: { default: "25", type: "string" } },
});
const [leftPath, rightPath] = positionals;
if (!leftPath || !rightPath) {
  console.error("Usage: compare-sources.mjs <metro.map> <vifx.map> [--top N]");
  process.exit(2);
}

/** `node_modules/.pnpm/x@1/node_modules/@scope/pkg/lib/a.js` -> `@scope/pkg`; app code -> `(app)`. */
function packageOf(source) {
  const normalized = source.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/node_modules/");
  if (index === -1) {
    return normalized.startsWith("node_modules/") ? packageName(normalized.slice(13)) : "(app)";
  }
  return packageName(normalized.slice(index + 14));
}

function packageName(rest) {
  const [first, second] = rest.split("/");
  return first?.startsWith("@") ? `${first}/${second}` : (first ?? "(unknown)");
}

/** Module identity that survives different path prefixes: package + path inside it. */
function moduleKey(source) {
  const normalized = source.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/node_modules/");
  if (index !== -1) {
    return normalized.slice(index + 14);
  }
  return normalized.replace(/^(\.\.\/)+/u, "").replace(/^\.\//u, "");
}

async function readModules(mapPath) {
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  const maps = map.sections ? map.sections.map((section) => section.map) : [map];
  const modules = new Map();
  const virtualKinds = new Map();
  for (const part of maps) {
    (part?.sources ?? []).forEach((rawSource, index) => {
      // vifx names modules it re-transforms `\0vifx:transformed:<real path>`;
      // they are real modules. Other virtual ids (shims, preludes) are not.
      const source = rawSource.replace(/^.*\0?vifx:transformed:/u, "");
      if (source.includes("\0") || source.includes("__prelude__") || source.includes("vifx:")) {
        const kind =
          source.match(/vifx:[a-z-]+/u)?.[0] ?? source.replace(/^.*\//u, "").slice(0, 40);
        virtualKinds.set(kind, (virtualKinds.get(kind) ?? 0) + 1);
        return;
      }
      const key = moduleKey(source);
      const paths = modules.get(key)?.paths ?? new Set();
      paths.add(source);
      modules.set(key, {
        bytes: part.sourcesContent?.[index]?.length ?? 0,
        package: packageOf(source),
        paths,
      });
    });
  }
  // The same file listed under two paths (a `node_modules/<name>` symlink and
  // its real location) means the bundler treated it as two modules.
  const duplicated = [...modules.values()].filter((module) => module.paths.size > 1);
  if (duplicated.length > 0) {
    const byPackage = new Map();
    for (const module of duplicated) {
      byPackage.set(module.package, (byPackage.get(module.package) ?? 0) + 1);
    }
    const top = [...byPackage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(
      `${mapPath.split("/").at(-2)}: ${duplicated.length} modules listed under 2+ paths — ${top
        .map(([name, total]) => `${name} x${total}`)
        .join(", ")}`,
    );
  }
  if (virtualKinds.size > 0) {
    const summary = [...virtualKinds.entries()].map(([kind, total]) => `${kind} x${total}`);
    console.log(`virtual sources skipped in ${mapPath.split("/").at(-2)}: ${summary.join(", ")}`);
  }
  return modules;
}

const [left, right] = await Promise.all([readModules(leftPath), readModules(rightPath)]);
const packages = new Map();
const bump = (name, field, bytes) => {
  const entry = packages.get(name) ?? { leftBytes: 0, leftCount: 0, rightBytes: 0, rightCount: 0 };
  entry[`${field}Count`] += 1;
  entry[`${field}Bytes`] += bytes;
  packages.set(name, entry);
};
for (const module of left.values()) {
  bump(module.package, "left", module.bytes);
}
for (const module of right.values()) {
  bump(module.package, "right", module.bytes);
}

const onlyLeft = [...left.keys()].filter((key) => !right.has(key));
const onlyRight = [...right.keys()].filter((key) => !left.has(key));
const kb = (bytes) => `${(bytes / 1000).toFixed(0)} kB`;

console.log(`metro: ${left.size} modules | vifx: ${right.size} modules`);
console.log(`only in metro: ${onlyLeft.length} | only in vifx: ${onlyRight.length}`);
console.log("");
console.log("| Package | Metro modules | vifx modules | Metro source | vifx source |");
console.log("| --- | --- | --- | --- | --- |");
const rows = [...packages.entries()]
  .map(([name, entry]) => ({ name, ...entry, gap: entry.rightBytes - entry.leftBytes }))
  .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
  .slice(0, Number.parseInt(values.top, 10) || 25);
for (const row of rows) {
  console.log(
    `| ${row.name} | ${row.leftCount} | ${row.rightCount} | ${kb(row.leftBytes)} | ${kb(row.rightBytes)} |`,
  );
}
