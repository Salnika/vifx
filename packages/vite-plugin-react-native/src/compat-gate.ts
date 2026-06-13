import type { VifxPlatform } from "@vifx/types";

/**
 * Native module specifiers whose Vifx JS compat substitute replaces the real
 * package on native (ios/android) builds. These swaps are behaviour-altering —
 * the JS mock for `react-native-reanimated` has no worklets and no UI-thread
 * runtime — so they must never be applied silently. They are gated behind the
 * explicit `compatPreview: true` opt-in via {@link isNativeCompatMockEnabled}.
 *
 * Web-mode shims are intentionally NOT listed here: those run in a browser
 * preview where the real native package cannot load, so they remain
 * unconditional and outside the `compatPreview` gate.
 */
export const NATIVE_COMPAT_PREVIEW_MODULE_IDS = ["react-native-reanimated"] as const;

const NATIVE_COMPAT_PREVIEW_MODULE_SET = new Set<string>(NATIVE_COMPAT_PREVIEW_MODULE_IDS);

/**
 * The subset of plugin state the compat gate needs to decide whether a native
 * JS compat mock may be substituted for a real native package.
 */
export interface NativeCompatGateState {
  compatPreview: boolean;
  resolvePlatform: VifxPlatform;
}

/**
 * True when behaviour-altering native JS compat mocks may be substituted for
 * the modules in {@link NATIVE_COMPAT_PREVIEW_MODULE_IDS}. This requires both a
 * native resolve platform (the mocks are meaningless on web) and an explicit
 * `compatPreview: true` opt-in. Default native builds resolve the real package.
 */
export function isNativeCompatMockEnabled(state: NativeCompatGateState): boolean {
  return state.compatPreview && state.resolvePlatform !== "web";
}

/** True when `source` is a native package gated behind `compatPreview`. */
export function isGatedNativeCompatModule(source: string): boolean {
  return NATIVE_COMPAT_PREVIEW_MODULE_SET.has(source);
}

const warnedNativeCompatPreviewModuleIds = new Set<string>();

/**
 * Emits a single loud warning per gated module the first time its native JS
 * compat preview mock is activated for a build, so a developer who opted into
 * `compatPreview` is never surprised by silently non-functional animations.
 *
 * @internal Exported for testing; reset between runs via
 * {@link resetNativeCompatPreviewWarnings}.
 */
export function warnNativeCompatPreviewOnce(moduleId: string): void {
  if (warnedNativeCompatPreviewModuleIds.has(moduleId)) {
    return;
  }

  warnedNativeCompatPreviewModuleIds.add(moduleId);
  console.warn(
    `[vifx] compatPreview: JS-only ${moduleId} mock active for native — ` +
      "worklets/UI-thread animations are NOT real. Disable compatPreview to bundle " +
      "the real package once your project supports it.",
  );
}

/** Clears the once-per-module warning latch. Intended for tests only. */
export function resetNativeCompatPreviewWarnings(): void {
  warnedNativeCompatPreviewModuleIds.clear();
}
