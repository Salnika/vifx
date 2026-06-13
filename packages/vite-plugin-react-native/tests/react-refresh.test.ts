import path from "node:path";
import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import {
  applyReactRefreshTransform,
  type ProjectBabelLike,
  shouldApplyReactRefresh,
  wrapWithRefreshRegistration,
} from "../src/react-refresh.ts";

const PROJECT_ROOT = "/project";
const COMPONENT_ID = path.join(PROJECT_ROOT, "src", "App.tsx");
const NODE_MODULE_ID = path.join(PROJECT_ROOT, "node_modules", "react-native", "index.js");

const COMPONENT_SOURCE = ["export default function App() {", "  return null;", "}"].join("\n");

/**
 * A representative module body as `react-refresh/babel` emits it: a default
 * component export plus the `$RefreshReg$` / `$RefreshSig$` instrumentation.
 */
const REFRESH_BABEL_OUTPUT = [
  "var _s = $RefreshSig$();",
  "function App() {",
  "  _s();",
  "  return null;",
  "}",
  "_s(App, 'deadbeef');",
  "module.exports.default = App;",
  "_c = App;",
  "var _c;",
  '$RefreshReg$(_c, "App");',
].join("\n");

function createStubBabel(returnedCode: string): {
  babel: ProjectBabelLike;
  calls: Array<{ code: string; options: Record<string, unknown> }>;
} {
  const calls: Array<{ code: string; options: Record<string, unknown> }> = [];
  const babel: ProjectBabelLike = {
    presetPath: "/stub/preset.js",
    transformAsync: async (code, options) => {
      calls.push({ code, options });
      return { code: returnedCode, map: { version: 3 } };
    },
  };
  return { babel, calls };
}

