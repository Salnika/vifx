/**
 * In-app runtime for the Rolldown dev engine (Fast Refresh on the default,
 * scope-hoisted dev bundle).
 *
 * The dev engine keeps the initial bundle scope-hoisted and, on each save,
 * compiles only the changed modules into a small patch: a script that registers
 * re-runnable factories on `globalThis.__rolldown_runtime__`. Rolldown's own
 * runtime is a store and an executor — deciding what to re-run, and when to
 * give up and reload, is left to the host. This file is that host for React
 * Native: it applies Metro's Fast Refresh rules (a module whose exports are all
 * components is a boundary; anything else propagates to its importers; no
 * boundary means a full reload) on top of Rolldown's module graph.
 *
 * The source is emitted as the engine's `devMode.implement` module, so it runs
 * before any application module and must not touch React Native globals
 * (`WebSocket`, `setTimeout`, ...) at evaluation time. The `/hot` socket is
 * owned by the HMR client module (hmr-client.ts), which calls into
 * `globalThis.__vifxDevRuntime`.
 */

/** Global the HMR client reads to find this runtime. */
export const VIFX_DEV_RUNTIME_GLOBAL = "__vifxDevRuntime";

/** Global that instrumented project modules call into (see {@link wrapModuleForFastRefresh}). */
export const VIFX_REFRESH_GLOBAL = "__vifxRefresh";

