# @vifx/vite-config-bridge

Loads a project's `vite.config.vifx.{ts,mts,js,mjs}` with Vite's own config loader and merges it into the Vite configuration Vifx builds with. Vifx's plugins stay first, and the keys Vifx must own (platform resolution, the define table, the native output format) are re-imposed after the merge, with a warning when a user setting is overridden.

It is an internal building block of [Vifx](https://github.com/Salnika/vifx), used by [`@vifx/vite-plugin-react-native`](../vite-plugin-react-native) and [`@vifx/vite-plugin-expo`](../vite-plugin-expo); its API is not stable. See [Config](https://salnika.github.io/vifx/reference/config) for the user-facing contract.
