# Vifx vs Metro — Benchmark (HNewsPro, iOS, release path)

> Date: 2026-06-13. Toolchain Vifx = `batch/integration` (les 20 unités du batch phases 0→6 mergées).
> App: HNewsPro — Expo SDK 54.0.33, RN 0.81.5, React 19.1, Reanimated 4.1, expo-router 6, 2000 modules.
> Machine: darwin (mesure locale, monoposte).

## Méthodologie

Comparaison **apples-to-apples** du chemin **release** : même app, iOS, `--dev false`, le même `hermesc` (`react-native/sdks/hermesc`, `-O`) pour les deux.

- **Metro** : `expo export:embed --platform ios --dev false` (le chemin de bundling release exact d'Expo/Metro, minifié + Hermes-targeted).
- **Vifx** : `vifx export:embed <app> --platform ios --dev false` depuis `batch/integration`.

Mesurable proprement **sans device** : temps de build (cold/warm), taille de bundle (brut + bytecode Hermes), nb de sources, assets.
**Non mesuré** (nécessite un runtime device) : TTI, mémoire, FPS, temps de parse/exec réel. À faire en phase 7.

Caveat : runs uniques (les écarts sont assez larges pour que la variance ne renverse pas les conclusions), une seule app, une seule machine.

## Résultats

| Métrique | Metro | Vifx | Écart |
|---|---|---|---|
| **Build cold** (JS bundle) | 20,7 s | **13,2 s** | **Vifx −36 %** |
| **Rebuild warm** (2ᵉ run, cache chaud) | 12,3 s | **3,8 s** | **Vifx ~3,2× plus rapide** |
| Speedup du cache (cold→warm) | 1,7× | **3,4×** | cache de transform Vifx (#06) |
| Compile Hermes (.bundle→.hbc) | 2,0 s | 1,8 s | ~égalité |
| Bundle JS (release) | **3,54 Mo** | 3,82 Mo¹ | parité (Vifx +7,8 %) |
| **Bytecode Hermes** (ce qui ship) | **4,96 Mo** | 5,24 Mo¹ | Metro −5,7 % |
| Modules / sources | 2007 | **1711** | Vifx −15 % (moins de modules) |
| Assets émis | 39 | 32² | — |

¹ **Après le fix du path production Expo** (commit `80a50d7`) : `export:embed --dev false` minifie (Oxc) + émet un IIFE. **Avant le fix**, `buildExpoBundle` ignorait le mode et émettait un bundle dev-flavored : 6,82 Mo JS / 5,82 Mo hbc — le benchmark a révélé ce bug. ² Écart d'assets à investiguer (grouping différent).

## Lecture honnête

### ✅ Avantage réel : la vitesse de build (surtout à chaud)
- **Cold −36 %**, et surtout **warm ~3,2× plus rapide** (3,8 s vs 12,3 s). Le cache de transform content-addressed (#06) sur Rolldown écrase le cache de Metro (×3,4 vs ×1,7). Pour la DX quotidienne (rebuilds répétés), c'est l'argument le plus solide — et il est **mesuré, pas supposé**.
- L'avantage cold tient même en ajoutant la minification manquante (oxc-minify = 154 ms, négligeable).

### ➖ Avantage supposé non confirmé : la taille de bundle
- Le pari « tree-shaking → bundles plus petits » **ne se matérialise pas sur cette app**, même après le fix prod. Vifx a **moins de modules** (1711 vs 2007), mais son JS release (3,82 Mo) reste **~7,8 % plus gros** que Metro (3,54 Mo), et son **bytecode Hermes ~5,7 % plus gros** (5,24 vs 4,96 Mo).
- L'écart résiduel vient de ce que Metro produit (inline-requires, optimisations de graphe) que le path Vifx ne fait pas encore. La taille n'est donc pas (encore) un argument ; c'est la parité, pas l'avantage.

### ✅ Bug trouvé par le benchmark — CORRIGÉ
Le benchmark a révélé que `vifx export:embed` sur un projet **Expo** émettait un bundle **dev-flavored même avec `--dev false`** :
```
WARN production semantics pending: --dev false / --minify true were forwarded as
mode "production", but this Vifx version still emits a development-flavored bundle.
```
Cause : l'unité 14 (mode production + oxc-minify) était implémentée dans `buildReactNativeBundle`, mais le chemin Expo passe par `buildExpoBundle` (dans `@vifx/vite-plugin-expo`) qui hardcodait `minify:false` / `format:"es"` — non câblé à `resolveOutputOptions`/`resolveBuildMinify`. Intégration verte mais **lacune non couverte par les gates isolés** (aucun test ne couvrait le path production Expo) — exactement ce qu'un run réel révèle.

**Résolu** (commit `80a50d7`) : `buildExpoBundle` applique désormais `resolveBundleMode` → `resolveBuildMinify` + `resolveOutputOptions` en production, tout en gardant le path development byte-identique au corridor Expo Go validé. Avertissement obsolète retiré, test de régression dev-vs-prod ajouté. Résultat re-mesuré : **6,82 → 3,82 Mo JS, 5,82 → 5,24 Mo hbc** (chiffres post-fix dans le tableau).

## Actions restantes

1. ~~Câbler le mode production dans `buildExpoBundle`~~ — **fait** (`80a50d7`).
2. **Travailler la taille** : porter les optimisations type inline-requires / DCE plus agressif, sinon repositionner — la valeur de Vifx est la **vitesse**, pas (encore) la taille.
3. **Phase 7 device** : mesurer TTI/mémoire/FPS sur simulateur+device, le seul axe où « plus petit bytecode » et « parse Hermes » comptent vraiment.
4. Investiguer l'écart d'assets (39 vs 32).

## Reproduire

```bash
HN=/chemin/vers/HNewsPro ; WT=<vifx>/.claude/worktrees/integration ; B=/tmp/vifx-bench
# Metro
( cd "$HN" && node_modules/.bin/expo export:embed --platform ios --dev false \
  --bundle-output $B/metro/ios.bundle --sourcemap-output $B/metro/ios.map --assets-dest $B/metro/assets )
# Vifx
node --experimental-transform-types "$WT/packages/cli/src/bin.ts" export:embed "$HN" --platform ios --dev false \
  --bundle-output $B/vifx/ios.bundle --sourcemap-output $B/vifx/ios.map --assets-dest $B/vifx/assets
# Hermes (les deux)
"$HN/node_modules/react-native/sdks/hermesc/osx-bin/hermesc" -emit-binary -O -out X.hbc X.bundle
```
