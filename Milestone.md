# Plan Milestones 5-7: chemin Vite réel sans promesse de remplacement total de Metro

## Résumé

- Baseline actuelle: pnpm test est vert, les milestones 0 à 4 sont réellement en place, et les seuls vrais
  placeholders restent @vifx/expo-export, @vifx/vite-plugin-react-native et @vifx/vite-plugin-expo.
- Cible retenue: rn-bare d’abord, parité de bundle seulement, packages scaffoldés rendus minimalement utilisables.
- Cette phase doit créer un chemin de build Metro-free borné pour fixtures/rn-bare-basic via Vite, tout en gardant
  les scripts Metro/Expo existants intacts et opt-in.

## Changements d’implémentation

- Commencer par consolider le contrat partagé:
  - faire de @vifx/config l’unique source pour defineVifxConfig et loadVifxConfig; @vifx/core ne fait que ré-
    exporter si nécessaire pour compatibilité.
  - étendre @vifx/types avec les types publics nécessaires au chemin Vite: options de plugin RN/Expo, artefacts de
    bundle, état de détection du plugin Vite dans l’inspection projet.
  - remplacer le faux opt-in actuel par une config Vite explicite et typée dans les templates générés.
- Implémenter réellement @vifx/vite-plugin-react-native:
  - exporter reactNative(options) comme vrai plugin Vite.
  - ajouter un helper programmatique de build qui lance Vite pour un entry et une platform donnés et retourne
    bundle + assets + sourcemap.
  - brancher la résolution de fichiers sur @vifx/platform-resolver, les assets sur @vifx/asset-registry, et
    l’option Hermes sur @vifx/hermes-tools.
  - limiter explicitement ce v1 à fixtures/rn-bare-basic, index.js, iOS/Android, build contrôlé uniquement.
  - ne pas implémenter dans ce cycle Fast Refresh, HMR, dev server Metro-compatible, ni exécution device end-to-
    end.
- Câbler le flux CLI autour de ce premier chemin Vite:
  - implémenter vifx vite init.
  - faire réutiliser ce générateur par vifx migrate react-native --with-vite et vifx migrate expo --with-vite.
  - générer un vite.config.ts qui importe le vrai plugin Vifx, pas juste un resolve.conditions.
  - faire remonter dans vifx doctor et vifx inspect le mode détecté: none, react-native, ou expo, plutôt qu’une
    simple présence de vite.config.ts.
  - garder vite build comme exécuteur réel de cette phase; ne pas ajouter un second build CLI tant que le contrat
    n’est pas stabilisé.
- Étendre la compatibilité et les fixtures avant Expo:
  - ajouter des cas bundle artifacts et sourcemap validity dans @vifx/compat.
  - faire utiliser au runner vifx les artefacts Vite générés pour les comparer au contrat capturé dans fixtures/rn-
    bare-basic/metro-output/ios.
  - remplacer les tests scaffold des plugins par des tests fixture-backed réels.
  - utiliser fixtures/rn-bare-basic comme cible smoke officielle de Milestone 5; ne pas créer un apps/playground-\*
    séparé dans ce cycle.
- Implémenter @vifx/expo-export puis @vifx/vite-plugin-expo:
  - @vifx/expo-export devient un package inspect-only avec inspectExpoExport(options) qui normalise bundles, assets
    et manifestes d’un export Expo existant.
  - ajouter une fixture dédiée d’export Expo; ne pas tenter de déduire cela depuis les metro-output actuels.
  - @vifx/vite-plugin-expo s’appuie sur le plugin RN, détecte la config Expo, injecte EXPO*PUBLIC*\*, et pose
    uniquement des aliases sûrs.
  - garder explicitement hors scope: Expo Router, Updates generation, EAS, remplacement de expo start.
- Terminer chaque lot par la mise à jour de la vérité documentaire du repo:
  - SPECS.md
  - apps/docs/roadmap.md
  - support matrix et pages package/CLI
  - README.md status text

## APIs et interfaces publiques à ajouter

- @vifx/vite-plugin-react-native
  - reactNative(options)
  - helper de build retournant des artefacts typés de bundle
- @vifx/vite-plugin-expo
  - expo(options) avec détection config Expo et injection EXPO*PUBLIC*\*
- @vifx/expo-export
  - inspectExpoExport(options) avec sortie normalisée et déterministe
- @vifx/types / @vifx/config
  - types de config Vite explicites
  - types d’artefacts de build
  - état de détection du plugin Vite dans l’inspection projet
- @vifx/cli
  - commande vifx vite init

## Plan de test

- Garder pnpm test vert en remplaçant les tests scaffold par de vraies intégrations.
- Tester côté RN Vite:
  - résolution ios / android
  - émission d’assets et manifeste stable
  - génération de source maps valides
  - comparaison des artefacts Vite avec la forme Metro capturée
- Tester côté CLI:
  - vifx vite init
  - migrate react-native --with-vite
  - migrate expo --with-vite
  - doctor / inspect avec détection correcte du mode plugin
- Tester côté Expo:
  - parsing déterministe de la fixture d’export Expo
  - chargement du plugin Expo sur fixtures/expo-basic
  - injection EXPO*PUBLIC*\* sans prétendre supporter Router/Updates

## Hypothèses retenues

- Le premier vrai chemin exécutable est fixtures/rn-bare-basic.
- L’objectif de cette phase est un build Vite contrôlé avec parité d’artefacts, pas un remplacement complet de Metro.
- Aucun nouveau playground applicatif n’est créé maintenant; la fixture sert de cible smoke.
- Toute implémentation des milestones 5 à 7 doit mettre à jour la doc de statut dans le repo dans le même changement.