const VIFX_DEV_RUNTIME_HOST_SOURCE = `
var vifxRoot =
  typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : this;
var VIFX_CYCLE = {};
var vifxRefreshTimer = null;
// Modules the patch being applied has re-run so far, in order.
var vifxRerunIds = [];
var vifxReloadRequested = false;

function vifxRefreshRuntime() {
  var prefix = vifxRoot.__METRO_GLOBAL_PREFIX__ || "";
  return vifxRoot[prefix + "__ReactRefresh"] || null;
}

function VifxHot(id, data) {
  this.id = id;
  this.data = data;
  this._accepted = false;
  this._acceptCallbacks = [];
  this._dispose = null;
}
VifxHot.prototype.accept = function (deps, callback) {
  if (typeof deps === "function" || deps == null) {
    this._accepted = true;
    if (typeof deps === "function") {
      this._acceptCallbacks.push(deps);
    }
  }
  // Dependency-scoped accepts are not tracked: the update propagates past
  // this module, which is always safe (worst case a full reload).
};
VifxHot.prototype.acceptExports = function () {};
VifxHot.prototype.dispose = function (callback) {
  this._dispose = callback;
};
VifxHot.prototype.prune = function () {};
VifxHot.prototype.decline = function () {};
VifxHot.prototype.invalidate = function () {
  vifxFullRefresh("A module invalidated itself");
};
VifxHot.prototype.on = function () {};
VifxHot.prototype.off = function () {};
VifxHot.prototype.send = function () {};

var vifxRuntime = new VifxDevRuntime(
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
);
vifxRuntime.vifxHot = new Map();
vifxRuntime.createModuleHotContext = function (id) {
  var previous = this.vifxHot.get(id);
  var context = new VifxHot(id, previous ? previous.data : {});
  this.vifxHot.set(id, context);
  return context;
};
vifxRoot.__rolldown_runtime__ = vifxRuntime;

function vifxExports(id) {
  var cached = vifxRuntime.moduleCache.get(id);
  return cached ? cached.exportsHolder.exports : undefined;
}

function vifxExecutedImporters(id) {
  return vifxRuntime.getImporters(id).filter(function (importer) {
    return vifxRuntime.isExecuted(importer);
  });
}

function vifxFullRefresh(reason) {
  // One reload per app instance: a second request would land on the instance
  // that is starting up in its place.
  if (vifxReloadRequested) {
    return;
  }
  vifxReloadRequested = true;
  // Tell the dev server why, before the app goes away: "it reloaded" with no
  // reason is the one Fast Refresh outcome nobody can act on.
  var host = vifxRoot.${VIFX_DEV_RUNTIME_GLOBAL};
  if (host && typeof host.onFullRefresh === "function") {
    try {
      host.onFullRefresh(reason);
    } catch (error) {}
  }
  var Refresh = vifxRefreshRuntime();
  if (Refresh != null && typeof Refresh.performFullRefresh === "function") {
    Refresh.performFullRefresh("Fast Refresh - " + reason);
  } else if (typeof vifxRoot.__vifxFullReload === "function") {
    vifxRoot.__vifxFullReload(reason);
  } else if (typeof console !== "undefined" && console.warn) {
    console.warn("[Fast Refresh] Could not reload after an edit: " + reason);
  }
}

function vifxReportError(error) {
  if (vifxRoot.ErrorUtils && typeof vifxRoot.ErrorUtils.reportFatalError === "function") {
    vifxRoot.ErrorUtils.reportFatalError(error);
  } else if (typeof console !== "undefined" && console.error) {
    console.error(error);
  }
}

// A bundler namespace object exposes every export through a getter, which is
// safe to read once the module has run; a getter on a plain CommonJS exports
// object may have side effects and is left alone, as Metro does.
function vifxIsExportSafeToAccess(moduleExports, key) {
  if (moduleExports.__esModule) {
    return true;
  }
  if (typeof Symbol !== "undefined" && moduleExports[Symbol.toStringTag] === "Module") {
    return true;
  }
  return (Object.getOwnPropertyDescriptor(moduleExports, key) || {}).get == null;
}

function vifxIsBoundary(Refresh, moduleExports) {
  if (Refresh.isLikelyComponentType(moduleExports)) {
    return true;
  }
  if (moduleExports == null || typeof moduleExports !== "object") {
    return false;
  }
  var hasExports = false;
  var areAllExportsComponents = true;
  for (var key in moduleExports) {
    hasExports = true;
    if (key === "__esModule") {
      continue;
    }
    if (!vifxIsExportSafeToAccess(moduleExports, key)) {
      return false;
    }
    if (!Refresh.isLikelyComponentType(moduleExports[key])) {
      areAllExportsComponents = false;
    }
  }
  return hasExports && areAllExportsComponents;
}

function vifxBoundarySignature(Refresh, moduleExports) {
  var signature = [];
  signature.push(Refresh.getFamilyByType(moduleExports));
  if (moduleExports == null || typeof moduleExports !== "object") {
    return signature;
  }
  for (var key in moduleExports) {
    if (key === "__esModule" || !vifxIsExportSafeToAccess(moduleExports, key)) {
      continue;
    }
    signature.push(key);
    signature.push(Refresh.getFamilyByType(moduleExports[key]));
  }
  return signature;
}

function vifxShouldInvalidateBoundary(Refresh, prevExports, nextExports) {
  var prevSignature = vifxBoundarySignature(Refresh, prevExports);
  var nextSignature = vifxBoundarySignature(Refresh, nextExports);
  if (prevSignature.length !== nextSignature.length) {
    return true;
  }
  for (var index = 0; index < nextSignature.length; index++) {
    if (prevSignature[index] !== nextSignature[index]) {
      return true;
    }
  }
  return false;
}

function vifxRegisterExports(Refresh, moduleExports, id) {
  Refresh.register(moduleExports, id + " %exports%");
  if (moduleExports == null || typeof moduleExports !== "object") {
    return;
  }
  for (var key in moduleExports) {
    if (!vifxIsExportSafeToAccess(moduleExports, key)) {
      continue;
    }
    Refresh.register(moduleExports[key], id + " %exports% " + key);
  }
}

function vifxTopologicalSort(roots, getEdges, earlyStop) {
  var result = [];
  var visited = new Set();
  var stack = new Set();
  function traverse(node) {
    if (stack.has(node)) {
      throw VIFX_CYCLE;
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    stack.add(node);
    var dependents = getEdges(node);
    if (earlyStop(node)) {
      stack.delete(node);
      return;
    }
    dependents.forEach(function (dependent) {
      traverse(dependent);
    });
    stack.delete(node);
    result.push(node);
  }
  roots.forEach(function (root) {
    traverse(root);
  });
  return result;
}

function vifxRerun(id) {
  if (!vifxRuntime.hasFactory(id)) {
    vifxFullRefresh("No update was shipped for " + id);
    return false;
  }
  var hot = vifxRuntime.vifxHot.get(id);
  if (hot && typeof hot._dispose === "function") {
    try {
      hot._dispose(hot.data);
    } catch (error) {
      vifxReportError(error);
    }
  }
  var acceptCallbacks = hot ? hot._acceptCallbacks : [];
  vifxRuntime.removeModuleCache(id);
  try {
    vifxRuntime.initModule(id);
  } catch (error) {
    vifxReportError(error);
    return false;
  }
  vifxRerunIds.push(id);
  for (var index = 0; index < acceptCallbacks.length; index++) {
    try {
      acceptCallbacks[index](vifxExports(id));
    } catch (error) {
      vifxReportError(error);
    }
  }
  return true;
}

// Metro's hot-update walk: find the modules that must re-run for this edit
// (up to the nearest accepting module or Fast Refresh boundary), re-run them
// dependencies first, and widen to the importers of a boundary whose exports
// stopped being refreshable.
function vifxHotUpdate(id, Refresh) {
  var boundaries = new Set();
  var bailed = false;
  var order;
  try {
    order = vifxTopologicalSort(
      [id],
      function (pendingId) {
        var hot = vifxRuntime.vifxHot.get(pendingId);
        var canAccept = hot != null && hot._accepted;
        if (!canAccept && Refresh != null && vifxIsBoundary(Refresh, vifxExports(pendingId))) {
          canAccept = true;
          boundaries.add(pendingId);
        }
        if (canAccept) {
          return [];
        }
        var parents = vifxExecutedImporters(pendingId);
        if (parents.length === 0) {
          vifxFullRefresh(
            pendingId === id
              ? "No root boundary: nothing that ran imports " + id
              : "No root boundary: " + id + " reaches " + pendingId + ", which no component module imports",
          );
          bailed = true;
          return [];
        }
        return parents;
      },
      function () {
        return bailed;
      },
    ).reverse();
  } catch (error) {
    if (error === VIFX_CYCLE) {
      vifxFullRefresh("Dependency cycle");
      return false;
    }
    throw error;
  }
  if (bailed) {
    return false;
  }

  var seen = new Set();
  for (var index = 0; index < order.length; index++) {
    var updatedId = order[index];
    if (seen.has(updatedId)) {
      continue;
    }
    seen.add(updatedId);
    var prevExports = vifxExports(updatedId);
    if (!vifxRerun(updatedId)) {
      return false;
    }
    if (!boundaries.has(updatedId)) {
      continue;
    }
    var nextExports = vifxExports(updatedId);
    var isNoLongerABoundary = !vifxIsBoundary(Refresh, nextExports);
    var didInvalidate = vifxShouldInvalidateBoundary(Refresh, prevExports, nextExports);
    if (!isNoLongerABoundary && !didInvalidate) {
      continue;
    }
    var parentIds = vifxExecutedImporters(updatedId);
    if (parentIds.length === 0) {
      vifxFullRefresh(isNoLongerABoundary ? "No longer a boundary" : "Invalidated boundary");
      return false;
    }
    for (var parentIndex = 0; parentIndex < parentIds.length; parentIndex++) {
      var parentId = parentIds[parentIndex];
      if (!vifxIsBoundary(Refresh, vifxExports(parentId))) {
        vifxFullRefresh("Invalidated boundary");
        return false;
      }
      boundaries.add(parentId);
      order.push(parentId);
    }
  }
  return true;
}

function vifxEvaluate(code, sourceURL) {
  // Hermes disables plain eval; globalEvalWithSourceUrl is its dev-mode entry
  // point and gives the patch a source URL for stack traces.
  if (typeof vifxRoot.globalEvalWithSourceUrl === "function") {
    vifxRoot.globalEvalWithSourceUrl(code, sourceURL || null);
    return;
  }
  (0, eval)(code);
}

function vifxScheduleRefresh(Refresh) {
  if (Refresh == null || vifxRefreshTimer != null) {
    return;
  }
  if (typeof setTimeout !== "function") {
    Refresh.performReactRefresh();
    return;
  }
  vifxRefreshTimer = setTimeout(function () {
    vifxRefreshTimer = null;
    Refresh.performReactRefresh();
  }, 30);
}

vifxRoot.${VIFX_REFRESH_GLOBAL} = {
  // $RefreshReg$ for one module: families are keyed by module and local name.
  register: function (moduleId, type, localId) {
    var Refresh = vifxRefreshRuntime();
    if (Refresh != null) {
      Refresh.register(type, moduleId + " " + localId);
    }
  },
  // $RefreshSig$.
  signature: function () {
    var Refresh = vifxRefreshRuntime();
    return Refresh != null
      ? Refresh.createSignatureFunctionForTransform()
      : function (type) {
          return type;
        };
  },
  // Called at the end of every project module: registers what it exports, so
  // a component created by a call (a HOC, styled(...)) refreshes as well.
  evaluated: function (moduleId) {
    var Refresh = vifxRefreshRuntime();
    if (Refresh == null || !vifxRuntime.isExecuted(moduleId)) {
      return;
    }
    vifxRegisterExports(Refresh, vifxExports(moduleId), moduleId);
  },
};

vifxRoot.${VIFX_DEV_RUNTIME_GLOBAL} = {
  clientId: vifxRuntime.clientId,
  // Reloads the app (the dev server found it cannot be patched).
  fullRefresh: function (reason) {
    vifxFullRefresh(reason);
  },
  // Evaluates one patch and re-runs what it changed. Returns false when the
  // edit could not be applied in place (a full reload was requested instead).
  // Ids of the modules the last applied patch re-ran (the edited ones and
  // every importer up to a Fast Refresh boundary).
  lastRerunIds: [],
  applyPatch: function (patch) {
    vifxRerunIds = [];
    this.lastRerunIds = vifxRerunIds;
    vifxEvaluate(patch.code, patch.sourceURL);
    var Refresh = vifxRefreshRuntime();
    var changedIds = patch.changedIds || [];
    for (var index = 0; index < changedIds.length; index++) {
      // A module that never ran here has nothing to update: its new factory
      // is registered and runs if something imports it later.
      if (!vifxRuntime.isExecuted(changedIds[index])) {
        continue;
      }
      if (!vifxHotUpdate(changedIds[index], Refresh)) {
        return false;
      }
    }
    vifxScheduleRefresh(Refresh);
    return true;
  },
};
`;

