import { readFile } from "node:fs/promises";
import path from "node:path";
import { SourceMap } from "node:module";

export interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  names?: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
}

export interface ValidateSourceMapOptions {
  sourceMapPath: string;
}

export interface SourceMapValidationResult {
  file: string | null;
  hasMappings: boolean;
  sourceCount: number;
  sourceMapPath: string;
  sources: string[];
  valid: boolean;
  warnings: string[];
}

export interface CompareSourceMapsOptions {
  leftSourceMapPath: string;
  rightSourceMapPath: string;
}

export interface SourceMapComparisonResult {
  commonSources: string[];
  leftOnlySources: string[];
  mappingMatches: boolean;
  rightOnlySources: string[];
}

export interface SymbolicateStackFrameOptions {
  column: number;
  line: number;
  sourceMapPath: string;
}

export interface SymbolicatedStackFrame {
  column: number | null;
  found: boolean;
  line: number | null;
  name: string | null;
  source: string | null;
}

type SourceMapPayload = ConstructorParameters<typeof SourceMap>[0];
type SourceMapEntry = ReturnType<SourceMap["findEntry"]>;

function normalizeToPosix(value: string) {
  return value.replaceAll("\\", "/");
}

function normalizeSource(source: string, sourceRoot?: string) {
  const joined =
    sourceRoot && !path.isAbsolute(source) && !source.startsWith("file://")
      ? path.posix.join(normalizeToPosix(sourceRoot), normalizeToPosix(source))
      : normalizeToPosix(source);

  return joined.replace(/\/\.\//g, "/").replace(/^\.\//, "");
}

export function normalizeSourceMap(sourceMap: RawSourceMap): RawSourceMap {
  return {
    ...sourceMap,
    sourceRoot: sourceMap.sourceRoot
      ? normalizeToPosix(sourceMap.sourceRoot)
      : sourceMap.sourceRoot,
    sources: sourceMap.sources.map((source) => normalizeSource(source, sourceMap.sourceRoot)),
  };
}

export async function loadSourceMap(sourceMapPath: string): Promise<RawSourceMap> {
  const contents = await readFile(sourceMapPath, "utf8");
  return normalizeSourceMap(JSON.parse(contents) as RawSourceMap);
}

export async function validateSourceMap(
  options: ValidateSourceMapOptions,
): Promise<SourceMapValidationResult> {
  const sourceMap = await loadSourceMap(options.sourceMapPath);
  const warnings: string[] = [];

  if (sourceMap.version !== 3) {
    warnings.push(`Unsupported source map version "${sourceMap.version}".`);
  }

  if (sourceMap.sources.length === 0) {
    warnings.push("Source map does not include any sources.");
  }

  if (!sourceMap.mappings) {
    warnings.push("Source map does not include any mappings.");
  }

  if (!sourceMap.sourcesContent || sourceMap.sourcesContent.length === 0) {
    warnings.push("Source map does not include inline sourcesContent.");
  }

  let valid = warnings.length === 0;

  try {
    const sourceMapInstance = new SourceMap(sourceMap as SourceMapPayload);
    sourceMapInstance.findEntry(0, 0);
  } catch (error) {
    valid = false;
    warnings.push(
      error instanceof Error ? error.message : "Source map could not be loaded by Node SourceMap.",
    );
  }

  return {
    file: sourceMap.file ?? null,
    hasMappings: sourceMap.mappings.length > 0,
    sourceCount: sourceMap.sources.length,
    sourceMapPath: options.sourceMapPath,
    sources: sourceMap.sources,
    valid,
    warnings,
  };
}

export async function compareSourceMaps(
  options: CompareSourceMapsOptions,
): Promise<SourceMapComparisonResult> {
  const [left, right] = await Promise.all([
    loadSourceMap(options.leftSourceMapPath),
    loadSourceMap(options.rightSourceMapPath),
  ]);
  const leftSources = new Set(left.sources);
  const rightSources = new Set(right.sources);

  return {
    commonSources: [...leftSources].filter((source) => rightSources.has(source)).sort(),
    leftOnlySources: [...leftSources].filter((source) => !rightSources.has(source)).sort(),
    mappingMatches: left.mappings === right.mappings,
    rightOnlySources: [...rightSources].filter((source) => !leftSources.has(source)).sort(),
  };
}

export async function symbolicateStackFrame(
  options: SymbolicateStackFrameOptions,
): Promise<SymbolicatedStackFrame> {
  const sourceMap = await loadSourceMap(options.sourceMapPath);
  const sourceMapInstance = new SourceMap(sourceMap as SourceMapPayload);
  const entry = sourceMapInstance.findEntry(
    Math.max(options.line - 1, 0),
    Math.max(options.column - 1, 0),
  ) as SourceMapEntry;

  if (!("originalSource" in entry) || !entry.originalSource) {
    return {
      column: null,
      found: false,
      line: null,
      name: null,
      source: null,
    };
  }

  return {
    column: entry.originalColumn + 1,
    found: true,
    line: entry.originalLine + 1,
    name: null,
    source: normalizeSource(entry.originalSource, sourceMap.sourceRoot),
  };
}
