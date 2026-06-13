import type { SerializedModule } from "./serializer.ts";

/**
 * Computes a Metro-shaped Fast Refresh `update` from two builds of a
 * `moduleFormat: "metro"` bundle (FR-C of Fast Refresh).
 *
 * A dev server keeps the previous build's {@link SerializedModule} list and, on
 * each rebuild, diffs it against the new one to produce the modules that
 * actually changed. Each changed module is re-emitted as
 * `__d(<factory>, <id>, <deps>, undefined, <inverseDeps>)`: evaluating that on
 * the device routes through the registry runtime's `define` to `global.__accept`
 * (the engine ported in `runtime.ts`), which re-runs the module and bubbles the
 * update to the nearest React Refresh boundary.
 *
 * Correctness depends on **stable module ids across rebuilds** (see
 * `assignModuleIds`): the delta patches modules by id, so a renumbering would
 * patch the wrong module.
 */

export interface HmrUpdateModule {
  /** `[moduleId, __d(...) code]`. */
  module: [number, string];
  sourceMappingURL: string | null;
  sourceURL: string | null;
}

export interface HmrUpdate {
  /** Modules present in the new build but not the previous one. */
  added: HmrUpdateModule[];
  /** Ids of modules dropped from the new build. */
  deleted: number[];
  isInitialUpdate: boolean;
  /** Modules whose factory changed between builds. */
  modified: HmrUpdateModule[];
  revisionId: string;
}

export interface ComputeHmrUpdateOptions {
  /** Whether this is the first update after a (re)connect. */
  isInitialUpdate?: boolean;
  /** Modules from the new build. */
  next: readonly SerializedModule[];
  /** Modules from the previous build. */
  previous: readonly SerializedModule[];
  /** Monotonic revision id for the new build (the caller owns the counter). */
  revisionId: string;
  /** Resolves the script/source-map URLs embedded in each update entry. */
  sourceUrlFor?: (module: SerializedModule) => {
    sourceMappingURL: string | null;
    sourceURL: string | null;
  };
}

function sameFactory(previous: SerializedModule, next: SerializedModule): boolean {
  // The factory text already embeds the rewritten require(<id>) calls, so a
  // dependency-id change shows up as a factory change too.
  return previous.factory === next.factory && previous.id === next.id;
}

/** Builds `id -> direct importer ids` over the new module graph. */
function buildInverseDependencies(modules: readonly SerializedModule[]): Map<number, number[]> {
  const inverse = new Map<number, number[]>();
  for (const mod of modules) {
    if (!inverse.has(mod.id)) {
      inverse.set(mod.id, []);
    }
  }
  for (const mod of modules) {
    for (const dependencyId of mod.dependencyIds) {
      let importers = inverse.get(dependencyId);
      if (importers === undefined) {
        importers = [];
        inverse.set(dependencyId, importers);
      }
      if (!importers.includes(mod.id)) {
        importers.push(mod.id);
      }
    }
  }
  return inverse;
}

/**
 * The transitive-ancestor inverse-dependency closure of `rootId` — exactly the
 * entries `metroHotUpdateModule` walks while bubbling the update upward. Sending
 * the focused closure (not the whole graph) keeps each delta small.
 */
function inverseClosureFor(
  rootId: number,
  inverse: ReadonlyMap<number, number[]>,
): Record<string, number[]> {
  const closure: Record<string, number[]> = {};
  const queue: number[] = [rootId];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const importers = inverse.get(id) ?? [];
    closure[String(id)] = importers;
    for (const importer of importers) {
      queue.push(importer);
    }
  }
  return closure;
}

function toUpdateModule(
  mod: SerializedModule,
  inverse: ReadonlyMap<number, number[]>,
  sourceUrlFor: ComputeHmrUpdateOptions["sourceUrlFor"],
): HmrUpdateModule {
  const inverseDependencies = inverseClosureFor(mod.id, inverse);
  const code = `__d(${mod.factory}, ${mod.id}, ${JSON.stringify(
    mod.dependencyIds,
  )}, undefined, ${JSON.stringify(inverseDependencies)});`;
  const urls = sourceUrlFor?.(mod) ?? { sourceMappingURL: null, sourceURL: null };
  return {
    module: [mod.id, code],
    sourceMappingURL: urls.sourceMappingURL,
    sourceURL: urls.sourceURL,
  };
}

export function computeHmrUpdate(options: ComputeHmrUpdateOptions): HmrUpdate {
  const previousByFile = new Map(options.previous.map((mod) => [mod.fileName, mod]));
  const nextByFile = new Map(options.next.map((mod) => [mod.fileName, mod]));
  const inverse = buildInverseDependencies(options.next);

  const added: HmrUpdateModule[] = [];
  const modified: HmrUpdateModule[] = [];
  for (const mod of options.next) {
    const previous = previousByFile.get(mod.fileName);
    if (previous === undefined) {
      added.push(toUpdateModule(mod, inverse, options.sourceUrlFor));
    } else if (!sameFactory(previous, mod)) {
      modified.push(toUpdateModule(mod, inverse, options.sourceUrlFor));
    }
  }

  const deleted: number[] = [];
  for (const mod of options.previous) {
    if (!nextByFile.has(mod.fileName)) {
      deleted.push(mod.id);
    }
  }

  return {
    added,
    deleted,
    isInitialUpdate: options.isInitialUpdate ?? false,
    modified,
    revisionId: options.revisionId,
  };
}
