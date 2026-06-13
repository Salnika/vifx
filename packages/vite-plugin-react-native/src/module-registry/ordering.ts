import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { VifxError } from "@vifx/errors";

/**
 * Module ordering for the Metro-compatible module-registry bundle format.
 *
 * The final bundle is laid out as:
 *
 * 1. the module-registry runtime prelude (`__d`/`__r`), first,
 * 2. polyfill modules (for example `@react-native/js-polyfills/error-guard`),
 * 3. `react-native/Libraries/Core/InitializeCore.js` as an early module when
 *    it is resolvable from the target project (synthetic fixtures without a
 *    real `react-native` install log a warning and skip it),
 * 4. every other module, dependencies registered before their dependents,
 * 5. the entry module last, executed by a trailing `__r(<entryId>)`.
 *
 * Ordering is achieved in two cooperating ways:
 *
 * - a generated entry wrapper imports the polyfills and InitializeCore before
 *   the user entry, so executing the entry module evaluates them first, and
 * - {@link orderModules} performs a post-order depth-first traversal of the
 *   require graph from the entry, which registers dependencies before
 *   dependents and the entry last. Because the wrapper imports polyfills and
 *   InitializeCore first, their subtrees also register first.
 */

/**
 * Polyfill module specifiers imported (in order) before the user entry when
 * they are resolvable from the target project. This mirrors the prelude used
 * by the Expo bundle pipeline (`@react-native/js-polyfills/error-guard`).
 */
export const MODULE_REGISTRY_POLYFILL_SPECIFIERS = [
  "@react-native/js-polyfills/error-guard",
] as const;

/**
 * React Native's core initialization module. Metro registers it as one of the
 * first modules of a bundle (`runBeforeMainModule`); the module-registry
 * format imports it just before the user entry so it executes first.
 */
export const INITIALIZE_CORE_SPECIFIER = "react-native/Libraries/Core/InitializeCore.js";

/**
 * React Native's Fast Refresh setup module. Development bundles import it right
 * after InitializeCore (which wires the globals it depends on) so it installs
 * `global[(__METRO_GLOBAL_PREFIX__ || "") + "__ReactRefresh"]` — the registry
 * the metro runtime's HMR engine reads — independently of RN's internal
 * InitializeCore → setUpDeveloperTools → setUpReactRefresh chain, which can drift
 * across RN versions. setUpReactRefresh is idempotent and the registry memoizes
 * each module, so importing it in addition to RN's own chain runs the body once.
 */
export const SET_UP_REACT_REFRESH_SPECIFIER = "react-native/Libraries/Core/setUpReactRefresh.js";

export interface MetroEntryPlanOptions {
  /** Absolute path of the final bundle output directory. */
  absoluteOutDir: string;
  /**
   * Development bundle: additionally import setUpReactRefresh after
   * InitializeCore so `global.__ReactRefresh` is installed for Fast Refresh.
   */
  dev?: boolean;
  /** User entry as configured (path-like or bare specifier). */
  entry: string;
  /** Called for non-fatal setup notices (defaults to `console.warn`). */
  onWarn?: (message: string) => void;
  /** Absolute project root. */
  projectRoot: string;
}

export interface MetroEntryPlan {
  /** Absolute path of the generated wrapper entry module. */
  inputEntryPath: string;
  /** Whether InitializeCore was resolvable and is imported by the wrapper. */
  includesInitializeCore: boolean;
  /** Whether the dev setUpReactRefresh import was resolvable and is included. */
  includesSetUpReactRefresh: boolean;
  /** Polyfill specifiers that resolved and are imported by the wrapper. */
  polyfillSpecifiers: string[];
  /** Warnings emitted while planning (also forwarded to `onWarn`). */
  warnings: string[];
}

function isPathLikeEntry(entry: string) {
  return (
    entry.startsWith("./") ||
    entry.startsWith("../") ||
    entry.startsWith("/") ||
    path.isAbsolute(entry)
  );
}

