# @vifx/transform-cache

Persistent, content-addressed cache for expensive Babel/OXC transforms so warm
rebuilds stay fast.

## Usage

```ts
import { createTransformCache, defaultTransformCacheDir } from "@vifx/transform-cache";

const cache = createTransformCache({
  cacheDir: defaultTransformCacheDir(projectRoot),
  version: "1",
});

const result = await cache.getOrCompute(
  [code, "oxc", transformOptions, pluginVersion],
  async () => transformWithOxc(code, id, transformOptions),
);

cache.stats(); // { hits, misses, writes, errors }
```

## Behavior

- **Key** = SHA-256 of a stable stringify (sorted object keys) of `keyParts`
  combined with the cache `version`. Any change to any key part — file content,
  transformer id, normalized options, or tool versions — yields a miss.
- **Disk layout**: `<cacheDir>/<hash[0..2]>/<hash>.json`.
- **Atomic writes**: results are written to a temp file and renamed into place.
- **Corruption tolerant**: unreadable or malformed entries are treated as a miss
  and counted under `errors`; reads never throw.
- **Concurrent-safe (best effort)**: concurrent `getOrCompute` calls for the same
  key share a single in-flight computation; cross-process safety relies on atomic
  renames.
