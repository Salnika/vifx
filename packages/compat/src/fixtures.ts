import { fileURLToPath } from "node:url";
import type { FixtureId, FixtureManifest } from "./types.ts";

const FIXTURE_MANIFESTS: FixtureManifest[] = [
  {
    id: "expo-basic",
    title: "Expo Basic",
    relativePath: "fixtures/expo-basic",
    projectType: "expo",
    packageManager: "pnpm",
    features: ["expo-project", "metro-config", "migration-target"],
  },
  {
    id: "rn-bare-basic",
    title: "React Native Bare Basic",
    relativePath: "fixtures/rn-bare-basic",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["react-native-project", "metro-config", "migration-target"],
  },
  {
    id: "rn-bare-platform-files",
    title: "React Native Platform Files",
    relativePath: "fixtures/rn-bare-platform-files",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["platform-files", "resolver-fixture"],
  },
  {
    id: "rn-bare-assets",
    title: "React Native Asset Scales",
    relativePath: "fixtures/rn-bare-assets",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["asset-scales", "assets-fixture"],
  },
  {
    id: "monorepo-pnpm-workspaces",
    title: "PNPM Workspace Monorepo",
    relativePath: "fixtures/monorepo-pnpm-workspaces",
    projectType: "monorepo",
    packageManager: "pnpm",
    primaryPackagePath: "apps/mobile",
    features: ["monorepo", "pnpm-workspaces", "expo-project"],
  },
  {
    id: "monorepo-yarn-workspaces",
    title: "Yarn Workspace Monorepo",
    relativePath: "fixtures/monorepo-yarn-workspaces",
    projectType: "monorepo",
    packageManager: "yarn",
    primaryPackagePath: "packages/mobile",
    features: ["monorepo", "yarn-workspaces", "react-native-project"],
  },
];

const FIXTURE_MANIFEST_MAP = new Map(FIXTURE_MANIFESTS.map((fixture) => [fixture.id, fixture]));

export function getFixtureManifests() {
  return FIXTURE_MANIFESTS;
}

export function getFixtureManifest(fixtureId: FixtureId) {
  const manifest = FIXTURE_MANIFEST_MAP.get(fixtureId);
  if (!manifest) {
    throw new Error(`Unknown fixture id: ${fixtureId}`);
  }

  return manifest;
}

export function resolveRepoRoot(metaUrl = import.meta.url) {
  return fileURLToPath(new URL("../../../", metaUrl));
}

export function resolveFixturePath(fixtureId: FixtureId, metaUrl = import.meta.url) {
  return fileURLToPath(new URL(`../../../fixtures/${fixtureId}/`, metaUrl));
}
