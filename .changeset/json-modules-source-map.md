---
"@vifx/vite-plugin-react-native": patch
---

Source maps list the JSON modules a bundle contains, with their content, as Metro's do. This covers production builds (`vifx export:embed`, `vifx expo export`, `vifx build --mode production`) and the `--fast-refresh` dev server. Before, a JSON module's data was in the bundle but its file was missing from the map's `sources`.
