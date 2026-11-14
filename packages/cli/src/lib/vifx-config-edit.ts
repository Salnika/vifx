import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MetroConfigFixes } from "./metro-config.ts";

// Writes the settings `vifx doctor --fix` maps from metro.config.js into an
// existing vifx.config.ts. The file is parsed (TypeScript included) and edited
// in place, so its comments, formatting and other keys are kept.

/** The lists a new `resolver` key starts from. */
export interface VifxConfigDefaults {
  extensions: readonly string[];
  assetExtensions: readonly string[];
}

export interface VifxConfigEditResult {
  /** What was added, such as `resolver.extensions: + mdx`. */
  applied: string[];
  /** What could not be written automatically, with the reason. */
  manual: string[];
  /** The file before the edit, to restore it if the result does not load. */
  original: string;
}

interface AstNode {
  type: string;
  start: number;
  end: number;
}

interface ObjectNode extends AstNode {
  type: "ObjectExpression";
  properties: AstNode[];
}

interface PropertyNode extends AstNode {
  type: "Property";
  computed: boolean;
  key: AstNode & { name?: string; value?: unknown };
  value: AstNode;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const WRAPPER_TYPES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

/** Strips `as`, `satisfies` and parentheses around an expression. */
function unwrap(node: AstNode | null | undefined): AstNode | undefined {
  let current = node ?? undefined;
  while (current && WRAPPER_TYPES.has(current.type)) {
    current = (current as AstNode & { expression: AstNode }).expression;
  }
  return current;
}

function asObject(node: AstNode | null | undefined): ObjectNode | undefined {
  const value = unwrap(node);
  return value?.type === "ObjectExpression" ? (value as ObjectNode) : undefined;
}

/** `{ … }`, `defineVifxConfig({ … })`, or either one behind an `as`/`satisfies`. */
function objectOrCallArgument(node: AstNode | null | undefined): ObjectNode | undefined {
  const value = unwrap(node);
  if (value?.type === "CallExpression") {
    const [first] = (value as AstNode & { arguments: AstNode[] }).arguments;
    return asObject(first);
  }
  return asObject(value);
}

/** The object literal vifx.config.ts exports by default, if it has one. */
function findConfigObject(program: AstNode & { body: AstNode[] }): ObjectNode | undefined {
  const exported = program.body.find((statement) => statement.type === "ExportDefaultDeclaration");
  if (!exported) {
    return undefined;
  }
  const declaration = unwrap((exported as AstNode & { declaration: AstNode }).declaration);
  if (declaration?.type !== "Identifier") {
    return objectOrCallArgument(declaration);
  }

  // `const config = { … }; export default config;`
  const name = (declaration as AstNode & { name: string }).name;
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") {
      continue;
    }
    for (const declarator of (statement as AstNode & { declarations: AstNode[] }).declarations) {
      const { id, init } = declarator as AstNode & {
        id: AstNode & { name?: string };
        init: AstNode;
      };
      if (id.name === name) {
        return objectOrCallArgument(init);
      }
    }
  }
  return undefined;
}

function keyName(property: PropertyNode): string | undefined {
  if (property.computed) {
    return undefined;
  }
  if (property.key.type === "Identifier") {
    return property.key.name;
  }
  return typeof property.key.value === "string" ? property.key.value : undefined;
}

function propertyOf(object: ObjectNode, name: string): PropertyNode | undefined {
  return object.properties.find(
    (property): property is PropertyNode =>
      property.type === "Property" && keyName(property as PropertyNode) === name,
  );
}

/** The strings of a `["a", "b"]` literal, or undefined for anything else. */
function stringList(node: AstNode): string[] | undefined {
  const value = unwrap(node);
  if (value?.type !== "ArrayExpression") {
    return undefined;
  }
  const values: string[] = [];
  for (const element of (value as AstNode & { elements: (AstNode | null)[] }).elements) {
    const literal = element as (AstNode & { value?: unknown }) | null;
    if (literal?.type !== "Literal" || typeof literal.value !== "string") {
      return undefined;
    }
    values.push(literal.value);
  }
  return values;
}

function formatStringList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/** The indentation of the line `offset` is on. */
function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/u.exec(source.slice(lineStart))?.[0] ?? "";
}

/** Adds `property` (such as `key: value`) as the last property of `object`. */
function insertProperty(source: string, object: ObjectNode, property: string, edits: Edit[]) {
  const last = object.properties.at(-1);
  if (!last) {
    const indent = lineIndent(source, object.start);
    edits.push({
      start: object.start + 1,
      end: object.end - 1,
      text: `\n${indent}  ${property},\n${indent}`,
    });
    return;
  }

  // `{ a: 1 }` stays on one line; a multi-line object gets a line per property.
  const separator = source.slice(object.start, object.end).includes("\n")
    ? `\n${lineIndent(source, last.start)}`
    : " ";
  const rest = source.slice(last.end, object.end - 1);
  const next = rest.search(/\S/u);
  if (next >= 0 && rest[next] === ",") {
    const at = last.end + next + 1;
    edits.push({ start: at, end: at, text: `${separator}${property},` });
  } else {
    edits.push({ start: last.end, end: last.end, text: `,${separator}${property}` });
  }
}

