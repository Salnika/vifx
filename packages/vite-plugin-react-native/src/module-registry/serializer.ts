import path from "node:path";
import { VifxError } from "@vifx/errors";
import { assignModuleIds, orderModules, type OrderableModule } from "./ordering.ts";
import { MODULE_REGISTRY_PRELUDE } from "./runtime.ts";

/**
 * Serializer for the Metro-compatible module-registry bundle format.
 *
 * Input: the per-module CommonJS chunks of a `preserveModules` staging build.
 * Output: a single plain-script `index.bundle` shaped like a Metro bundle:
 *
 * ```
 * <runtime prelude defining __d / __r>
 * __d(function (global, require, importDefault, importAll, module, exports, dependencyMap) {
 *   <module body with require("<relative>") rewritten to require(<id>)>
 * }, <id>, <dependency ids>);
 * ...
 * __r(<entry id>);
 * ```
 *
 * The composed source map preserves each staged chunk's own mappings (which
 * already point back at the original sources) by re-emitting them with the
 * module's line offset inside the final bundle and the column shifts caused
 * by require-specifier rewrites. Sources, source contents, and names from all
 * chunk maps are merged into one flat map, because Vifx source-map tooling
 * (and Metro symbolication) expects a flat `mappings` string rather than an
 * index map.
 */

/** Raw source map payload attached to a staged chunk. */
export interface StagedChunkSourceMap {
  file?: string;
  mappings: string;
  names?: string[];
  sources: (string | null)[];
  sourcesContent?: (string | null)[];
  version: number;
}

/** One staged CommonJS module, as emitted by the staging build. */
export interface StagedChunk {
  code: string;
  fileName: string;
  isEntry: boolean;
  map?: StagedChunkSourceMap | null;
}

export interface SerializeModuleRegistryOptions {
  /**
   * Absolute directory that will contain the final bundle and its map; used
   * to re-relativize the merged source paths.
   */
  absoluteOutDir: string;
  /** Staged per-module chunks. Exactly one must have `isEntry: true`. */
  chunks: StagedChunk[];
  /** File name of the final bundle (used in the map and trailing comment). */
  outputFileName: string;
  /**
   * Absolute directory the staged chunk files were written to; chunk map
   * `sources` entries are resolved relative to each chunk's location in it.
   */
  stagingDir: string;
}

export interface SerializedModuleRegistryBundle {
  /** Final bundle code (plain script, no ESM syntax). */
  code: string;
  /** Entry module id executed by the trailing `__r(...)`. */
  entryModuleId: number;
  /** Composed flat source map. */
  map: ComposedSourceMap;
  /** Module ids keyed by staged file name. */
  moduleIds: Map<string, number>;
}

export interface ComposedSourceMap {
  file: string;
  mappings: string;
  names: string[];
  sources: string[];
  sourcesContent: (string | null)[];
  version: 3;
}

interface RequireSite {
  /** Offset of the opening quote of the specifier inside the chunk code. */
  specifierStart: number;
  /** Offset just past the closing quote of the specifier. */
  specifierEnd: number;
  /** The raw specifier text between the quotes. */
  specifier: string;
  /** Emitted file name the specifier resolves to. */
  resolvedFileName: string;
}

const REQUIRE_CALL_PATTERN = /\brequire\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g;
const TRAILING_SOURCE_MAP_COMMENT_PATTERN = /\n?\/\/#\s*sourceMappingURL=[^\n]*\s*$/;

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

/**
 * Resolves a require specifier found in a staged chunk against the emitted
 * file set. Staged inter-module requires are always relative paths with
 * explicit extensions, so resolution is an exact path-map lookup.
 */
function resolveStagedRequire(
  fromFileName: string,
  specifier: string,
  knownFileNames: ReadonlySet<string>,
): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_REQUIRE_UNRESOLVED",
      message: `Staged module "${fromFileName}" requires the bare specifier "${specifier}", which cannot be bundled into a module-registry bundle.`,
      hint: "All dependencies must be bundled; check for Vite externals or unresolved imports in the build output.",
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(fromFileName)), specifier),
  );
  if (!knownFileNames.has(resolved)) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_REQUIRE_UNRESOLVED",
      message: `Staged module "${fromFileName}" requires "${specifier}", but "${resolved}" is not part of the staged build output.`,
      hint: "This is an internal serializer error; re-run the build with logLevel info and report the output.",
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  return resolved;
}