function canResolveFromProject(projectRoot: string, specifier: string) {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  try {
    requireFromProject.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes the generated wrapper entry for a `moduleFormat: "metro"` build. The
 * wrapper imports the resolvable polyfills, then InitializeCore when
 * available, then the user entry, so that executing the entry module runs the
 * React Native initialization before any user code.
 */
export async function planMetroEntryModule(
  options: MetroEntryPlanOptions,
): Promise<MetroEntryPlan> {
  const warn = options.onWarn ?? ((message: string) => console.warn(message));
  const warnings: string[] = [];
  const generatedEntryPath = path.join(
    path.dirname(options.absoluteOutDir),
    "__vifx-entry__",
    `${path.basename(options.absoluteOutDir)}-module-registry.js`,
  );

  const polyfillSpecifiers = MODULE_REGISTRY_POLYFILL_SPECIFIERS.filter((specifier) =>
    canResolveFromProject(options.projectRoot, specifier),
  );
  const includesInitializeCore = canResolveFromProject(
    options.projectRoot,
    INITIALIZE_CORE_SPECIFIER,
  );

  if (!includesInitializeCore) {
    const warning =
      `[vifx] ${INITIALIZE_CORE_SPECIFIER} is not resolvable from "${options.projectRoot}"; ` +
      "the module-registry bundle is emitted without React Native core initialization.";
    warnings.push(warning);
    warn(warning);
  }

  // Development bundles explicitly install React Refresh after InitializeCore so
  // global.__ReactRefresh exists for the HMR runtime, independent of RN's
  // internal dev-tools chain. A no-op (with a loud warning) when unresolvable.
  const includesSetUpReactRefresh =
    options.dev === true &&
    includesInitializeCore &&
    canResolveFromProject(options.projectRoot, SET_UP_REACT_REFRESH_SPECIFIER);

  if (options.dev === true && includesInitializeCore && !includesSetUpReactRefresh) {
    const warning =
      `[vifx] ${SET_UP_REACT_REFRESH_SPECIFIER} is not resolvable from "${options.projectRoot}"; ` +
      "Fast Refresh will be inert (global.__ReactRefresh is never installed) in this dev bundle.";
    warnings.push(warning);
    warn(warning);
  }

  const entrySpecifier = isPathLikeEntry(options.entry)
    ? toPosixSpecifier(
        path.relative(
          path.dirname(generatedEntryPath),
          path.resolve(options.projectRoot, options.entry),
        ),
      )
    : options.entry;

  const importLines = [
    ...polyfillSpecifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
    ...(includesInitializeCore ? [`import ${JSON.stringify(INITIALIZE_CORE_SPECIFIER)};`] : []),
    ...(includesSetUpReactRefresh
      ? [`import ${JSON.stringify(SET_UP_REACT_REFRESH_SPECIFIER)};`]
      : []),
    `import ${JSON.stringify(entrySpecifier)};`,
    "",
  ];

  await mkdir(path.dirname(generatedEntryPath), { recursive: true });
  await writeFile(generatedEntryPath, importLines.join("\n"), "utf8");

  return {
    includesInitializeCore,
    includesSetUpReactRefresh,
    inputEntryPath: generatedEntryPath,
    polyfillSpecifiers,
    warnings,
  };
}

function toPosixSpecifier(relativePath: string) {
  const posixPath = relativePath.split(path.sep).join("/");
  return posixPath.startsWith(".") ? posixPath : `./${posixPath}`;
}

/**
 * A staged module participating in the registry bundle: one emitted CommonJS
 * chunk of the `preserveModules` staging build.
 */
export interface OrderableModule {
  /** Emitted file name, relative to the staging directory (posix-style). */
  fileName: string;
  /** Emitted file names this module requires, in source order. */
  requires: string[];
}

/**
 * Orders modules so dependencies register before dependents and the entry
 * registers last, via post-order depth-first traversal from the entry.
 * Cycles are tolerated (the runtime resolves them with partially-initialized
 * exports); back-edges are simply not revisited. Modules unreachable from the
 * entry are appended after the reachable graph, before the entry, in stable
 * file-name order.
 */
export function orderModules(modules: OrderableModule[], entryFileName: string): string[] {
  const byFileName = new Map(modules.map((module) => [module.fileName, module]));
  if (!byFileName.has(entryFileName)) {
    throw new VifxError({
      code: "VIFX_MODULE_REGISTRY_ENTRY_MISSING",
      message: `The staged build output does not contain the entry module "${entryFileName}".`,
      hint: "This is an internal serializer error; re-run the build with logLevel info and report the output.",
      docsPath: "/reference/packages#vifxvite-plugin-react-native",
    });
  }

  const ordered: string[] = [];
  const visited = new Set<string>();

  const visit = (fileName: string) => {
    if (visited.has(fileName)) {
      return;
    }
    visited.add(fileName);
    const module = byFileName.get(fileName);
    if (!module) {
      return;
    }
    for (const dependency of module.requires) {
      visit(dependency);
    }
    ordered.push(fileName);
  };

  visit(entryFileName);

  const unreachable = modules
    .map((module) => module.fileName)
    .filter((fileName) => !visited.has(fileName))
    .sort();
  if (unreachable.length > 0) {
    ordered.splice(ordered.length - 1, 0, ...unreachable);
  }

  return ordered;
}

/**
 * Assigns stable numeric module ids.
 *
 * With no `existingIds`, ids are the file names sorted lexicographically and
 * numbered 0..n-1 — deterministic for identical builds and independent of
 * traversal order.
 *
 * Ids must be **stable across rebuilds** for Fast Refresh: an HMR delta
 * re-`__d`s a module by id, so if adding or removing a file renumbered the
 * others, the update would patch the wrong module. Passing the previous build's
 * id map preserves every known file's id and assigns fresh ids (past the current
 * maximum) only to newly seen files; a removed file keeps its id reserved so it
 * is never reused for a different file.
 */
export function assignModuleIds(
  fileNames: string[],
  existingIds?: ReadonlyMap<string, number>,
): Map<string, number> {
  const ids = new Map<string, number>(existingIds);
  let nextId = 0;
  for (const id of ids.values()) {
    if (id >= nextId) {
      nextId = id + 1;
    }
  }
  for (const fileName of [...fileNames].sort()) {
    if (!ids.has(fileName)) {
      ids.set(fileName, nextId);
      nextId += 1;
    }
  }
  return ids;
}
