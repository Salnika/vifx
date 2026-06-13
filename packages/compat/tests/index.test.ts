import { expect, test } from "vite-plus/test";
import {
  compatCases,
  evaluateCompatCase,
  getFixtureManifest,
  getFixtureManifests,
  resolveFixturePath,
} from "../src/index.ts";

test("fixture manifests expose the compatibility fixtures", () => {
  expect(getFixtureManifests()).toHaveLength(20);
  expect(getFixtureManifest("expo-basic").projectType).toBe("expo");
  expect(getFixtureManifest("expo-router-basic").features).toContain("expo-router");
  expect(resolveFixturePath("expo-basic")).toContain("fixtures/expo-basic");
  expect(resolveFixturePath("lib-react-native-reanimated")).toContain(
    "fixtures/libs/react-native-reanimated",
  );
});

test("compat cases cover the NEXT minimum categories", () => {
  const categories = [...new Set(compatCases.map((compatCase) => compatCase.category))];

  expect(categories).toEqual([
    "doctor.projectDetection",
    "resolver.platformExtensions",
    "resolver.packageMainFields",
    "resolver.packageExports",
    "assets.scaleGroups",
    "assets.metadata",
    "bundler.bundleArtifacts",
    "bundler.sourceMapValidity",
    "monorepo.workspaceResolution",
    "libraries",
  ]);
});

test("the libraries category covers the top synthetic library fixtures", () => {
  const libraryCases = compatCases.filter((compatCase) => compatCase.category === "libraries");

  expect(libraryCases).toHaveLength(12);
  for (const libraryCase of libraryCases) {
    expect(libraryCase.operation.kind).toBe("library-build");
    // Every library case must carry a per-toolchain status snapshot.
    expect(libraryCase.expected).toHaveProperty("toolchains.vifx.status");
    expect(libraryCase.expected).toHaveProperty("toolchains.metro.status");
  }
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