function scanRequireSites(chunk: StagedChunk, knownFileNames: ReadonlySet<string>): RequireSite[] {
  const sites: RequireSite[] = [];
  for (const match of chunk.code.matchAll(REQUIRE_CALL_PATTERN)) {
    const specifier = match[2] ?? "";
    const quoteOffset = match[0].indexOf(match[1] ?? '"');
    const specifierStart = (match.index ?? 0) + quoteOffset;
    const specifierEnd = specifierStart + specifier.length + 2;
    sites.push({
      resolvedFileName: resolveStagedRequire(chunk.fileName, specifier, knownFileNames),
      specifier,
      specifierEnd,
      specifierStart,
    });
  }
  return sites;
}

/** Extracts the require graph used by {@link orderModules}. */
export function collectModuleGraph(chunks: StagedChunk[]): OrderableModule[] {
  const knownFileNames = new Set(chunks.map((chunk) => toPosix(chunk.fileName)));
  return chunks.map((chunk) => ({
    fileName: toPosix(chunk.fileName),
    requires: scanRequireSites(chunk, knownFileNames).map((site) => site.resolvedFileName),
  }));
}

interface RewrittenModule {
  code: string;
  dependencyIds: number[];
  /**
   * Column adjustments caused by specifier rewrites, keyed by zero-based line
   * index. Each entry shifts original columns at or past `fromColumn` by
   * `delta` (cumulative when a line has several rewrites).
   */
  columnShifts: Map<number, { delta: number; fromColumn: number }[]>;
}

function buildLineStartOffsets(code: string): number[] {
  const offsets = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function locate(lineStarts: number[], offset: number): { column: number; line: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { column: offset - (lineStarts[low] ?? 0), line: low };
}

/**
 * Rewrites `require("<relative>")` call sites to `require(<id>)` and records
 * the per-line column shifts so the source map composition can keep mappings
 * after a rewritten specifier exact.
 */
function rewriteRequires(chunk: StagedChunk, moduleIds: Map<string, number>): RewrittenModule {
  const knownFileNames = new Set(moduleIds.keys());
  const sites = scanRequireSites(chunk, knownFileNames);
  const lineStarts = buildLineStartOffsets(chunk.code);
  const columnShifts: RewrittenModule["columnShifts"] = new Map();
  const dependencyIds: number[] = [];

  let rewritten = "";
  let cursor = 0;
  for (const site of sites) {
    const moduleId = moduleIds.get(site.resolvedFileName);
    if (moduleId === undefined) {
      throw new VifxError({
        code: "VIFX_MODULE_REGISTRY_REQUIRE_UNRESOLVED",
        message: `No module id was assigned for "${site.resolvedFileName}" (required by "${chunk.fileName}").`,
        hint: "This is an internal serializer error; re-run the build with logLevel info and report the output.",
        docsPath: "/reference/packages#vifxvite-plugin-react-native",
      });
    }
    if (!dependencyIds.includes(moduleId)) {
      dependencyIds.push(moduleId);
    }

    const replacement = String(moduleId);
    rewritten += chunk.code.slice(cursor, site.specifierStart) + replacement;
    cursor = site.specifierEnd;

    const { column, line } = locate(lineStarts, site.specifierStart);
    const delta = replacement.length - (site.specifierEnd - site.specifierStart);
    const shifts = columnShifts.get(line) ?? [];
    shifts.push({ delta, fromColumn: column + (site.specifierEnd - site.specifierStart) });
    columnShifts.set(line, shifts);
  }
  rewritten += chunk.code.slice(cursor);
  rewritten = rewritten.replace(TRAILING_SOURCE_MAP_COMMENT_PATTERN, "");

  return { code: rewritten, columnShifts, dependencyIds };
}

const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_CHAR_TO_VALUE = new Map([...VLQ_CHARS].map((char, index) => [char, index]));

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = VLQ_CHAR_TO_VALUE.get(char);
    if (digit === undefined) {
      throw new VifxError({
        code: "VIFX_MODULE_REGISTRY_SOURCEMAP_INVALID",
        message: `Invalid VLQ character "${char}" in a staged chunk source map.`,
        docsPath: "/reference/packages#vifxvite-plugin-react-native",
      });
    }
    value += (digit & 31) << shift;
    if ((digit & 32) === 0) {
      values.push((value & 1) === 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    } else {
      shift += 5;
    }
  }
  return values;
}

