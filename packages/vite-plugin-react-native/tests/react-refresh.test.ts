import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  applyReactRefreshTransform,
  type ProjectBabelLike,
  shouldApplyReactRefresh,
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

// React Refresh registration now happens in the metro registry runtime, not by
// wrapping the module body — see module-registry-hmr.test.ts for the runtime's
// $RefreshReg$ install + registerExportsForReactRefresh coverage.
