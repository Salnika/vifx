import { readdir } from "node:fs/promises";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import {
  applyCodeReplacements,
  isInsideCollectedRange,
  locateOffset,
  parseModuleProgram,
  prependModuleCode,
  readStaticStringValue,
  walkAst,
  type AstNode,
  type CodeReplacement,
} from "./static-analysis.ts";

export const REQUIRE_CONTEXT_PREFIX = "\0vifx:require-context:";

const REQUIRE_CONTEXT_QUICK_PATTERN = /require\s*\.\s*context/u;
const REQUIRE_CONTEXT_DOCS_PATH = "/reference/packages#vifxvite-plugin-react-native";
const SUPPORTED_CONTEXT_MODE = "sync";

interface RequireContextDescriptor {
  directory: string;
  displayId: string;
  filterFlags: string | null;
  filterSource: string | null;
  recursive: boolean;
}

interface RequireContextEntry {
  contextKey: string;
  resolvedFilePath: string;
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function isProjectSourceFile(filePath: string, projectRoot: string) {
  const normalizedPath = toPosixPath(filePath);
  if (normalizedPath.includes("/node_modules/")) {
    return false;
  }

  const relativePath = path.relative(projectRoot, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isRequireContextCall(node: AstNode) {
  if (node.type !== "CallExpression") {
    return false;
  }

  const callee = node.callee;
  if (
    typeof callee !== "object" ||
    callee === null ||
    (callee as AstNode).type !== "MemberExpression" ||
    (callee as AstNode).computed === true
  ) {
    return false;
  }

  const calleeNode = callee as AstNode;
  const object = calleeNode.object as AstNode | null;
  const property = calleeNode.property as AstNode | null;

  return (
    object !== null &&
    property !== null &&
    object.type === "Identifier" &&
    object.name === "require" &&
    property.type === "Identifier" &&
    property.name === "context"
  );
}

function createContextError(options: {
  code: "VIFX_DYNAMIC_CONTEXT_MODE_UNSUPPORTED" | "VIFX_DYNAMIC_CONTEXT_NOT_STATIC";
  filePath: string;
  hint: string;
  reason: string;
  source: string;
  start: number;
}) {
  const { column, line } = locateOffset(options.source, options.start);

  return new VifxError({
    code: options.code,
    message: `Vifx cannot bundle the require.context(...) call in "${options.filePath}" (line ${line}, column ${column}): ${options.reason}`,
    hint: options.hint,
    docsPath: REQUIRE_CONTEXT_DOCS_PATH,
    details: {
      column,
      file: options.filePath,
      line,
    },
  });
}

function parseRequireContextArguments(options: { call: AstNode; code: string; filePath: string }): {
  directory: string;
  filterFlags: string | null;
  filterSource: string | null;
  mode: string;
  recursive: boolean;
} {
  const notStatic = (reason: string, start: number) =>
    createContextError({
      code: "VIFX_DYNAMIC_CONTEXT_NOT_STATIC",
      filePath: options.filePath,
      hint: "Vifx resolves require.context at build time, so the directory, recursive flag, filter regex, and mode must all be literal values.",
      reason,
      source: options.code,
      start,
    });
  const callArguments = (options.call.arguments ?? []) as AstNode[];

  if (callArguments.length === 0) {
    throw notStatic("the directory argument is missing.", options.call.start);
  }

  if (callArguments.length > 4) {
    throw notStatic("it receives more than four arguments.", options.call.start);
  }

  for (const argument of callArguments) {
    if (argument.type === "SpreadElement") {
      throw notStatic("spread arguments cannot be statically analyzed.", argument.start);
    }
  }

  const directoryArgument = callArguments[0] as AstNode;
  const directory = readStaticStringValue(directoryArgument);
  if (directory === null) {
    throw notStatic("the directory argument must be a string literal.", directoryArgument.start);
  }

  let recursive = true;
  const recursiveArgument = callArguments[1];
  if (recursiveArgument !== undefined) {
    if (recursiveArgument.type !== "Literal" || typeof recursiveArgument.value !== "boolean") {
      throw notStatic("the recursive argument must be a boolean literal.", recursiveArgument.start);
    }
    recursive = recursiveArgument.value;
  }

  let filterSource: string | null = null;
  let filterFlags: string | null = null;
  const filterArgument = callArguments[2];
  if (filterArgument !== undefined) {
    const regex = filterArgument.type === "Literal" ? filterArgument.regex : null;
    const pattern = (regex as { flags?: unknown; pattern?: unknown } | null)?.pattern;
    const flags = (regex as { flags?: unknown; pattern?: unknown } | null)?.flags;
    if (typeof pattern !== "string" || typeof flags !== "string") {
      throw notStatic(
        "the filter argument must be a regular expression literal.",
        filterArgument.start,
      );
    }
    filterSource = pattern;
    filterFlags = flags;
  }

  let mode = SUPPORTED_CONTEXT_MODE;
  const modeArgument = callArguments[3];
  if (modeArgument !== undefined) {
    const modeValue = readStaticStringValue(modeArgument);
    if (modeValue === null) {
      throw notStatic("the mode argument must be a string literal.", modeArgument.start);
    }
    mode = modeValue;
  }

  if (mode !== SUPPORTED_CONTEXT_MODE) {
    throw createContextError({
      code: "VIFX_DYNAMIC_CONTEXT_MODE_UNSUPPORTED",
      filePath: options.filePath,
      hint: 'Vifx inlines every context module into the bundle, so only the "sync" mode is supported.',
      reason: `the "${mode}" mode is not supported.`,
      source: options.code,
      start: (modeArgument as AstNode).start,
    });
  }

  return { directory, filterFlags, filterSource, mode, recursive };
}

function createRequireContextModuleId(descriptor: RequireContextDescriptor) {
  return `${REQUIRE_CONTEXT_PREFIX}${JSON.stringify(descriptor)}`;
}

function parseRequireContextModuleId(id: string): RequireContextDescriptor {
  const rawDescriptor = id.slice(REQUIRE_CONTEXT_PREFIX.length);

  try {
    const parsed = JSON.parse(rawDescriptor) as Partial<RequireContextDescriptor>;
    if (
      typeof parsed.directory !== "string" ||
      typeof parsed.displayId !== "string" ||
      typeof parsed.recursive !== "boolean" ||
      (parsed.filterSource !== null && typeof parsed.filterSource !== "string") ||
      (parsed.filterFlags !== null && typeof parsed.filterFlags !== "string")
    ) {
      throw new Error("Malformed require.context descriptor.");
    }

    return {
      directory: parsed.directory,
      displayId: parsed.displayId,
      filterFlags: parsed.filterFlags ?? null,
      filterSource: parsed.filterSource ?? null,
      recursive: parsed.recursive,
    };
  } catch (error) {
    throw new VifxError({
      code: "VIFX_INTERNAL_ERROR",
      message: `Vifx could not decode the require.context module id "${id}".`,
      docsPath: REQUIRE_CONTEXT_DOCS_PATH,
      cause: error,
    });
  }
}

export function transformRequireContext(options: {
  code: string;
  filePath: string;
  projectRoot: string;
}): { code: string } | null {
  if (!isProjectSourceFile(options.filePath, options.projectRoot)) {
    return null;
  }

  if (!REQUIRE_CONTEXT_QUICK_PATTERN.test(options.code)) {
    return null;
  }

  const program = parseModuleProgram(options.filePath, options.code);
  if (!program) {
    return null;
  }

  const replacements: CodeReplacement[] = [];
  const importLines: string[] = [];

  walkAst(program, (node) => {
    if (!isRequireContextCall(node) || isInsideCollectedRange(node, replacements)) {
      return;
    }

    const contextArguments = parseRequireContextArguments({
      call: node,
      code: options.code,
      filePath: options.filePath,
    });
    const directory = path.resolve(path.dirname(options.filePath), contextArguments.directory);
    const relativeDirectory = toPosixPath(path.relative(options.projectRoot, directory)) || ".";
    const filterDisplay =
      contextArguments.filterSource === null
        ? "*"
        : `/${contextArguments.filterSource}/${contextArguments.filterFlags ?? ""}`;
    const descriptor: RequireContextDescriptor = {
      directory,
      displayId: `vifx-require-context:${relativeDirectory}?recursive=${String(contextArguments.recursive)}&filter=${filterDisplay}&mode=${SUPPORTED_CONTEXT_MODE}`,
      filterFlags: contextArguments.filterFlags,
      filterSource: contextArguments.filterSource,
      recursive: contextArguments.recursive,
    };
    const importName = `__vifxRequireContext${importLines.length}`;

    importLines.push(
      `import ${importName} from ${JSON.stringify(createRequireContextModuleId(descriptor))};`,
    );
    replacements.push({ end: node.end, start: node.start, text: importName });
  });

  if (replacements.length === 0) {
    return null;
  }

  return {
    code: prependModuleCode(
      applyCodeReplacements(options.code, replacements),
      `${importLines.join("\n")}\n`,
    ),
  };
}

async function collectRequireContextEntries(
  descriptor: RequireContextDescriptor,
): Promise<RequireContextEntry[]> {
  const filter =
    descriptor.filterSource === null
      ? null
      : new RegExp(descriptor.filterSource, descriptor.filterFlags ?? "");
  const entries: RequireContextEntry[] = [];

  async function visitDirectory(directory: string): Promise<void> {
    let directoryEntries;
    try {
      directoryEntries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of directoryEntries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (descriptor.recursive) {
          await visitDirectory(entryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const contextKey = `./${toPosixPath(path.relative(descriptor.directory, entryPath))}`;
      if (filter && !filter.test(contextKey)) {
        continue;
      }

      entries.push({ contextKey, resolvedFilePath: entryPath });
    }
  }

  await visitDirectory(descriptor.directory);
  return entries.sort((left, right) => left.contextKey.localeCompare(right.contextKey));
}

export async function renderRequireContextModule(id: string): Promise<string> {
  const descriptor = parseRequireContextModuleId(id);
  const entries = await collectRequireContextEntries(descriptor);
  const importLines = entries.map((entry, index) => {
    return `import * as contextModule${index} from ${JSON.stringify(entry.resolvedFilePath)};`;
  });
  const moduleMapLines = entries.map((entry, index) => {
    return `  ${JSON.stringify(entry.contextKey)}: contextModule${index},`;
  });

  return [
    ...importLines,
    "",
    "const modules = {",
    ...moduleMapLines,
    "};",
    "",
    "function createModuleNotFoundError(key) {",
    "  const error = new Error(`Cannot find module '${key}' in the Vifx require.context.`);",
    "  error.code = 'MODULE_NOT_FOUND';",
    "  return error;",
    "}",
    "",
    "function requireContext(key) {",
    "  if (!Object.prototype.hasOwnProperty.call(modules, key)) {",
    "    throw createModuleNotFoundError(key);",
    "  }",
    "",
    "  return modules[key];",
    "}",
    "",
    "requireContext.keys = function keys() {",
    "  return Object.keys(modules);",
    "};",
    "",
    "requireContext.resolve = function resolve(key) {",
    "  if (!Object.prototype.hasOwnProperty.call(modules, key)) {",
    "    throw createModuleNotFoundError(key);",
    "  }",
    "",
    "  return key;",
    "};",
    "",
    `requireContext.id = ${JSON.stringify(descriptor.displayId)};`,
    "",
    "export default requireContext;",
    "",
  ].join("\n");
}
