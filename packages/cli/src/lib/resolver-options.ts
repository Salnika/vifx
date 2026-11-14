import type { VifxResolverConfig } from "@vifx/types";

/** The `resolver` settings of vifx.config.ts that a build or dev server takes. */
export interface ResolverBuildOptions {
  assetExtensions?: string[];
  conditions: string[];
  extensions: string[];
  mainFields: string[];
}

/**
 * Passes vifx.config.ts `resolver` settings to the bundler. `conditions` holds
 * the project's own conditions only: @vifx/config drops the ones the bundler
 * sets itself, and the bundler places these between its own.
 */
export function resolverBuildOptions(resolver: VifxResolverConfig): ResolverBuildOptions {
  return {
    conditions: resolver.conditions,
    extensions: resolver.extensions,
    mainFields: resolver.mainFields,
    ...(resolver.assetExtensions === undefined
      ? {}
      : { assetExtensions: resolver.assetExtensions }),
  };
}
