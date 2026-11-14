import type { VifxBundleMode } from "@vifx/types";
import type { Plugin } from "@voidzero-dev/vite-plus-core";
import { createIndirectEvalPlugin } from "./indirect-eval.ts";

export interface BuildVifxPluginPipelineOptions {
  /**
   * The vifx base plugin(s), already constructed (e.g.
   * `createReactNativePlugin(state)`). Passed in rather than built here so this
   * module stays free of a circular import back into `index.ts`.
   */
  basePlugins: Plugin[];
  /** Bundle mode; the indirect-eval rewrite is production-only. */
  mode: VifxBundleMode;
  /**
   * Whether to append `createIndirectEvalPlugin()` in production. The hoisted
   * release path sets this `true`; the metro and web-preview paths set it
   * `false` — the metro bundle must NOT receive indirect-eval (it has no direct
   * eval to rewrite and its size/mangling characteristics differ).
   */
  includeIndirectEval: boolean;
  /**
   * User Vite/Rollup plugins to append AFTER vifx's own. Reserved as the single
   * injection point for the plugin workstream; empty today, so the pipeline is
   * byte-identical to the inline arrays it replaces.
   */
  userPlugins?: Plugin[];
  /**
   * Reserved per-phase timing hook for the instrumentation workstream. Accepted
   * for contract stability; not wired here.
   */
  onPhase?: (phase: string, ms: number) => void;
}

/**
 * Single source of truth for the vifx native/web build plugin array.
 *
 * Centralizes the `[base, ...indirectEval?, ...userPlugins]` composition so the
 * plugin workstream has ONE place to inject user plugins and the instrumentation
 * workstream has ONE hook surface, instead of multiple inline arrays drifting
 * apart. With `userPlugins` empty and `includeIndirectEval` matching each
 * call-site's previous behavior, the returned array is element-identical to the
 * inline arrays it replaces, so the emitted bundle is byte-for-byte unchanged.
 */
export function buildVifxPluginPipeline(options: BuildVifxPluginPipelineOptions): Plugin[] {
  return [
    ...options.basePlugins,
    ...(options.includeIndirectEval && options.mode === "production"
      ? [createIndirectEvalPlugin()]
      : []),
    ...(options.userPlugins ?? []),
  ];
}
