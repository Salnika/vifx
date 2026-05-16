import type { CompatCase } from "./types.ts";

export const compatCases: CompatCase[] = [
  {
    id: "doctor.project-detection.expo-basic",
    title: "Expo projects are detected with package manager metadata",
    category: "doctor.projectDetection",
    fixtureId: "expo-basic",
    operation: {
      kind: "project-info",
    },
    expected: {
      projectType: "expo",
      packageManager: "pnpm",
      expoVersion: "~54.0.0",
      reactNativeVersion: "0.81.0",
    },
    docsPath: "/compat/doctor#project-detection",
  },
  {
    id: "doctor.project-detection.rn-bare-basic",
    title: "React Native bare projects are detected without Expo",
    category: "doctor.projectDetection",
    fixtureId: "rn-bare-basic",
    operation: {
      kind: "project-info",
    },
    expected: {
      projectType: "react-native",
      packageManager: "pnpm",
      expoVersion: null,
      reactNativeVersion: "0.81.0",
    },
    docsPath: "/compat/doctor#project-detection",
  },
  {
    id: "resolver.platform-extensions.ios-file-wins",
    title: "iOS files win over native files",
    category: "resolver.platformExtensions",
    fixtureId: "rn-bare-platform-files",
    operation: {
      kind: "resolve-file",
      from: "src/App.tsx",
      specifier: "./Button",
      platform: "ios",
    },
    expected: {
      relativeFile: "src/Button.ios.tsx",
    },
    docsPath: "/compat/resolver#platform-extensions",
  },
  {
    id: "resolver.platform-extensions.android-file-wins",
    title: "Android files win over native files",
    category: "resolver.platformExtensions",
    fixtureId: "rn-bare-platform-files",
    operation: {
      kind: "resolve-file",
      from: "src/App.tsx",
      specifier: "./Button",
      platform: "android",
    },
    expected: {
      relativeFile: "src/Button.android.tsx",
    },
    docsPath: "/compat/resolver#platform-extensions",
  },
  {
    id: "resolver.platform-extensions.native-fallback",
    title: "Native fallback resolves when a platform override does not exist",
    category: "resolver.platformExtensions",
    fixtureId: "rn-bare-platform-files",
    operation: {
      kind: "resolve-file",
      from: "src/App.tsx",
      specifier: "./Button",
      platform: "native",
    },
    expected: {
      relativeFile: "src/Button.native.tsx",
    },
    docsPath: "/compat/resolver#platform-extensions",
  },
  {
    id: "resolver.platform-extensions.plain-fallback",
    title: "Plain files resolve when no platform variants exist",
    category: "resolver.platformExtensions",
    fixtureId: "rn-bare-platform-files",
    operation: {
      kind: "resolve-file",
      from: "src/App.tsx",
      specifier: "./Plain",
      platform: "ios",
    },
    expected: {
      relativeFile: "src/Plain.tsx",
    },
    docsPath: "/compat/resolver#platform-extensions",
  },
  {
    id: "assets.scale-groups.icon",
    title: "Asset scale groups are discovered from React Native file naming",
    category: "assets.scaleGroups",
    fixtureId: "rn-bare-assets",
    operation: {
      kind: "asset-scales",
      assetPath: "src/assets/icon.png",
    },
    expected: {
      assetPath: "src/assets/icon.png",
      scales: [1, 2, 3],
      files: ["src/assets/icon.png", "src/assets/icon@2x.png", "src/assets/icon@3x.png"],
    },
    docsPath: "/compat/assets#scale-groups",
  },
  {
    id: "bundler.bundle-artifacts.rn-bare-basic-ios",
    title:
      "Vite and Metro expose the same first-pass bundle artifact shape for the RN smoke fixture",
    category: "bundler.bundleArtifacts",
    fixtureId: "rn-bare-basic",
    operation: {
      kind: "bundle-artifacts",
      platform: "ios",
    },
    expected: {
      assetCount: 1,
      assetTypes: ["svg"],
      bundleFile: "index.bundle",
      entry: "index.js",
      platform: "ios",
    },
    docsPath: "/compat/bundler#bundle-artifacts",
  },
  {
    id: "bundler.source-map-validity.rn-bare-basic-ios",
    title: "Vite and Metro both produce valid source maps for the RN smoke fixture",
    category: "bundler.sourceMapValidity",
    fixtureId: "rn-bare-basic",
    operation: {
      kind: "source-map-validity",
      platform: "ios",
    },
    expected: {
      platform: "ios",
      sourceMapPresent: true,
      valid: true,
    },
    docsPath: "/compat/bundler#source-maps",
  },
  {
    id: "monorepo.workspace-resolution.pnpm-root",
    title: "Workspace roots are discovered from pnpm workspaces",
    category: "monorepo.workspaceResolution",
    fixtureId: "monorepo-pnpm-workspaces",
    operation: {
      kind: "workspace-root",
      cwd: "apps/mobile",
    },
    expected: {
      relativeRoot: ".",
      packageManager: "pnpm",
    },
    docsPath: "/compat/monorepo#workspace-resolution",
  },
  {
    id: "monorepo.workspace-resolution.yarn-root",
    title: "Workspace roots are discovered from yarn workspaces",
    category: "monorepo.workspaceResolution",
    fixtureId: "monorepo-yarn-workspaces",
    operation: {
      kind: "workspace-root",
      cwd: "packages/mobile",
    },
    expected: {
      relativeRoot: ".",
      packageManager: "yarn",
    },
    docsPath: "/compat/monorepo#workspace-resolution",
  },
];