function encodeVlqValue(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += VLQ_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

/**
 * One absolute (non-delta) mapping segment:
 * `[generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex?]`.
 */
type MappingSegment = [number, number, number, number] | [number, number, number, number, number];

/** Decodes a `mappings` string into absolute segments per generated line. */
function decodeMappings(mappings: string): MappingSegment[][] {
  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  for (const lineText of mappings.split(";")) {
    const segments: MappingSegment[] = [];
    let generatedColumn = 0;
    if (lineText.length > 0) {
      for (const segmentText of lineText.split(",")) {
        if (segmentText.length === 0) {
          continue;
        }
        const values = decodeVlqSegment(segmentText);
        generatedColumn += values[0] ?? 0;
        if (values.length >= 4) {
          sourceIndex += values[1] ?? 0;
          sourceLine += values[2] ?? 0;
          sourceColumn += values[3] ?? 0;
          if (values.length >= 5) {
            nameIndex += values[4] ?? 0;
            segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]);
          } else {
            segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn]);
          }
        }
      }
    }
    lines.push(segments);
  }
  return lines;
}

/** Encodes absolute segments per generated line back into a `mappings` string. */
function encodeMappings(lines: MappingSegment[][]): string {
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  return lines
    .map((segments) => {
      let generatedColumn = 0;
      return segments
        .map((segment) => {
          let encoded = encodeVlqValue(segment[0] - generatedColumn);
          generatedColumn = segment[0];
          encoded += encodeVlqValue(segment[1] - sourceIndex);
          sourceIndex = segment[1];
          encoded += encodeVlqValue(segment[2] - sourceLine);
          sourceLine = segment[2];
          encoded += encodeVlqValue(segment[3] - sourceColumn);
          sourceColumn = segment[3];
          if (segment.length === 5) {
            encoded += encodeVlqValue(segment[4] - nameIndex);
            nameIndex = segment[4];
          }
          return encoded;
        })
        .join(",");
    })
    .join(";");
}

function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

interface MergedMapBuilder {
  lines: MappingSegment[][];
  names: string[];
  nameIndices: Map<string, number>;
  sources: string[];
  sourceIndices: Map<string, number>;
  sourcesContent: (string | null)[];
}

function internSource(
  builder: MergedMapBuilder,
  source: string,
  content: string | null,
): number {
  const existing = builder.sourceIndices.get(source);
  if (existing !== undefined) {
    if (builder.sourcesContent[existing] == null && content != null) {
      builder.sourcesContent[existing] = content;
    }
    return existing;
  }
  const index = builder.sources.length;
  builder.sources.push(source);
  builder.sourcesContent.push(content);
  builder.sourceIndices.set(source, index);
  return index;
}

function internName(builder: MergedMapBuilder, name: string): number {
  const existing = builder.nameIndices.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const index = builder.names.length;
  builder.names.push(name);
  builder.nameIndices.set(name, index);
  return index;
}

function appendChunkMappings(options: {
  builder: MergedMapBuilder;
  bundleLineOffset: number;
  chunk: StagedChunk;
  columnShifts: RewrittenModule["columnShifts"];
  finalMapDir: string;
  stagingDir: string;
}): void {
  const { builder, bundleLineOffset, chunk, columnShifts, finalMapDir, stagingDir } = options;
  const map = chunk.map;
  if (!map || map.mappings.length === 0) {
    return;
  }

  const chunkDir = path.dirname(path.join(stagingDir, chunk.fileName));
  const sourceIndexRemap = map.sources.map((source, index) => {
    if (source == null) {
      return -1;
    }
    const absoluteSource = path.resolve(chunkDir, source);
    const relativeSource = toPosix(path.relative(finalMapDir, absoluteSource));
    return internSource(builder, relativeSource, map.sourcesContent?.[index] ?? null);
  });
  const nameRemap = (map.names ?? []).map((name) => internName(builder, name));

  const decoded = decodeMappings(map.mappings);
  for (const [lineIndex, segments] of decoded.entries()) {
    const bundleLine = bundleLineOffset + lineIndex;
    while (builder.lines.length <= bundleLine) {
      builder.lines.push([]);
    }
    const shifts = columnShifts.get(lineIndex) ?? [];
    for (const segment of segments) {
      const remappedSource = sourceIndexRemap[segment[1]] ?? -1;
      if (remappedSource < 0) {
        continue;
      }
      let column = segment[0];
      for (const shift of shifts) {
        if (column >= shift.fromColumn) {
          column += shift.delta;
        }
      }
      const target = builder.lines[bundleLine];
      if (!target) {
        continue;
      }
      if (segment.length === 5) {
        const remappedName = nameRemap[segment[4]];
        if (remappedName === undefined) {
          target.push([column, remappedSource, segment[2], segment[3]]);
        } else {
          target.push([column, remappedSource, segment[2], segment[3], remappedName]);
        }
      } else {
        target.push([column, remappedSource, segment[2], segment[3]]);
      }
    }
  }
}

