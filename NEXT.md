# NEXT

Plan d'achevement de `vifx`, aligne sur `SPECS.md`.

Ce document ne decrit pas des objectifs de demonstration, de smoke path, de preview ou de prototype comme etat
final d'une phase. Chaque etape ci-dessous doit se terminer sur une implementation complete du perimetre qu'elle
annonce.

## Regle de ce plan

Dans ce document, `100%` signifie toujours:

- le perimetre annonce est implemente en entier
- les APIs et commandes publiques sont stabilisees pour ce perimetre
- les tests unitaires, integration, fixtures et validations de compat couvrent ce perimetre
- la doc, la matrice de support et les erreurs utilisateur sont alignees
- il n'existe plus de trou fonctionnel connu dans le perimetre annonce

Important:

- les packages experimentaux definis comme experimentaux dans `SPECS.md` peuvent rester etiquetes experimentaux
  comme positionnement produit
- en revanche, leur contrat de premiere milestone doit etre implemente completement
- une phase n'est pas finie si son perimetre reste "partiel", "preview", "scaffold", "placeholder" ou
  "supporte seulement sur un exemple"

## Alignement avec la spec source

`SPECS.md` definit le projet de base comme:

1. une suite de compatibilite
2. des outils d'inspection Metro
3. des primitives reutilisables
4. une CLI de migration et d'analyse
5. une documentation complete
6. une couche Vite experimentale

La spec de base ne demande pas, au premier horizon, un remplacement total de Metro pour Expo.

Le plan ci-dessous est donc organise en trois programmes coherents:

- `Programme A`: achever integralement le projet defini par `SPECS.md`
- `Programme B`: achever integralement le support mobile natif, au-dela du perimetre initial
- `Programme C`: achever integralement le scenario "Expo sans Metro", si le projet le choisit comme produit

## Etat de depart

Etat actuellement observe dans le repo:

- la base monorepo existe
- la doc existe et a ete remise a niveau
- `vifx doctor`, `inspect`, `compat run`, `migrate`, `vite init`, `build`, `run`, `hermes compile` existent
- `@vifx/platform-resolver`, `@vifx/asset-registry`, `@vifx/source-map-tools`, `@vifx/hermes-tools`,
  `@vifx/expo-export`, `@vifx/vite-plugin-react-native`, `@vifx/vite-plugin-expo` existent
- la suite `compat` passe aujourd'hui sur un petit sous-ensemble de cas

Ce qui n'est pas acceptable comme etat final:

- des commandes reelles mais non completes dans leur contrat public
- des packages reels mais encore limites a un chemin de preuve etroit
- une matrice de support plus ambitieuse que la preuve
- un support mobile iOS/Android absent ou non structure
- un discours "Expo sans Metro" sans programme de parite explicite

## Programme A - Achever integralement le projet defini par `SPECS.md`

Objectif:

Livrer un `vifx` complet au regard de la spec de base, c'est-a-dire une fondation de qualite production pour la
compatibilite, l'inspection, les primitives, la CLI, la doc et les couches Vite experimentales.

### A1 - Fondation monorepo et contrats publics

Perimetre:

- `@vifx/types`
- `@vifx/errors`
- `@vifx/logger`
- `@vifx/config`
- structure monorepo, scripts, CI, releases, docs infra

Implementation complete attendue:

- `@vifx/types` expose tous les types partages necessaires a la suite du repo
- `@vifx/errors` couvre tous les codes d'erreur publics utiles et les formats CLI/doc
- `@vifx/logger` supporte proprement sortie pretty, JSON, verbose et silent
- `@vifx/config` est l'unique source de verite pour `defineVifxConfig` et `loadVifxConfig`
- les formats de config listes dans `SPECS.md` sont supportes et valides
- la doc de config est integralement alignee avec la forme implementee

Critere de fin:

- plus aucun package de fondation n'est un scaffold ou un contrat implicite
- toute commande ou package utilisateur peut s'appuyer sur ces contrats sans logique parallele

Validation minimale:

```sh
pnpm --filter @vifx/types run test
pnpm --filter @vifx/errors run test
pnpm --filter @vifx/logger run test
pnpm --filter @vifx/config run test
```

### A2 - Compatibilite et inspection Metro completes

Perimetre:

- `@vifx/compat`
- `@vifx/compat-runner`
- `@vifx/metro-inspect`
- fixtures de reference

Implementation complete attendue:

