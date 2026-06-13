import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import {
  MODULE_REGISTRY_PRELUDE,
  buildModuleRegistryPrelude,
} from "../src/module-registry/runtime.ts";

/**
 * Fast Refresh runtime tests. The HMR engine ({@link buildModuleRegistryPrelude}
 * with `hmr: true`) is evaluated the way Hermes runs it — as a plain script in a
 * `vm` context — against a fake `react-refresh/runtime` exposed at
 * `global.__ReactRefresh` (the name RN's setUpReactRefresh installs). Hot updates
 * are delivered exactly as a delta would: an `__d(factory, id, [], undefined,
 * inverseDeps)` re-definition, which `__d` routes to `global.__accept`.
 */

interface FakeRefresh {
  performFullRefreshReasons: string[];
  performReactRefreshCount: number;
  registrations: Array<{ id: string }>;
}

interface HmrHarness {
  context: vm.Context;
  flushTimers: () => void;
  log: string[];
  refresh: FakeRefresh;
  /** Delivers an `__d(...)` re-definition delta into the running bundle. */
  update: (code: string) => void;
}

function createFakeRefresh(state: FakeRefresh) {
  // Component-ness is opted into with a `__isComponent` marker so the synthetic
  // factories can declare boundaries explicitly. Families are keyed by the
  // registration id so re-registering the same export id keeps a stable family
  // (mirroring react-refresh, where a stable signature avoids invalidation).
  const familyByType = new Map<unknown, string>();
  return {
    createSignatureFunctionForTransform() {
      return () => {};
    },
    getFamilyByType(type: unknown) {
      return familyByType.get(type);
    },
    isLikelyComponentType(value: unknown) {
      return (
        typeof value === "function" && (value as { __isComponent?: boolean }).__isComponent === true
      );
    },
    performFullRefresh(reason: string) {
      state.performFullRefreshReasons.push(reason);
    },
    performReactRefresh() {
      state.performReactRefreshCount += 1;
    },
    register(type: unknown, id: string) {
      state.registrations.push({ id });
      familyByType.set(type, id);
    },
  };
}

function startHmrBundle(modules: string[], entryId: number): HmrHarness {
  const log: string[] = [];
  const refresh: FakeRefresh = {
    performFullRefreshReasons: [],
    performReactRefreshCount: 0,
    registrations: [],
  };
  const pendingTimers: Array<() => void> = [];
  const context = vm.createContext({
    __ReactRefresh: createFakeRefresh(refresh),
    __log: log,
    clearTimeout: () => {},
    console,
    setTimeout: (callback: () => void) => {
      pendingTimers.push(callback);
      return pendingTimers.length;
    },
  });

  const bundle = [
    buildModuleRegistryPrelude({ hmr: true }),
    ...modules,
    `__r(${entryId});`,
    "",
  ].join("\n");
  new vm.Script(bundle, { filename: "index.bundle" }).runInContext(context, { timeout: 10_000 });

  return {
    context,
    flushTimers: () => {
      while (pendingTimers.length > 0) {
        const next = pendingTimers.shift();
        next?.();
      }
    },
    log,
    refresh,
    update: (code) => {
      new vm.Script(code, { filename: "hmr-update.js" }).runInContext(context, { timeout: 10_000 });
    },
  };
}

function moduleFactory(id: number, body: string, dependencyIds: number[] = []): string {
  return [
    "__d(function (global, require, importDefault, importAll, module, exports, dependencyMap) {",
    body,
    `}, ${id}, ${JSON.stringify(dependencyIds)});`,
  ].join("\n");
}

function updateDelta(
  id: number,
  body: string,
  inverseDependencies: Record<string, number[]>,
): string {
  return [
    "__d(function (global, require, importDefault, importAll, module, exports, dependencyMap) {",
    body,
    `}, ${id}, [], undefined, ${JSON.stringify(inverseDependencies)});`,
  ].join("\n");
}