const MODULE_FACTORY_HEADER =
  "__d(function (global, require, importDefault, importAll, module, exports, dependencyMap) {";

/**
 * Assembles the final module-registry bundle from staged CommonJS chunks:
 * runtime prelude first, `__d`-wrapped modules in dependency order with
 * stable numeric ids, and a trailing `__r(<entryId>)`, plus a composed flat
 * source map preserving per-module mappings.
 */
export function serializeModuleRegistryBundle(
  options: SerializeModuleRegistryOptions,
): SerializedModuleRegistryBundle {
  const chunks = options.chunks.map((chunk) => ({ ...chunk, fileName: toPosix(chunk.fileName) }));
  const entryChunks = chunks.filter((chunk) => chunk.isEntry);
  if (entryChunks.length !== 1) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_ENTRY_MISSING",
      message: `Expected exactly one entry chunk in the staged build output, found ${entryChunks.length}.`,
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }
  const entryChunk = entryChunks[0];
  if (!entryChunk) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_ENTRY_MISSING",
      message: "Expected exactly one entry chunk in the staged build output.",
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  const graph = collectModuleGraph(chunks);
  const orderedFileNames = orderModules(graph, entryChunk.fileName);
  const moduleIds = assignModuleIds(chunks.map((chunk) => chunk.fileName));
  const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entryModuleId = moduleIds.get(entryChunk.fileName);
  if (entryModuleId === undefined) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_ENTRY_MISSING",
      message: `No module id was assigned for the entry chunk "${entryChunk.fileName}".`,
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  const builder: MergedMapBuilder = {
    lines: [],
    nameIndices: new Map(),
    names: [],
    sourceIndices: new Map(),
    sources: [],
    sourcesContent: [],
  };

  const parts: string[] = [MODULE_REGISTRY_PRELUDE];
  // Line index (zero-based) at which the next appended part begins. The
  // prelude ends with a newline, so the count of newline characters is the
  // index of the line right after it.
  let bundleLineOffset = countLines(MODULE_REGISTRY_PRELUDE) - 1;

  for (const fileName of orderedFileNames) {
    const chunk = chunksByFileName.get(fileName);
    if (!chunk) {
      continue;
    }
    const moduleId = moduleIds.get(fileName);
    if (moduleId === undefined) {
      continue;
    }

    const rewrittenModule = rewriteRequires(chunk, moduleIds);
    const header = `${MODULE_FACTORY_HEADER}\n`;
    const footer = `\n}, ${moduleId}, ${JSON.stringify(rewrittenModule.dependencyIds)}); // ${fileName}\n`;

    appendChunkMappings({
      builder,
      bundleLineOffset: bundleLineOffset + 1,
      chunk,
      columnShifts: rewrittenModule.columnShifts,
      finalMapDir: options.absoluteOutDir,
      stagingDir: options.stagingDir,
    });

    const moduleText = header + rewrittenModule.code + footer;
    parts.push(moduleText);
    bundleLineOffset += countLines(moduleText) - 1;
  }

  parts.push(`__r(${entryModuleId});\n`);
  parts.push(`//# sourceMappingURL=${options.outputFileName}.map\n`);

  const code = parts.join("");
  const totalLines = countLines(code);
  while (builder.lines.length < totalLines) {
    builder.lines.push([]);
  }

  return {
    code,
    entryModuleId,
    map: {
      file: options.outputFileName,
      mappings: encodeMappings(builder.lines),
      names: builder.names,
      sources: builder.sources,
      sourcesContent: builder.sourcesContent,
      version: 3,
    },
    moduleIds,
  };
}
