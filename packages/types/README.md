# @vifx/types

Shared public TypeScript contracts for the Vifx monorepo.

This package is intentionally runtime-free. It centralizes stable domain types that other packages can depend on without pulling in implementation details.

## Highlights

- Platform, project, and compatibility result types
- Asset and source map descriptors
- Shared config and diagnostic shapes

## Example

```ts
import type { VifxAssetDescriptor, VifxCompatibilityResult, VifxResolveOptions } from "@vifx/types";

const resolveOptions: VifxResolveOptions = {
  platform: "ios",
  projectRoot: "/repo",
  extensions: ["tsx", "ts", "js"],
  mainFields: ["react-native", "module", "main"],
};

const asset: VifxAssetDescriptor = {
  filePath: "/repo/assets/icon.png",
  httpServerLocation: "/assets",
  name: "icon",
  type: "png",
  scales: [1, 2, 3],
};

const result: VifxCompatibilityResult = {
  id: "resolver-ios-basic",
  suite: "platform-resolver",
  status: "pass",
  target: "metro",
  summary: "Metro and Vifx resolved the same file.",
};
```
