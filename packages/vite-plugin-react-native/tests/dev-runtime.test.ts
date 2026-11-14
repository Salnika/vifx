import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import vm from "node:vm";
import { dev } from "@voidzero-dev/vite-plus-core/rolldown/experimental";
import { DevRuntime } from "@voidzero-dev/vite-plus-core/rolldown/experimental/runtime";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  buildVifxDevRuntimeSource,
  VIFX_DEV_RUNTIME_GLOBAL,
  wrapModuleForFastRefresh,
} from "../src/dev-runtime.ts";

const requireFromHere = createRequire(import.meta.url);

interface RefreshLog {
  fullRefreshes: string[];
  reactRefreshes: number;
}

/** A sandbox shaped like the app: globals, and `Refresh` as RN's setUpReactRefresh builds it. */
function createAppSandbox(): { context: vm.Context; log: RefreshLog; rendered: unknown[] } {
  const log: RefreshLog = { fullRefreshes: [], reactRefreshes: 0 };
  const rendered: unknown[] = [];
  const context = vm.createContext({
    __log: log,
    __render(value: unknown) {
      rendered.push(value);
    },
    console,
    process: { env: { NODE_ENV: "development" } },
    setTimeout,
  });
  // The real React Refresh runtime, evaluated inside the sandbox: it compares
  // prototypes against `Object.prototype`, so it must share the app's realm.
  const refreshRuntimeSource = readFileSync(
    path.join(
      path.dirname(requireFromHere.resolve("react-refresh/runtime")),
      "cjs/react-refresh-runtime.development.js",
    ),
    "utf8",
  );
  vm.runInContext(
    `var __refreshModule = { exports: {} };
(function (exports, module) {
${refreshRuntimeSource}
})(__refreshModule.exports, __refreshModule);
(function (Runtime) {
  globalThis.__ReactRefresh = {
    createSignatureFunctionForTransform: Runtime.createSignatureFunctionForTransform,
    getFamilyByType: Runtime.getFamilyByType,
    isLikelyComponentType: Runtime.isLikelyComponentType,
    performFullRefresh: function (reason) { __log.fullRefreshes.push(reason); },
    performReactRefresh: function () { __log.reactRefreshes += 1; Runtime.performReactRefresh(); },
    register: Runtime.register,
  };
})(__refreshModule.exports);`,
    context,
  );
  return { context, log, rendered };
}

describe("dev engine runtime", () => {
  test("it has every member of Rolldown's DevRuntime", () => {
    const { context } = createAppSandbox();
    vm.runInContext(buildVifxDevRuntimeSource(), context);
    const ported = (context as { __rolldown_runtime__: Record<string, unknown> })
      .__rolldown_runtime__;
    const original = new DevRuntime("contract") as unknown as Record<string, unknown>;

    const expectedMembers = [
      ...Object.getOwnPropertyNames(DevRuntime.prototype).filter((name) => name !== "constructor"),
      ...Object.keys(original),
    ];
    const missing = expectedMembers.filter((name) => !(name in ported));

    // A Rolldown upgrade that adds a member lands here: port it to
    // src/dev-runtime.ts before trusting the dev engine again.
    expect(missing).toStrictEqual([]);
    for (const name of Object.getOwnPropertyNames(DevRuntime.prototype)) {
      if (name !== "constructor") {
        expect(typeof ported[name], name).toBe("function");
      }
    }
  });

  test("the runtime source is plain ES5: no class, no arrow function, no let/const", () => {
    const source = buildVifxDevRuntimeSource();

    expect(source).not.toMatch(/\bclass\s/u);
    expect(source).not.toMatch(/=>/u);
    expect(source).not.toMatch(/^\s*(let|const)\s/mu);
  });

  test("wrapping keeps the module's line numbers and binds registrations to its id", () => {
    const wrapped = wrapModuleForFastRefresh(
      'import x from "x";\n$RefreshReg$(A, "A");',
      "src/A.tsx",
    );
    const lines = wrapped.split("\n");

    expect(lines[0]?.endsWith('import x from "x";')).toBe(true);
    expect(lines[0]).toContain('r.register("src/A.tsx",t,i)');
    expect(lines[1]).toBe('$RefreshReg$(A, "A");');
    expect(lines[2]).toContain('.evaluated("src/A.tsx")');
    // A module without registrations only reports that it ran.
    expect(wrapModuleForFastRefresh("export const a = 1;", "a.ts").startsWith("export")).toBe(true);
  });
});

