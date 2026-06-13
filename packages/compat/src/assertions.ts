import { isDeepStrictEqual } from "node:util";
import { VifxError } from "@vifx/errors";
import {
  COMPAT_CASE_STATUSES,
  COMPAT_TOOLCHAINS,
  type CompatCase,
  type CompatCaseOutcome,
  type CompatCaseStatus,
  type CompatExpectation,
  type CompatToolchain,
  type LibraryBuildExpectation,
  type LibraryBuildResult,
} from "./types.ts";

function formatValue(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isCompatCaseStatus(value: unknown): value is CompatCaseStatus {
  return COMPAT_CASE_STATUSES.includes(value as CompatCaseStatus);
}

function isCompatToolchain(value: unknown): value is CompatToolchain {
  return COMPAT_TOOLCHAINS.includes(value as CompatToolchain);
}

export function isLibraryBuildResult(value: unknown): value is LibraryBuildResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<LibraryBuildResult>;
  return (
    typeof candidate.packageName === "string" &&
    typeof candidate.detail === "string" &&
    isCompatToolchain(candidate.toolchain) &&
    isCompatCaseStatus(candidate.status)
  );
}

export function isLibraryBuildExpectation(
  value: CompatExpectation,
): value is LibraryBuildExpectation {
  if (!("toolchains" in value) || typeof value.toolchains !== "object") {
    return false;
  }

  return COMPAT_TOOLCHAINS.every((toolchain) => {
    const expectation = value.toolchains[toolchain] as unknown;
    if (typeof expectation !== "object" || expectation === null) {
      return false;
    }

    const candidate = expectation as { status?: unknown; note?: unknown };
    return isCompatCaseStatus(candidate.status) && typeof candidate.note === "string";
  });
}

function buildOutcome(
  compatCase: CompatCase,
  actual: CompatCaseOutcome["actual"],
  passed: boolean,
  status: CompatCaseStatus,
  message: string,
): CompatCaseOutcome {
  return {
    caseId: compatCase.id,
    title: compatCase.title,
    category: compatCase.category,
    fixtureId: compatCase.fixtureId,
    passed,
    status,
    expected: compatCase.expected,
    actual,
    message,
    docsPath: compatCase.docsPath,
    notes: compatCase.notes,
  };
}

function evaluateLibraryBuildCase(
  compatCase: CompatCase,
  actual: CompatCaseOutcome["actual"],
): CompatCaseOutcome {
  if (!isLibraryBuildExpectation(compatCase.expected)) {
    throw new VifxError({
      code: "VIFX_COMPAT_INVALID_LIBRARY_CASE",
      message: `Compat case "${compatCase.id}" uses a library-build operation without a library support matrix expectation.`,
      hint: "Library cases must define expected.toolchains with a status snapshot for every toolchain.",
    });
  }

  if (!isLibraryBuildResult(actual)) {
    return buildOutcome(
      compatCase,
      actual,
      false,
      "fail",
      `Expected a library build classification but received ${formatValue(actual)}.`,
    );
  }

  const expectation = compatCase.expected.toolchains[actual.toolchain];
  const packageNameMatches = actual.packageName === compatCase.expected.packageName;
  const statusMatches = actual.status === expectation.status;
  const passed = packageNameMatches && statusMatches;

  const message = passed
    ? `${actual.toolchain} status "${actual.status}" matches the support matrix snapshot. ${actual.detail}`
    : packageNameMatches
      ? `Expected ${actual.toolchain} status "${expectation.status}" but observed "${actual.status}". ${actual.detail}`
      : `Expected package "${compatCase.expected.packageName}" but the adapter classified "${actual.packageName}".`;

  return buildOutcome(compatCase, actual, passed, actual.status, message);
}

export function evaluateCompatCase(
  compatCase: CompatCase,
  actual: CompatCaseOutcome["actual"],
): CompatCaseOutcome {
  if (compatCase.operation.kind === "library-build") {
    return evaluateLibraryBuildCase(compatCase, actual);
  }

  const passed = isDeepStrictEqual(actual, compatCase.expected);
  const message = passed
    ? "Matched expected output."
    : `Expected ${formatValue(compatCase.expected)} but received ${formatValue(actual)}.`;

  return buildOutcome(compatCase, actual, passed, passed ? "pass" : "fail", message);
}
