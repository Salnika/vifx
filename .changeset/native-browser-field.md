---
"@vifx/platform-resolver": patch
"@vifx/vite-plugin-react-native": patch
---

iOS and Android builds resolve packages the way React Native's and Expo's Metro configs do: main fields `react-native`, `browser`, `main` (before: `react-native`, `main`, `module`), and the object form of those fields is applied as Metro applies it. A `browser` map replaces a package's entry (`"./lib/index.js": "./lib/browser.js"`), its files and subpaths (before `exports` is read, so `multiformats/hashes/sha2` gets its browser file), and the modules it imports (`"crypto": "./shim.js"`, `"util": "util-polyfill"`); `false` is an empty module.

Before, the field was ignored, so a package such as `qrcode` resolved to its Node.js entry: on Bluesky's app that pulled in `pngjs`, which fails as soon as the bundle runs.

A Node.js built-in name such as `util` still resolves to the package of that name when one is installed. When none is, vifx keeps bundling an empty module but now warns, naming the importer, since Metro fails to resolve it on iOS and Android.
