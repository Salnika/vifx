import { expect, test } from "vite-plus/test";
import {
  VifxError,
  formatVifxError,
  resolveVifxDocsUrl,
  serializeVifxError,
  toVifxError,
} from "../src/index.ts";

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
