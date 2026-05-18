# @vifx/expo-export

Expo export artifact inspection and bounded generation for Vifx-built bundles.

## Highlights

- `inspectExpoExport(options)` walks an existing export directory.
- `writeExpoExport(options)` writes bundles, source maps, assets, `manifest.json`, and `metadata.json` from Vifx bundle artifacts.
- `evaluateExpoNoMetroContract(options)` reports bundling-only workflow evidence and blockers.
- The package reuses Vifx asset and source-map primitives without claiming Expo CLI, EAS, Updates runtime, or app execution parity.

## Example

```ts
import { evaluateExpoNoMetroContract, inspectExpoExport, writeExpoExport } from "@vifx/expo-export";

const report = await inspectExpoExport({
  projectRoot: "./fixtures/expo-export-basic",
  exportRoot: ".",
});

console.log(report.manifests.length);

const generated = await writeExpoExport({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
  bundles: vifxBundleArtifacts,
});

console.log(generated.exportRoot);

const contract = await evaluateExpoNoMetroContract({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
});

console.log(contract.decision);
```

## Boundaries

- Generated exports cover Vifx bundles, source maps, assets, `manifest.json`, and `metadata.json`.
- Expo Updates runtime manifests, local Updates serving, response signing, EAS metadata parity, and app execution validation are out of scope.
