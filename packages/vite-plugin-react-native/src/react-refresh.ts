import { createRequire } from "node:module";
import path from "node:path";
import { VifxError } from "@vifx/errors";
import type { VifxBundleMode, VifxModuleFormat } from "@vifx/types";

/**
 * Transform-level React Refresh support for the Metro-compatible dev bundle.
 *
 * Vifx serves React Native's own Fast Refresh client (HMRClient +
 * setUpReactRefresh, shipped inside react-native). For that client to drive
 * component-level updates, every project module must be transformed exactly the
 * way Metro transforms it:
 *
 *  1. The `react-refresh/babel` plugin runs over the module, emitting
 *     `$RefreshReg$(Type, "id")` registration calls and `$RefreshSig$()`
 *     signature calls for every component/hook it can recognise.
 *  2. The module body is wrapped so that, while it executes, the global
 *     `$RefreshReg$` / `$RefreshSig$` point at per-module implementations that
 *     register types against a stable id (`moduleId + " " + localName`) with the
 *     react-refresh runtime, and the previous globals are restored afterwards.
 *
 * Metro performs step 2 inside its `metroRequire` runtime (see
 * metro-runtime/src/polyfills/require.js). Vifx's dev bundle is scope-hoisted and
 * has no `__d`/`__r` module registry to hook into at this layer, so the
 * equivalent save/install/execute/restore is emitted inline around each module's
 * body here. The semantics are matched to Metro's so RN's HMRClient and
 * setUpReactRefresh work unmodified once the delta-delivery layer lands.
 *
 * Scope: TRANSFORM-LEVEL ONLY. This module does not deliver updates over a
 * `/hot` socket and is not wired to any runtime end-to-end path; both depend on
 * sibling units and a follow-up.
 */

/** Default global name React Native's metro-require exposes the Refresh registry under. */
const REACT_REFRESH_GLOBAL_KEY = "__ReactRefresh";

/** Metro reads the runtime global prefix from this global; we mirror its `|| ""` fallback. */
const METRO_GLOBAL_PREFIX_KEY = "__METRO_GLOBAL_PREFIX__";

/** Babel-plugin-injected global identifiers. Kept as Metro's defaults so the glue matches. */
const REFRESH_REG_GLOBAL = "$RefreshReg$";
const REFRESH_SIG_GLOBAL = "$RefreshSig$";

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

function isProjectSource(id: string, projectRoot: string) {
  const normalizedId = stripQuery(id);

  if (normalizedId.includes("\0") || toPosixPath(normalizedId).includes(NODE_MODULES_SEGMENT)) {
    return false;
  }

  const relativePath = path.relative(projectRoot, normalizedId);
  return (
    relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
  );
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
  presetPath: string;
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
   * Root to resolve `react-refresh/babel` from. Defaults to the directory of this
   * module's package, which declares `react-refresh` as a direct dependency.
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

function resolveReactRefreshBabelPlugin(resolveFrom: string): string {
  const cached = reactRefreshBabelPluginCache.get(resolveFrom);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const requireFrom = createRequire(path.join(resolveFrom, "package.json"));
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
 * project babel runtime. Emits the `$RefreshReg$` / `$RefreshSig$` calls the
 * registration glue (see {@link wrapWithRefreshRegistration}) depends on.
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
        isDev: true,
        isHMREnabled: true,
        isNodeModule: false,
        name: "vifx",
        platform: input.platform ?? "ios",
        projectRoot: input.projectRoot,
        supportsStaticESM: true,
      },
      configFile: false,
      filename: id,
      plugins: [[reactRefreshPlugin, { skipEnvCheck: true }]],
      presets: [babel.presetPath],
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
  return path.dirname(new URL("../", import.meta.url).pathname);
}

function toJsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/**
 * Wrap a (react-refresh-babel-transformed) module body with Metro-compatible
 * registration glue.
 *
 * The shape mirrors metro-runtime's `metroRequire` execution path:
 *
 *  - Resolve the Refresh registry RN's `setUpReactRefresh` installs at
 *    `global[(global.__METRO_GLOBAL_PREFIX__ || "") + "__ReactRefresh"]`.
 *  - Capture the previous `global.$RefreshReg$` / `global.$RefreshSig$`.
 *  - If a registry is present, install per-module implementations:
 *      `$RefreshReg$ = (type, id) => Refresh.register(type, moduleId + " " + id)`
 *      `$RefreshSig$ = Refresh.createSignatureFunctionForTransform`
 *  - Execute the module body (the babel-emitted `$RefreshReg$`/`$RefreshSig$`
 *    calls fire here).
 *  - After the body, register the module's exports
 *    (`Refresh.register(exports, moduleId + " %exports%")` and per-key) so
 *    function-component default/named exports become refresh boundaries.
 *  - In a `finally`, restore the previous `$RefreshReg$`/`$RefreshSig$`.
 *
 * The body runs inside a function so its top-level `const`/`let`/`import`-lowered
 * bindings stay module-scoped rather than leaking to the wrapper. The wrapper is
 * a no-op (beyond running the body) whenever the Refresh registry is absent,
 * matching Metro's `if (Refresh != null)` guard.
 *
 * `moduleId` is embedded as a string literal; the stable type id is
 * `moduleId + " " + localName`, identical to Metro's `$RefreshReg$` id scheme.
 */
export function wrapWithRefreshRegistration(code: string, moduleId: string): string {
  const moduleIdLiteral = toJsStringLiteral(moduleId);

  return `(function () {
  var __vifxRefresh =
    globalThis[(globalThis.${METRO_GLOBAL_PREFIX_KEY} || "") + ${toJsStringLiteral(
      REACT_REFRESH_GLOBAL_KEY,
    )}];
  var __vifxPrevRefreshReg = globalThis.${REFRESH_REG_GLOBAL};
  var __vifxPrevRefreshSig = globalThis.${REFRESH_SIG_GLOBAL};
  var __vifxModuleId = ${moduleIdLiteral};
  if (__vifxRefresh != null) {
    globalThis.${REFRESH_REG_GLOBAL} = function (type, id) {
      __vifxRefresh.register(type, __vifxModuleId + " " + id);
    };
    globalThis.${REFRESH_SIG_GLOBAL} = __vifxRefresh.createSignatureFunctionForTransform;
  }
  var __vifxModule = { exports: {} };
  try {
    (function (module, exports) {
${code}
    })(__vifxModule, __vifxModule.exports);
    if (__vifxRefresh != null) {
      __vifxRefresh.register(__vifxModule.exports, __vifxModuleId + " %exports%");
      if (__vifxModule.exports != null && typeof __vifxModule.exports === "object") {
        for (var __vifxKey in __vifxModule.exports) {
          var __vifxDesc = Object.getOwnPropertyDescriptor(__vifxModule.exports, __vifxKey);
          if (__vifxDesc && __vifxDesc.get) {
            continue;
          }
          __vifxRefresh.register(
            __vifxModule.exports[__vifxKey],
            __vifxModuleId + " %exports% " + __vifxKey,
          );
        }
      }
    }
  } finally {
    globalThis.${REFRESH_REG_GLOBAL} = __vifxPrevRefreshReg;
    globalThis.${REFRESH_SIG_GLOBAL} = __vifxPrevRefreshSig;
  }
})();
`;
}
