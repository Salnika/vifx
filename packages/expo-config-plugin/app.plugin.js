// Expo config plugin convention entry: @expo/config-plugins resolves
// `<package>/app.plugin.js` with require(). This package is ESM
// ("type": "module"), so the file re-exports the built plugin as an ESM
// default export; require(esm) handles it on every Node version supported by
// Expo SDK 54 (>= 20.19), and Expo's plugin resolver unwraps `.default`.
export { default } from "./dist/index.mjs";