/** Applies edits from the end of the file, keeping same-offset edits in order. */
function applyEdits(source: string, edits: Edit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((left, right) => right.edit.start - left.edit.start || right.index - left.index);
  let result = source;
  for (const { edit } of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function describeAll(fixes: MetroConfigFixes): string[] {
  const lines: string[] = [];
  if (fixes.sourceExtensions.length > 0) {
    lines.push(`resolver.extensions: add ${fixes.sourceExtensions.join(", ")}`);
  }
  if (fixes.assetExtensions.length > 0) {
    lines.push(`resolver.assetExtensions: add ${fixes.assetExtensions.join(", ")}`);
  }
  const aliasNames = Object.keys(fixes.aliases);
  if (aliasNames.length > 0) {
    lines.push(`vite.targets[].aliases: add ${aliasNames.join(", ")}`);
  }
  return lines;
}

/**
 * Writes `fixes` into the vifx.config.ts at `configPath`. Lists already in the
 * file gain only the missing entries; a missing list starts from `defaults`.
 * What cannot be edited safely (a computed list, a config that is not an object
 * literal) is returned in `manual` and left untouched.
 */
export async function applyMetroFixesToVifxConfig(
  configPath: string,
  fixes: MetroConfigFixes,
  defaults: VifxConfigDefaults,
): Promise<VifxConfigEditResult> {
  const source = await readFile(configPath, "utf8");
  const applied: string[] = [];
  const manual: string[] = [];
  const fileName = path.basename(configPath);

  // Loaded on demand: only `doctor --fix` needs a parser.
  const { parseSync } = await import("@voidzero-dev/vite-plus-core/rolldown/utils");
  const parsed = parseSync(fileName, source);
  const program = parsed.program as unknown as AstNode & { body: AstNode[] };
  const config = parsed.errors.length > 0 ? undefined : findConfigObject(program);
  if (!config) {
    const reason =
      parsed.errors.length > 0
        ? `${fileName} could not be parsed`
        : `${fileName} does not export an object literal`;
    return {
      applied,
      manual: describeAll(fixes).map((line) => `${line} (${reason})`),
      original: source,
    };
  }

  const edits: Edit[] = [];

  // resolver.extensions and resolver.assetExtensions
  const resolverProperty = propertyOf(config, "resolver");
  const resolver = resolverProperty ? asObject(resolverProperty.value) : undefined;
  const newResolverEntries: string[] = [];
  const lists = [
    { key: "extensions", additions: fixes.sourceExtensions, defaults: defaults.extensions },
    {
      key: "assetExtensions",
      additions: fixes.assetExtensions,
      defaults: defaults.assetExtensions,
    },
  ];
  for (const list of lists) {
    if (list.additions.length === 0) {
      continue;
    }
    const label = `resolver.${list.key}`;
    if (resolverProperty && !resolver) {
      manual.push(`${label}: add ${list.additions.join(", ")} (resolver is not an object literal)`);
      continue;
    }
    const existing = resolver ? propertyOf(resolver, list.key) : undefined;
    if (existing) {
      const current = stringList(existing.value);
      if (!current) {
        manual.push(`${label}: add ${list.additions.join(", ")} (the list is not a plain array)`);
        continue;
      }
      const missing = list.additions.filter((entry) => !current.includes(entry));
      if (missing.length > 0) {
        edits.push({
          start: existing.value.start,
          end: existing.value.end,
          text: formatStringList([...current, ...missing]),
        });
        applied.push(`${label}: + ${missing.join(", ")}`);
      }
      continue;
    }
    const values = [
      ...list.defaults,
      ...list.additions.filter((entry) => !list.defaults.includes(entry)),
    ];
    const property = `${list.key}: ${formatStringList(values)}`;
    if (resolver) {
      insertProperty(source, resolver, property, edits);
    } else {
      newResolverEntries.push(property);
    }
    applied.push(`${label}: + ${list.additions.join(", ")}`);
  }
  if (newResolverEntries.length > 0) {
    const last = config.properties.at(-1);
    const indent = last ? lineIndent(source, last.start) : "  ";
    const body = newResolverEntries.map((entry) => `${indent}  ${entry},`).join("\n");
    insertProperty(source, config, `resolver: {\n${body}\n${indent}}`, edits);
  }

  // vite.targets[].aliases
  const aliasEntries = Object.entries(fixes.aliases);
  if (aliasEntries.length > 0) {
    const aliasNames = aliasEntries.map(([name]) => name);
    const vite = asObject(propertyOf(config, "vite")?.value);
    const targetsNode = vite ? unwrap(propertyOf(vite, "targets")?.value) : undefined;
    const targets =
      targetsNode?.type === "ArrayExpression"
        ? (targetsNode as AstNode & { elements: (AstNode | null)[] }).elements.map((element) =>
            asObject(element),
          )
        : [];
    if (targets.length === 0 || targets.some((target) => target === undefined)) {
      manual.push(
        `vite.targets[].aliases: add ${aliasNames.join(", ")} (vite.targets is not a list of object literals)`,
      );
    } else {
      const added = new Set<string>();
      for (const target of targets as ObjectNode[]) {
        const aliasesProperty = propertyOf(target, "aliases");
        if (!aliasesProperty) {
          const entries = aliasEntries
            .map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`)
            .join(", ");
          insertProperty(source, target, `aliases: { ${entries} }`, edits);
          for (const name of aliasNames) {
            added.add(name);
          }
          continue;
        }
        const aliases = asObject(aliasesProperty.value);
        if (!aliases) {
          manual.push(
            `vite.targets[].aliases: add ${aliasNames.join(", ")} (aliases is not an object literal)`,
          );
          continue;
        }
        for (const [name, value] of aliasEntries) {
          if (!propertyOf(aliases, name)) {
            insertProperty(
              source,
              aliases,
              `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
              edits,
            );
            added.add(name);
          }
        }
      }
      if (added.size > 0) {
        applied.push(`vite.targets[].aliases: + ${[...added].join(", ")}`);
      }
    }
  }

  if (edits.length > 0) {
    await writeFile(configPath, applyEdits(source, edits), "utf8");
  }
  return { applied, manual, original: source };
}
