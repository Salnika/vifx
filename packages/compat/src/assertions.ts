import { isDeepStrictEqual } from "node:util";
import type { CompatCase, CompatCaseOutcome } from "./types.ts";

function formatValue(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function evaluateCompatCase(
  compatCase: CompatCase,
  actual: CompatCaseOutcome["actual"],
): CompatCaseOutcome {
  const passed = isDeepStrictEqual(actual, compatCase.expected);
  const message = passed
    ? "Matched expected output."
    : `Expected ${formatValue(compatCase.expected)} but received ${formatValue(actual)}.`;

  return {
    caseId: compatCase.id,
    title: compatCase.title,
    category: compatCase.category,
    fixtureId: compatCase.fixtureId,
    passed,
    expected: compatCase.expected,
    actual,
    message,
    docsPath: compatCase.docsPath,
  };
}
