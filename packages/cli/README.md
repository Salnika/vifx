# @vifx/cli

The `vifx` command of [Vifx](https://github.com/Salnika/vifx): Vite and Rolldown bundling for React Native and Expo, without Metro.

```bash
npm install --save-dev @vifx/cli
```

## Commands

| Command                   | What it does                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `vifx setup`              | Writes a Vifx config next to an Expo app, leaving Expo-owned files untouched.        |
| `vifx expo dev --expo-go` | Expo Go dev server with Fast Refresh.                                                |
| `vifx expo dev`           | react-native-web preview in the browser.                                             |
| `vifx export:embed`       | Release bundle, source map and assets for Xcode and Gradle (Metro-compatible flags). |
| `vifx expo export`        | Expo export artifacts: bundles, maps, assets, manifest and metadata.                 |
| `vifx init`, `vifx dev`   | Config and Metro-compatible dev server for bare React Native projects.               |
| `vifx doctor`             | Checks a project and reports what Vifx detected.                                     |
| `vifx hermes compile`     | Compiles a bundle to Hermes bytecode with the project's `hermesc`.                   |
| `vifx vite init`          | Writes a `vite.config.vifx.ts` for your own Vite and Rollup plugins.                 |

Every command takes `--help`, and `--json` for machine-readable output. The [CLI reference](https://salnika.github.io/vifx/reference/cli) lists every flag.

Requires Node.js 22.18+, 24.11+ or 26+.
