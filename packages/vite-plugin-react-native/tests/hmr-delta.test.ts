import { expect, test } from "vite-plus/test";
import { computeHmrUpdate } from "../src/module-registry/hmr-delta.ts";
import { assignModuleIds } from "../src/module-registry/ordering.ts";
import type { SerializedModule } from "../src/module-registry/serializer.ts";

function mod(
  id: number,
  fileName: string,
  factory: string,
  dependencyIds: number[] = [],
): SerializedModule {
  return { dependencyIds, factory, fileName, id };
}

test("assignModuleIds numbers sorted file names from zero without a prior map", () => {
  const ids = assignModuleIds(["src/b.js", "src/a.js"]);
  expect(ids.get("src/a.js")).toBe(0);
  expect(ids.get("src/b.js")).toBe(1);
});

test("assignModuleIds keeps known ids stable when a new file sorts ahead of them", () => {
  const previous = assignModuleIds(["src/b.js", "src/a.js"]);
  const next = assignModuleIds(["src/a.js", "src/b.js", "src/aa.js"], previous);
  // Existing ids must not shift even though "aa.js" sorts before "b.js".
  expect(next.get("src/a.js")).toBe(0);
  expect(next.get("src/b.js")).toBe(1);
  expect(next.get("src/aa.js")).toBe(2);
});

test("assignModuleIds reserves a removed file's id so it is never reused", () => {
  const previous = assignModuleIds(["src/a.js", "src/b.js"]);
  const next = assignModuleIds(["src/b.js", "src/new.js"], previous);
  expect(next.get("src/b.js")).toBe(1);
  // "a.js" (id 0) is gone but its id stays reserved, so "new.js" gets 2, not 0.
  expect(next.get("src/new.js")).toBe(2);
});

test("computeHmrUpdate reports a modified module as an __d delta with inverse deps", () => {
  const previous = [mod(0, "App.js", "FA", [1]), mod(1, "Button.js", "FB_v1")];
  const next = [mod(0, "App.js", "FA", [1]), mod(1, "Button.js", "FB_v2")];

  const update = computeHmrUpdate({ next, previous, revisionId: "rev-1" });

  expect(update.added).toEqual([]);
  expect(update.deleted).toEqual([]);
  expect(update.modified.map((entry) => entry.module[0])).toEqual([1]);

  const code = update.modified[0]?.module[1] ?? "";
  expect(code.startsWith("__d(FB_v2, 1,")).toBe(true);
  // Button's importer (App, id 0) is in the inverse closure so the update can
  // bubble up to the App boundary.
  expect(code).toContain('"1":[0]');
});

test("computeHmrUpdate reports added and deleted modules and skips unchanged ones", () => {
  const previous = [mod(0, "App.js", "FA"), mod(1, "Old.js", "FOLD")];
  const next = [mod(0, "App.js", "FA"), mod(2, "New.js", "FNEW")];

  const update = computeHmrUpdate({ next, previous, revisionId: "rev-2" });

  expect(update.added.map((entry) => entry.module[0])).toEqual([2]);
  expect(update.deleted).toEqual([1]);
  // App.js is byte-identical across builds, so it is not re-sent.
  expect(update.modified).toEqual([]);
  expect(update.revisionId).toBe("rev-2");
});

test("computeHmrUpdate resolves embedded source urls", () => {
  const previous = [mod(0, "App.js", "FA_v1")];
  const next = [mod(0, "App.js", "FA_v2")];

  const update = computeHmrUpdate({
    next,
    previous,
    revisionId: "rev-3",
    sourceUrlFor: (module) => ({
      sourceMappingURL: `http://host/${module.fileName}.map`,
      sourceURL: `http://host/${module.fileName}`,
    }),
  });

  expect(update.modified[0]?.sourceURL).toBe("http://host/App.js");
  expect(update.modified[0]?.sourceMappingURL).toBe("http://host/App.js.map");
});
