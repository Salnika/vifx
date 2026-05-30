    1480      fromFile: generatedEntryPath,
    1481 +    mainFields: options.mainFields,
    1482      projectRoot: options.projectRoot,
         ⋮
    1519    jsxInPackages?: string[];
    1520 +  mainFields?: string[];
    1521    outDir: string;
         ⋮
    1536            extensions: options.extensions,
    1537 +          mainFields: options.mainFields,
    1538            outDir: options.outDir,
         ⋮
    1551      jsxInPackages: normalizeJsxInPackages(options.jsxInPackages),
    1552 +    mainFields: normalizeMainFields("web", options.mainFields),
    1553      platform: options.platform,

• Edited packages/vite-plugin-react-native/src/index.ts (+1 -0)
1918 jsxInPackages: options.jsxInPackages,
1919 + mainFields: options.mainFields,
1920 outDir: absoluteOutDir,

• Explored
└ Read build.ts, run.ts, expo-audit.ts

• Edited packages/cli/src/commands/build.ts (+1 -0)
135 jsxInPackages: target.jsxInPackages,
136 + mainFields: loaded.config.resolver.mainFields,
137 outDir: target.outDir,

• Edited packages/cli/src/commands/run.ts (+1 -0)
330 jsxInPackages: target.jsxInPackages,
331 + mainFields: loaded.config.resolver.mainFields,
332 outDir: target.outDir,

• Edited packages/cli/src/commands/expo-audit.ts (+2 -0)
369 projectRoot: string,
370 + mainFields?: string[],
371 ): Promise<ExpoBuildResult> {
⋮
379 jsxInPackages: target.jsxInPackages,
380 + mainFields,
381 outDir: target.outDir,

• Explored
└ Search buildExpoTarget\( in expo-audit.ts

• Edited packages/cli/src/commands/expo-audit.ts (+3 -1)
1138 for (const target of targets) {
1139 - builds.push(await buildExpoTarget(target, loaded.config.projectRoot));
1139 + builds.push(
1140 + await buildExpoTarget(target, loaded.config.projectRoot, loaded.config.resolver.mainFields),
1141 + );
1142 }

• Edited packages/cli/src/commands/expo-audit.ts (+3 -0)
600 jsxInPackages: target.jsxInPackages,
601 + mainFields: loaded.config.resolver.mainFields,
602 platform: target.platform,
⋮
955 jsxInPackages: target.jsxInPackages,
956 + mainFields: loaded.config.resolver.mainFields,
957 platform: target.platform,
⋮
1031 jsxInPackages: target.jsxInPackages,
1032 + mainFields: loaded.config.resolver.mainFields,
1033 outDir: target.outDir,

─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Le nouveau souci vient d’un paquet dual-entry: en natif, résoudre module avant main fait charger punycode.es6.js sous un require() CommonJS, ce qui casse punycode.ucs2. J’ai ajouté mainFields au plugin et je force l’ordre natif sûr react-
native, main, module lorsque l’ancien défaut web était utilisé.

• Ran pnpm --filter @vifx/vite-plugin-react-native test
└ $ vp test run
RUN /Users/alexis.salnikoff/workspace/perso/projects/software/vifx/packages/vite-plugin-react-native
… +5 lines (ctrl + t to view transcript)
Duration 1.03s (transform 51ms, setup 0ms, import 114ms, tests 712ms, environment 0ms)

• Ran pnpm --filter @vifx/vite-plugin-react-native run build
└ $ vp pack
ℹ entry: src/index.ts
… +6 lines (ctrl + t to view transcript)
ℹ 3 files, total: 136.58 kB
✔ Build complete in 403ms

• Ran pnpm --filter @vifx/vite-plugin-expo run build
└ $ vp pack
ℹ entry: src/index.ts
… +6 lines (ctrl + t to view transcript)
ℹ 3 files, total: 120.02 kB
✔ Build complete in 353ms

✔ You approved codex to run pnpm --filter @vifx/vite-plugin-expo test this time

• Ran pnpm --filter @vifx/vite-plugin-expo test
└ $ vp test run
RUN /Users/alexis.salnikoff/workspace/perso/projects/software/vifx/packages/vite-plugin-expo
… +5 lines (ctrl + t to view transcript)
Duration 464ms (transform 65ms, setup 0ms, import 135ms, tests 145ms, environment 0ms)

✔ You approved codex to run ps -axo pid,ppid,command | rg 'node ./bin/vifx.mjs expo dev|vifx expo dev /Us... this time

• Ran ps -axo pid,ppid,command | rg 'node ./bin/vifx.mjs expo dev|vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro|port 55888'
└ 37790 51565 /Users/alexis.salnikoff/.vite-plus/js_runtime/node/24.16.0/bin/node /Users/alexis.salnikoff/.nvm/versions/node/v22.18.0/bin/pnpm --filter @vifx/cli vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro
--platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json
… +3 lines (ctrl + t to view transcript)
80075 51565 /bin/zsh -c ps -axo pid,ppid,command | rg 'node ./bin/vifx.mjs expo dev|vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro|port 55888'
80095 80075 rg node ./bin/vifx.mjs expo dev|vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro|port 55888

• Ran kill 37790
└ (no output)

• Ran pnpm --filter @vifx/cli vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro --platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json
└ $ node ./bin/vifx.mjs expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro --platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json
(node:37858) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro/vifx.config.ts?t=1779562082891 is not specified and it doesn't parse as CommonJS.
… +23 lines (ctrl + t to view transcript)
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @vifx/cli@0.1.0 vifx: `node ./bin/vifx.mjs expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro --platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json`
Command failed with signal "SIGTERM"

✔ You approved codex to run pnpm --filter @vifx/cli vifx expo dev /Users/alexis.salnikoff/workspace/perso... this time

• Ran pnpm --filter @vifx/cli vifx expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro --platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json
└ $ node ./bin/vifx.mjs expo dev /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro --platform ios --expo-go --host 0.0.0.0 --public-host 127.0.0.1 --port 55888 --json
(node:82093) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro/vifx.config.ts?t=1779562532800 is not specified and it doesn't parse as CommonJS.
… +20 lines (ctrl + t to view transcript)
"url": "http://127.0.0.1:55888"
}

• Explored
└ Search node_modules/punycode/(punycode\.js|punycode\.es6\.js)|module\.exports = punycode|exports.default = \{ in index.bundle

• Ran /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro/node*modules/.pnpm/react-native@0.81.5*@babel+core@7.29.0_@types+react@19.1.17_react@19.1.0/node_modules/react-native/sdks/hermesc/osx-bin/hermesc -emit-binary -out /
│ private/tmp/vifx-hnewspro-ios-after-mainfields.hbc /Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro/.vifx/expo-go/ios/index.bundle
└ (no output)

• Running xcrun simctl terminate booted host.exp.Exponent

✔ You approved codex to run xcrun simctl terminate booted host.exp.Exponent this time

• Ran xcrun simctl terminate booted host.exp.Exponent
└ (no output)

✔ You approved codex to run xcrun simctl openurl booted exp://127.0.0.1:55888 this time

• Ran xcrun simctl openurl booted exp://127.0.0.1:55888
└ (no output)

✔ You approved codex to run xcrun simctl io booted screenshot /private/tmp/vifx-hnewspro-expo-go-after-ma... this time

• Ran xcrun simctl io booted screenshot /private/tmp/vifx-hnewspro-expo-go-after-mainfields.png
└ Wrote screenshot to: /private/tmp/vifx-hnewspro-expo-go-after-mainfields.png

• Viewed Image
└ /private/tmp/vifx-hnewspro-expo-go-after-mainfields.png
