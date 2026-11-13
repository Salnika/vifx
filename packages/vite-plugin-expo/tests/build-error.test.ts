import { expect, test } from "vite-plus/test";
import { isSourceCompileError, summarizeBuildError } from "../src/build-error.ts";
import { createHotErrorPayload } from "../src/hot.ts";

// What a Babel syntax error looks like once the transform cache and the
// bundler have each wrapped it (abridged from a real run).
const WRAPPED_SYNTAX_ERROR = [
  "Build failed with 1 error:",
  "",
  "[plugin vifx:react-native] /app/app/index.tsx",
  "VifxError: Transform cache compute callback failed.",
  "    at toVifxError (file:///repo/packages/errors/dist/index.mjs:164:10)",
  "    at async cachedTransform (file:///repo/packages/vite-plugin-react-native/dist/index.mjs:5540:18)",
  "Caused by:",
  "  SyntaxError: /app/app/index.tsx: Unexpected token (45:17)",
  "  ",
  "    43 |     useSettings();",
  "  > 45 |   const broken = ;",
  "       |                  ^",
  "    46 |   at = 3;",
  "      at constructor (/app/node_modules/@babel/parser/lib/index.js:365:19)",
  "      at TypeScriptParserMixin.raise (/app/node_modules/@babel/parser/lib/index.js:6616:19)",
  "",
].join("\n");

const SYNTAX_ERROR_SUMMARY = [
  "SyntaxError: /app/app/index.tsx: Unexpected token (45:17)",
  "",
  "  43 |     useSettings();",
  "> 45 |   const broken = ;",
  "     |                  ^",
  "  46 |   at = 3;",
].join("\n");

test("summarizeBuildError keeps the innermost cause and its code frame, without stack frames", () => {
  const summary = summarizeBuildError(new Error(WRAPPED_SYNTAX_ERROR));

  // A code line that happens to start with "at" is source, not a stack frame.
  expect(summary).toBe(SYNTAX_ERROR_SUMMARY);
  expect(isSourceCompileError(summary)).toBe(true);
});

test("summarizeBuildError leaves an error with nothing to strip as it is", () => {
  expect(summarizeBuildError(new Error("Could not resolve ./missing"))).toBe(
    "Could not resolve ./missing",
  );
  expect(summarizeBuildError("plain failure")).toBe("plain failure");
  expect(isSourceCompileError("Could not resolve ./missing")).toBe(false);
});

test("createHotErrorPayload sends a compile error in the shape LogBox parses", () => {
  const payload = createHotErrorPayload(new Error(WRAPPED_SYNTAX_ERROR));

  expect(payload.type).toBe("TransformError");
  expect(payload.message).toBe(SYNTAX_ERROR_SUMMARY);
  expect(payload.errors).toEqual([
    { description: "SyntaxError: /app/app/index.tsx: Unexpected token (45:17)" },
  ]);
  // React Native's own pattern for a Babel compile error (LogBox,
  // parseLogBoxException): the client throws `${type} ${message}`.
  expect(`${payload.type} ${payload.message}`).toMatch(
    /^(?:TransformError )?(?:SyntaxError: |ReferenceError: )(.*): (.*) \((\d+):(\d+)\)\n\n([\s\S]+)/u,
  );
});