/**
 * The module store and executor that compiler-emitted code calls
 * (`__rolldown_runtime__.registerModule(...)`, `initModule(...)`, ...).
 *
 * This is Rolldown's `DevRuntime` (`rolldown/experimental/runtime`) ported to
 * ES5: Hermes parses neither `class` nor class fields, and the dev runtime is
 * injected verbatim, past every transform. Behavior follows the original
 * member for member; `tests/dev-runtime.test.ts` fails when a Rolldown upgrade
 * adds a member this port does not have.
 */
const VIFX_DEV_RUNTIME_STORE_SOURCE = `
var vifxCreate = Object.create;
var vifxDefProp = Object.defineProperty;
var vifxGetOwnPropDesc = Object.getOwnPropertyDescriptor;
var vifxGetOwnPropNames = Object.getOwnPropertyNames;
var vifxGetProtoOf = Object.getPrototypeOf;
var vifxHasOwnProp = Object.prototype.hasOwnProperty;

function vifxExportAll(all, noSymbols) {
  var target = {};
  for (var name in all) {
    vifxDefProp(target, name, { get: all[name], enumerable: true });
  }
  if (!noSymbols) {
    vifxDefProp(target, Symbol.toStringTag, { value: "Module" });
  }
  return target;
}

function vifxCopyProps(to, from, except, desc) {
  if ((from && typeof from === "object") || typeof from === "function") {
    var keys = vifxGetOwnPropNames(from);
    for (var index = 0; index < keys.length; index++) {
      (function (key) {
        if (!vifxHasOwnProp.call(to, key) && key !== except) {
          vifxDefProp(to, key, {
            get: function () {
              return from[key];
            },
            enumerable: !(desc = vifxGetOwnPropDesc(from, key)) || desc.enumerable,
          });
        }
      })(keys[index]);
    }
  }
  return to;
}

function vifxReExport(target, mod, secondTarget) {
  vifxCopyProps(target, mod, "default");
  return secondTarget && vifxCopyProps(secondTarget, mod, "default");
}

function vifxToESM(mod, isNodeMode, target) {
  target = mod != null ? vifxCreate(vifxGetProtoOf(mod)) : {};
  return vifxCopyProps(
    isNodeMode || !mod || !mod.__esModule || !vifxHasOwnProp.call(mod, "default")
      ? vifxDefProp(target, "default", { value: mod, enumerable: true })
      : target,
    mod,
  );
}

function vifxToCommonJS(mod) {
  return vifxHasOwnProp.call(mod, "module.exports")
    ? mod["module.exports"]
    : vifxCopyProps(vifxDefProp({}, "__esModule", { value: true }), mod);
}

function VifxModule(id) {
  this.exportsHolder = { exports: null };
  this.id = id;
}
vifxDefProp(VifxModule.prototype, "exports", {
  get: function () {
    return this.exportsHolder.exports;
  },
});

function VifxMissingFactoryError(id) {
  var error = new Error("No factory registered for module " + id);
  error.id = id;
  return error;
}

function VifxDevRuntime(clientId) {
  this.clientId = clientId;
  // Static import edges from registerGraph: { edges, bindings } by importer.
  this.staticImports = new Map();
  this.importers = new Map();
  this.dynamicImports = new Map();
  this.dynamicImporters = new Map();
  this.entries = new Set();
  // Membership means "this module's side effects ran in this app".
  this.moduleCache = new Map();
  // Re-runnable factories from patches; the initial bundle contributes none.
  this.factories = new Map();
  // A late payload must not replace newer rows or factories.
  this.rowStamps = new Map();
  this.factoryStamps = new Map();
  this.hooks = null;
  this.__toESM = vifxToESM;
  this.__toCommonJS = vifxToCommonJS;
  this.__exportAll = vifxExportAll;
  this.__toDynamicImportESM = function (isNodeMode) {
    return function (mod) {
      return vifxToESM(mod.default, isNodeMode);
    };
  };
  this.__reExport = vifxReExport;
}

function vifxReindex(forward, reverse, id, edges) {
  var previous = forward.get(id);
  var previousEdges = previous ? previous.edges : [];
  for (var index = 0; index < previousEdges.length; index++) {
    var previousSet = reverse.get(previousEdges[index]);
    if (previousSet) {
      previousSet.delete(id);
    }
  }
  for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    var importerSet = reverse.get(edges[edgeIndex]);
    if (!importerSet) {
      importerSet = new Set();
      reverse.set(edges[edgeIndex], importerSet);
    }
    importerSet.add(id);
  }
}

VifxDevRuntime.prototype.registerGraph = function (delta) {
  var resolveId = function (row) {
    return delta.ids[row];
  };
  for (var index = 0; index < delta.localCount; index++) {
    var id = delta.ids[index];
    if (delta.stamps) {
      var stamp = delta.stamps[index] || 0;
      if (stamp < (this.rowStamps.get(id) || 0)) {
        continue;
      }
      this.rowStamps.set(id, stamp);
    } else {
      this.rowStamps.delete(id);
    }
    var edges = delta.edges[index].map(resolveId);
    vifxReindex(this.staticImports, this.importers, id, edges);
    this.staticImports.set(id, {
      edges: edges,
      bindings: delta.bindings ? delta.bindings[index] : undefined,
    });
    var dynamicRow = delta.dynamicEdges ? delta.dynamicEdges[index] : undefined;
    var dynamicEdges = (dynamicRow || []).map(resolveId);
    vifxReindex(this.dynamicImports, this.dynamicImporters, id, dynamicEdges);
    this.dynamicImports.set(id, { edges: dynamicEdges });
    if (delta.entries && delta.entries.indexOf(index) !== -1) {
      this.entries.add(id);
    } else {
      this.entries.delete(id);
    }
  }
};

VifxDevRuntime.prototype.registerFactory = function (id, fn, stamp) {
  stamp = stamp || 0;
  if (stamp < (this.factoryStamps.get(id) || 0)) {
    return;
  }
  this.factoryStamps.set(id, stamp);
  this.factories.set(id, fn);
};

VifxDevRuntime.prototype.registerModule = function (id, exportsHolder) {
  var module = new VifxModule(id);
  module.exportsHolder = exportsHolder === undefined ? { exports: {} } : exportsHolder;
  this.moduleCache.set(id, module);
};

VifxDevRuntime.prototype.getImporters = function (id) {
  var result = [];
  var seen = new Set();
  var collect = function (importer) {
    if (!seen.has(importer)) {
      seen.add(importer);
      result.push(importer);
    }
  };
  var staticSet = this.importers.get(id);
  if (staticSet) {
    staticSet.forEach(collect);
  }
  var dynamicSet = this.dynamicImporters.get(id);
  if (dynamicSet) {
    dynamicSet.forEach(collect);
  }
  return result;
};

// "*" means the whole namespace, an empty list a side-effect-only import,
// undefined no edge.
VifxDevRuntime.prototype.getImportedBindings = function (importer, id) {
  var record = this.staticImports.get(importer);
  var edgeIndex = record ? record.edges.indexOf(id) : -1;
  var names =
    edgeIndex === -1 ? undefined : (record.bindings && record.bindings[edgeIndex]) || ["*"];
  var dynamic = this.dynamicImports.get(importer);
  if (!dynamic || dynamic.edges.indexOf(id) === -1) {
    return names;
  }
  if (!names) {
    return ["*"];
  }
  return names.indexOf("*") !== -1 ? names : names.concat(["*"]);
};

VifxDevRuntime.prototype.isEntry = function (id) {
  return this.entries.has(id);
};

VifxDevRuntime.prototype.isExecuted = function (id) {
  return this.moduleCache.has(id);
};

VifxDevRuntime.prototype.hasFactory = function (id) {
  return this.factories.has(id);
};

// Module-cache delete only: import edges and factories persist. Removal is
// what re-arms a factory for initModule.
VifxDevRuntime.prototype.removeModuleCache = function (id) {
  this.moduleCache.delete(id);
  if (this.hooks) {
    this.hooks.onModuleCacheRemoval(id);
  }
};

// The one re-execution gate: registered -> the live exports; otherwise run
// the factory (which registers the module first, then runs its body).
VifxDevRuntime.prototype.initModule = function (id) {
  if (this.moduleCache.has(id)) {
    return this.loadExports(id);
  }
  var factory = this.factories.get(id);
  if (!factory) {
    throw VifxMissingFactoryError(id);
  }
  factory(id);
  return this.loadExports(id);
};

VifxDevRuntime.prototype.loadExports = function (id) {
  var module = this.moduleCache.get(id);
  if (module) {
    return module.exportsHolder.exports;
  }
  if (typeof console !== "undefined" && console.warn) {
    console.warn("Module " + id + " not found");
  }
  return {};
};

VifxDevRuntime.prototype.createModuleHotContext = function (moduleId) {
  if (this.hooks) {
    return this.hooks.createModuleHotContext(moduleId);
  }
  throw new Error("createModuleHotContext requires installed hooks or an override");
};
`;

