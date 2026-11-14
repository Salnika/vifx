import { createRequire } from "node:module";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import type { VifxBundleMode, VifxModuleFormat } from "@vifx/types";

/**
 * Transform-level React Refresh support for the Metro-compatible dev bundle.
 *
 * Runs `react-refresh/babel` over each project module, emitting the
 * `$RefreshReg$(Type, "id")` registration calls and `$RefreshSig$()` signature
 * calls React Refresh needs. That is the ONLY thing done here.
 *
 * The registration glue itself lives in the runtime, not in the module body:
 * the `moduleFormat: "metro"` registry prelude installs the `$RefreshReg$` /
 * `$RefreshSig$` globals around each module factory and registers the module's
 * real exports afterwards (see `module-registry/runtime.ts`
 * `loadModuleImplementation`), exactly as Metro's `metroRequire` does. Doing the
 * registration in the runtime — rather than wrapping the body in a nested
 * `(module, exports)` closure here — is what keeps the factory's real
 * `module.exports` visible to React Refresh; wrapping it would register an empty
 * exports object and silently degrade every edit to a full reload.
 *
 * Scope: TRANSFORM-LEVEL ONLY. Activated under `moduleFormat: "metro"` +
 * development (see {@link shouldApplyReactRefresh}); a no-op otherwise.
 */

const NODE_MODULES_SEGMENT = "/node_modules/";

const reactRefreshBabelPluginCache = new Map<string, string>();

export interface ShouldApplyReactRefreshInput {
  /** Plugin options. `moduleFormat` and `mode` are consumed here (owned by sibling units). */
  options: {
    mode?: VifxBundleMode;
    moduleFormat?: VifxModuleFormat;
  };
  /** Module id (absolute path, possibly with a query/hash suffix). */
  id: string;
  /** Absolute project root used to decide whether a file is project source. */
  projectRoot: string;
}

function stripQuery(filePath: string) {
  return filePath.replace(/[?#].*$/u, "");
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

export function isProjectSource(id: string, projectRoot: string) {
  const normalizedId = stripQuery(id);

  if (normalizedId.includes("\0") || toPosixPath(normalizedId).includes(NODE_MODULES_SEGMENT)) {
    return false;
  }

  const relativePath = path.relative(projectRoot, normalizedId);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * Activation predicate for the React Refresh transform.
 *
 * React Refresh glue is applied only when ALL of the following hold:
 *  - `options.moduleFormat === "metro"` (the format whose runtime ships RN's
 *    HMRClient + setUpReactRefresh; the scope-hoisted format has no module
 *    registry and cannot drive native Fast Refresh),
 *  - `options.mode !== "production"` (Fast Refresh is a dev-only concern), and
 *  - the file is project source (never `node_modules`).
 *
 * `moduleFormat` and `mode` are owned by sibling units; their semantics are
 * consumed, never defined here. Under any other combination this is a no-op,
 * which keeps the transform inert (and the PR mergeable) until those units land.
 */
export function shouldApplyReactRefresh(input: ShouldApplyReactRefreshInput): boolean {
  const { options, id, projectRoot } = input;

  if (options.moduleFormat !== "metro") {
    return false;
  }

  if (options.mode === "production") {
    return false;
  }

  return isProjectSource(id, projectRoot);
}

export interface ProjectBabelLike {
  presetPath: string | null;
  transformAsync: (
    code: string,
    options: Record<string, unknown>,
  ) => Promise<{
    code?: string | null;
    map?: unknown;
  } | null>;
}

export interface ApplyReactRefreshTransformInput {
  /** Source to transform (already plain JS/JSX as delivered to the transform hook). */
  code: string;
  /** Module id used as the babel filename. */
  id: string;
  /**
   * The project's babel runtime, loaded by the plugin's existing machinery
   * (`loadProjectBabelRuntime` / `transformWithProjectBabel`). We do not bundle a
   * second babel; the `react-refresh/babel` plugin is run through this instance.
   */
  babel: ProjectBabelLike;
  /**
   * Module URL or filesystem path to resolve `react-refresh/babel` from. Defaults
   * to this module, whose package declares `react-refresh` as a direct dependency.
   */
  resolveFrom?: string;
  /** Platform passed to the babel caller (defaults to a native platform). */
  platform?: string;
  /** Absolute project root, forwarded to the babel caller. */
  projectRoot?: string;
}

export interface ApplyReactRefreshTransformResult {
  code: string;
  map: unknown;
}

export function resolveReactRefreshBabelPlugin(resolveFrom: string): string {
  const cached = reactRefreshBabelPluginCache.get(resolveFrom);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const requireFrom = createRequire(resolveFrom);
    const resolved = requireFrom.resolve("react-refresh/babel");
    reactRefreshBabelPluginCache.set(resolveFrom, resolved);
    return resolved;
  } catch (cause) {
    throw new VifxError({
      code: "VIFX_INTERNAL_ERROR",
      message: "Failed to resolve the react-refresh/babel plugin for the Fast Refresh transform.",
      hint: "Ensure react-refresh is installed; it ships as a dependency of @vifx/vite-plugin-react-native.",
      details: { resolveFrom },
      cause,
    });
  }
}

/**
 * Run `react-refresh/babel` over a project module using the plugin's existing
 * project babel runtime. Emits the `$RefreshReg$` / `$RefreshSig$` calls that
 * the metro registry runtime's per-factory registration relies on.
 *
 * `skipEnvCheck` is set because this pipeline's babel caller does not advertise a
 * `development` env; the activation predicate already gates on dev mode.
 */
export async function applyReactRefreshTransform(
  input: ApplyReactRefreshTransformInput,
): Promise<ApplyReactRefreshTransformResult> {
  const { code, id, babel } = input;
  const resolveFrom = input.resolveFrom ?? defaultResolveFrom();
  const reactRefreshPlugin = resolveReactRefreshBabelPlugin(resolveFrom);

  let transformed: { code?: string | null; map?: unknown } | null;
  try {
    transformed = await babel.transformAsync(code, {
      babelrc: false,
      caller: {
        bundler: "metro",
        // Same Hermes profile as the main project-Babel transform.
        ...(input.platform === "web" ? {} : { engine: "hermes" }),
        isDev: true,
        isHMREnabled: true,
        isNodeModule: false,
        name: "vifx",
        platform: input.platform ?? "ios",
        projectRoot: input.projectRoot,
        // CommonJS output: the registration wrapper places the module body inside
        // a function, so top-level ESM `import`/`export` must be lowered first.
        // The metro module format consumes CommonJS factories, so this matches.
        supportsStaticESM: false,
      },
      configFile: false,
      filename: id,
      plugins: [[reactRefreshPlugin, { skipEnvCheck: true }]],
      presets: babel.presetPath ? [babel.presetPath] : [],
      sourceMaps: true,
    });
  } catch (cause) {
    throw new VifxError({
      code: "VIFX_INTERNAL_ERROR",
      message: "React Refresh babel transform failed.",
      details: { id },
      cause,
    });
  }

  if (!transformed?.code) {
    throw new VifxError({
      code: "VIFX_INTERNAL_ERROR",
      message: "React Refresh babel transform produced no output.",
      details: { id },
    });
  }

  return {
    code: transformed.code,
    map: transformed.map ?? null,
  };
}

function defaultResolveFrom(): string {
  return import.meta.url;
}

// React Refresh registration is performed by the metro registry runtime
// (module-registry/runtime.ts loadModuleImplementation), not by wrapping the
// module body here — see this file's header comment.
