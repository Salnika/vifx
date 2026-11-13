# Vifx vs Metro — Benchmark (HNewsPro, iOS, release path)

> **Mesures plus récentes et plus complètes** (iOS + Android, release + dev, serveur de dev,
> mémoire) : [`docs/benchmarks/expo-vs-vifx-2026-11.md`](./docs/benchmarks/expo-vs-vifx-2026-11.md),
> produites par `pnpm bench:expo`. Les chiffres ci-dessous datent de juin 2026.

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

| Métrique                               | Metro       | Vifx         | Écart                         |
| -------------------------------------- | ----------- | ------------ | ----------------------------- |
| **Build cold** (JS bundle)             | 20,7 s      | **13,2 s**   | **Vifx −36 %**                |
| **Rebuild warm** (2ᵉ run, cache chaud) | 12,3 s      | **3,8 s**    | **Vifx ~3,2× plus rapide**    |
| Speedup du cache (cold→warm)           | 1,7×        | **3,4×**     | cache de transform Vifx (#06) |
| Compile Hermes (.bundle→.hbc)          | 2,0 s       | 1,8 s        | ~égalité                      |
| Bundle JS (release)                    | 3,54 Mo     | **3,46 Mo**³ | **Vifx −2,2 %**               |
| **Bytecode Hermes** (ce qui ship)      | **4,96 Mo** | 5,24 Mo¹     | Metro −5,8 %                  |
| Modules / sources                      | 2007        | **1711**     | Vifx −15 % (moins de modules) |
| Assets émis                            | 39          | 32²          | —                             |

¹ **Après le fix du path production Expo** (commit `80a50d7`) : `export:embed --dev false` minifie (Oxc) + émet un IIFE. **Avant le fix**, `buildExpoBundle` ignorait le mode et émettait un bundle dev-flavored : 6,82 Mo JS / 5,82 Mo hbc — le benchmark a révélé ce bug. ² Écart d'assets à investiguer (grouping différent). ³ **Après le fix indirect-eval** (commit `9ce03c1`) : 3,82 → 3,46 Mo. Voir §« Taille » ci-dessous.

## Lecture honnête

### ✅ Avantage réel : la vitesse de build (surtout à chaud)

- **Cold −36 %**, et surtout **warm ~3,2× plus rapide** (3,8 s vs 12,3 s). Le cache de transform content-addressed (#06) sur Rolldown écrase le cache de Metro (×3,4 vs ×1,7). Pour la DX quotidienne (rebuilds répétés), c'est l'argument le plus solide — et il est **mesuré, pas supposé**.
- L'avantage cold tient même en ajoutant la minification manquante (oxc-minify = 154 ms, négligeable).

### Mesure de la DX warm — instrumentation par sauvegarde (reproductible)

Le 3,8 s / 3,2× ci-dessus était un chiffre de **build complet** (un export from-scratch à cache chaud). Mais la DX réelle, c'est le **rebuild par sauvegarde** dans `vifx expo dev`. Le batch instrumentation (batch/01) rend ce chiffre reproductible et ventilé : à chaque save, le dev server émet **une ligne** au terminal —

```
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

- **Ventilation par phase** : `transform` (l'unique `await build()` Vite/Rolldown — transform Babel + bundle Rolldown ne sont pas isolables, étiquette honnête « transform+bundle »), `serialize` (assemblage du registre `__d`/`__r` + sourcemap), `write` (les deux `writeFile` + rename des assets + nettoyage staging), `apply` (diff + broadcast `/hot`). En export, une phase `hbc` (compile Hermes) s'ajoute ; en dev elle est **absente** (pas de bytecode par save).
- **Hit-rate du cache PAR CYCLE, pas cumulatif.** C'est le point méthodologique clé : le hit-rate cumulatif converge faussement vers ~99 % sur un cache chaud (il dilue chaque save dans tout l'historique). Le delta par cycle (`hits/(hits+misses)` de **ce** rebuild) montre ce qu'une sauvegarde donnée a réellement recalculé — c'est `TransformCache.snapshotDelta()`, distinct de `stats()` (cumulatif, inchangé).
- **Même donnée en NDJSON via `--json`.** Le flux reste du **NDJSON pur** : ligne 1 = snapshot compact du dev server (1 ligne), puis 1 ligne JSON par save (`VifxRebuildReport` : `cycle`, `phases`, `cache`, `moduleCount`, `hmr`). Parseable ligne-à-ligne, agrégeable (médiane / p95 sur N saves) sans harnais externe.

> **Statut de mesure (honnête).** L'outil est livré et testé (`formatRebuildReport`, `composeRebuildReport`, `snapshotDelta` couverts par tests unitaires ; byte-identité du chemin hoisted prod re-vérifiée). Les **chiffres par-save chiffrés sur HNewsPro** (médiane/p95 des phases + hit-rate par cycle sur ≥5 saves warm) restent à capturer sur la machine de bench (HNewsPro n'est pas présent dans ce worktree) — la baseline 3,8 s reste le seul chiffre warm publié pour l'instant. La reproduction ci-dessous donne la commande exacte.

### Taille : JS désormais < Metro, mais bytecode encore +5,8 % (cause isolée)

**JS release : Vifx passe sous Metro (−2,2 %, commit `9ce03c1`).** Cause de l'écart précédent (+7,8 %) : RN ne ship **qu'un seul `eval` direct** (le fallback de `loadBundleFromServer.js`). oxc-minify **désactive le mangling des identifiants _globalement_** dès qu'il voit un `eval` direct (il ne peut pas prouver que l'eval ne référence pas un local par nom) — Metro/terser limite ça à la fonction contenante. Ce seul `eval` laissait **tout** le bundle release non-manglé (`__commonJSMin` ×1858, tous les `require_*` intacts). Le plugin `createIndirectEvalPlugin` réécrit `eval(` → `(0,eval)(` en `renderChunk` avant le minify (sémantique préservée : indirect eval = scope global, ce que ces call-sites veulent déjà) → le minifier mangle tout le bundle. `__commonJSMin` 1858→0.

**Bytecode Hermes : encore +5,8 % (5,24 vs 4,96 Mo) — et le mangling n'y change RIEN** (Hermes ignore les noms d'identifiants ; le mangling réduit le texte JS, pas le bytecode). Diagnostic au désassembleur (`hermesc -dump-bytecode`) :

|                                       | Functions | String table | hbc        |
| ------------------------------------- | --------- | ------------ | ---------- |
| Metro                                 | 18 179    | 31 043       | 4,96 Mo    |
| Vifx **hoisted**                      | 23 078    | 30 617       | **+5,8 %** |
| Vifx **metro** (`__d`/`__r`, minifié) | 27 062    | 30 656       | +17,3 %    |

- L'écart est **entièrement des fonctions en trop** (+4 899), pas des strings (la string table de Vifx est même _plus petite_).
- Les +4 899 fonctions = **+8 145 arrows getter-thunk `:()=>`** (Metro : 317). Ce sont les wrappers d'interop esbuild-style de Rolldown : `__esm(() => {...})` (init différée) + `__export(ns, { nom: () => binding })` (un getter par export). Rolldown ne peut pas hoister _eagerly_ un graphe RN saturé de CJS↔ESM (cœur RN + nombreuses libs en CJS, entry CJS, `require()` partout) → il enveloppe chaque module ESM atteint en lazy-init. ~8 000 arrows triviaux × ~40 o de bytecode ≈ l'écart de +287 Ko.
- **Le format `metro` (`__d`/`__r`) n'est PAS la solution** : il supprime bien les 8 145 getters (→ 0) mais **perd le scope-hoisting cross-module de Rolldown** (DCE/inlining inter-modules) → finit avec _plus_ de fonctions (27 062) et un hbc **pire** (+17,3 %). Mesuré, pas supposé.
- **Le levier réel** : Vifx hoisted = 8 145 getters + ~14 933 « vraies » fonctions ; ces 14 933 sont **déjà sous** les 18 179 de Metro. Éliminer les getters (sans perdre le hoisting) ferait passer le bytecode **sous Metro**. Mais ça n'est pas un flag Rolldown — il faudrait soit un transform custom de dé-lazification (risqué, sémantique, à valider device), soit un travail upstream Rolldown sur l'eager-hoisting des graphes CJS-lourds.

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
2. ~~Réduire le JS release sous Metro~~ — **fait** (`9ce03c1`, indirect-eval → −2,2 %).
3. **Bytecode sous Metro** (encore +5,8 %) — bloqué sur l'élimination des ~8 000 getters lazy `__esm`/`__export` de Rolldown (cf. §Taille). Le format `metro` est exclu (mesuré pire, +17,3 %). Pistes ouvertes, toutes à valider device : (a) transform `renderChunk` de dé-lazification des namespaces triviaux ; (b) flag/patch Rolldown pour l'eager-hoisting ; (c) accepter +5,8 % et capitaliser sur vitesse + JS plus petit.
4. **Phase 7 device** : mesurer TTI/mémoire/FPS sur simulateur+device, le seul axe où « plus petit bytecode » et « parse Hermes » comptent vraiment.
5. Investiguer l'écart d'assets (39 vs 32).

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

### DX warm — instrumentation par save

```bash
# Dev server Expo Go en NDJSON pur (snapshot ligne 1, puis 1 ligne par save).
# Lancer en arrière-plan, toucher des fichiers, puis arrêter pour agréger.
vifx expo dev "$HN" --expo-go --fast-refresh --json > $B/rebuilds.ndjson &
# … éditer App.tsx (≥5 fois, fichiers distincts) …
# kill du dev server, puis :
# médiane des phases + hit-rate par cycle sur les lignes de save (cycle ≥ 1) :
node -e '
  const fs = require("node:fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n")
    .map((l) => JSON.parse(l)).filter((r) => typeof r.cycle === "number");
  const med = (xs) => xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  for (const k of ["transformMs","serializeMs","writeMs","applyMs","totalMs"])
    console.log(k, med(rows.map((r) => r.phases[k] ?? 0)));
  console.log("hitRate (par cycle)", rows.map((r) => r.cache?.hitRate ?? 0));
' $B/rebuilds.ndjson
```
