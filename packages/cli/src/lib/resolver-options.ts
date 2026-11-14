import type { VifxResolverConfig } from "@vifx/types";

/** The `resolver` settings of vifx.config.ts that a build or dev server takes. */
export interface ResolverBuildOptions {
  assetExtensions?: string[];
  extensions: string[];
  mainFields: string[];
}

/**
 * Passes vifx.config.ts `resolver` settings to the bundler. `conditions` is
 * left out: the bundler adds its own conditions around the configured ones, and
 * builds have never received them.
 */
export function resolverBuildOptions(resolver: VifxResolverConfig): ResolverBuildOptions {
  return {
    extensions: resolver.extensions,
    mainFields: resolver.mainFields,
    ...(resolver.assetExtensions === undefined
      ? {}
      : { assetExtensions: resolver.assetExtensions }),
  };
}
