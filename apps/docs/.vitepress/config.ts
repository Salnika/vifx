import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Vifx",
  description: "A unified Vite + Rolldown toolchain that replaces Metro for React Native and Expo.",
  lastUpdated: true,
  outDir: "./dist",
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
