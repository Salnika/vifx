import { expect, test } from "vite-plus/test";
import type { VifxRebuildReport } from "@vifx/types";
import { formatClientLog, formatRebuildReport } from "../src/commands/expo-shared.ts";

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

// Dev engine: one save, one line saying what the app did with it.
const ENGINE: VifxRebuildReport = {
  changedPaths: ["app/index.tsx"],
  cycle: 7,
  engine: true,
  hmr: "fast-refresh",
  phases: { transformMs: 32.6, serializeMs: 0, writeMs: 0, totalMs: 32.6 },
};

test("formatRebuildReport renders a dev engine Fast Refresh as file and time to the app", () => {
  expect(plain(formatRebuildReport(ENGINE))).toBe("fast refresh  app/index.tsx  33ms");
  // A single module re-run is the file itself: nothing more to say.
  expect(plain(formatRebuildReport({ ...ENGINE, moduleCount: 1 }))).toBe(
    "fast refresh  app/index.tsx  33ms",
  );
});

test("formatRebuildReport says how far a dev engine edit propagated", () => {
  const line = plain(
    formatRebuildReport({
      ...ENGINE,
      changedPaths: ["src/endpoints.ts", "src/other.ts"],
      moduleCount: 32,
    }),
  );

  expect(line).toBe("fast refresh  src/endpoints.ts (+1)  33ms  (32 modules re-run)");
});

test("formatRebuildReport gives the reason of a dev engine reload", () => {
  const line = plain(
    formatRebuildReport({ ...ENGINE, hmr: "reload", reason: "The dev server restarted" }),
  );

  expect(line).toBe("reload  app/index.tsx  33ms  — The dev server restarted");
  // No file and no timing when the reload did not come from a save.
  expect(
    plain(
      formatRebuildReport({
        cycle: 1,
        engine: true,
        hmr: "reload",
        phases: { transformMs: 0, serializeMs: 0, writeMs: 0, totalMs: 0 },
        reason: "The dev server restarted",
      }),
    ),
  ).toBe("reload  — The dev server restarted");
});

test("formatRebuildReport keeps a dev engine compile error readable", () => {
  const error = "SyntaxError: /app/index.tsx: Unexpected token (2:17)\n\n> 2 | const broken = ;";
  const text = plain(
    formatRebuildReport({ ...ENGINE, changedPaths: undefined, error, hmr: "error" }),
  );

  expect(text).toBe(`update failed\n${error}`);
});

test("formatClientLog labels an app console call the way Metro does", () => {
  expect(plain(formatClientLog({ data: ["hello", "{a: 1}"], level: "log" }))).toBe(
    " LOG  hello {a: 1}",
  );
  expect(plain(formatClientLog({ data: ["careful"], level: "warn" }))).toBe(" WARN  careful");
  expect(plain(formatClientLog({ data: ["group"], level: "groupCollapsed" }))).toBe(" LOG  group");
});
