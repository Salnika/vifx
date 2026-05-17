import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  VIFX_ERROR_CODES,
  VifxError,
  formatVifxError,
  resolveVifxDocsUrl,
  serializeVifxError,
  toVifxError,
} from "../src/index.ts";

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

test("VifxError keeps structured fields and derives docs URLs", () => {
  const error = new VifxError({
    code: "VIFX_RESOLVE_NOT_FOUND",
    message: 'Unable to resolve module "./Button" for platform "ios".',
    hint: "Check Button.ios.tsx, Button.native.tsx, or Button.tsx.",
  });

  expect(error.code).toBe("VIFX_RESOLVE_NOT_FOUND");
  expect(error.docsPath).toBe("/errors/VIFX_RESOLVE_NOT_FOUND");
  expect(resolveVifxDocsUrl(error.docsPath)).toBe("https://vifx.dev/errors/VIFX_RESOLVE_NOT_FOUND");
});

test("formatVifxError renders summary, hint, and docs link", () => {
  const output = formatVifxError(
    new VifxError({
      code: "VIFX_CONFIG_INVALID",
      message: "The configured platforms list is empty.",
      hint: 'Provide at least one platform such as "ios" or "android".',
    }),
  );

  expect(output).toContain("[VIFX_CONFIG_INVALID] The configured platforms list is empty.");
  expect(output).toContain("Hint: Provide at least one platform");
  expect(output).toContain("Docs: https://vifx.dev/errors/VIFX_CONFIG_INVALID");
});

test("toVifxError wraps unknown failures with a structured fallback", () => {
  const wrapped = toVifxError(new Error("boom"), {
    code: "VIFX_CONFIG_LOAD_FAILED",
    hint: "Check that the config file uses a default export.",
  });

  const serialized = serializeVifxError(wrapped, { includeStack: true });
  expect(serialized.code).toBe("VIFX_CONFIG_LOAD_FAILED");
  expect(serialized.causeMessage).toBe("boom");
  expect(serialized.stack).toContain("VifxError");
});

test("known error codes cover emitted package diagnostics", async () => {
  const packagesRoot = path.resolve(import.meta.dirname, "../..");
  const sourceFiles = await collectSourceFiles(packagesRoot);
  const emittedCodes = new Set<string>();
  const codePattern = /\bcode:\s*"(?<code>VIFX_[A-Z0-9_]+)"/gu;
  const terminalDiagnosticPattern = /\b(?:ERROR|INFO|WARN)\s+(?<code>VIFX_[A-Z0-9_]+)\b/gu;

  for (const sourceFile of sourceFiles) {
    const contents = await readFile(sourceFile, "utf8");

    for (const match of contents.matchAll(codePattern)) {
      const code = match.groups?.code;
      if (code) {
        emittedCodes.add(code);
      }
    }

    for (const match of contents.matchAll(terminalDiagnosticPattern)) {
      const code = match.groups?.code;
      if (code) {
        emittedCodes.add(code);
      }
    }
  }

  const knownCodes = new Set<string>(VIFX_ERROR_CODES);
  const missingCodes = [...emittedCodes].filter((code) => !knownCodes.has(code)).sort();

  expect(missingCodes).toEqual([]);
});

test("error reference docs cover every known code", async () => {
  const docsPath = path.resolve(import.meta.dirname, "../../../apps/docs/reference/errors.md");
  const contents = await readFile(docsPath, "utf8");
  const documentedCodes = new Set<string>();
  const docsCodePattern = /\|\s+`(?<code>VIFX_[A-Z0-9_]+)`/gu;

  for (const match of contents.matchAll(docsCodePattern)) {
    const code = match.groups?.code;
    if (code) {
      documentedCodes.add(code);
    }
  }

  const missingDocs = VIFX_ERROR_CODES.filter((code) => !documentedCodes.has(code));
  const undocumentedCodes = [...documentedCodes].filter(
    (code) => !(VIFX_ERROR_CODES as readonly string[]).includes(code),
  );

  expect(missingDocs).toEqual([]);
  expect(undocumentedCodes).toEqual([]);
});
