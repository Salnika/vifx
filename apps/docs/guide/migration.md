# Migration

Migration now means two different things in this repository:

- the supported Expo onboarding corridor driven by `vifx setup`
- legacy manual surfaces kept for maintainers who want to inspect or patch files directly

## Principles

- Preserve existing scripts and Metro config.
- Keep rollback instructions visible and tested.
- Keep existing Expo and bare React Native workflows available while migrating.

## Expo Migration

Use [Expo Migration](/guide/expo-migration) as the recommended onboarding path for an existing Expo project.

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx native run <expo-project-path> --platform ios
```

- `vifx setup` is Expo-only in v1 and is the preferred command for the repo-local onboarding flow.
- Never replace `expo start` automatically.
- Keep Router, EAS, Expo Go, Fast Refresh, and Android runtime gaps explicit.

### Legacy Manual Expo Migration

`vifx migrate expo` remains available when you explicitly want the older file-planning workflow.

```sh
pnpm vifx migrate expo <expo-project-path> --write
```

- `vifx migrate expo` is the more manual path and should not be treated as the default onboarding surface.
- Use `--dry-run` only when you explicitly want a preview mode.

## React Native Migration

Use `vifx migrate react-native` only after a reference report already exists.

```sh
vifx migrate react-native --write
```

- Preserve Metro config and scripts.
- Use `--dry-run` only when you explicitly want a preview mode.
- Keep rollback guidance prominent.

## Related Reference

- [Expo Migration](/guide/expo-migration)
- [CLI Reference](/reference/cli)
- [Support Matrix](/reference/support-matrix)