- toutes les categories de compat de base de `SPECS.md` existent reellement
- les cas sont implementation-agnostic
- `metro-inspect` produit des rapports deterministes et lisibles
- `compat-runner` compare proprement `metro` et `vifx`
- les fixtures couvrent RN bare, Expo, Expo Router, assets, workspaces
- les echos docs/CLI/JSON sont coherents

Categories minimales a achever integralement:

- `resolver.platformExtensions`
- `resolver.packageMainFields`
- `resolver.packageExports`
- `assets.scaleGroups`
- `assets.metadata`
- `bundler.bundleArtifacts`
- `bundler.sourceMapValidity`
- `monorepo.workspaceResolution`

Critere de fin:

- la suite de compat n'est plus "petite mais verte"; elle devient une vraie definition executable du contrat
- chaque ligne importante de la matrice de support a un ancrage test ou fixture

Validation minimale:

```sh
pnpm --filter @vifx/cli vifx compat run --adapter metro --report json
pnpm --filter @vifx/cli vifx compat run --adapter vifx --report json
pnpm --filter @vifx/cli vifx compat run --adapter all --report markdown
```

### A3 - Primitives completees integralement

Perimetre:

- `@vifx/platform-resolver`
- `@vifx/asset-registry`
- `@vifx/source-map-tools`
- `@vifx/hermes-tools`
- `@vifx/expo-export`

Implementation complete attendue:

- le resolver couvre les fichiers plateforme, packages, `react-native`, `exports`, workspaces et symlinks
- l'asset registry couvre les types annonces dans `SPECS.md` avec metadata stables
- les outils sourcemaps couvrent validation, normalisation, comparaison et base de symbolication
- `hermes-tools` couvre detection, compilation, erreurs d'installation et sortie stable
- `expo-export` inspecte completement les exports Expo declares par la spec de base

Critere de fin:

- les primitives ne sont plus des aides locales aux plugins; elles deviennent des packages autonomes et fiables
- la doc package par package est suffisante pour une reutilisation externe

Validation minimale:

```sh
pnpm --filter @vifx/platform-resolver run test
pnpm --filter @vifx/asset-registry run test
pnpm --filter @vifx/source-map-tools run test
pnpm --filter @vifx/hermes-tools run test
pnpm --filter @vifx/expo-export run test
```

### A4 - Core, codemods et CLI completes

Perimetre:

- `@vifx/core`
- `@vifx/codemods`
- `@vifx/cli`

Implementation complete attendue:

- `core` detecte correctement Expo, RN bare, workspace root et charge la config
- `codemods` sont conservateurs, testables, dry-run first, avec preview de patch
- la CLI couvre integralement le contrat public de `SPECS.md`
- les regles de securite de migration de `SPECS.md` sont appliquees integralement
- les commandes existantes hors spec de base (`build`, `run`) sont soit formalisees completement, soit retirees
- les messages d'erreur et de diagnostic sont coherents sur toute la surface CLI

Contrat CLI a achever integralement:

- `vifx init`
- `vifx doctor`
- `vifx inspect`
- `vifx compat run`
- `vifx metro inspect`
- `vifx migrate`
- `vifx migrate expo`
- `vifx migrate react-native`
- `vifx vite init`
- `vifx hermes compile`

Decision de coherence:

Le repo contient deja `vifx build` et `vifx run`. Le plan retient de les conserver, mais seulement si:

- leur contrat est documente
- leurs erreurs sont stables
- leurs tests d'integration existent
- leur place dans la strategie produit est explicite

Les sorties de migration et de generation doivent aussi etre alignees avec `SPECS.md`:

- noms de fichiers generes
- scripts ajoutes au `package.json`
- positionnement de `vite.config.vifx.ts` vs `vite.config.ts`
- texte de rollback et de next steps

Critere de fin:

- toute la surface CLI publique peut etre executee, testee et documentee comme un vrai outil developpeur
- plus aucune commande n'existe en tant que detail d'implementation sous-documente

Validation minimale:

```sh
pnpm --filter @vifx/cli run test
pnpm --filter @vifx/cli vifx doctor ./fixtures/expo-basic
pnpm --filter @vifx/cli vifx inspect ./fixtures/rn-bare-basic
```

### A5 - Documentation complete et cohérente

Perimetre:

- `apps/docs`
- `README.md`
- pages guides, reference, packages, concepts, migration, comparisons

Implementation complete attendue:

