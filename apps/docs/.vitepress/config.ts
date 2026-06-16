import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Vifx",
  description: "A unified Vite + Rolldown toolchain that replaces Metro for React Native and Expo.",
  lastUpdated: true,
  outDir: "./dist",
  // The workspace aliases `vite` to @voidzero-dev/vite-plus-core (rolldown-vite).
  // In vite-plus-core 0.1.21 (the copy vitepress@2.0.0-alpha.17 resolves) the JS
  // bridge that forwards rolldown bundle logs to the native `BindingLog`
  // ThreadsafeFunction is declared `async`, so it always resolves to a Promise.
  // That ThreadsafeFunction is typed `Either<(), InvalidReturnValue>` and rejects
  // any non-`undefined` return, so the *first* bundle log that survives the level
  // filter crashes the build with:
  //   The function returned `object`, but expected `undefined` in
  //   `Arc<ThreadsafeFunction<FnArgs<(String, BindingLog)>, ...>>`.
  // The trigger here is rolldown's INVALID_ANNOTATION warning for a misplaced
  // `/* #__PURE__ */` comment in @vueuse/core. Silencing the rolldown bundle log
  // level (via rollupOptions) drops every bundle log *before* it reaches that buggy
  // async bridge, so the crash never fires. This only gates rolldown's own bundle
  // logs; vitepress's dead-link / build reporting uses a separate vite logger and
  // is unaffected.
  vite: {
    build: {
      rollupOptions: { logLevel: "silent" },
    },
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Features", link: "/reference/features" },
      { text: "vs Metro", link: "/reference/comparisons" },
      { text: "Reference", link: "/reference/cli" },
    ],
    search: {
      provider: "local",
    },
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Migration", link: "/guide/migration" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Compatibility Philosophy", link: "/guide/compatibility-philosophy" },
            { text: "Workflows", link: "/guide/workflows" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Features", link: "/reference/features" },
            { text: "vs Metro", link: "/reference/comparisons" },
            { text: "CLI", link: "/reference/cli" },
            { text: "Config", link: "/reference/config" },
            { text: "Support Matrix", link: "/reference/support-matrix" },
            { text: "Packages", link: "/reference/packages" },
            { text: "Error Codes", link: "/reference/errors" },
            { text: "Compatibility Report Format", link: "/reference/compatibility-report-format" },
          ],
        },
      ],
    },
  },
});
