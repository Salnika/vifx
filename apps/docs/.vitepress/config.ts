import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Vifx",
  description:
    "Compatibility toolkit and experimental modern bundling layer for React Native and Expo.",
  lastUpdated: true,
  outDir: "./dist",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/packages" },
      { text: "Roadmap", link: "/roadmap" },
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
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Compatibility Philosophy", link: "/guide/compatibility-philosophy" },
            { text: "Workflows", link: "/guide/workflows" },
            { text: "Migration", link: "/guide/migration" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Features", link: "/reference/features" },
            { text: "Packages", link: "/reference/packages" },
            { text: "CLI", link: "/reference/cli" },
            { text: "Config", link: "/reference/config" },
            { text: "Native Artifacts", link: "/reference/native" },
            { text: "Error Codes", link: "/reference/errors" },
            { text: "Compatibility Report Format", link: "/reference/compatibility-report-format" },
            { text: "Support Matrix", link: "/reference/support-matrix" },
            { text: "Comparisons", link: "/reference/comparisons" },
          ],
        },
      ],
    },
  },
});