- toutes les pages enumerees par `SPECS.md` existent
- chaque package a sa page complete
- chaque commande CLI a sa page complete
- les packages experimentaux sont etiquetes experimentaux, mais sans contradiction avec leur vrai contrat
- la matrice de support est une verite documentaire, pas une approximation marketing
- les diagrammes, exemples et workflows sont coherents avec le code

Critere de fin:

- un lecteur peut comprendre le projet, ses limites et ses workflows sans se reposer sur l'historique de chat

Validation minimale:

```sh
pnpm --filter docs run build
```

### A6 - `@vifx/vite-plugin-react-native` complet dans le cadre de la spec de base

Perimetre:

- `@vifx/vite-plugin-react-native`
- son integration avec resolver, assets, sourcemaps et Hermes
- ses surfaces CLI associees si conservees

Important:

La spec de base le declare experimental. `100%` signifie donc:

- contrat experimental de premiere milestone implemente completement
- pas "equivalent total a Metro"

Implementation complete attendue:

- le plugin charge proprement dans Vite
- le support plateforme est reel
- l'injection des defines RN necessaires est complete pour le perimetre annonce
- le resolver et l'asset registry sont reellement integres
- les sourcemaps et Hermes sont reels et testes
- si un dev server endpoint est revendique, il est implemente et documente
- un playground RN bare formel existe, avec commande de validation maintenue
- les limitations sont documentees uniquement hors du perimetre revendique

Critere de fin:

- le package n'est plus un chemin de preuve; c'est un package experimental complet dans le perimetre de la milestone

Validation minimale:

```sh
pnpm --filter @vifx/vite-plugin-react-native run test
```

### A7 - `@vifx/vite-plugin-expo` complet dans le cadre de la spec de base

Perimetre:

- `@vifx/vite-plugin-expo`
- detection config Expo
- variables `EXPO_PUBLIC_*`
- scaffolding et integration CLI/documentation

Important:

La spec de base le declare experimental et ne lui demande pas encore un remplacement de `expo start`.
`100%` signifie donc:

- contrat de premiere milestone implemente en entier
- aucun trou connu dans ce contrat

Implementation complete attendue:

- detection fiable de config Expo
- injection propre des variables publiques Expo
- aliases et comportements Expo explicitement supportes
- integration avec doctor, migrate, vite init, config et doc
- un playground Expo formel existe, avec commande de validation maintenue
- fixtures Expo suffisantes pour couvrir le perimetre revendique

Critere de fin:

- le package Expo n'est plus un simple habillage; il devient une couche Expo experimentale complete au regard de
  la spec de base

Validation minimale:

```sh
pnpm --filter @vifx/vite-plugin-expo run test
```

## Programme B - Achever integralement le support mobile natif

Objectif:

Ajouter au projet un support mobile natif complet pour les parcours explicitement revendiques, a commencer par iOS,
puis Android.

Ce programme depasse le cadre initial de `SPECS.md`, mais il est necessaire si `vifx` doit lancer des apps
reelles au-dela de la seule couche web/Vite experimentale.

### B1 - Support iOS complet

Implementation complete attendue:

- un contrat d'artefacts natifs iOS clair existe entre build Vifx et app iOS
- le bundle JS, les assets, les sourcemaps et Hermes sont integres correctement
- le lancement simulateur et appareil reel sont supportes
- les diagnostics Xcode, signing et toolchain sont propres
- la CLI ou les scripts Vifx permettent de preparer, builder, installer et lancer

Surfaces a livrer:

- host iOS formel dans le repo
- preparation artefacts iOS
- build et launch iOS
- signing et erreurs associees
- doc iOS complete

Critere de fin:

- une application iOS supportee par Vifx peut etre construite et lancee sans etape manuelle implicite

Validation minimale:

```sh
xcodebuild -project <ios-host>.xcodeproj -scheme <ios-host> -destination 'platform=iOS Simulator,name=<device>' build
xcrun simctl boot <simulator-id>
xcrun simctl launch booted <bundle-id>
```

### B2 - Support Android complet

Implementation complete attendue:

- contrat d'artefacts natifs Android complet
- integration JS, assets, source maps et Hermes
- build, install et launch Android
- diagnostics SDK, emulator, device et signing
- doc Android complete

Critere de fin:

- une application Android supportee par Vifx peut etre construite et lancee sans dependance implicite a Metro

## Programme C - Achever integralement Expo sans Metro

Objectif:

Si le projet l'assume comme produit, livrer une alternative complete a Metro pour Expo sur un perimetre de versions
et de workflows explicitement supporte.

Important:

