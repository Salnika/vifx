---
"@vifx/cli": patch
---

`vifx setup` now suggests its next commands for the project's package manager (`npx vifx`, `pnpm vifx`, `yarn vifx` or `bun vifx`), starting with the Expo Go dev server (`vifx expo dev --expo-go`), which works whichever targets setup wrote. Its summary names the targets it wrote instead of reporting the Expo Go server as skipped.
