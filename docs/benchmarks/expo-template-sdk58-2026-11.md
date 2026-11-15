# Expo (Metro) vs vifx — default Expo template, November 2026

> Date: 2026-11-15. vifx 0.2.0, built from the repository at the release.
> App: a new `npx create-expo-app@latest` (template `default@sdk-58`): Expo 58.0.25,
> React Native 0.88.1, expo-router, installed with npm, unchanged.
> Machine: Apple M4 Pro (14 cores), 24 GB, macOS (Darwin 25.5), Node 26.13.1.
> Harness: [`scripts/bench/expo-vs-vifx.mjs`](../../scripts/bench/expo-vs-vifx.mjs)
> (`pnpm bench:expo`), iOS.

Anyone can recreate this app with one command, unlike the private app of the
[main report](./expo-vs-vifx-2026-11.md). Same method: Metro is the project's
own `expo export:embed` and `expo start`, vifx is `vifx export:embed` and
`vifx expo dev --expo-go`. Cold runs start with the caches cleared, one run per
cell; warm figures are the median of 3 runs. Memory is the peak of the sum over
the process tree, sampled every 100 ms. Delta is vifx relative to Metro;
negative is better for vifx.

## Results

### Release bundle (`export:embed --dev false`)

| Metric                         |    Metro |     vifx |   Delta |
| ------------------------------ | -------: | -------: | ------: |
| Cold build                     |  10.46 s |   3.90 s | −62.7 % |
| Warm build                     |   1.72 s |   1.40 s | −18.6 % |
| Peak memory, cold              | 2,895 MB | 2,912 MB |  +0.6 % |
| Peak memory, warm              |   564 MB |   947 MB | +68.1 % |
| JS bundle                      |  2.43 MB |  2.19 MB |  −9.8 % |
| JS bundle, gzip                |  0.57 MB |  0.51 MB |  −9.0 % |
| Hermes bytecode (`hermesc -O`) |  3.59 MB |  3.72 MB |  +3.6 % |
| Source map                     |  9.55 MB |  7.54 MB | −21.1 % |
| Modules in the source map      |    1,543 |    1,471 |  −4.7 % |
| Asset files                    |       34 |       35 |      +1 |

vifx's extra asset file is its `assetmap.json`; the 34 images are the same.

### Development bundle (`export:embed --dev true`)

| Metric            |    Metro |     vifx |   Delta |
| ----------------- | -------: | -------: | ------: |
| Cold build        |   6.13 s |   4.29 s | −30.0 % |
| Warm build        |   2.00 s |   1.40 s | −30.2 % |
| Peak memory, cold | 2,768 MB | 2,408 MB | −13.0 % |
| Peak memory, warm |   851 MB |   887 MB |  +4.3 % |
| JS bundle         |  8.44 MB |  6.54 MB | −22.5 % |

### Dev server (`expo start` vs `vifx expo dev --expo-go`)

| Metric                              |   Metro |    vifx |   Delta |
| ----------------------------------- | ------: | ------: | ------: |
| Cold start → server answering       |  1.75 s |  0.63 s | −64.2 % |
| Cold start → first bundle served    |  4.09 s |  3.93 s |  −3.9 % |
| Warm start → server answering       |  1.12 s |  0.52 s | −53.5 % |
| Warm start → first bundle served    |  1.64 s |  1.53 s |  −6.6 % |
| Repeat bundle fetch                 |  0.10 s |  0.01 s | −91.6 % |
| Edit → Fast Refresh update received |  0.13 s |  0.05 s | −59.8 % |
| Edit → new full bundle available    |  0.14 s |  0.16 s | +14.9 % |
| Dev bundle served                   | 8.45 MB | 7.94 MB |  −6.0 % |

Fast Refresh is the median of 3 edits of `src/app/_layout.tsx`, timed on the
`/hot` socket as the app receives them: 0.32, 0.05 and 0.04 s for vifx (the
first edit after a start is the slow one), 0.17, 0.13 and 0.12 s for Metro.

## Reading the numbers

- **Cold builds are where vifx leads clearly**: a release bundle builds 2.7×
  faster (10.5 → 3.9 s), a development bundle 1.4× faster.
- **Warm builds are close on this small app** (1.72 → 1.40 s for a release
  bundle). On the 2,000-module app of the main report, Metro's warm release
  build took 8.71 s against 1.57 s for vifx. That app differs in more than its
  size (it is installed with pnpm's isolated layout, for one), so these two
  results do not say which difference makes Metro slower there.
- **The dev server answers sooner, but the first bundle is about level** with
  Metro's on this app (3.93 against 4.09 s from a cold start).
- **Fast Refresh updates arrive sooner** (0.05 against 0.13 s); a new full
  bundle for a reload is a little slower (0.16 against 0.14 s).
- **Metro is ahead on Hermes bytecode size** (+3.6 %, as on the main app, +3.9 %)
  **and on the peak memory of warm builds** (+68 % for a release build, +4 % for
  a development build). vifx's JS bundles are smaller, its bytecode is not: see
  [where Metro is on par or ahead](https://salnika.github.io/vifx/reference/comparisons#where-metro-is-on-par-or-ahead).

## Hermes

The harness compiles each release bundle, the served dev bundle and one Fast
Refresh patch with the project's own `hermesc` (`hermes-compiler`
260318099.0.5 in this template). In the shell this run used, that compiler
exited at once whenever it was started through `/usr/bin/time`, which the
harness wraps around every command it measures, so its generated report has no
Hermes figures for either tool. Run directly, the same compiler accepted both
tools' dev bundles and patches, and the bytecode sizes above come from
compiling both release bundles with `hermesc -emit-binary -O`. Compile time was
not measured.

## Reproduce

From a clone of the vifx repository:

```bash
vp install
vp run build
npx create-expo-app@latest ../expo-template --yes
node packages/cli/dist/bin.mjs setup ../expo-template --yes --expo-go
pnpm bench:expo --project ../expo-template --runs 3 --platforms ios --edit-file src/app/_layout.tsx
```

Raw results (`results.json`, `report.md`, the bundles and maps) are written to
`.bench/expo-template/`, which is git-ignored.
