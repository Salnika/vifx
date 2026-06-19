import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import { looksLikeGeneratedModule, renderUnresolvedGeneratedStub } from "../src/index.ts";

/**
 * B3 regression: a path-like import that fails to resolve and looks like the
 * output of a project codegen step (e.g. Lingui's `./locales/<lng>/messages`,
 * only produced by `lingui compile`) must NOT abort the whole bundle. vifx
 * degrades it to a throwing stub + a single warning, the way Metro keeps
 * building past a catalog the install step never generated. A genuine typo in a
 * hand-written relative import must still be classified as a hard failure so the
 * resolve hook surfaces a clear `VIFX_RESOLVE_GENERATED_MODULE_MISSING`.
 */

test("classifies codegen-shaped specifiers as generated (graceful path)", () => {
  const generated = [
    "./locales/en/messages",
    "./locales/messages.ts",
    "../i18n/locales/fr/messages.js",
    "./compiled/catalogs/messages",
    "./__generated__/operations",
    "./graphql/types.generated.ts",
    "../gql/schema.gen.js",
    "./types.generated",
    "./api.gen.ts",
  ];

  for (const specifier of generated) {
    expect({ specifier, generated: looksLikeGeneratedModule(specifier) }).toEqual({
      specifier,
      generated: true,
    });
  }
});

test("does NOT misclassify ordinary relative imports (hard-fail path)", () => {
  const handWritten = [
    "./components/Button",
    "../utils/format.ts",
    "./screens/Home/index",
    "./localization",
    "./message-bus",
    "../assets/logo.png",
  ];

  for (const specifier of handWritten) {
    expect({ specifier, generated: looksLikeGeneratedModule(specifier) }).toEqual({
      specifier,
      generated: false,
    });
  }
});

test("the stub is inert to import but throws an actionable error on use", () => {
  const source = renderUnresolvedGeneratedStub("./locales/en/messages");

  // Execute the stub as a CommonJS-ish module: rewrite the single ESM default
  // export to a `module.exports` assignment so we can drive it without a bundler.
  const cjs = source.replace("export default stub;", "module.exports = stub;");
  const moduleScope = { exports: {} as { default?: unknown } & Record<string, unknown> };
  vm.runInNewContext(cjs, { module: moduleScope, exports: moduleScope.exports });
  const stub = moduleScope.exports as Record<PropertyKey, unknown> &
    ((...args: unknown[]) => unknown);

  // Importing the namespace is inert; the interop markers do not throw.
  expect(stub.__esModule).toBe(true);
  expect(stub[Symbol.toStringTag]).toBeUndefined();

  // Touching any real export throws a clear, actionable message naming the path.
  expect(() => (stub as Record<string, unknown>).t).toThrow(
    /could not resolve "\.\/locales\/en\/messages"/iu,
  );
  expect(() => (stub as Record<string, unknown>).t).toThrow(/codegen|lingui compile/iu);
  expect(() => stub()).toThrow(/could not resolve/iu);
});
