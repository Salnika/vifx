# PLAN FINAL — Différenciation vs Metro : 4 actions parallélisables (A1..A4)

> **Date** : 2026-06-15. Companion à `PLAN.md` (style `/batch` du repo). Issu de l'analyse stratégique de différenciation vs Metro, durci par deux stress-tests adverses ayant lu le code réel (conflits/deps + faisabilité). Tous les ancrages re-vérifiés contre les sources.
>
> **Acquis (mesurés, pas promesses)** : builds warm **3,2× plus rapides**, JS bundle **−2,2 %** vs Metro, Fast Refresh complet **opt-in**, dev server Expo Go, `export:embed` compatible Metro.
> **Mur connu, NON prioritaire** : bytecode Hermes **+5,8 %** (getters lazy Rolldown — à pousser **upstream**, jamais en aval).
>
> **Principe `/batch`** : 1 worktree + 1 PR par unité, branche `batch/<NN>-<slug>`, **commit "contrats" inerte** mergé en premier pour dé-conflicter, puis vagues de merge. Toute édition cross-pkg `@vifx/*` exige `pnpm -C packages/<pkg> build` avant que le global `vifx` (lit `packages/cli/dist/bin.mjs`) la voie.

---

## 0. Vue d'ensemble — tailles **ré-estimées honnêtement** après stress-test

| Unité        | Slug                | Taille                                           | Risque       | Honnêteté                                                                                                                                                                                                                                                   |
| ------------ | ------------------- | ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **batch/00** | shared-contracts    | **S→M** (S-large)                                | faible       | **élargi** : extrait `rebuildServedBundle`, rend `TransformCache` injectable, tranche les paliers de clés, réserve `userInlineConfig`+`graphHandle`, rend le pipeline-helper metro-aware. La preuve byte-identité (metro-prod **inclus**) est le vrai coût. |
| **A1**       | instrumentation     | **M** (était S)                                  | faible→moyen | **re-classé**. La chronométrie pure est S ; le **hit-rate cache par cycle** exige la plomberie d'injection du cache (posée en batch/00). Sous-découpé A1a/A1b.                                                                                              |
| **A2**       | vite-plugins        | **L** (L-haut)                                   | moyen        | **le moat**. Sans marge. Piège staging-CJS : `build.rollupOptions.output` doit être RESERVED. Exécute du code user au build.                                                                                                                                |
| **A3**       | native-web          | **L**                                            | moyen        | **borné ADR-005**. Suppression de ~324 lignes web ; cross-package atomique (RN shim + Expo runtime). 2e risque après A4.                                                                                                                                    |
| **A4**       | hmr-incremental-poc | **M (POC) → L si on code le serializer partiel** | **élevé**    | **pari à faible espérance**. Types Rolldown 1.0.1 vérifiés : variante B (DevEngine→`Patch`) = **NO-GO clean** ; variante A (`RolldownBuild.generate()`) = **aucun incremental public**. Gate spike **pré-worktree**.                                        |

**Ordre de valeur, découplé** : A1, A2, A3 livrent une **valeur autonome**. A4 est un **pari instrumenté à espérance faible** (types défavorables) — sa non-réussite ne retire rien à A1/A2/A3. La formulation « A1 débloque la preuve qu'A4 consommera » est abandonnée : A1 vaut pour la DX warm visible, **indépendamment** d'A4.

---

## 1. ÉTAPE 0 — COMMIT CONTRATS INERTE (Coordinateur) — **ÉLARGI**

**Branche** : `batch/00-shared-contracts` (depuis `master`). **Merge AVANT de spawner A1..A4.** Aucun changement de comportement runtime. **Gate de sortie** (§1.12) : `vp check && vp test` verts **ET** bundles `metro-dev`, **`metro-prod`**, `hoisted-prod`, `web-preview` **byte-identiques** avant/après sur HNewsPro.

> Les 6 fixes bloquants des stress-tests sont **absorbés ici** (sinon A1↔A4 entrent en conflit direct et le gate échoue silencieusement sur metro-prod).

### 1.1 `packages/types/src/index.ts` — tous les types partagés, **optionnels**, posés une seule fois

Après `VifxTransformCacheStats` (l.98) :