test("hmr runtime re-runs a self-accepting module on __accept", () => {
  const harness = startHmrBundle(
    [moduleFactory(0, '  global.__log.push("v1");\n  module.hot.accept();')],
    0,
  );
  expect(harness.log).toEqual(["v1"]);

  harness.update(updateDelta(0, '  global.__log.push("v2");\n  module.hot.accept();', { "0": [] }));

  // The updated factory re-ran (state preserved at the module level).
  expect(harness.log).toEqual(["v1", "v2"]);
  // A self-accepting non-component boundary does not trigger a full refresh.
  expect(harness.refresh.performFullRefreshReasons).toEqual([]);
});

test("hmr runtime treats a component-only module as a React Refresh boundary", () => {
  const harness = startHmrBundle(
    [
      moduleFactory(
        0,
        [
          "  function Screen() {}",
          "  Screen.__isComponent = true;",
          '  global.__log.push("v1");',
          "  module.exports = Screen;",
        ].join("\n"),
      ),
    ],
    0,
  );
  // Exports were registered with React Refresh during initial evaluation.
  expect(harness.refresh.registrations.length).toBeGreaterThan(0);

  harness.update(
    updateDelta(
      0,
      [
        "  function Screen() {}",
        "  Screen.__isComponent = true;",
        '  global.__log.push("v2");',
        "  module.exports = Screen;",
      ].join("\n"),
      { "0": [] },
    ),
  );
  harness.flushTimers();

  expect(harness.log).toEqual(["v1", "v2"]);
  // The boundary accepted locally: a React Refresh was performed, no full reload.
  expect(harness.refresh.performReactRefreshCount).toBe(1);
  expect(harness.refresh.performFullRefreshReasons).toEqual([]);
});

test("hmr runtime falls back to a full refresh when no boundary accepts", () => {
  const harness = startHmrBundle(
    [moduleFactory(0, '  global.__log.push("v1");\n  module.exports = { value: 1 };')],
    0,
  );

  harness.update(
    updateDelta(0, '  global.__log.push("v2");\n  module.exports = { value: 2 };', { "0": [] }),
  );
  harness.flushTimers();

  // A non-component root module with no accepting parent cannot hot reload.
  expect(harness.refresh.performReactRefreshCount).toBe(0);
  expect(harness.refresh.performFullRefreshReasons).toEqual(["Fast Refresh - No root boundary"]);
});

test("hmr runtime bubbles an update to an accepting parent boundary", () => {
  // Child (1) exports a plain value (not a boundary); parent (0) imports it and
  // is a component boundary. Updating the child must bubble to the parent.
  const harness = startHmrBundle(
    [
      moduleFactory(
        0,
        [
          "  var value = require(1);",
          "  function Screen() {}",
          "  Screen.__isComponent = true;",
          "  Screen.value = value;",
          "  module.exports = Screen;",
        ].join("\n"),
        [1],
      ),
      moduleFactory(1, '  global.__log.push("child-v1");\n  module.exports = 1;'),
    ],
    0,
  );

  harness.update(
    updateDelta(1, '  global.__log.push("child-v2");\n  module.exports = 2;', {
      "0": [],
      "1": [0],
    }),
  );
  harness.flushTimers();

  expect(harness.log).toEqual(["child-v1", "child-v2"]);
  // The parent boundary re-ran and a React Refresh was performed.
  expect(harness.refresh.performReactRefreshCount).toBe(1);
  expect(harness.refresh.performFullRefreshReasons).toEqual([]);
});

test("the Fast Refresh engine is only present in hmr-mode preludes", () => {
  const production = buildModuleRegistryPrelude();
  const development = buildModuleRegistryPrelude({ hmr: true });

  expect(MODULE_REGISTRY_PRELUDE).toBe(production);
  expect(production).not.toContain("__accept");
  expect(production).not.toContain("createHotReloadingObject");
  expect(development).toContain("global.__accept = metroHotUpdateModule");
  expect(development).toContain("createHotReloadingObject");
});
