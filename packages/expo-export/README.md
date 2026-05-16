# @vifx/expo-export

Inspect-only Expo export artifact normalization for existing `expo export` output.

## Highlights

- `inspectExpoExport(options)` walks an existing export directory
- Normalizes bundles, source maps, manifests, and assets into a deterministic shape
- Reuses Vifx asset and source-map primitives instead of claiming output generation

## Example

```ts
import { inspectExpoExport } from "@vifx/expo-export";

const report = await inspectExpoExport({
  projectRoot: "./fixtures/expo-export-basic",
  exportRoot: ".",
});

console.log(report.manifests.length);
```

## Boundaries

- Reads existing export output only. It does not replace `expo export`.
- Output generation, Expo Router, and full Updates generation remain out of scope.