/**
 * Source of the dev engine's `devMode.implement` module: the ES5 module store
 * followed by the React Native Fast Refresh host. Plain ES5 on purpose — it is
 * injected as is, and must parse in every Hermes the supported SDKs ship.
 */
export function buildVifxDevRuntimeSource(): string {
  return `${VIFX_DEV_RUNTIME_STORE_SOURCE}\n${VIFX_DEV_RUNTIME_HOST_SOURCE}`;
}

/**
 * Makes one transformed project module refreshable: binds the
 * `$RefreshReg$` / `$RefreshSig$` identifiers emitted by `react-refresh/babel`
 * to this module, and registers the module's exports once it has run.
 *
 * The bindings go on the module's first line (no line is added before the
 * code, so the source map keeps its line numbers) and the registration on a
 * new last line. `moduleId` must be the id the bundler uses for the module:
 * its path relative to the bundler's working directory.
 */
export function wrapModuleForFastRefresh(code: string, moduleId: string): string {
  const key = JSON.stringify(moduleId);
  const usesRefresh = code.includes("$RefreshReg$") || code.includes("$RefreshSig$");
  const head = usesRefresh
    ? `var $RefreshReg$=function(t,i){var r=globalThis.${VIFX_REFRESH_GLOBAL};r&&r.register(${key},t,i)},$RefreshSig$=function(){var r=globalThis.${VIFX_REFRESH_GLOBAL};return r?r.signature():function(t){return t}};`
    : "";
  return `${head}${code}\n;globalThis.${VIFX_REFRESH_GLOBAL}&&globalThis.${VIFX_REFRESH_GLOBAL}.evaluated(${key});\n`;
}
