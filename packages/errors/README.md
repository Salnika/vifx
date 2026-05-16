# @vifx/errors

Structured, actionable error primitives for Vifx packages and CLI surfaces.

The package centers on a single `VifxError` class plus helpers for formatting, serialization, and safe conversion from unknown failures.

## Highlights

- Stable error codes with docs-friendly defaults
- Human-readable formatting for CLI output
- JSON-safe serialization for logs and automation

## Example

```ts
import { VifxError, formatVifxError } from "@vifx/errors";

const error = new VifxError({
  code: "VIFX_RESOLVE_NOT_FOUND",
  message: 'Unable to resolve module "./Button" for platform "ios".',
  hint: "Check Button.ios.tsx, Button.native.tsx, or Button.tsx.",
});

console.error(formatVifxError(error));
```