Ce programme ne doit pas etre confondu avec le contrat de base de `SPECS.md`.
Il s'agit d'un produit plus ambitieux, avec cout de maintenance propre.

### C1 - Contrat de parite Expo

Implementation complete attendue:

- versions Expo et RN supportees listees explicitement
- matrice de parite complete pour dev, build, export, Router, iOS, Android, Updates
- definition precise de ce que veut dire "Expo sans Metro" pour `vifx`

Critere de fin:

- aucune ambiguite entre ce qui est supporte et ce qui ne l'est pas

### C2 - Build Expo complet sans Metro

Implementation complete attendue:

- bundling Expo complet via Vifx
- assets Expo et artefacts de build compatibles
- sourcemaps et Hermes coherents
- aucun passage Metro requis pour les builds supportes

Critere de fin:

- un projet Expo supporte peut etre bundle completement via Vifx

### C3 - Dev server Expo complet sans Metro

Implementation complete attendue:

- serveur de dev Vifx pour Expo
- invalidation correcte
- HMR et Fast Refresh sur le perimetre supporte
- overlays et erreurs de dev utilisables

Critere de fin:

- un projet Expo supporte peut etre developpe quotidiennement sans Metro

### C4 - Expo Router complet

Implementation complete attendue:

- support de `expo-router` sur les parcours supportes
- routes, contexte, invalidation, navigation et deep links correctement geres
- parite web, iOS et Android pour le perimetre revendique

Critere de fin:

- `expo-router` n'est plus un cas special ou borne; il fait partie du contrat supporte

### C5 - Export, Updates et artefacts Expo complets

Implementation complete attendue:

- export Expo complet via Vifx
- manifests et artefacts conformes au perimetre supporte
- Updates supportees si revendiquees par le produit

Critere de fin:

- les workflows Expo de build et distribution supportes ne demandent plus Metro

### C6 - Integration native Expo complete

Implementation complete attendue:

- iOS et Android fonctionnent avec les bundles et artefacts Vifx
- installation, lancement, packaging et diagnostics sont supportes
- la chaine native complete est documentee

Critere de fin:

- un projet Expo supporte peut tourner sur mobile via Vifx sans retour a Metro

### C7 - Produit final et migration complete

Implementation complete attendue:

- CLI Vifx complete pour remplacer les parcours Metro supportes
- migration Expo -> Vifx documentee
- support matrix definitive
- suites de tests et de compat dediees au mode Expo sans Metro

Critere de fin:

- un utilisateur peut raisonnablement retirer Metro de ses parcours Expo supportes

## Ordre recommande

Ordre d'execution:

1. Programme A integralement
2. Programme B integralement
3. Programme C uniquement si la decision produit est prise

Raison:

- c'est l'ordre coherent avec `SPECS.md`
- cela evite de lancer trop tot un chantier "Expo sans Metro" sans fondations completement finies
- cela force chaque couche a etre complete avant l'etape suivante

## Definition of Done globale

Une etape ou un programme n'est termine que si:

- le code est implemente integralement pour le perimetre annonce
- les tests cibles sont en place et verts
- la compatibilite est mesuree si la couche l'exige
- la doc est a jour
- la matrice de support est mise a jour
- les erreurs et diagnostics utilisateur sont lisibles et actionnables
- les fixtures et validations necessaires existent

## Validation globale

Validation de base:

```sh
pnpm --filter @vifx/cli vifx compat run --adapter all --report json
pnpm --filter @vifx/vite-plugin-react-native run test
pnpm --filter @vifx/vite-plugin-expo run test
pnpm --filter @vifx/cli run test
pnpm --filter docs run build
```

Validation large:

```sh
pnpm test
pnpm build
```

Validation native, quand les programmes B et C sont engages:

```sh
xcodebuild -project <ios-host>.xcodeproj -scheme <ios-host> -destination 'platform=iOS Simulator,name=<device>' build
xcrun simctl boot <simulator-id>
xcrun simctl launch booted <bundle-id>
```

## Risques structurants

- laisser des commandes reelles sans contrat public complet
- laisser la doc aller plus vite que la preuve
- melanger le contrat de base de `SPECS.md` avec le programme plus ambitieux "Expo sans Metro"
- ouvrir trop tot le chantier Metro replacement pour Expo
- sous-estimer le cout durable de HMR, Fast Refresh, Router, Updates et integration native complete

## Decision immediate recommandee

La prochaine decision structurante a prendre est:

`achever integralement le Programme A selon SPECS.md avant de poursuivre le support mobile complet et Expo sans Metro`
