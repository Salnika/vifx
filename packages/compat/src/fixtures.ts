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
    id: "expo-export-basic",
    title: "Expo Export Basic",
    relativePath: "fixtures/expo-export-basic",
    projectType: "expo",
    packageManager: "pnpm",
    features: ["expo-export", "inspection-fixture"],
  },
  {
    id: "expo-router-basic",
    title: "Expo Router Basic",
    relativePath: "fixtures/expo-router-basic",
    projectType: "expo",
    packageManager: "pnpm",
    features: ["expo-project", "expo-router", "browser-preview-target"],
  },
  {
    id: "expo-sdk55-basic",
    title: "Expo SDK 55 Basic",
    relativePath: "fixtures/expo-sdk55-basic",
    projectType: "expo",
    packageManager: "pnpm",
    features: ["expo-project", "sdk-matrix", "new-architecture"],
    notes: [
      "Expo SDK 55 (React Native 0.83, New Architecture only).",
      "Experimental support tier: static analysis and fixtures only, not device-validated.",
    ],
  },
  {
    id: "expo-sdk56-basic",
    title: "Expo SDK 56 Basic",
    relativePath: "fixtures/expo-sdk56-basic",
    projectType: "expo",
    packageManager: "pnpm",
    features: ["expo-project", "sdk-matrix", "hermes-v1"],
    notes: [
      "Expo SDK 56 (React Native 0.84, Hermes V1 default engine).",
      "Experimental support tier: static analysis and fixtures only, not device-validated.",
    ],
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
  {
    id: "lib-react-native-reanimated",
    title: "Library: react-native-reanimated",
    relativePath: "fixtures/libs/react-native-reanimated",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["library-fixture", "synthetic-package", "worklet-directives", "ts-source-entry"],
    notes: [
      "Synthetic replica of react-native-builder-bob packaging with a react-native field pointing at TypeScript sources.",
    ],
  },
  {
    id: "lib-react-native-gesture-handler",
    title: "Library: react-native-gesture-handler",
    relativePath: "fixtures/libs/react-native-gesture-handler",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "exports-map",
      "native-module",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica with an exports map and a react-native condition pointing at TypeScript sources that reach into a native module.",
    ],
  },
  {
    id: "lib-react-native-screens",
    title: "Library: react-native-screens",
    relativePath: "fixtures/libs/react-native-screens",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "native-component",
      "jsx-source",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica registering a native host component (RNSScreen) from a TSX react-native entry.",
    ],
  },
  {
    id: "lib-react-native-safe-area-context",
    title: "Library: react-native-safe-area-context",
    relativePath: "fixtures/libs/react-native-safe-area-context",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["library-fixture", "synthetic-package", "pure-js", "jsx-source", "ts-source-entry"],
    notes: [
      "Synthetic replica modelling the pure-JS insets surface (no native module access on the resolved entry).",
    ],
  },
  {
    id: "lib-react-native-svg",
    title: "Library: react-native-svg",
    relativePath: "fixtures/libs/react-native-svg",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "native-component",
      "jsx-source",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica registering native host components (RNSVGSvgView, RNSVGPath) from a TSX react-native entry.",
    ],
  },
  {
    id: "lib-expo-image",
    title: "Library: expo-image",
    relativePath: "fixtures/libs/expo-image",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "expo-module",
      "exports-map",
      "native-component",
    ],
    notes: [
      "Synthetic Expo module shipping precompiled build/ output that renders a native view via a vendored expo-modules-core.",
    ],
  },
  {
    id: "lib-flash-list",
    title: "Library: @shopify/flash-list",
    relativePath: "fixtures/libs/flash-list",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "scoped-package",
      "native-component",
      "transitive-dep",
    ],
    notes: [
      "Synthetic scoped package building on a vendored recyclerlistview and rendering a native AutoLayoutView.",
    ],
  },
  {
    id: "lib-expo-sqlite",
    title: "Library: expo-sqlite",
    relativePath: "fixtures/libs/expo-sqlite",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "expo-module",
      "native-module",
      "exports-map",
    ],
    notes: [
      "Synthetic Expo module opening a database through the ExpoSQLite native module via a vendored expo-modules-core.",
    ],
  },
  {
    id: "lib-react-native-vector-icons",
    title: "Library: react-native-vector-icons",
    relativePath: "fixtures/libs/react-native-vector-icons",
    projectType: "react-native",
    packageManager: "pnpm",
    features: ["library-fixture", "synthetic-package", "jsx-in-published-js", "babel-required"],
    notes: [
      "Synthetic replica shipping untranspiled JSX inside published .js files, the classic Metro-flavored publishing quirk.",
    ],
  },
  {
    id: "lib-lottie-react-native",
    title: "Library: lottie-react-native",
    relativePath: "fixtures/libs/lottie-react-native",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "native-component",
      "jsx-source",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica rendering a native animation view (LottieAnimationView) from a TSX react-native entry.",
    ],
  },
  {
    id: "lib-nativewind",
    title: "Library: nativewind",
    relativePath: "fixtures/libs/nativewind",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "css-import",
      "babel-required",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica whose consumer imports a Tailwind CSS entry; the real toolchain pairs it with a Babel preset and PostCSS pipeline.",
    ],
  },
  {
    id: "lib-react-native-webview",
    title: "Library: react-native-webview",
    relativePath: "fixtures/libs/react-native-webview",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "native-component",
      "jsx-source",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica rendering a native RNCWebView host component from a TSX react-native entry.",
    ],
  },
  {
    id: "lib-react-native-mmkv",
    title: "Library: react-native-mmkv",
    relativePath: "fixtures/libs/react-native-mmkv",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "exports-map",
      "native-module",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica whose MMKV storage constructor reaches into a JSI-installed native module via the React Native default export.",
    ],
  },
  {
    id: "lib-async-storage",
    title: "Library: @react-native-async-storage/async-storage",
    relativePath: "fixtures/libs/async-storage",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "scoped-package",
      "native-module",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic scoped package whose default export proxies a native storage module (RNCAsyncStorage) from a TS react-native entry.",
    ],
  },
  {
    id: "lib-react-native-maps",
    title: "Library: react-native-maps",
    relativePath: "fixtures/libs/react-native-maps",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "native-component",
      "jsx-source",
      "ts-source-entry",
    ],
    notes: [
      "Synthetic replica registering native host components (AIRMap, AIRMapMarker) from a TSX react-native entry.",
    ],
  },
  {
    id: "lib-expo-camera",
    title: "Library: expo-camera",
    relativePath: "fixtures/libs/expo-camera",
    projectType: "react-native",
    packageManager: "pnpm",
    features: [
      "library-fixture",
      "synthetic-package",
      "expo-module",
      "native-component",
      "native-module",
      "exports-map",
    ],
    notes: [
      "Synthetic Expo module rendering a native camera view and querying a native module via a vendored expo-modules-core.",
    ],
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
  const manifest = getFixtureManifest(fixtureId);
  return fileURLToPath(new URL(`../../../${manifest.relativePath}/`, metaUrl));
}
