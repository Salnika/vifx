import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "@voidzero-dev/vite-plus-core";

interface SourceMapJson {
  sourceRoot?: string;
  sources: (string | null)[];
  sourcesContent?: (string | null)[];
}

/**
 * Lists every bundled JSON module in the bundle's source map, with its content.
 *
 * Vite's JSON plugin gives a JSON module an empty source map, so Rolldown
 * leaves the file out of `sources`: the data is in the bundle but not in its
 * map. Metro's map lists it, and tools that read the map (symbolication,
 * bundle-size explorers) expect it there. No mappings are added.
 *
 * The map is parsed and written again, so the pipeline adds this to release
 * builds only, and it does nothing for a chunk without JSON modules.
 */
export function createJsonSourcesPlugin(): Plugin {
  return {
    name: "vifx:json-sources",
    apply: "build",
    async generateBundle(outputOptions, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }
        const jsonModuleIds = output.moduleIds.filter((moduleId) => moduleId.endsWith(".json"));
        if (jsonModuleIds.length === 0) {
          continue;
        }
        // Rolldown emits the chunk's map as an asset of its own; that asset is
        // what is written, not `output.map`.
        const mapAsset = bundle[output.sourcemapFileName ?? `${output.fileName}.map`];
        if (mapAsset?.type !== "asset" || typeof mapAsset.source !== "string") {
          continue;
        }

        const map = JSON.parse(mapAsset.source) as SourceMapJson;
        const mapDir = path.dirname(path.resolve(outputOptions.dir ?? "", mapAsset.fileName));
        const sourcesDir = map.sourceRoot ? path.resolve(mapDir, map.sourceRoot) : mapDir;
        const listed = new Set(
          map.sources.flatMap((source) =>
            source === null ? [] : [path.resolve(sourcesDir, source)],
          ),
        );
        let added = 0;
        for (const moduleId of jsonModuleIds) {
          if (listed.has(moduleId)) {
            continue;
          }
          const content = await readFile(moduleId, "utf8").catch(() => null);
          if (content === null) {
            continue;
          }
          listed.add(moduleId);
          map.sources.push(path.relative(sourcesDir, moduleId).split(path.sep).join("/"));
          map.sourcesContent?.push(content);
          added += 1;
        }
        if (added > 0) {
          mapAsset.source = JSON.stringify(map);
        }
      }
    },
  };
}
