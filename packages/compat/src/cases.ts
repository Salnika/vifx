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
    id: "doctor.project-detection.expo-router-basic",
    title: "Expo Router projects are detected as Expo projects",
    category: "doctor.projectDetection",
    fixtureId: "expo-router-basic",
    operation: {
      kind: "project-info",
    },
    expected: {
      projectType: "expo",
      packageManager: "pnpm",
      expoVersion: "^54.0.0",
      reactNativeVersion: "^0.82.0",
    },
    docsPath: "/compat/doctor#project-detection",
  },
  {
    id: "doctor.project-detection.expo-sdk55-basic",
    title: "Expo SDK 55 projects are detected on the experimental support tier",
    category: "doctor.projectDetection",
    fixtureId: "expo-sdk55-basic",
    operation: {
      kind: "project-info",
    },
    expected: {
      projectType: "expo",
      packageManager: "pnpm",
      expoVersion: "~55.0.0",
      reactNativeVersion: "0.83.0",
    },
    docsPath: "/compat/doctor#project-detection",
    notes: [
      "Expo SDK 55 support is experimental: static analysis and fixtures only, not device-validated.",
    ],
  },
  {
    id: "doctor.project-detection.expo-sdk56-basic",
    title: "Expo SDK 56 projects are detected on the experimental support tier",
    category: "doctor.projectDetection",
    fixtureId: "expo-sdk56-basic",
    operation: {
      kind: "project-info",
    },
    expected: {
      projectType: "expo",
      packageManager: "pnpm",
      expoVersion: "~56.0.0",
      reactNativeVersion: "0.84.0",
    },
    docsPath: "/compat/doctor#project-detection",
    notes: [
      "Expo SDK 56 support is experimental: static analysis and fixtures only, not device-validated.",
    ],
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
    id: "resolver.package-main-fields.react-native-entry",
    title: "Package react-native fields are preferred over main fields",
    category: "resolver.packageMainFields",
    fixtureId: "monorepo-pnpm-workspaces",
    operation: {
      kind: "resolve-file",
      from: "apps/mobile/src/App.tsx",
      specifier: "@fixture/ui",
      platform: "android",
    },
    expected: {
      relativeFile: "packages/ui/src/Button.android.tsx",
    },
    docsPath: "/compat/resolver#package-main-fields",
  },
  {
    id: "resolver.package-exports.react-native-condition",
    title: "Package exports resolve react-native conditions before default entries",
    category: "resolver.packageExports",
    fixtureId: "monorepo-pnpm-workspaces",
    operation: {
      kind: "resolve-file",
      from: "apps/mobile/src/App.tsx",
      specifier: "@fixture/design-system",
      platform: "ios",
    },
    expected: {
      relativeFile: "packages/design-system/src/native.ts",
    },
    docsPath: "/compat/resolver#package-exports",
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
    id: "assets.metadata.svg-logo",
    title: "Asset metadata includes normalized location, type, scales, and dimensions",
    category: "assets.metadata",
    fixtureId: "rn-bare-assets",
    operation: {
      kind: "asset-metadata",
      assetPath: "assets/logo.svg",
    },
    expected: {
      assetPath: "assets/logo.svg",
      fileCount: 1,
      height: 32,
      httpServerLocation: "/assets",
      name: "logo",
      scales: [1],
      type: "svg",
      width: 64,
    },
    docsPath: "/compat/assets#metadata",
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
  {
    id: "lib-react-native-reanimated",
    title: "react-native-reanimated bundles from its react-native TS source entry",
    category: "libraries",
    fixtureId: "lib-react-native-reanimated",
    operation: {
      kind: "library-build",
      packageName: "react-native-reanimated",
      platform: "ios",
      bundleProbes: ["withTiming"],
      partialAspects: [
        "worklet directives are not compiled to UI-thread worklets without the Reanimated Babel plugin (see the babel-pipeline unit)",
      ],
    },
    expected: {
      packageName: "react-native-reanimated",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the react-native field to TypeScript sources and bundles them, but 'worklet' directives are stripped instead of compiled. Real worklets need the Reanimated Babel plugin from the babel-pipeline unit.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: [
      "Synthetic replica of react-native-builder-bob packaging (extensionless entries, react-native field at TS sources, 'worklet' directives).",
    ],
    docsPath: "/compat/libraries#react-native-reanimated",
  },
  {
    id: "lib-react-native-gesture-handler",
    title: "react-native-gesture-handler bundles from its exports/react-native TS entry",
    category: "libraries",
    fixtureId: "lib-react-native-gesture-handler",
    operation: {
      kind: "library-build",
      packageName: "react-native-gesture-handler",
      platform: "ios",
      bundleProbes: ["attachGestureHandler", "gestureHandlerRootHOC"],
      partialAspects: [
        "the RNGestureHandlerModule native module is only registered on a device, so gesture recognition does not run from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-gesture-handler",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the exports map / react-native condition to TypeScript sources and bundles them. The native gesture module is unavailable at build time, so the JS surface bundles but gestures do not run.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica with an exports map plus a native-module dependency."],
    docsPath: "/compat/libraries#react-native-gesture-handler",
  },
  {
    id: "lib-react-native-screens",
    title: "react-native-screens bundles its TSX native-component entry",
    category: "libraries",
    fixtureId: "lib-react-native-screens",
    operation: {
      kind: "library-build",
      packageName: "react-native-screens",
      platform: "ios",
      bundleProbes: ["Screen", "ScreenContainer"],
      partialAspects: [
        "the RNSScreen native host component is only available on a device, so native screen containers do not mount from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-screens",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Transpiles the TSX react-native entry and bundles it, but the RNSScreen native component is not registered at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica registering a native host component from a TSX entry."],
    docsPath: "/compat/libraries#react-native-screens",
  },
  {
    id: "lib-react-native-safe-area-context",
    title: "react-native-safe-area-context bundles its pure-JS TSX entry",
    category: "libraries",
    fixtureId: "lib-react-native-safe-area-context",
    operation: {
      kind: "library-build",
      packageName: "react-native-safe-area-context",
      platform: "ios",
      bundleProbes: ["getSafeAreaInsets", "SafeAreaProvider"],
      partialAspects: [],
    },
    expected: {
      packageName: "react-native-safe-area-context",
      toolchains: {
        vifx: {
          status: "pass",
          note: "Pure-JS insets surface: the TSX react-native entry transpiles and bundles with no native module dependency, fully reproducing its build-time behavior.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: [
      "Synthetic replica of the pure-JS insets surface (no native module on the resolved entry).",
    ],
    docsPath: "/compat/libraries#react-native-safe-area-context",
  },
  {
    id: "lib-react-native-svg",
    title: "react-native-svg bundles its TSX native-component entry",
    category: "libraries",
    fixtureId: "lib-react-native-svg",
    operation: {
      kind: "library-build",
      packageName: "react-native-svg",
      platform: "ios",
      bundleProbes: ["Svg", "Path"],
      partialAspects: [
        "the RNSVGSvgView and RNSVGPath native host components are only available on a device, so SVG rendering does not run from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-svg",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Transpiles the TSX react-native entry and bundles it, but the RNSVG native components are not registered at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica registering native host components from a TSX entry."],
    docsPath: "/compat/libraries#react-native-svg",
  },
  {
    id: "lib-expo-image",
    title: "expo-image bundles its precompiled Expo-module build entry",
    category: "libraries",
    fixtureId: "lib-expo-image",
    operation: {
      kind: "library-build",
      packageName: "expo-image",
      platform: "ios",
      bundleProbes: ["Image", "prefetch"],
      partialAspects: [
        "the ExpoImage native view manager is only registered on a device, so images do not decode or render from a bundler build",
      ],
    },
    expected: {
      packageName: "expo-image",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the Expo module's precompiled build entry and its vendored expo-modules-core, then bundles them. The native ExpoImage view is unavailable at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic Expo module rendering a native view via a vendored expo-modules-core."],
    docsPath: "/compat/libraries#expo-image",
  },
  {
    id: "lib-flash-list",
    title: "@shopify/flash-list bundles its scoped react-native TS entry and transitive deps",
    category: "libraries",
    fixtureId: "lib-flash-list",
    operation: {
      kind: "library-build",
      packageName: "@shopify/flash-list",
      platform: "ios",
      bundleProbes: ["FlashList", "DataProvider"],
      partialAspects: [
        "the AutoLayoutView native host component is only available on a device, so the high-performance list layout does not run from a bundler build",
      ],
    },
    expected: {
      packageName: "@shopify/flash-list",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the scoped react-native/source field to TypeScript sources and bundles them together with the vendored recyclerlistview. The AutoLayoutView native component is unavailable at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic scoped package building on a vendored recyclerlistview."],
    docsPath: "/compat/libraries#shopify-flash-list",
  },
  {
    id: "lib-expo-sqlite",
    title: "expo-sqlite bundles its precompiled Expo-module build entry",
    category: "libraries",
    fixtureId: "lib-expo-sqlite",
    operation: {
      kind: "library-build",
      packageName: "expo-sqlite",
      platform: "ios",
      bundleProbes: ["openDatabaseSync", "requireNativeModule"],
      partialAspects: [
        "the ExpoSQLite native module is only registered on a device, so opening a database throws from a bundler build",
      ],
    },
    expected: {
      packageName: "expo-sqlite",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the Expo module's precompiled build entry and its vendored expo-modules-core, then bundles them. The native ExpoSQLite module is unavailable at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic Expo module opening a database via the ExpoSQLite native module."],
    docsPath: "/compat/libraries#expo-sqlite",
  },
  {
    id: "lib-react-native-vector-icons",
    title: "react-native-vector-icons ships untranspiled JSX in published .js",
    category: "libraries",
    fixtureId: "lib-react-native-vector-icons",
    operation: {
      kind: "library-build",
      packageName: "react-native-vector-icons",
      platform: "ios",
      bundleProbes: ["createIconSet"],
      partialAspects: [],
    },
    expected: {
      packageName: "react-native-vector-icons",
      toolchains: {
        vifx: {
          status: "pass",
          note: "The published entry ships untranspiled JSX inside a .js file. The integrated project-derived Babel pipeline runs node_modules sources through the React Native preset on native platforms (as Metro does), so the JSX is transpiled and the bundle builds.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: [
      "Synthetic replica of the classic Metro-flavored publishing quirk: JSX shipped in published .js files.",
    ],
    docsPath: "/compat/libraries#react-native-vector-icons",
  },
  {
    id: "lib-lottie-react-native",
    title: "lottie-react-native bundles its TSX native-component entry",
    category: "libraries",
    fixtureId: "lib-lottie-react-native",
    operation: {
      kind: "library-build",
      packageName: "lottie-react-native",
      platform: "ios",
      bundleProbes: ["LottieView"],
      partialAspects: [
        "the LottieAnimationView native host component is only available on a device, so animations do not render from a bundler build",
      ],
    },
    expected: {
      packageName: "lottie-react-native",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Transpiles the TSX react-native entry and bundles it, but the LottieAnimationView native component is not registered at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica rendering a native animation view from a TSX entry."],
    docsPath: "/compat/libraries#lottie-react-native",
  },
  {
    id: "lib-nativewind",
    title: "nativewind bundles its runtime but does not apply its CSS/Babel pipeline",
    category: "libraries",
    fixtureId: "lib-nativewind",
    operation: {
      kind: "library-build",
      packageName: "nativewind",
      platform: "ios",
      bundleProbes: ["cssInterop", "styled"],
      partialAspects: [
        "the NativeWind Babel preset (jsxImportSource) and the Tailwind/PostCSS compilation of the imported CSS entry are not applied by a plain bundler build, so utility classes are not registered at runtime (see the babel-pipeline unit)",
      ],
    },
    expected: {
      packageName: "nativewind",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the react-native field to TypeScript sources and tolerates the imported CSS entry, but neither the NativeWind Babel preset nor the Tailwind PostCSS pipeline runs, so className utilities are not compiled to styles.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica whose consumer imports a Tailwind CSS entry."],
    docsPath: "/compat/libraries#nativewind",
  },
  {
    id: "lib-react-native-webview",
    title: "react-native-webview bundles its TSX native-component entry",
    category: "libraries",
    fixtureId: "lib-react-native-webview",
    operation: {
      kind: "library-build",
      packageName: "react-native-webview",
      platform: "ios",
      bundleProbes: ["WebView"],
      partialAspects: [
        "the RNCWebView native host component is only available on a device, so the web view does not mount from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-webview",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Transpiles the TSX react-native entry and bundles it, but the RNCWebView native component is not registered at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica rendering a native RNCWebView host component from a TSX entry."],
    docsPath: "/compat/libraries#react-native-webview",
  },
  {
    id: "lib-react-native-mmkv",
    title: "react-native-mmkv bundles its exports/react-native TS entry",
    category: "libraries",
    fixtureId: "lib-react-native-mmkv",
    operation: {
      kind: "library-build",
      packageName: "react-native-mmkv",
      platform: "ios",
      bundleProbes: ["MMKV", "MmkvPlatformContext"],
      partialAspects: [
        "the JSI-installed MMKV native binding is only available on a device, so a storage instance backed by real persistence cannot be created from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-mmkv",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the exports map / react-native condition to TypeScript sources and bundles them. The JSI-installed native binding is unavailable at build time, so the synchronous storage instance is not backed by native persistence.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica with an exports map plus a JSI native-binding dependency."],
    docsPath: "/compat/libraries#react-native-mmkv",
  },
  {
    id: "lib-async-storage",
    title: "@react-native-async-storage/async-storage bundles its scoped react-native TS entry",
    category: "libraries",
    fixtureId: "lib-async-storage",
    operation: {
      kind: "library-build",
      packageName: "@react-native-async-storage/async-storage",
      platform: "ios",
      bundleProbes: ["AsyncStorage", "multiGet"],
      partialAspects: [
        "the RNCAsyncStorage native module is only registered on a device, so reads and writes do not reach native storage from a bundler build",
      ],
    },
    expected: {
      packageName: "@react-native-async-storage/async-storage",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the scoped react-native field to TypeScript sources and bundles them. The native storage module is unavailable at build time, so getItem/setItem return inert results.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic scoped package proxying a native storage module from a TS entry."],
    docsPath: "/compat/libraries#react-native-async-storage",
  },
  {
    id: "lib-react-native-maps",
    title: "react-native-maps bundles its TSX native-component entry",
    category: "libraries",
    fixtureId: "lib-react-native-maps",
    operation: {
      kind: "library-build",
      packageName: "react-native-maps",
      platform: "ios",
      bundleProbes: ["MapView", "Marker"],
      partialAspects: [
        "the AIRMap and AIRMapMarker native host components are only available on a device, so the map and its markers do not render from a bundler build",
      ],
    },
    expected: {
      packageName: "react-native-maps",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Transpiles the TSX react-native entry and bundles it, but the AIRMap native components are not registered at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: ["Synthetic replica registering native host components from a TSX entry."],
    docsPath: "/compat/libraries#react-native-maps",
  },
  {
    id: "lib-expo-camera",
    title: "expo-camera bundles its precompiled Expo-module build entry",
    category: "libraries",
    fixtureId: "lib-expo-camera",
    operation: {
      kind: "library-build",
      packageName: "expo-camera",
      platform: "ios",
      bundleProbes: ["CameraView", "getAvailableCameraTypesAsync"],
      partialAspects: [
        "the ExpoCamera native view manager and module are only registered on a device, so the camera preview does not render and capability queries return empty from a bundler build",
      ],
    },
    expected: {
      packageName: "expo-camera",
      toolchains: {
        vifx: {
          status: "partial",
          note: "Resolves the Expo module's precompiled build entry and its vendored expo-modules-core, then bundles them. The native ExpoCamera view and module are unavailable at build time.",
        },
        metro: {
          status: "skip",
          note: "Not exercised against live Metro.",
        },
      },
    },
    notes: [
      "Synthetic Expo module rendering a native camera view via a vendored expo-modules-core.",
    ],
    docsPath: "/compat/libraries#expo-camera",
  },
];
