import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  pack: {
    dts: true,
    entry: ["src/index.ts", "src/bin.ts"],
    exports: true,
    format: ["esm"],
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
