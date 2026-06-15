import { expect, test } from "vite-plus/test";
import type { VifxRebuildReport } from "@vifx/types";
import { formatRebuildReport } from "../src/commands/expo-shared.ts";

// Strip ANSI so assertions are stable whether or not chalk emits color (the
// phase labels are dimmed via formatVifxMuted/chalk.gray). The escape byte is
// built from its char code so no literal control character lands in the regex.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function plain(value: string): string {
  return value.replace(ANSI, "");
}

const BASE: VifxRebuildReport = {
  cycle: 1,
  phases: { transformMs: 120, serializeMs: 35, writeMs: 40, applyMs: 15, totalMs: 210 },
  cache: { hits: 11, misses: 1, computed: 1, hitRate: 11 / 12 },
  hmr: "fast-refresh",
};

test("formatRebuildReport renders one line with the per-phase breakdown and cycle hit-rate", () => {
  const line = plain(formatRebuildReport(BASE));

  expect(line).toBe("~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)");
  // Single line — the terminal/NDJSON stream stays one record per rebuild.
  expect(line).not.toContain("\n");
});

test("formatRebuildReport rounds fractional milliseconds", () => {
  const line = plain(
    formatRebuildReport({
      ...BASE,
      phases: {
        transformMs: 119.6,
        serializeMs: 34.4,
        writeMs: 40.5,
        applyMs: 15.2,
        totalMs: 209.7,
      },
    }),
  );

  expect(line).toBe("~210ms  transform 120  serialize 34  write 41  apply 15  cache 92% (11/12)");
});

test("formatRebuildReport includes hbc only when present (export path), omits it in dev", () => {
  const withHbc = plain(
    formatRebuildReport({
      ...BASE,
      phases: { transformMs: 100, serializeMs: 30, writeMs: 20, hbcMs: 50, totalMs: 200 },
    }),
  );
  expect(withHbc).toContain("hbc 50");

  const devOnly = plain(formatRebuildReport(BASE));
  expect(devOnly).not.toContain("hbc");
});

test("formatRebuildReport omits the cache segment when no per-cycle delta is present", () => {
  const line = plain(formatRebuildReport({ ...BASE, cache: undefined }));

  expect(line).toBe("~210ms  transform 120  serialize 35  write 40  apply 15");
  expect(line).not.toContain("cache");
});

test("formatRebuildReport reports a 0% cache hit-rate without dividing by zero", () => {
  const line = plain(
    formatRebuildReport({
      ...BASE,
      cache: { hits: 0, misses: 0, computed: 0, hitRate: 0 },
    }),
  );

  expect(line).toContain("cache 0% (0/0)");
});

test("formatRebuildReport renders an error cycle with its reason instead of timings", () => {
  const line = plain(
    formatRebuildReport({
      cycle: 4,
      phases: { transformMs: 0, serializeMs: 0, writeMs: 0, totalMs: 0 },
      hmr: "error",
      error: "boom",
    }),
  );

  expect(line).toBe("rebuild #4 failed: boom");
});
