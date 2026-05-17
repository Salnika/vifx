# @vifx/expo-export

Expo export artifact inspection and bounded generation for Vifx-built bundles.

## Highlights

- `inspectExpoExport(options)` walks an existing export directory
- `writeExpoExport(options)` writes a bounded export directory from Vifx bundle artifacts
- `startExpoUpdatesServer(options)` serves generated Updates manifests and referenced files locally, with optional response signing
- `evaluateExpoNoMetroContract(options)` reports Program C workflow evidence and blockers
- Normalizes bundles, source maps, manifests, Updates manifests, and assets into a deterministic shape
- Reuses Vifx asset and source-map primitives without claiming full Expo CLI parity

## Example

```ts
import {
  evaluateExpoNoMetroContract,
  inspectExpoExport,
  startExpoUpdatesServer,
  writeExpoExport,
} from "@vifx/expo-export";

const report = await inspectExpoExport({
  projectRoot: "./fixtures/expo-export-basic",
  exportRoot: ".",
});

console.log(report.manifests.length);

// Pass bundle artifacts returned by @vifx/vite-plugin-react-native build helpers.
const generated = await writeExpoExport({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
  bundles: vifxBundleArtifacts,
  updates: {
    baseUrl: "https://updates.example/app",
    runtimeVersion: "1.0.0",
  },
});

console.log(generated.exportRoot);

const server = await startExpoUpdatesServer({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
  signing: {
    keyId: "root",
    privateKey: process.env.EXPO_UPDATES_PRIVATE_KEY!,
  },
});

console.log(server.url);

const contract = await evaluateExpoNoMetroContract({
  projectRoot: "./apps/playground-expo",
  exportRoot: "dist/expo",
});

console.log(contract.decision);
```

## Boundaries

- Generated exports cover Vifx bundles, source maps, assets, `manifest.json`, `metadata.json`, and optional Expo Updates v1 manifest JSON.
- The local Updates server serves bounded JSON or multipart manifest responses, optional `expo-signature` headers, and referenced files only; it is not a multipart directive server, native execution gate, or EAS replacement.
- Dev server parity, native Expo runtime, and native Updates validation remain out of scope.
