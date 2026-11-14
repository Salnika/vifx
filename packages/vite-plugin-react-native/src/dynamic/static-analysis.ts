import path from "node:path";
import { parseSync } from "@voidzero-dev/vite-plus-core";

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface SourcePosition {
  column: number;
  line: number;
}

export interface CodeReplacement {
  end: number;
  start: number;
  text: string;
}

type ParserLang = "js" | "jsx" | "ts" | "tsx";

interface ParsedModule {
  errors: unknown[];
  program: AstNode;
}

function inferParserLang(filePath: string): ParserLang {
  const fileName = path.basename(filePath).toLowerCase();

  if (fileName.endsWith(".tsx")) {
    return "tsx";
  }

  if (fileName.endsWith(".ts") || fileName.endsWith(".mts") || fileName.endsWith(".cts")) {
    return "ts";
  }

  // React Native projects routinely keep JSX in plain ".js" files, and the JSX
  // grammar is a superset of plain JavaScript, so ".js"/".jsx" both parse as JSX.
  return "jsx";
}

export function parseModuleProgram(filePath: string, code: string): AstNode | null {
  let parsed: ParsedModule;
  try {
    parsed = parseSync(path.basename(filePath), code, {
      lang: inferParserLang(filePath),
      sourceType: "unambiguous",
    }) as unknown as ParsedModule;
  } catch {
    return null;
  }

  if (parsed.errors.length > 0) {
    return null;
  }

  return parsed.program;
}

export function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function walkAst(node: AstNode, visit: (node: AstNode) => void) {
  visit(node);

  for (const key of Object.keys(node)) {
    const value = node[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          walkAst(item, visit);
        }
      }
      continue;
    }

    if (isAstNode(value)) {
      walkAst(value, visit);
    }
  }
}

export function locateOffset(code: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  const boundedOffset = Math.min(Math.max(offset, 0), code.length);

  for (let index = 0; index < boundedOffset; index += 1) {
    if (code.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { column: boundedOffset - lineStart + 1, line };
}

export function readStaticStringValue(node: AstNode): string | null {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "TemplateLiteral") {
    const expressions = node.expressions;
    const quasis = node.quasis;
    if (Array.isArray(expressions) && expressions.length === 0 && Array.isArray(quasis)) {
      const [quasi] = quasis;
      if (isAstNode(quasi)) {
        const value = (quasi.value as { cooked?: unknown } | undefined)?.cooked;
        if (typeof value === "string") {
          return value;
        }
      }
    }
  }

  return null;
}

export function isInsideCollectedRange(node: AstNode, replacements: CodeReplacement[]) {
  return replacements.some(
    (replacement) => node.start >= replacement.start && node.end <= replacement.end,
  );
}

export function applyCodeReplacements(code: string, replacements: CodeReplacement[]) {
  const sorted = [...replacements].sort((left, right) => left.start - right.start);
  let output = "";
  let cursor = 0;

  for (const replacement of sorted) {
    output += code.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }

  return output + code.slice(cursor);
}

export function prependModuleCode(code: string, prelude: string) {
  if (prelude === "") {
    return code;
  }

  if (code.startsWith("#!")) {
    const firstLineBreak = code.indexOf("\n");
    if (firstLineBreak === -1) {
      return `${code}\n${prelude}`;
    }

    return `${code.slice(0, firstLineBreak + 1)}${prelude}${code.slice(firstLineBreak + 1)}`;
  }

  return prelude + code;
}