- **A1** — `VifxRebuildPhaseTimings { transformMs:number; serializeMs:number; writeMs:number; hbcMs?:number; applyMs?:number; totalMs:number }` ; `VifxCycleCacheStats { hits:number; misses:number; computed:number; hitRate:number }` ; `VifxRebuildReport { cycle:number; changedPaths?:string[]; phases:VifxRebuildPhaseTimings; cache?:VifxCycleCacheStats; moduleCount?:number; hmr:'fast-refresh'|'reload'|'error'; error?:string }`.
  - **FIX stress-test** : `changedPaths` est **optionnel** (le watcher ne le propage pas jusqu'à la closure ; cf. §1.6).
- **A1** — sur `VifxBundleArtifacts` (l.118) : `rebuildTimings?: VifxRebuildPhaseTimings` (`cacheStats?` existe déjà l.122).
- **A2** — sur `VifxViteConfig` (l.274) : `userConfigFile?: string | false`. Sur `VifxReactNativePluginOptions` (l.290) + `VifxExpoPluginOptions` (l.316) : `userViteConfig?: import('vite').InlineConfig | string`.
- **A1/A3 (plomberie cache)** — `transformCacheInstance?: import('@vifx/transform-cache').TransformCache` sur `VifxReactNativePluginOptions` **et** `VifxExpoPluginOptions`. **FIX bloquant** : le cache n'est aujourd'hui **pas injectable** (créé en interne par `createTransformCacheForState`, RN `index.ts:2286/2819/3282`) ; sans ce canal, A1::`snapshotDelta()` n'a **rien** à observer sur le chemin Expo metro.
- **A3** — sur `VifxReactNativePluginOptions` (l.290) : `publicEnv?: Record<string,string>` ; `publicEnvPrefix?: string`. **NOTE** : `VifxExpoPluginOptions` a **déjà** `publicEnv`/`publicEnvPrefix` (l.321-322 — vérifié) ; ne **pas** redéclarer.
- **A3** — `unifiedEnv?: boolean` posé **top-level** (cf. §1.2, palier tranché).
- **A4** — `VifxIncrementalGraphHandle` (type opaque) ; `SerializerWarmState` (placeholder opaque).

> **Règle anti-conflit mécanique** : lancer `oxfmt` en fin de batch/00 pour stabiliser le diff de base. Après batch/00, **aucune** unité ne re-déclare / ré-ordonne / reformate ces types — elles ne remplissent que des **corps** ailleurs (sinon `oxfmt` fait exploser le diff sur ce fichier 4-owners).

### 1.2 `packages/config/src/index.ts` — réserver les clés, **paliers tranchés** (FIX `assertAllowedKeys` strict)

`assertAllowedKeys` (l.653) est **strict** : oublier UNE clé casse l'unité sœur silencieusement avec `VIFX_CONFIG_INVALID`.

- **`userConfigFile`** → **palier `vite`** : ajouter à `VITE_KEYS` (l.80, actuellement `Set(['mode','targets'])`). Valider dans `parseViteConfig` (string **ou** `false`, existence **non** requise). **Ne pas charger** le fichier.
- **`unifiedEnv`** → **palier top-level** (tranché) : ajouter à `TOP_LEVEL_KEYS` (l.64) + branche de validation booléenne dans `normalizeVifxConfig`.
- **Tests obligatoires batch/00** : un test `assertAllowedKeys` **par clé** (`userConfigFile` sous `vite`, `unifiedEnv` top-level) — preuve qu'aucune des deux ne plante.
- Exporter le **stub** `loadUserViteConfig(opts): Promise<…|null>` qui **retourne `null`** (A2 le remplace). `loadVifxConfig` fonctionnellement inchangé (aucun `loadConfigFromFile`).

### 1.3 `packages/vite-plugin-react-native/src/modes.ts` — seams A3 (lus par A2)

- `VifxResolveDefinesOptions` += `publicEnv?` + `publicEnvPrefix?` (inertes : comportement actuel quand absents).
- Exporter les constantes **lues par A2 pour ses garde-fous** : `VIFX_IMPOSED_DEFINE_KEYS` (`['__DEV__','global','process.env.NODE_ENV','process.env.EXPO_OS']`) et `VIFX_IMPOSED_RESOLVE_KEYS` (`['conditions','dedupe']`). Aucune branche comportementale.
- **Préserver l'invariant testé** (commentaire l.50-52) : `EXPO_OS` natif seulement, web sans `EXPO_OS`.
- **Figer le bloc export `index.ts:70-81`** ici (oxfmt) pour qu'A2/A3 ne le reformatent jamais.

### 1.4 `packages/vite-plugin-react-native/src/pipeline.ts` — **NOUVEAU**, **metro-aware** (FIX byte-identité)

**FIX bloquant** : un helper _générique_ qui injecte toujours `createIndirectEvalPlugin()` en prod casserait le **metro-prod** (qui n'en a **pas** — vérifié : `index.ts:3322` = `[createReactNativePlugin(state)]` sans indirect-eval) et donc le mangling/−2,2 %.

```ts
buildVifxPluginPipeline({
  state, mode,
  includeIndirectEval,      // explicite : hoisted=true en prod, metro=false, web-preview=false
  userPlugins = [],         // A2 — SEUL point d'injection user
  onPhase,                  // A1 — param réservé, non câblé ici
}): Plugin[]
// retourne exactement :
// [ createReactNativePlugin(state),
//   ...(includeIndirectEval && mode==='production' ? [createIndirectEvalPlugin()] : []),
//   ...userPlugins ]
```

Au commit contrats `userPlugins=[]` ⇒ array **byte-identique** aux 3 formes existantes. Owner = **A2**.

### 1.5 Câbler le helper sur les call-sites RN (`index.ts`) — **byte-for-byte**, 3 formes distinctes

- web-preview l.3039-3042 : `includeIndirectEval:false`.
- **métro l.3322** : `includeIndirectEval:false` (**critique** — pas d'indirect-eval ici).
- hoisted l.3386-3393 : `includeIndirectEval:true` (reproduit `...(mode==='production'?[createIndirectEvalPlugin()]:[])`).

### 1.6 `packages/vite-plugin-expo/src/index.ts` — **extraction `rebuildServedBundle` + options réservées** (FIX bloquant)

**FIX bloquant (le plus important)** : `rebuildServedBundle` (l.1314) est une **closure zéro-arg** éditée par **A1** (timing/report) **et A4** (chemin incrémental) **aux mêmes lignes** (l.1318 `buildExpoBundle`, l.1329 `computeHmrUpdate`). Sans extraction → **conflit de merge garanti** vague1→vague3.

- **Extraire** le corps en fonction nommée testable, byte-identique :
  ```ts
  async function runExpoGoRebuild(ctx: {
    onPhase?: (phase, ms) => void; // A1 — hook timing
    incremental?: boolean; // A4 — flag POC, défaut false
  }): Promise<VifxRebuildReport | void>;
  ```
  Au commit contrats : appelée sans `ctx` ⇒ comportement **identique**. A1 remplit le hook timing ; A4 ajoute la branche incrémentale derrière `incremental`.
- `StartExpoDevServerOptions` (l.77, **partagé** par `startExpoGoDevServer` l.1266 ET `startExpoDevServer` l.1548) += `onRebuild?: (report: VifxRebuildReport) => void` (A1), `userPlugins?: Plugin[]` (A2), `incremental?: boolean` (A4), `transformCacheInstance?: TransformCache` (A1) — **tous ignorés** au commit contrats.
- Router les 3 plugin-arrays Expo (build l.1164, **chemin metro l.1086** sans indirect-eval, `createViteServer` l.1559) via le pipeline-helper. `userPlugins=[]` ⇒ identique.

> **Décision watcher (FIX `changedPaths`)** : `watch.ts` reste **pur**. `runSerializedRebuilds` (l.113) calcule `changedPaths` (l.116) mais invoke `options.rebuild()` **sans argument** (l.127) — confirmé. La closure **ne peut pas** remplir `report.changedPaths` sans une nouvelle voie de données. **Décision** : `changedPaths` reste **optionnel/omis en dev** (§1.1). L'évolution éventuelle de la signature `rebuild(ctx)` dans `CreateBundleWatcherOptions` est **réservée à A1** (pas A4), **uniquement si** A1 décide de la propager dans **sa** propre unité — `watch.ts` n'est **pas** touché en batch/00.

### 1.7 `packages/vite-plugin-react-native/src/index.ts` — rendre le `TransformCache` injectable (FIX bloquant)

**FIX bloquant** : honorer `options.transformCacheInstance` dans `createTransformCacheForState` (l.2286) — si une instance est fournie, **l'utiliser** au lieu d'en créer une. Inerte par défaut (`transformCacheInstance` absent ⇒ comportement actuel exact, même version-key). Threadé via `createReactNativePluginState`. C'est la voie par laquelle A1 surface le handle pour `snapshotDelta()`.

- **Garde-fou byte** : vérifier que l'injection d'un cache **équivalent** ne change **pas** la sortie (version-key/invalidation identiques au chemin sans-cache injecté).

### 1.8 `packages/transform-cache/src/index.ts` — **réservé, non implémenté** (exclusif A1)

Ne **rien** changer ici en batch/00. `snapshotDelta()` touche **3 points** (interface l.57, literal retourné l.259, reset dans `clear()` l.277) — c'est l'affaire d'A1, pas du commit contrats.

### 1.9 `packages/vite-plugin-react-native/src/module-registry/index.ts` — **hook-points, pas split linéaire** (FIX) + réserver 2 champs

**FIX faisabilité** : la séquence `rm(142)` → `planMetroEntryModule(144)` → `build(184)` → `collectStagedChunks(185)` → `serialize(195)` → `writeFile×2`/`rename`/`rm staging`(215-222) est **entrelacée** (vérifié) — pas 3 blocs linéaires. **Ne pas prétendre** à un split `prepare/finalize` propre.

- Poser des **hook-points internes nommés** `onPhaseStart/onPhaseEnd` autour de `build` / `serialize` / `write`, qui **mesurent sans réordonner** le flux. Inertes (no-op par défaut) ⇒ byte-identique.
- **Réserver DEUX champs supplémentaires** sur `BuildModuleRegistryBundleOptions` (l.38) — **FIX** : sinon A2 et A4 ré-éditent la même interface en conflit :
  - `userInlineConfig?: import('vite').InlineConfig` (A2),
  - `graphHandle?: VifxIncrementalGraphHandle` (A4).
- Étendre `ModuleRegistryBundleResult` (l.58) avec `timings?: { transformMs:number; serializeMs:number; writeMs:number }` (réservé A1, non rempli).
- Le **chemin l.138-233 reste byte-identique** quand `graphHandle`/`userInlineConfig`/hooks absents (défaut).

### 1.10 `packages/vite-plugin-react-native/src/module-registry/serializer.ts` — réserver la signature (seam A4)

`SerializeModuleRegistryOptions` += `previousSerialization?: { moduleIds; modules }` **non lu**. `serializeModuleRegistryBundle` continue de tourner sur le graphe **COMPLET**. JSDoc explicite : **`bundleLineOffset` est cumulatif** (l.613/652, `+= countLines − 1` — vérifié) ⇒ un module changeant de hauteur de lignes **décale TOUS les offsets aval** ; ordering/id-assignment/sourcemap restent full ; l'incrémentalisation byte-exacte est l'objet (incertain) d'A4.

### 1.11 `packages/vite-plugin-react-native/src/modes.ts` (defines, **réservé**) + `@vifx/errors`

- Réserver le code d'erreur `VIFX_USER_VITE_CONFIG_CONFLICT` (rempli par A2).

### 1.12 Preuve d'inertie (gate batch/00) — **metro-prod inclus**

`pnpm -C packages/{types,config,transform-cache,vite-plugin-react-native,vite-plugin-expo,cli} build` (ordre deps) → `vp check && vp test` verts → **diff byte-identique** des `index.bundle`/`.map` sur HNewsPro pour **4 cibles** : `metro-dev`, **`metro-prod`** (FIX — le plan initial ne testait que metro-dev), `hoisted-prod`, `web-preview` → **merge sur master**. Toute non-identité = **blocage** (le −2,2 % mangling en dépend).

---

## 2. CONTRATS D'INTERFACE & PROPRIÉTÉ

| Surface partagée                                                                                 | Owner                                                                          | Lecteurs (read-only)                                             | Règle                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`pipeline.ts` / `buildVifxPluginPipeline`** (metro-aware, 5 call-sites)                        | **A2**                                                                         | A1 (`onPhase`), A3/A4 (lisent l'ordre)                           | SEUL point d'injection user. `includeIndirectEval` **explicite** (metro=false). vifx **physiquement en tête** ⇒ gagne la course `resolveId`.     |
| **`runExpoGoRebuild(ctx)`** (extrait en batch/00)                                                | **A1** (hook timing) / **A4** (flag `incremental`)                             | —                                                                | Champs `ctx` disjoints. **Extraction faite en batch/00** pour éviter le conflit A1↔A4 sur la closure.                                            |
| **`transformCacheInstance`** (injection cache, RN+Expo options + `createTransformCacheForState`) | **A1** (consommateur)                                                          | A3                                                               | Posé inerte en batch/00. A1 fournit l'instance et lit `snapshotDelta()`.                                                                         |
| **`modes.ts` : `resolveDefines`/`resolveOutputOptions`/`resolvePublicEnv`/`VIFX_IMPOSED_*`**     | **A3**                                                                         | A2 (lit `IMPOSED_*` uniquement, **jamais** le hook expo runtime) | A3 = **valeur** des defines ; A2 = **non-écrasabilité**.                                                                                         |
| **`config` : `userConfigFile`** (palier `vite`/`VITE_KEYS`)                                      | **A2**                                                                         | —                                                                | réservé batch/00.                                                                                                                                |
| **`config` : `unifiedEnv`** (palier **top-level**/`TOP_LEVEL_KEYS`)                              | **A3**                                                                         | A2                                                               | réservé batch/00, palier **tranché**.                                                                                                            |
| **`watch.ts`** (`durationMs` l.128)                                                              | **inchangé** (batch/00 ne le touche pas)                                       | —                                                                | A1 émet le report via `onRebuild`/`runExpoGoRebuild`, **pas** via l'event watcher. `changedPaths` omis en dev.                                   |
| **`transform-cache` : `snapshotDelta()`** (3 points : iface/literal/clear)                       | **A1** (exclusif)                                                              | —                                                                | `stats()` cumulatif **inchangé** (testé).                                                                                                        |
| **`module-registry` : hook-points + `userInlineConfig` + `graphHandle` + `timings`**             | **A4** (graphe/incrémental) / **A2** (`userInlineConfig`) / **A1** (`timings`) | —                                                                | **`userInlineConfig` ET `graphHandle` réservés en batch/00** (FIX). `build.rollupOptions.output` = **RESERVED** non-écrasable (FIX A2, cf. §A2). |
| **`serializer.ts` : `previousSerialization`**                                                    | **A4** (exclusif)                                                              | —                                                                | batch/00 ne promet rien d'incrémental ; `bundleLineOffset` cumulatif documenté.                                                                  |
| **5 entry-points `build()`/`createServer()`**                                                    | **personne** en direct post-batch/00                                           | tous                                                             | tout passe par un **param optionnel réservé** ou par `pipeline.ts`.                                                                              |

---

## 3. LES UNITÉS

> Recette e2e par unité : `pnpm -C packages/<pkg> build` (ordre deps) → `vp check` → `vp test` (pkg) → e2e ciblé (HNewsPro / playground-expo, `vifx expo smoke`, `vifx export:embed`). PR isolée. (cross-pkg) rebuild dist avant tout essai du global `vifx`.

---

### A1 — `batch/01-instrumentation` · taille **M** (chrono S + cache-rate M) · risque faible→moyen

**But** : à chaque save dans `vifx expo dev --expo-go --fast-refresh`, afficher au terminal la durée du rebuild ventilée par phase (transform+bundle / serialize / write / apply ; `hbc?` absent en dev) **et** le hit-rate du cache **PAR CYCLE** (pas cumulatif, qui converge faussement vers ~99 %). Même donnée en **NDJSON** via `--json`. Baseline chiffrable.

> **Re-classé S→M** (FIX stress-test) : la chronométrie pure (`transformMs/serializeMs/writeMs/applyMs/hbcMs`, `formatRebuildReport`, NDJSON) est S. Le **hit-rate par cycle** exige la plomberie d'injection du cache (posée en batch/00, §1.7) car `buildExpoBundle` n'a **aucun** transformCache aujourd'hui (vérifié : 0 occurrence). **Sous-découpage recommandé** si on veut livrer vite : **A1a** (chrono, S, valeur immédiate) puis **A1b** (cache-rate, M, plomberie). Une seule PR acceptable si l'agent absorbe les deux.

**Fichiers** :

- `packages/transform-cache/src/index.ts` — **exclusif**. `snapshotDelta(): VifxCycleCacheStats` (delta depuis le dernier appel, reset des baselines). **3 points** : ajouter à l'interface `TransformCache` (l.57), au literal retourné (l.259), reset dans `clear()` (l.277). **NE PAS toucher `stats()`** (cumulatif, testé).
- `packages/vite-plugin-react-native/src/index.ts` — **partagé** : (1) fournir l'instance via `transformCacheInstance` (canal batch/00) ; (2) remplir `cacheStats`+`rebuildTimings` sur le retour **métro** de `buildReactNativeBundle` (l.3344-3357 — `cacheStats` aujourd'hui **absent** du retour métro) ; (3) `hbcMs` : entourer `compileHermesBytecode` de `performance.now()` (**chemin export uniquement**, optionnel/absent en dev).
- `packages/vite-plugin-react-native/src/module-registry/index.ts` — **remplir `timings`** via les hook-points batch/00 (transform = `await build` l.184 ⇒ `transformMs`, étiquette honnête « transform+bundle » : un seul `await build()`, **pas de pur Babel isolable** ; `serialize` l.195 ⇒ `serializeMs` ; `writeFile×2`+`rename`+`rm staging` l.215-222 ⇒ `writeMs`).
- `packages/vite-plugin-expo/src/index.ts` — **partagé** : (1) créer un `transformCache` explicite dans `buildExpoBundle`, l'injecter via `transformCacheInstance` **et** lire `snapshotDelta()` après le build ; poser `rebuildTimings`+`cacheStats` sur le `VifxBundleArtifacts`. (2) Dans **`runExpoGoRebuild`** (extrait batch/00, ex-l.1314), encadrer le bloc HMR (`computeHmrUpdate` → broadcast/reload) via le hook `onPhase` ⇒ `applyMs` ; composer le `VifxRebuildReport` (`changedPaths` **omis**) ; `options.onRebuild?.(report)`.
- `packages/cli/src/commands/expo-dev.ts` — **partagé** : construire `onRebuild` avant `startExpoGoDevServer` (l.276) ; mode terminal → `process.stdout.write(formatRebuildReport(report)+'\n')`. **FIX `--json`** : le `--json` actuel renvoie **déjà** un blob `JSON.stringify(…, null, 2)` **multi-ligne** dans `stdout` (l.304, écrit avant `waitUntilExit`). Ajouter des lignes NDJSON casserait le parse. **Décision** : en `--json`, **passer le snapshot initial du dev server en JSON compact 1-ligne** (mettre à jour les tests concernés) pour que le flux soit du **NDJSON pur** (1 ligne snapshot + 1 ligne/cycle). Documenter le changement de format dans la PR.
- `packages/cli/src/commands/expo-shared.ts` — **partagé** : `formatRebuildReport(report): string` (réutilise `formatVifxKeyValues`/chalk via `@vifx/logger`). Format : `~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)`.
- `BENCHMARKS.md` — **exclusif** : section « Mesure de la DX warm » ; hit-rate **par cycle** ; ancrer le 3,8 s / 3,2× au nouvel outil reproductible `--json`.

**INTERDITS** : ne pas toucher `watch.ts` (le report passe par `onRebuild`/`runExpoGoRebuild`, `changedPaths` omis). Ne pas modifier la composition des plugins (`pipeline.ts` = A2). Ne pas changer la sortie du chemin **hoisted** (byte-identité requise). `hbcMs` **optionnel et absent en dev**. L'injection du cache doit être **byte-transparente** (sinon régression sortie).

**Contrat possédé** : `TransformCache.snapshotDelta()` ; `ModuleRegistryBundleResult.timings` (rempli) ; `StartExpoDevServerOptions.onRebuild` (rempli) ; format **NDJSON** de `--json` pour `expo dev` (snapshot initial passé en 1-ligne).

**Recette e2e (autonome)** : build deps `types→transform-cache→vite-plugin-react-native→vite-plugin-expo→cli` → `vp check && vp test` → `vifx expo dev <HNewsPro> --expo-go --fast-refresh` → toucher `App.tsx` → vérifier 1 ligne d'instrumentation (~100-300 ms, ventilation + hit-rate **du cycle**) → toucher un 2e fichier différent → vérifier que le hit-rate **reflète ce cycle** (ne converge **pas** vers 99 %) → relancer `--json` → flux **NDJSON pur parseable** (1 snapshot 1-ligne + 1 ligne/save) → vérifier hoisted **byte-identique**.

---

### A2 — `batch/02-vite-plugins` · taille **L** (L-haut) · risque moyen · **le moat**

**But** : charger & merger le `vite.config.vifx.ts` user (généré par `vifx vite init`, codemods, mais **jamais lu** — `grep mergeConfig/loadConfigFromFile = 0`, vérifié) dans **tous** les call-sites, via `@vifx/vite-config-bridge`. Ordering déterministe `vifx(enforce:pre)`↔`user`, **liste blanche** vs **clés RÉSERVÉES**, garde-fous qui **détectent et WARN** quand un plugin/alias user casse silencieusement la résolution `.ios`/`.native`/`AssetRegistry`.

**Nouveau package** : `packages/vite-config-bridge/` (deps : `vite` peer, `@vifx/errors`, `@vifx/types`).

- `loadUserViteConfig({projectRoot, configFile, command, mode, platform}): Promise<…|null>` (via `loadConfigFromFile` de Vite ; `null` ⇒ comportement actuel **exact** préservé).
- `mergeWithVifx(userResult, vifxInline, guardCtx): InlineConfig` (via `mergeConfig`, **puis** OVERWRITE explicite des `RESERVED_VITE_KEYS` — `mergeConfig` **concatène** les tableaux, donc `resolve.conditions/dedupe/define` doivent être ré-imposés).
- **FIX bloquant (staging-CJS)** : sur le chemin **metro**, `RESERVED_VITE_KEYS` inclut **`build.rollupOptions.output` ENTIER** (`format:'cjs'`, `preserveModules:true`, `exports:'named'`, `preserveModulesRoot` — vérifié l.160-170). **Ne PAS `mergeConfig` le `stagingConfig` globalement** : n'injecter que `userPlugins` + `resolve`/`define` filtrés. Un user touchant `output` casserait **silencieusement** la sérialisation Fast Refresh.
- `detectNativeResolutionConflicts(userConfig): VifxDiagnosticData[]` (warn sur `alias['react-native']`, `optimizeDeps.include`, plugin user `resolveId` `enforce:pre`).
- `RESERVED_VITE_KEYS` (conditionnelle au `resolvePlatform` : `optimizeDeps`/`server.*` autorisés sur le dev server **web**, interdits en natif) / `ALLOWED_VITE_KEYS`.
- `src/index.test.ts` : ordering, ré-imposition RESERVED (dont `output` sur metro), passage ALLOWED, `detectNativeResolutionConflicts`.

**Fichiers** :

- `packages/vite-plugin-react-native/src/index.ts` — **owner via `pipeline.ts`** : `mergeWithVifx(loadUserViteConfig(...), vifxInline)` sur hoisted (l.3361/3386) + web-preview (l.3014) ; passer `userPlugins` au pipeline. Émettre les warns.
- `packages/vite-plugin-react-native/src/module-registry/index.ts` — **partagé** : utiliser `userInlineConfig` (réservé batch/00) ; **n'injecter que `userPlugins` + `resolve`/`define` filtrés** dans `stagingConfig` (jamais `output`). Merge **une fois** (pas par cycle).
- `packages/vite-plugin-expo/src/index.ts` — **owner via `pipeline.ts`** : `buildExpoBundle` (l.1164), chemin metro (l.1086, **sans indirect-eval**), `createViteServer` (l.1559). vifx en tête.
- `packages/config/src/index.ts` — **remplir** : valider `userConfigFile` (pas de chargement ici).
- `packages/cli/src/commands/export-embed.ts` + `dev.ts` + `run.ts` + `build.ts` + `expo-dev.ts` — **partagé** : résoudre le **chemin** `userConfigFile` (`config.vite.userConfigFile ?? autodetect VIFX_VITE_CONFIG_FILE_NAMES`) et le passer dans `buildOptions` (canal cross-subprocess : le CLI passe le **chemin**, le build charge **in-process** via `loadConfigFromFile`).
- `@vifx/errors` — remplir `VIFX_USER_VITE_CONFIG_CONFLICT`.

**INTERDITS** : ne pas écraser le define table (A3 owner ; A2 lit **uniquement** `modes.ts::VIFX_IMPOSED_*`, **jamais** le hook expo runtime). Ne pas toucher `watch.ts` ni `serializer.ts`. Ne pas éditer les arrays plugins **inline** (tout via `pipeline.ts`). Ne pas `mergeConfig` le `stagingConfig` metro globalement (`output` RESERVED). Router les warns via `@vifx/logger` (respecter `logLevel:'silent'`).

**Décisions tranchées** : (1) plugins vifx **physiquement en tête**, pas seulement `enforce:'pre'` (l'ordre `resolveId` entre plugins de même enforce n'est **pas garanti** par contrat Vite/Rolldown). (2) `RESERVED` conditionnelle au `resolvePlatform`. (3) Fichier chargé = template **Vite** `buildViteConfigTemplate` (`defineConfig`, codemods:261), pas `defineVifxConfig`. (4) Opt-out : `vite.userConfigFile:false`. (5) **Question ouverte** : `warn` (défaut) vs `error` quand un plugin user `enforce:'pre'` expose `resolveId` — recommandation : **warn** + vifx physiquement en tête ; `error` envisageable en v2.

**Contrat possédé** : `@vifx/vite-config-bridge` ; `VifxViteConfig.userConfigFile` ; `BuildModuleRegistryBundleOptions.userInlineConfig` (réservé batch/00) ; `VIFX_USER_VITE_CONFIG_CONFLICT`.

**Recette e2e (autonome)** : `vifx vite init` sur fixture expo → plugin user `{name:'user-banner', transform(code,id){ return id.endsWith('App.tsx') ? '/* user-banner */\n'+code : null }}` → `vifx export:embed --platform ios --bundle-output /tmp/out.bundle --dev false` → `grep '/* user-banner */' /tmp/out.bundle` (présent) → vérifier `App.ios.tsx` + asset png résolvent (id numérique AssetRegistry présent) → ajouter `resolve:{alias:{'react-native':'react-native-web'}}` → re-export → warn `VIFX_USER_VITE_CONFIG_CONFLICT` + RN natif toujours bundlé → ajouter `build.rollupOptions.output.format:'es'` dans la config user → **vérifier que le staging metro CJS est intact** (sérialisation FR non cassée) → **régression** : sans `vite.config.vifx.ts`, bundle **byte-identique** → `vp check && vp test`.

---

### A3 — `batch/03-native-web` · taille **L** · risque moyen · **borné ADR-005**

**But** : unifier define/env via un **seul** `resolveDefines` (fusionne `import.meta.env` + `process.env`, y compris `EXPO_PUBLIC_*`) pour **natif ET web** ; partager config/env entre natif et web (lever le XOR ou, **au minimum**, garantir define/env partagés) ; **tuer le shim `__VIFX_WEB_RUNTIME__`** au profit du chemin réel RNW+Vite ; livrer `apps/playground-universal` + preuve côté-à-côté. **HONNÊTE** : reanimated/skia/sqlite/gesture-handler reroutés/dégradés. **NE PAS sur-investir le web ni casser le corridor natif Expo Go** (gate ADR-003).

**FIX cross-package atomique** : la suppression du shim touche RN `index.ts` **ET** Expo `index.ts:786-789` (le runtime dev web lit `globalThis.__VIFX_WEB_RUNTIME__` et appelle `runtime.mount(root)`). Si seule la moitié RN atterrit, `startExpoDevServer` (dev web) **casse** (mount undefined). **Tout dans un seul PR atomique**, avec les deux tests.

**Fichiers** :

- `packages/vite-plugin-react-native/src/modes.ts` — **owner** : `resolveDefines` = **SEULE** source du define table. Pour chaque clé `publicEnv` (filtrée par prefix, **triée** — figer l'ordre pour la byte-identité), émettre **À LA FOIS** `import.meta.env.<k>` ET `process.env.<k>` = `JSON.stringify(v)`, en plus de `__DEV__`/`global`/`process.env.NODE_ENV`/`EXPO_OS`. Web **sans** `EXPO_OS` (invariant testé l.50-52). Ajouter+exporter `resolvePublicEnv(env,prefix)`. Documenter : web **sans** chemin prod (`resolveOutputOptions` web→es) — **hors-scope ADR-005**.
- `packages/vite-plugin-react-native/src/index.ts` — **partagé** : config hook (l.2444-2457) passe `publicEnv`/`publicEnvPrefix` (depuis `options.env`). **SUPPRIMER le shim** : blocs `__VIFX_WEB_RUNTIME__` de `renderCompat` (l.1439-1480 — **garder l'`AppRegistry` RNW réel** qui mémorise les appKeys/`rootTag`, sans état global maison) + `runtimeScript` (l.3232-3238) ; `writeWebRuntimeArtifacts` (~324 lignes l.2952-3273) + son appel (l.3429-3451). Garder les reroutes web **honnêtes** (`WEB_COMPAT_SPECIFIERS` l.128) **documentés comme dégradations**. Exporter `resolveDefines`/`resolvePublicEnv` (bloc l.70-81, figé en batch/00).
- `packages/vite-plugin-expo/src/index.ts` — **partagé** : supprimer `resolvePublicEnv` local (l.123-134) + réduire le define hook `expo()` (l.899-914) à `__EXPO_APP_CONFIG_PATH__` seul (déléguer à `resolveDefines`). **Retirer le shim du runtime dev (l.786-789)** et remplacer `runtime.mount()` par l'`AppRegistry.runApplication` RNW réel. `startExpoDevServer` (web l.1548) et `startExpoGoDevServer` (natif l.1266) partagent la **même** résolution config/env.
- `packages/cli/src/commands/expo-dev.ts` — **partagé** : viser le partage define/env (le **« OU minimum »** est l'objectif réaliste ; le co-démarrage réel natif+web = 2 serveurs/ports/lifetimes — **refactor non chiffré**, hors-scope strict de cette unité). Ajuster la garde `VIFX_EXPO_DEV_REQUIRES_WEB_COMPAT` (l.253-255).
- Tests : `tests/modes.test.ts` (injection conjointe natif ET web ; retirer/adapter le test l.279 de l'artefact shim) ; `vite-plugin-expo/tests/index.test.ts` (l.634 `not.toContain __VIFX_WEB_RUNTIME__` = garantie générale).
- `docs/adr/ADR-005-web-platform.md` — note de statut : shim retiré (preview-only) ; web via RNW réel ; rappel borne.

**Nouveaux fichiers** : `apps/playground-universal/` (`vifx.config.ts`, `src/App.tsx` lit `import.meta.env.EXPO_PUBLIC_*` ET `process.env`, `src/message.ios.ts`, `src/message.web.ts`, dep `react-native`+`react-native-web`, `index.js` `registerRootComponent`) ; `docs/proof/universal-side-by-side.md` (commandes, capture du même define injecté des deux côtés, **tableau HONNÊTE** des dégradations).

**INTERDITS** : ne **PAS** combler le chemin prod web (hors-scope ADR-005). Ne pas ajouter `web` à `VifxBundlePlatform` (reste `ios|android` ; web = mode de **résolution**). Pas de parité reanimated. Ne pas casser le corridor Expo Go : **sans aucune var `EXPO_PUBLIC_*`, bundle byte-identique** (avec var présente, changement attendu). Ne pas écraser les `IMPOSED_KEYS` qu'A2 lit. Livrer RN+Expo+tests **dans le même PR** (atomique).

**Contrat possédé** : `resolveDefines` (signature étendue, **unique** table) ; `resolvePublicEnv` exporté ; `VifxReactNativePluginOptions.publicEnv/publicEnvPrefix` ; **invariant** : toute clé `EXPO_PUBLIC_*` → `import.meta.env.<k>` ET `process.env.<k>` (natif comme web) ; **SUPPRIMÉ** : `globalThis.__VIFX_WEB_RUNTIME__`, `writeWebRuntimeArtifacts()` ; `apps/playground-universal`.

**Recette e2e (autonome)** : build deps → `vp check && vp test` → `EXPO_PUBLIC_VIFX_DEMO=hello vifx expo dev apps/playground-universal --platform ios --expo-go --json` → bundle servi contient `import.meta.env.EXPO_PUBLIC_VIFX_DEMO` ET `process.env.EXPO_PUBLIC_VIFX_DEMO` = `'hello'` → lancer le web depuis la **MÊME** config/env → même define + `grep` confirme **0** `__VIFX_WEB_RUNTIME__` → côté-à-côté : `Platform.OS=ios` natif / `=web` navigateur, même `message.<platform>` → importer `react-native-reanimated` → reroute dégradé documenté (no-op, pas de crash) → **gate non-régression** : HNewsPro/playground-expo **byte-identique** sans var `EXPO_PUBLIC_*`.

---

### A4 — `batch/04-hmr-incremental-poc` · taille **M (POC)** → **L si serializer partiel** · risque **élevé** · **pari à faible espérance**

**But** : **prouver ou réfuter par la mesure sur device** que vifx produit un delta Fast Refresh Metro (`__d`/`__r`) en gardant un graphe chaud et en re-sérialisant **seulement** le sous-graphe touché, sous **300 ms**. **CE SPRINT = POC GO/NO-GO instrumenté, PAS l'XL.** **Nuance** : Metro fait **DÉJÀ** de l'incrémental (DeltaBundler) — la barre est **égaler/battre Metro sur la même app**.

> **Espérance faible — types Rolldown 1.0.1 VÉRIFIÉS** : `RolldownBuild` n'expose que `generate()/write()/close()/[asyncDispose]/watchFiles@hidden` — **aucun** `invalidate`/`rebuild`/`hotUpdate`. `DevEngine.invalidate(file)` retourne un `BindingHmrUpdate` `type:'Patch'` `{code,filename,sourcemap,hmrBoundaries}` = format **module-runner Vite** (`import.meta.hot`), **jamais** `__d`/`__r`/`__accept`. Le runtime device vifx (FR-A..D) ne consomme **pas** ce format.

**GATE SPIKE — ÉTAPE 0 (0,5 j, BLOQUANT, hors-src, jetable, AVANT d'ouvrir le worktree)** :

- **Variante B (DevEngine→`__d`)** : **NO-GO clean quasi-certain** (types confirment `Patch` module-runner ≠ `__d`). Ne **pas** coder.
- **Variante A (warm `RolldownBuild`)** : éditer 1 fichier, rappeler `generate()`, **chronométrer le delta-t**. **Décide GO/NO-GO** : `generate()` réutilise-t-il un cache transform interne (non documenté) ? **Si non → NO-GO/GO-CONDITIONNEL, ne PAS coder `incremental-serializer.ts`.** Ne **pas** dépendre de `watchFiles@hidden`.
- Consigner : le dev métro passe-t-il par hbc à chaque save ? (si non, hbc hors budget → POC plus favorable).

**Fichiers (tous derrière flag POC, défaut OFF — uniquement si le spike est GO)** :

- `packages/vite-plugin-react-native/src/module-registry/index.ts` — **partagé** : variante `buildModuleRegistryBundleIncremental` (utilise `graphHandle` réservé batch/00 ; pas de `rm`, garde un handle chaud). **Chemin l.138-233 intact et défaut.**
- `packages/vite-plugin-react-native/src/module-registry/serializer.ts` — **partagé** : mode re-sérialisation partielle (`previousSerialization`). **NE PAS toucher `serializeModuleRegistryBundle`** (oracle plein-graphe).
- `packages/vite-plugin-expo/src/watch.ts` — **partagé, prudent** : **POC le plus sûr** = garder `fs/promises` (l.163), passer les `changedPaths` à la couche incrémentale. **Jamais** un second watcher (fs/promises XOR Rolldown). Ajouter `source?:'fs'|'external'` à `CreateBundleWatcherOptions` (posé **ici**, par A4).
- `packages/vite-plugin-expo/src/index.ts` — **partagé** : brancher **`runExpoGoRebuild(ctx)`** (extrait batch/00) sur la variante incrémentale via `ctx.incremental`. `computeHmrUpdate` **reste le contrat de delta inchangé**.
- `hmr-delta.ts` — **aucune modif** (aval payé FR-C/D).

**Nouveaux fichiers** : `incremental-serializer.ts` (`SerializerWarmState` + `reserializePartial(...) → {code,map,modules,fallbackUsed}` ; **fallback explicite** vers plein-graphe) ; `warm-graph.ts` (variante A : `RolldownBuild`+`generate()`, mesurer le gain réel) ; `packages/cli/src/commands/hmr-bench.ts` (sous-commande **cachée** ; **étend/consomme** l'instrumentation A1, ne re-implémente pas un harnais parallèle ; `--json`).

**INTERDITS** : pas de modif du chemin prod (variante derrière flag). Ne pas toucher `serializeModuleRegistryBundle` (oracle). Pas de **second** watcher. Ne pas diverger du format de phases/NDJSON d'A1 (**consommer**, pas re-définir). Ne pas coder le serializer partiel **avant** un spike GO.

**Cas FACILE redéfini (FIX `bundleLineOffset` cumulatif)** : edit **ne changeant NI le graphe d'imports NI la hauteur en lignes du module touché ET préservant son rang** ⇒ mêmes `orderedFileNames`/`moduleIds`, offsets aval inchangés, seul le factory re-`rewriteRequires` + bloc sourcemap recomposé. **Plus étroit que « edit feuille »** : tout edit changeant le nombre de lignes décale `bundleLineOffset` de **tous** les modules aval → leurs mappings divergent de l'oracle. **Cas DIFFICILE → fallback plein-graphe** : import ajouté/retiré, fichier ajouté/supprimé, cycle, **ou changement de hauteur de lignes**.

**Contrat possédé** : `incremental-serializer.ts::{SerializerWarmState, reserializePartial}` ; `warm-graph.ts::WarmGraphHandle` ; `buildModuleRegistryBundleIncremental` (défaut OFF) ; `vifx hmr-bench --json` (cachée) ; `CreateBundleWatcherOptions.source`.

**Recette e2e (autonome)** : (0) **spike GATE** d'abord. (1) baseline `vifx expo dev <fixture> --fast-refresh` ; `/hot` connecté → (2) **test différentiel** (sans device, le plus important) : `reserializePartial` produit code/map **BYTE-EXACT** == `serializeModuleRegistryBundle` plein-graphe pour le cas facile redéfini → (3) **delta-équivalence** : delta `/hot` incrémental == delta `computeHmrUpdate` sur deux builds pleins → (4) **fallback** : edit changeant la hauteur de lignes **ou** ajoutant un import ⇒ `fallbackUsed=true` → (5) **stabilité des ids** sur N cycles → (6) **device** : `t_save→t_paint` (marker runtime), médiane + p95 sur ≥10 cycles, vifx-plein / vifx-POC / Metro DeltaBundler → (7) `hmr-bench --json`.

---

## 4. DAG DE DÉPENDANCES + VAGUES DE MERGE

```
                 ┌─────────────────────────────────────┐
                 │ batch/00-shared-contracts (S→M)       │  ← racine ÉLARGIE, merge AVANT tout spawn
                 │  + extraction runExpoGoRebuild        │
                 │  + transformCacheInstance injectable  │
                 │  + paliers config tranchés            │
                 │  + userInlineConfig & graphHandle     │
                 │  + pipeline metro-aware               │
                 └──────────────┬──────────────────────-┘
        ┌───────────────┬───────┴────────┬──────────────────────┐
        ▼               ▼                ▼                       ▼
  A1 (M)          A2 (L)            A3 (L)              A4 (M-POC→L)
  instrumentation vite-plugins      native-web          hmr-incremental
        │               │  IMPÉRATIF  │                   │ spike GATE pré-worktree
        │               └──►A2 avant A3 (define table)     │ + branche sur post-A1
        └────────────────────────────────────────────────►─┘  (consomme NDJSON/phases A1)
```

| Vague | Unités                                                   | Rationale                                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | `batch/00`                                               | Racine **élargie**. Mergé seul. Gate : inertie byte-identique **metro-prod inclus** + `vp check/test` + tests `assertAllowedKeys` par clé.                                                                                                                                                                                                   |
| **1** | **A1**                                                   | M. Valeur autonome (DX warm). Aucune dép amont hors batch/00.                                                                                                                                                                                                                                                                                |
| **2** | **A2 puis A3** — ordre **IMPÉRATIF** (pas « ordonnées ») | A3 supprime ~324 lignes de RN `index.ts` ; si A3 merge avant A2, les ancres de call-sites A2 (3014/3322/3386) **se décalent**. A2 d'abord ⇒ A3 rebase sur des call-sites déjà en forme `buildVifxPluginPipeline(...)`. A2 fournit `IMPOSED_*` (non-écrasabilité), A3 la valeur du define.                                                    |
| **3** | **A4** (POC)                                             | **Branche sur master POST-A1** (FIX — consomme NDJSON/phases/`formatRebuildReport` d'A1 ; le DAG « tous sur post-batch/00 » contredisait « A4 dép A1 »). Spike GATE **avant** d'ouvrir le worktree. Forte collision A1/A4 sur `runExpoGoRebuild` **neutralisée par l'extraction batch/00**. Merge en dernier ; **jetable** sans bloquer 1/2. |

**Worktrees** : après merge batch/00, ouvrir A1/A2/A3 sur master post-batch/00 ; **A4 sur master post-A1** (et seulement si le spike est GO).

---

## 5. JALONS GO/NO-GO — **durcis**

### A4 (POC — critère noir sur blanc)

- **Spike GATE (pré-worktree)** : si `generate()` ne réutilise **aucun** cache transform (mesuré en 0,5 j) **ET** variante B = `Patch` module-runner (déjà quasi-certain par les types) ⇒ **NO-GO direct, ne pas ouvrir le worktree**.
- **GO (→ engager l'XL)** : sur le **cas facile redéfini** (ni graphe ni hauteur de lignes modifiés), médiane `t_save→t_paint` **< 300 ms** ET **≥ 2×** plus rapide que le plein-graphe ET delta **byte-identique** à l'oracle, **sans** API `@hidden` instable.
- **NO-GO** : latence dominée par une phase **non-compressible** (re-transform plein car `generate()` sans cache, OU hbc plein) OU seule voie = API expérimentale non documentée (variante B `DevEngine`).
- **GO-CONDITIONNEL** (gain réel mais 300-600 ms, ou faisable seulement via `DevEngine` fragile) : **attendre une API incrémentale Rolldown publique** avant l'XL ; consigner **quelle phase domine** (Rolldown / serializer / hbc).

### A3 (borne ADR-005)

- **GO borné** : define/env unifiés réels + shim tué (RN+Expo **atomique**) + démo universal + preuve côté-à-côté + honnêteté des dégradations. **STOP** dès la tentation de sur-construire (chemin prod web, parité reanimated = **interdits**).
- **Gate non-régression** : corridor Expo Go (HNewsPro) **byte-identique** **sans** var `EXPO_PUBLIC_*`. Avec var ⇒ changement attendu.

### A2 (garde-fous)

- **GO** : plugin user visible dans le bundle ET résolution `.ios`/`AssetRegistry` intacte ; alias `react-native` user **ignoré** + warn `VIFX_USER_VITE_CONFIG_CONFLICT` ; **staging metro CJS intact** même si la config user touche `build.rollupOptions.output`. **Régression zéro** sans `vite.config.vifx.ts`.

### A1 (preuve)

- **GO** : 5 saves warm ≪ cold ; `serializeMs` identifié (pertinent pour A4) ; **hit-rate par cycle** réel (ne converge pas vers 99 %) ; `--json` = **NDJSON pur parseable** ; chiffres dans `BENCHMARKS.md`.

### batch/00 (gate élargi)

- **GO** : `vp check && vp test` verts ; **4 cibles byte-identiques** (metro-dev, **metro-prod**, hoisted-prod, web-preview) ; tests `assertAllowedKeys` verts pour `userConfigFile` ET `unifiedEnv` ; `runExpoGoRebuild` extrait byte-identique ; injection `transformCacheInstance` byte-transparente.

---

## 6. RISQUES RÉSIDUELS & INCONNUES (honnêteté — distingue acquis / à-portée / ambitieux)

**À-portée (faible incertitude)**

- **A1** — observationnel, sauf l'injection du cache : un cache injecté **non byte-transparent** régresserait la sortie. Mitigation : version-key/invalidation identiques + diff byte. Le changement de format `--json` (snapshot 1-ligne) **casse des tests existants** à mettre à jour.
- **A2** — `mergeConfig` **concatène** les tableaux ⇒ ré-imposer explicitement les `RESERVED_VITE_KEYS` (**dont `output` sur metro**), jamais se fier au merge. `loadConfigFromFile` = **exécution de code user au build** (déjà vrai pour `vifx.config.ts` ; élargit la surface de confiance à un 2e fichier). Un plugin user `enforce:'pre'` `resolveId` peut shadow `.ios`/`.native` ; le garde-fou **WARN** mais ne peut pas **empêcher** techniquement (l'ordre `resolveId` entre plugins de même enforce **n'est pas garanti** par contrat Vite/Rolldown) — mitigation : vifx **physiquement en tête**.

**Ambitieux (incertitude réelle)**

- **A3** — suppression de ~324 lignes (`writeWebRuntimeArtifacts`) + bloc shim `renderCompat` : risque de casser le re-mount RNW si `AppRegistry.runApplication` réel ne reproduit pas la mémoïsation `lastRegisteredAppKey`/`rootTag`. **2e risque du plan**. Cross-package atomique (RN + Expo `index.ts:786-789` + 2 tests) **obligatoire**. Le co-démarrage réel natif+web (2 serveurs/lifetimes) est un **refactor non chiffré** — l'unité vise le **partage define/env** (« OU minimum »), pas le co-démarrage.
- **A4 — RISQUE MAJEUR (peut tuer le POC)** : Rolldown 1.0.1 **n'expose pas** d'API incrémentale stable pour un format custom non-Vite (`__d`/`__r`) — **vérifié sur les types**. `RolldownBuild` = `generate/write/close/watchFiles@hidden` ; `DevEngine.invalidate` = `Patch` module-runner. Si `generate()` ne réutilise aucun cache **ET** `DevEngine` ne sort pas du `__d`, le « graphe chaud » n'économise que la transform → gain plafonné. Le **serializer plein-graphe est intrinsèquement O(graphe)** (DFS ordering, sort de **tous** les fileNames, `bundleLineOffset` **cumulatif** l.613/652 : un module changeant de hauteur décale tous les offsets aval, donc la byte-identité du delta partiel est **plus dure** que « edit feuille » — le cas facile est étroit). **Espérance faible assumée** : un NO-GO mesuré en 0,5 j est un **résultat valide**.

**Mécaniques (neutralisées par batch/00 élargi)**

- `assertAllowedKeys` **strict** : oublier `userConfigFile` OU `unifiedEnv` casse A2/A3 silencieusement → **tests par clé** en batch/00.
- `pipeline.ts` doit être **byte-for-byte** (l'ordre + la présence conditionnelle d'`createIndirectEvalPlugin` en prod influent sur le mangling/−2,2 %) → **metro-aware** (`includeIndirectEval`) + snapshot **metro-prod** inclus.
- `types/index.ts` + `config/index.ts` (4 owners, 1 fichier) : tous les champs posés à batch/00 ; les unités ne touchent que des **corps** ; `oxfmt` lancé en batch/00 pour figer le diff. **NOTE** : `VifxExpoPluginOptions.publicEnv/publicEnvPrefix` existent **déjà** (l.321-322) — ne pas redéclarer ; les poser sur `VifxReactNativePluginOptions` (l.290) où ils manquent.
- **Cross-pkg** : le global `vifx` lit `packages/cli/dist/bin.mjs` ⇒ rebuild dist dans l'ordre `types → config/transform-cache → vite-config-bridge → vite-plugin-react-native → vite-plugin-expo → cli` avant tout essai e2e du global.

---

## 7. Récap exécutable `/batch` — **une ligne par unité**

1. `git checkout -b batch/00-shared-contracts` ; appliquer §1.1-1.12 ; `pnpm -C packages/{types,config,transform-cache,vite-plugin-react-native,vite-plugin-expo,cli} build` ; `vp check && vp test` ; **diff byte-identique 4 cibles** (metro-dev/**metro-prod**/hoisted-prod/web-preview) HNewsPro ; **merge master**.
2. Ouvrir worktrees A1/A2/A3 sur master post-batch/00 ; **A4 sur master post-A1** (après le spike GATE).
3. **Vague 1** : A1. **Vague 2** : A2 **puis** A3 (impératif). **Vague 3** : A4 (ou consigner NO-GO/GO-CONDITIONNEL, ne pas merger le chemin POC en défaut).

**Lignes prêtes pour un agent `/batch`** :

- `batch/00-shared-contracts` — **(Coordinateur, merge en premier)** Pose tous les types/clés optionnels (§1.1-1.2, paliers tranchés : `userConfigFile`→`VITE_KEYS`, `unifiedEnv`→top-level), rend `transformCacheInstance` injectable (RN `createTransformCacheForState`), extrait `runExpoGoRebuild(ctx)` byte-identique, crée `pipeline.ts` **metro-aware** (`includeIndirectEval`) et câble les 5 call-sites byte-for-byte, réserve `userInlineConfig`+`graphHandle`+hook-points+`timings` sur `module-registry`, réserve `previousSerialization` sur `serializer`. Gate : `vp check && vp test` + byte-identité **4 cibles** (metro-dev/metro-prod/hoisted-prod/web-preview) + tests `assertAllowedKeys` par clé.
- `batch/01-instrumentation` — **(taille M)** `TransformCache.snapshotDelta()` (3 points) ; remplir `timings` via hook-points `module-registry` ; injecter+lire un transformCache dans `buildExpoBundle` ; encadrer le bloc HMR de `runExpoGoRebuild` (`applyMs`) + composer `VifxRebuildReport` (`changedPaths` omis) ; `formatRebuildReport` + `--json` **NDJSON pur** (snapshot initial passé en 1-ligne). INTERDIT : `watch.ts`, `pipeline.ts`, sortie hoisted. Recette : save HNewsPro → 1 ligne ventilée + hit-rate **du cycle** ; `--json` parseable.
- `batch/02-vite-plugins` — **(taille L)** Créer `@vifx/vite-config-bridge` (`loadUserViteConfig`→`null` si absent, `mergeWithVifx` avec ré-imposition `RESERVED_VITE_KEYS` **dont `build.rollupOptions.output` sur metro**, `detectNativeResolutionConflicts`) ; brancher sur les 6 call-sites via `pipeline.ts` (jamais inline) ; threader `userConfigFile` (chemin) depuis les callers CLI ; vifx **physiquement en tête**. INTERDIT : écraser le define table (lire `VIFX_IMPOSED_*` seulement), `mergeConfig` global du stagingConfig metro. Recette : plugin user visible dans le bundle + `.ios`/AssetRegistry intacts + alias RN ignoré+warn + staging CJS intact + régression zéro sans config user.
- `batch/03-native-web` — **(taille L, borné ADR-005, PR atomique)** Faire de `resolveDefines` la seule table (émettre `import.meta.env.<k>` ET `process.env.<k>` triés pour natif ET web, `EXPO_OS` natif seulement) ; supprimer le shim `__VIFX_WEB_RUNTIME__` (RN `renderCompat`/`runtimeScript`/`writeWebRuntimeArtifacts` **ET** Expo runtime dev l.786-789, remplacé par `AppRegistry.runApplication` RNW réel) ; partager config/env entre `startExpoGoDevServer` et `startExpoDevServer` (partage define/env minimum, pas le co-démarrage) ; livrer `apps/playground-universal` + `docs/proof/universal-side-by-side.md`. INTERDIT : chemin prod web, parité reanimated, `web` dans `VifxBundlePlatform`, casser le corridor Expo Go (byte-identique sans var `EXPO_PUBLIC_*`). Recette : même define injecté des deux côtés + 0 `__VIFX_WEB_RUNTIME__` + HNewsPro byte-identique sans var.
- `batch/04-hmr-incremental-poc` — **(POC, branche sur post-A1, spike GATE pré-worktree)** D'abord spike 0,5 j hors-src : mesurer si `RolldownBuild.generate()` réutilise un cache transform ; **NO-GO si non** (variante B `DevEngine`→`Patch` déjà NO-GO par les types). Si GO : `incremental-serializer.ts` (`reserializePartial`, fallback plein-graphe explicite) + `warm-graph.ts` + `buildModuleRegistryBundleIncremental` (flag OFF, via `graphHandle`) + brancher `runExpoGoRebuild(ctx.incremental)` + `hmr-bench --json` (consomme l'instrumentation A1). INTERDIT : toucher `serializeModuleRegistryBundle` (oracle), second watcher, chemin prod par défaut. GO si cas facile (ni graphe ni hauteur de lignes modifiés) < 300 ms ET ≥ 2× ET byte-identique à l'oracle, sans API `@hidden`.
