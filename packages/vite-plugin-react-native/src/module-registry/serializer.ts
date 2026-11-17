import path from "node:path";
import { VifxError } from "@vifx/errors";
import { assignModuleIds, orderModules, type OrderableModule } from "./ordering.ts";
import { buildModuleRegistryPrelude, MODULE_REGISTRY_PRELUDE } from "./runtime.ts";

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
  /**
   * The file a module came from when its own map maps nothing to it: the
   * staging build emits JSON modules without a source map. The composed map
   * lists that file with its content, as Metro's does, and maps each of the
   * module's lines to the start of it.
   */
  originalSource?: { content: string | null; path: string } | null;
}

export interface SerializeModuleRegistryOptions {
  /**
   * Absolute directory that will contain the final bundle and its map; used
   * to re-relativize the merged source paths.
   */
  absoluteOutDir: string;
  /** Staged per-module chunks. Exactly one must have `isEntry: true`. */
  chunks: StagedChunk[];
  /**
   * Module id map from a previous build of this bundle. When provided, known
   * file names keep their id so Fast Refresh deltas target the right module
   * across rebuilds (see {@link assignModuleIds}).
   */
  existingModuleIds?: ReadonlyMap<string, number>;
  /** Emit the Fast Refresh runtime prelude (development bundles only). */
  hmr?: boolean;
  /** File name of the final bundle (used in the map and trailing comment). */
  outputFileName: string;
  /**
   * Absolute directory the staged chunk files were written to; chunk map
   * `sources` entries are resolved relative to each chunk's location in it.
   */
  stagingDir: string;
  /**
   * Previous full serialization, for partial re-serialization. Reserved for the
   * incremental Fast Refresh PoC and NOT read today: `serializeModuleRegistryBundle`
   * still runs over the complete graph. Note `bundleLineOffset` is cumulative
   * (see below), so a module that changes line height shifts every downstream
   * offset — byte-exact partial re-serialization is the (uncertain) object of
   * that PoC, not a property of the current serializer.
   */
  previousSerialization?: {
    moduleIds: ReadonlyMap<string, number>;
    modules: readonly SerializedModule[];
  };
}

/**
 * One serialized module, exposed so a dev server can diff builds and emit Fast
 * Refresh deltas without re-parsing the concatenated bundle.
 */
export interface SerializedModule {
  /** Dependency module ids, in first-seen order (the `__d` dependency map). */
  dependencyIds: number[];
  /**
   * The `__d(function (...) { <body> }` text — everything up to and including
   * the factory's closing brace, but without the trailing `, <id>, <deps>);`.
   * An HMR delta re-emits this as
   * `<factory>, <id>, <deps>, undefined, <inverseDeps>);`.
   */
  factory: string;
  /** Staged (posix) file name this module was emitted from. */
  fileName: string;
  /** Stable numeric module id. */
  id: number;
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
  /** Per-module factory blocks in bundle (dependency) order. */
  modules: SerializedModule[];
  /**
   * Bare specifiers that could not be bundled and were replaced with throwing
   * stub modules (sorted, unique). Empty when everything resolved.
   */
  unresolvedModules: string[];
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

const UNRESOLVED_STUB_DIR = "__vifx-unresolved__";

/** Synthetic staged file name for the throwing stub of an unresolved specifier. */
function stubFileNameFor(specifier: string): string {
  return `${UNRESOLVED_STUB_DIR}/${encodeURIComponent(specifier)}.js`;
}

/**
 * Bare specifiers the staging build left as literal `require("<pkg>")` calls
 * (typically uninstalled optional peer deps, e.g. a library that does
 * `try { require('optional-pkg') } catch {}`). Each gets a stub chunk that
 * throws when required, so the build succeeds instead of failing on a specifier
 * the registry cannot bundle, matching Metro's runtime behavior.
 */
function collectUnresolvedSpecifiers(chunks: StagedChunk[]): string[] {
  const specifiers = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.code.matchAll(REQUIRE_CALL_PATTERN)) {
      const specifier = match[2] ?? "";
      if (specifier.length > 0 && !specifier.startsWith("./") && !specifier.startsWith("../")) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers].sort();
}

