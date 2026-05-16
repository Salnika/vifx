# @vifx/logger

Small structured logger for Vifx CLI tools and packages.

The logger defaults to concise pretty output, supports JSON lines for automation, and keeps verbose diagnostics opt-in.

## Highlights

- Human-friendly console output by default
- JSON line output for machine consumers
- `silent`, `verbose`, and `debug` modes
- Structured `VifxError` rendering

## Example

```ts
import { createLogger } from "@vifx/logger";

const logger = createLogger({ name: "vifx", verbose: true });

logger.info("Inspecting Expo project", { cwd: process.cwd() });
```
