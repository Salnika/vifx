import { expect, test } from "vite-plus/test";
import {
  compatCases,
  evaluateCompatCase,
  getFixtureManifest,
  getFixtureManifests,
  resolveFixturePath,
} from "../src/index.ts";

test("fixture manifests expose the first-pass fixtures", () => {
  expect(getFixtureManifests()).toHaveLength(6);
  expect(getFixtureManifest("expo-basic").projectType).toBe("expo");
  expect(resolveFixturePath("expo-basic")).toContain("fixtures/expo-basic");
});

test("compat cases cover doctor, resolver, assets, and monorepo categories", () => {
  const categories = [...new Set(compatCases.map((compatCase) => compatCase.category))];

  expect(categories).toEqual([
    "doctor.projectDetection",
    "resolver.platformExtensions",
    "assets.scaleGroups",
    "monorepo.workspaceResolution",
  ]);
});

test("compat assertions preserve expected and actual values in failures", () => {
  const compatCase = compatCases.find(
    (candidate) => candidate.id === "resolver.platform-extensions.ios-file-wins",
  );

  expect(compatCase).toBeDefined();

  const outcome = evaluateCompatCase(compatCase!, {
    relativeFile: "src/Button.native.tsx",
  });

  expect(outcome.passed).toBe(false);
  expect(outcome.message).toContain("Expected");
});