function createUnresolvedStubChunk(specifier: string): StagedChunk {
  return {
    code: `throw new Error(${JSON.stringify(
      `Unable to resolve module '${specifier}': it is not installed. Vifx emitted a throwing stub so an optional require can catch it at runtime.`,
    )});\n`,
    fileName: stubFileNameFor(specifier),
    isEntry: false,
    map: null,
  };
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
    // Bare specifier: an unresolved (typically optional, uninstalled) module the
    // staging build left as a literal require. It maps to a throwing stub chunk
    // (added in serializeModuleRegistryBundle), so the build succeeds and an
    // optional `try { require(x) } catch {}` catches it at runtime, like Metro.
    const stubFileName = stubFileNameFor(specifier);
    if (knownFileNames.has(stubFileName)) {
      return stubFileName;
    }
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
const VLQ_CHAR_TO_VALUE = new Map(VLQ_CHARS.split("").map((char, index) => [char, index]));

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

function internSource(builder: MergedMapBuilder, source: string, content: string | null): number {
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

/** Appends a staged chunk's own mappings; returns how many segments it added. */
function appendChunkMappings(options: {
  builder: MergedMapBuilder;
  bundleLineOffset: number;
  chunk: StagedChunk;
  columnShifts: RewrittenModule["columnShifts"];
  finalMapDir: string;
  stagingDir: string;
}): number {
  const { builder, bundleLineOffset, chunk, columnShifts, finalMapDir, stagingDir } = options;
  const map = chunk.map;
  if (!map || map.mappings.length === 0) {
    return 0;
  }
  let appended = 0;

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
      appended += 1;
    }
  }
  return appended;
}

/**
 * Maps the start of each line of a module to the start of the file it came
 * from, for a module whose own map maps nothing (see
 * {@link StagedChunk.originalSource}).
 */
function appendOriginalSourceMappings(options: {
  builder: MergedMapBuilder;
  bundleLineOffset: number;
  finalMapDir: string;
  lineCount: number;
  source: { content: string | null; path: string };
}): void {
  const { builder, bundleLineOffset, finalMapDir, lineCount, source } = options;
  const sourceIndex = internSource(
    builder,
    toPosix(path.relative(finalMapDir, source.path)),
    source.content,
  );
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const bundleLine = bundleLineOffset + lineIndex;
    while (builder.lines.length <= bundleLine) {
      builder.lines.push([]);
    }
    builder.lines[bundleLine]?.push([0, sourceIndex, 0, 0]);
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
  const baseChunks = options.chunks.map((chunk) => ({
    ...chunk,
    fileName: toPosix(chunk.fileName),
  }));
  // Bare specifiers the staging build could not bundle become throwing stub
  // chunks, so they flow through ordering/id-assignment/rewriting like any other
  // module and the build succeeds (the require throws at runtime).
  const unresolvedModules = collectUnresolvedSpecifiers(baseChunks);
  const chunks = [...baseChunks, ...unresolvedModules.map(createUnresolvedStubChunk)];
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
  const moduleIds = assignModuleIds(
    chunks.map((chunk) => chunk.fileName),
    options.existingModuleIds,
  );
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

  const prelude = options.hmr ? buildModuleRegistryPrelude({ hmr: true }) : MODULE_REGISTRY_PRELUDE;
  const parts: string[] = [prelude];
  const serializedModules: SerializedModule[] = [];
  // Line index (zero-based) at which the next appended part begins. The
  // prelude ends with a newline, so the count of newline characters is the
  // index of the line right after it.
  let bundleLineOffset = countLines(prelude) - 1;

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
    // The `__d(function (...) { <body> }` text, minus the `, <id>, <deps>);`
    // tail. Keeping it separate lets HMR re-emit the same factory with an
    // inverse-dependency argument without re-parsing the bundle. Composing
    // `factory + tail` reproduces the previous `header + code + footer` bytes
    // exactly, so the bundle and its source map are unchanged.
    const factory = `${MODULE_FACTORY_HEADER}\n${rewrittenModule.code}\n}`;

    const appended = appendChunkMappings({
      builder,
      bundleLineOffset: bundleLineOffset + 1,
      chunk,
      columnShifts: rewrittenModule.columnShifts,
      finalMapDir: options.absoluteOutDir,
      stagingDir: options.stagingDir,
    });
    if (appended === 0 && chunk.originalSource) {
      appendOriginalSourceMappings({
        builder,
        bundleLineOffset: bundleLineOffset + 1,
        finalMapDir: options.absoluteOutDir,
        lineCount: countLines(rewrittenModule.code),
        source: chunk.originalSource,
      });
    }

    const moduleText = `${factory}, ${moduleId}, ${JSON.stringify(
      rewrittenModule.dependencyIds,
    )}); // ${fileName}\n`;
    parts.push(moduleText);
    serializedModules.push({
      dependencyIds: rewrittenModule.dependencyIds,
      factory,
      fileName,
      id: moduleId,
    });
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
    modules: serializedModules,
    unresolvedModules,
  };
}
