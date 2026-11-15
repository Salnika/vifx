---
description: How Vifx, Re.Pack and One each replace Metro for React Native and Expo, and which one fits an app.
---

# Vifx, Re.Pack and One

Metro is not the only way to bundle a React Native app: Re.Pack and One replace it too, for different needs. This page compares the three as their own documentation described them in November 2026. Their docs, linked under [Sources](#sources), are the reference: they change faster than this page.

<div class="vs-compare">

|            | Re.Pack                                                                                               | One                                                                    | Vifx                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| What it is | A toolkit that replaces Metro                                                                         | A React framework for web and native                                   | A bundler swap for an existing Expo or React Native app               |
| Bundler    | Rspack by default, or webpack                                                                         | Vite; Rolldown for native by default, Metro as an option               | Vite and Rolldown                                                     |
| Your app   | Unchanged                                                                                             | Adopts One's router (derived from Expo Router) and project conventions | Unchanged, Expo Router included                                       |
| Expo Go    | Not covered by its docs                                                                               | No: native needs a custom build                                        | Yes, with Fast Refresh                                                |
| Setup      | Commands in `react-native.config.js`, an `rspack.config` file, and a change to the Xcode bundle phase | One's CLI and layout (`one prebuild`, `one run:ios`)                   | `vifx setup` writes `vifx.config.ts`; Expo-owned files are left alone |
| Plugins    | webpack and Rspack loaders and plugins                                                                | Vite plugins                                                           | Vite and Rollup plugins                                               |
| Built for  | Module Federation and code splitting (mini apps in a host app)                                        | One codebase and one router for web and native                         | Moving an Expo app to Vite's tooling without leaving Expo Go          |

</div>

## Which one fits

- **Re.Pack** if you need Module Federation or code splitting, for example to load mini apps into a host app, or if your team already works with webpack or Rspack. Its own docs advise keeping Metro installed for tools that assume it.
- **One** if you are starting an app and want web and native from one framework on Vite. For an existing Expo app, adopting it is a move to a new framework rather than a bundler swap.
- **Vifx** if you have an Expo or React Native app and want Vite and Rolldown without changing the app, its router or the Expo Go workflow. It is younger than both: [Project Status](../guide/status) lists what has been validated.

For how Vifx compares with Metro itself, with measurements, see [vifx vs Metro](./comparisons).

## Sources

- Re.Pack: [introduction](https://re-pack.dev/docs/getting-started/introduction), [migrating from Metro](https://re-pack.dev/docs/migration-guides/metro), [Expo Modules](https://re-pack.dev/docs/guides/expo-modules), [Module Federation](https://re-pack.dev/docs/features/module-federation).
- One: [introduction](https://onestack.dev/docs/introduction), [Metro mode](https://onestack.dev/docs/metro-mode), [migrating to One](https://onestack.dev/native/migrating-to-one), [native setup](https://onestack.dev/docs/native-setup), [status](https://onestack.dev/docs/status).