describe("dev engine runtime applies real Rolldown patches", () => {
  let workDir: string | null = null;
  let engine: Awaited<ReturnType<typeof dev>> | null = null;

  afterEach(async () => {
    await engine?.close();
    engine = null;
    if (workDir) {
      await rm(workDir, { force: true, recursive: true });
      workDir = null;
    }
  });

  test("a helper edit re-runs up to the component boundary; a lost boundary reloads", async () => {
    workDir = await realpath(await mkdtemp(path.join(tmpdir(), "vifx-dev-runtime-")));
    const write = (name: string, code: string) =>
      writeFile(path.join(workDir as string, name), code, "utf8");
    await write("entry.js", 'import App from "./App.js";\nglobalThis.__render(App);\n');
    await write(
      "App.js",
      [
        'import { label } from "./label.js";',
        'export default function App() { return "app:" + label(); }',
        '$RefreshReg$(App, "App");',
        "",
      ].join("\n"),
    );
    await write("label.js", 'export function label() { return "one"; }\n');

    let initialCode: string | null = null;
    let onPatch:
      | ((patch: { changedIds: string[]; code: string; filename: string }) => void)
      | null = null;
    const root = workDir;
    engine = await dev(
      {
        cwd: root,
        experimental: {
          devMode: { implement: buildVifxDevRuntimeSource(), skipCommonRuntimeInjection: true },
        },
        input: path.join(root, "entry.js"),
        optimization: { inlineConst: false },
        plugins: [
          {
            name: "test:fast-refresh",
            transform(code, id) {
              return id.startsWith(root) && !id.endsWith("entry.js")
                ? wrapModuleForFastRefresh(code, path.relative(root, id))
                : null;
            },
          },
        ],
      },
      { dir: path.join(root, "out"), format: "es" },
      {
        onHmrUpdates(result) {
          if (result instanceof Error) {
            throw result;
          }
          for (const { update } of result.updates) {
            if (update.type === "Patch") {
              onPatch?.(update);
            }
          }
        },
        onOutput(result) {
          if (!(result instanceof Error)) {
            const entry = result.output.find((item) => item.type === "chunk" && item.isEntry);
            initialCode ??= entry && entry.type === "chunk" ? entry.code : null;
          }
        },
        rebuildStrategy: "never",
        watch: { skipWrite: true },
      },
    );
    await engine.run();
    await engine.ensureCurrentBuildFinish();
    for (let attempt = 0; attempt < 500 && initialCode === null; attempt += 1) {
      await sleep(10);
    }
    expect(initialCode).not.toBeNull();

    const { context, log, rendered } = createAppSandbox();
    vm.runInContext(initialCode as unknown as string, context);
    const app = (
      context as Record<
        string,
        { applyPatch: (patch: unknown) => boolean; clientId: string } | undefined
      >
    )[VIFX_DEV_RUNTIME_GLOBAL];
    const runtime = (
      context as {
        __rolldown_runtime__: { loadExports: (id: string) => { default: () => string } };
      }
    ).__rolldown_runtime__;
    expect(app).toBeDefined();
    expect((rendered[0] as () => string)()).toBe("app:one");
    await engine.registerClient(app!.clientId);

    const nextPatch = () =>
      new Promise<{ changedIds: string[]; code: string; filename: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no patch within 15 s")), 15_000);
        onPatch = (patch) => {
          clearTimeout(timer);
          resolve(patch);
        };
      });

    // 1. Edit a helper: not a boundary, so its importer (a component) re-runs
    //    and React Refresh is asked to swap the component in place.
    let pending = nextPatch();
    await write("label.js", 'export function label() { return "two"; }\n');
    let patch = await pending;
    expect(patch.changedIds).toStrictEqual(["label.js"]);
    expect({ applied: app!.applyPatch(patch), reloads: log.fullRefreshes }).toStrictEqual({
      applied: true,
      reloads: [],
    });
    await engine.notifyPayloadDelivered(patch.filename);
    expect(runtime.loadExports("App.js").default()).toBe("app:two");
    await sleep(80);
    expect(log.reactRefreshes).toBe(1);
    expect(log.fullRefreshes).toStrictEqual([]);

    // 2. Edit the component itself: it is its own boundary.
    pending = nextPatch();
    await write(
      "App.js",
      [
        'import { label } from "./label.js";',
        'export default function App() { return "APP:" + label(); }',
        '$RefreshReg$(App, "App");',
        "",
      ].join("\n"),
    );
    patch = await pending;
    expect(app!.applyPatch(patch)).toBe(true);
    await engine.notifyPayloadDelivered(patch.filename);
    expect(runtime.loadExports("App.js").default()).toBe("APP:two");
    await sleep(80);
    expect(log.reactRefreshes).toBe(2);

    // 3. The component module starts exporting a non-component: it is no
    //    longer a boundary and its only importer is the entry -> full reload.
    pending = nextPatch();
    await write(
      "App.js",
      [
        'import { label } from "./label.js";',
        'export default function App() { return "APP:" + label(); }',
        "export const settings = { title: label() };",
        '$RefreshReg$(App, "App");',
        "",
      ].join("\n"),
    );
    patch = await pending;
    expect(app!.applyPatch(patch)).toBe(false);
    expect(log.fullRefreshes).toHaveLength(1);
    expect(log.fullRefreshes[0]).toContain("Fast Refresh - ");
  }, 60_000);
});
