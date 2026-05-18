# NEXT

Use `SPECS.md` as the source of truth.

Immediate work should stay on the no-Metro Vite bundling corridor:

1. Keep the cleanup stable after removing native lifecycle and Expo Updates/server scope.
2. Compare Vifx/Vite output against `fixtures/rn-bare-basic/metro-output/ios`.
3. Harden Expo iOS and Android bundle production through `@vifx/vite-plugin-expo`.
4. Keep `vifx expo export` limited to bundles, source maps, assets, `manifest.json`, and `metadata.json`.
5. Make `vifx expo dev` useful as a Vite bundle/dev server without claiming Expo CLI, Expo Go, native dev-client, or full Fast Refresh parity.
