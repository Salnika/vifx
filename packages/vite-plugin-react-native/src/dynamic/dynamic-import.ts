import { VifxError } from "@vifx/errors";
import type { VifxPlatform } from "@vifx/types";
import {
  applyCodeReplacements,
  isInsideCollectedRange,
  locateOffset,
  parseModuleProgram,
  readStaticStringValue,
  walkAst,
  type AstNode,
  type CodeReplacement,
} from "./static-analysis.ts";

const DYNAMIC_IMPORT_QUICK_PATTERN = /\bimport\s*\(/u;
const DYNAMIC_IMPORT_DOCS_PATH = "/reference/packages#vifxvite-plugin-react-native";

function createDynamicImportError(options: {
  filePath: string;
  reason: string;
  source: string;
  start: number;
}) {
  const { column, line } = locateOffset(options.source, options.start);

  return new VifxError({
    code: "VIFX_DYNAMIC_IMPORT_NOT_STATIC",
    message: `Vifx cannot bundle the import(...) expression in "${options.filePath}" (line ${line}, column ${column}): ${options.reason}`,
    hint: "Native Vifx bundles are emitted as a single file, so dynamic import specifiers must be string literals that can be resolved at build time.",
    docsPath: DYNAMIC_IMPORT_DOCS_PATH,
    details: {
      column,
      file: options.filePath,
      line,
    },
  });
}

export function transformDynamicImport(options: {
  code: string;
  filePath: string;
  resolvePlatform: VifxPlatform;
}): { code: string } | null {
  if (options.resolvePlatform === "web") {
    return null;
  }

  if (!DYNAMIC_IMPORT_QUICK_PATTERN.test(options.code)) {
    return null;
  }

  const program = parseModuleProgram(options.filePath, options.code);
  if (!program) {
    return null;
  }

  const replacements: CodeReplacement[] = [];

  walkAst(program, (node) => {
    if (node.type !== "ImportExpression" || isInsideCollectedRange(node, replacements)) {
      return;
    }

    if (node.phase != null) {
      throw createDynamicImportError({
        filePath: options.filePath,
        reason: "phased dynamic imports cannot be inlined into a single native bundle.",
        source: options.code,
        start: node.start,
      });
    }

    const source = node.source as AstNode;
    const specifier = readStaticStringValue(source);
    if (specifier === null) {
      throw createDynamicImportError({
        filePath: options.filePath,
        reason: "the import specifier is not a string literal.",
        source: options.code,
        start: source.start,
      });
    }

    // Rolldown inlines the synchronous require below instead of code-splitting,
    // and the block-bodied closure keeps its CommonJS namespace interop intact.
    replacements.push({
      end: node.end,
      start: node.start,
      text: `Promise.resolve().then(() => { const requiredModule = require(${JSON.stringify(specifier)}); return requiredModule; })`,
    });
  });

  if (replacements.length === 0) {
    return null;
  }

  return { code: applyCodeReplacements(options.code, replacements) };
}
