import { VifxError } from "@vifx/errors";
import type { VifxBundleMode } from "@vifx/types";

/**
 * Parses the optional `--mode` CLI flag. An explicit flag overrides the
 * per-target `mode` from `vifx.config.*`; omitting both keeps the
 * development default resolved by the bundler.
 */
export function parseBundleModeFlag(
  value: string | boolean | undefined,
): VifxBundleMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "development" || value === "production") {
    return value;
  }

  throw new VifxError({
    code: "VIFX_BUILD_INVALID_MODE",
    message: `Unsupported mode "${String(value)}" for vifx build.`,
    hint: "Use --mode development or --mode production.",
    docsPath: "/reference/cli#build",
  });
}
