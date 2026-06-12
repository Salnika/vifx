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
    fixedExtension: true,
    format: ["esm", "cjs"],
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
