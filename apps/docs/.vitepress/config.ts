import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { packageManagerTabs } from "./package-manager-tabs";

const repositoryUrl = "https://github.com/Salnika/vifx";
// Where the docs workflow publishes the site. Link previews, canonical links and
// the sitemap need absolute URLs, whatever `base` a build uses.
const siteUrl = "https://salnika.github.io/vifx/";
const socialImage = {
  url: `${siteUrl}og-image.png`,
  width: "1280",
  height: "640",
  alt: "Vifx: Vite and Rolldown bundling for React Native and Expo, with build times against Metro",
};
// The released version shown in the nav: every @vifx package shares it.
// The docs workflow redeploys the site when it changes.
const { version } = JSON.parse(
  readFileSync(new URL("../../../packages/cli/package.json", import.meta.url), "utf8"),
) as { version: string };
// GitHub Pages serves the site under /<repository>/ (set by the docs workflow).
// `head` links are not rebased by VitePress, so they are prefixed with it here.
const base = process.env.DOCS_BASE ?? "/";

export default defineConfig({
  title: "Vifx",
  description: "A unified Vite + Rolldown toolchain that replaces Metro for React Native and Expo.",
  base,
  head: [
    ["link", { rel: "icon", type: "image/png", href: `${base}favicon.png` }],
    ["link", { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` }],
    ["meta", { name: "theme-color", content: "#7c3aed" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Vifx" }],
    ["meta", { property: "og:image", content: socialImage.url }],
    ["meta", { property: "og:image:width", content: socialImage.width }],
    ["meta", { property: "og:image:height", content: socialImage.height }],
    ["meta", { property: "og:image:alt", content: socialImage.alt }],
    // X reads the og: tags for everything but the card type.
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
  ],
  // Each page's own address, title and description, for link previews and search engines.
  transformHead({ page, title, description }) {
    // `page` is the source path (`guide/status.md`); the site serves `.html`.
    if (page === "404.md") return [];
    const url = new URL(page.replace(/(^|\/)index\.md$/u, "$1").replace(/\.md$/u, ".html"), siteUrl)
      .href;
    return [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
    ];
  },
  sitemap: {
    // The trailing slash keeps /vifx/ in every URL of sitemap.xml.
    hostname: siteUrl,
    // Markdown under public/ (the agent migration prompt) is served as a raw file.
    transformItems: (items) => items.filter((item) => !item.url.startsWith("public/")),
  },
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
  markdown: {
    config(md) {
      packageManagerTabs(md);

      // CLI errors link to /reference/errors#<CODE>: on that page, a table cell
      // holding only an error code gets the code as its id.
      const renderCodeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (tokens, index, options, env, self) => {
        const token = tokens[index];
        const relativePath = (env as { relativePath?: string }).relativePath;
        if (
          token &&
          tokens.length === 1 &&
          relativePath === "reference/errors.md" &&
          /^VIFX_[A-Z0-9_]+$/u.test(token.content)
        ) {
          token.attrSet("id", token.content);
        }
        return renderCodeInline
          ? renderCodeInline(tokens, index, options, env, self)
          : self.renderToken(tokens, index, options);
      };
    },
  },
  themeConfig: {
    logo: { src: "/logo.png", alt: "" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Features", link: "/reference/features" },
      { text: "vs Metro", link: "/reference/comparisons" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Status", link: "/guide/status" },
      {
        text: `v${version}`,
        items: [
          { text: "Release notes", link: `${repositoryUrl}/releases` },
          { text: "Changelog", link: `${repositoryUrl}/blob/master/packages/cli/CHANGELOG.md` },
          { text: "npm", link: "https://www.npmjs.com/package/@vifx/cli" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repositoryUrl }],
    editLink: {
      pattern: `${repositoryUrl}/edit/master/apps/docs/:path`,
    },
    footer: {
      message: "Released under the MIT License.",
    },
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
            { text: "Migrate with an AI Agent", link: "/guide/agent-migration" },
            { text: "Dev Server and Fast Refresh", link: "/guide/dev-server" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Compatibility Philosophy", link: "/guide/compatibility-philosophy" },
            { text: "Workflows", link: "/guide/workflows" },
            { text: "Project Status", link: "/guide/status" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Features", link: "/reference/features" },
            { text: "vs Metro", link: "/reference/comparisons" },
            { text: "vs Re.Pack and One", link: "/reference/alternatives" },
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