test("shouldApplyReactRefresh activates for project component sources in metro dev mode", () => {
  expect(
    shouldApplyReactRefresh({
      options: { mode: "development", moduleFormat: "metro" },
      id: COMPONENT_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(true);

  // mode is optional in the contract; absent mode is still "not production".
  expect(
    shouldApplyReactRefresh({
      options: { moduleFormat: "metro" },
      id: COMPONENT_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(true);
});

test("shouldApplyReactRefresh is a no-op for node_modules files", () => {
  expect(
    shouldApplyReactRefresh({
      options: { mode: "development", moduleFormat: "metro" },
      id: NODE_MODULE_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(false);
});

test("shouldApplyReactRefresh is a no-op for the hoisted module format", () => {
  expect(
    shouldApplyReactRefresh({
      options: { mode: "development", moduleFormat: "hoisted" },
      id: COMPONENT_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(false);

  // Also inert when no module format is requested at all.
  expect(
    shouldApplyReactRefresh({
      options: { mode: "development" },
      id: COMPONENT_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(false);
});

test("shouldApplyReactRefresh is a no-op in production mode", () => {
  expect(
    shouldApplyReactRefresh({
      options: { mode: "production", moduleFormat: "metro" },
      id: COMPONENT_ID,
      projectRoot: PROJECT_ROOT,
    }),
  ).toBe(false);
});

test("applyReactRefreshTransform runs react-refresh/babel as CommonJS through the project babel", async () => {
  const { babel, calls } = createStubBabel(REFRESH_BABEL_OUTPUT);

  const result = await applyReactRefreshTransform({
    code: COMPONENT_SOURCE,
    id: COMPONENT_ID,
    babel,
    projectRoot: PROJECT_ROOT,
  });

  expect(result.code).toBe(REFRESH_BABEL_OUTPUT);
  expect(calls).toHaveLength(1);

  const call = calls.at(0);
  if (!call) {
    throw new Error("expected applyReactRefreshTransform to invoke babel");
  }
  const { options } = call;

  // The real react-refresh/babel plugin is resolved and threaded (not a second
  // bundled babel), with skipEnvCheck so the dev-only env assertion is bypassed.
  const plugins = options.plugins as Array<[string, Record<string, unknown>]>;
  expect(Array.isArray(plugins)).toBe(true);
  expect(plugins).toHaveLength(1);
  const reactRefreshPlugin = plugins.at(0);
  if (!reactRefreshPlugin) {
    throw new Error("expected a react-refresh babel plugin entry");
  }
  expect(reactRefreshPlugin[0]).toContain("react-refresh");
  expect(reactRefreshPlugin[0]).toMatch(/babel/u);
  expect(reactRefreshPlugin[1]).toEqual({ skipEnvCheck: true });

  // The project preset is reused.
  expect(options.presets).toEqual(["/stub/preset.js"]);

  // CommonJS output so the registration wrapper body stays valid.
  const caller = options.caller as Record<string, unknown>;
  expect(caller.supportsStaticESM).toBe(false);
  expect(caller.isHMREnabled).toBe(true);
  expect(caller.bundler).toBe("metro");
});

test("applyReactRefreshTransform surfaces babel failures as VifxError", async () => {
  const babel: ProjectBabelLike = {
    presetPath: "/stub/preset.js",
    transformAsync: async () => {
      throw new Error("boom");
    },
  };

  await expect(
    applyReactRefreshTransform({ code: COMPONENT_SOURCE, id: COMPONENT_ID, babel }),
  ).rejects.toMatchObject({ name: "VifxError", code: "VIFX_INTERNAL_ERROR" });
});

test("wrapWithRefreshRegistration emits Metro-compatible registration glue", () => {
  const moduleId = "src/App.tsx";
  const wrapped = wrapWithRefreshRegistration(REFRESH_BABEL_OUTPUT, moduleId);

  // Reads the Refresh registry RN's setUpReactRefresh installs (prefix + key).
  expect(wrapped).toContain("__METRO_GLOBAL_PREFIX__");
  expect(wrapped).toContain('"__ReactRefresh"');

  // Saves previous globals, installs per-module impls, restores in finally.
  expect(wrapped).toContain("$RefreshReg$");
  expect(wrapped).toContain("$RefreshSig$");
  expect(wrapped).toContain("createSignatureFunctionForTransform");
  expect(wrapped).toContain('register(type, __vifxModuleId + " " + id)');
  expect(wrapped).toContain(JSON.stringify(moduleId));

  // Registers the executed module's exports (and per-key) as refresh families.
  expect(wrapped).toContain('+ " %exports%"');
  expect(wrapped).toContain('+ " %exports% "');

  // The babel-emitted registration calls are carried through verbatim.
  expect(wrapped).toContain('$RefreshReg$(_c, "App")');

  // The restore happens in a finally block.
  expect(wrapped).toMatch(/finally\s*\{/u);
});

test("wrapWithRefreshRegistration output is syntactically valid", () => {
  const wrapped = wrapWithRefreshRegistration(REFRESH_BABEL_OUTPUT, "src/App.tsx");
  // Compiling (without executing) throws on any syntax error.
  expect(() => new vm.Script(wrapped, { filename: "wrapped.js" })).not.toThrow();
});

test("wrapWithRefreshRegistration glue registers against the moduleId and restores globals", () => {
  // A module body that exercises the installed $RefreshReg$/$RefreshSig$.
  const body = [
    "var sig = $RefreshSig$();",
    "function Comp() { return null; }",
    "module.exports.default = Comp;",
    '$RefreshReg$(Comp, "Comp");',
  ].join("\n");
  const wrapped = wrapWithRefreshRegistration(body, "src/Comp.tsx");

  const registered: Array<{ id: unknown }> = [];
  const sentinelReg = () => undefined;
  const sentinelSig = () => undefined;

  const sandbox: Record<string, unknown> = {
    globalThis: undefined,
    Object,
  };
  sandbox.globalThis = sandbox;
  sandbox.__METRO_GLOBAL_PREFIX__ = "";
  sandbox.$RefreshReg$ = sentinelReg;
  sandbox.$RefreshSig$ = sentinelSig;
  sandbox.__ReactRefresh = {
    register: (_type: unknown, id: unknown) => {
      registered.push({ id });
    },
    createSignatureFunctionForTransform: () => () => undefined,
  };

  vm.runInNewContext(wrapped, sandbox, { filename: "wrapped-run.js" });

  // The component registered against `moduleId + " " + localName`.
  expect(registered.some((entry) => entry.id === "src/Comp.tsx Comp")).toBe(true);
  // Exports were registered too.
  expect(registered.some((entry) => entry.id === "src/Comp.tsx %exports%")).toBe(true);

  // Globals were restored to the previous sentinels after the body ran.
  expect(sandbox.$RefreshReg$).toBe(sentinelReg);
  expect(sandbox.$RefreshSig$).toBe(sentinelSig);
});

test("wrapWithRefreshRegistration is a no-op wrapper when no Refresh registry is present", () => {
  let ran = false;
  const body = "module.exports.value = (globalThis.__vifxRan = true);";
  const wrapped = wrapWithRefreshRegistration(body, "src/Plain.tsx");

  const sandbox: Record<string, unknown> = { Object };
  sandbox.globalThis = sandbox;
  // No __ReactRefresh, no $RefreshReg$/$RefreshSig$ globals defined.
  Object.defineProperty(sandbox, "__vifxRan", {
    configurable: true,
    get: () => ran,
    set: (value: boolean) => {
      ran = value;
    },
  });

  expect(() => vm.runInNewContext(wrapped, sandbox, { filename: "plain-run.js" })).not.toThrow();
  // Body still executed even with no registry available.
  expect(ran).toBe(true);
});
