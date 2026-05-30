# Migration

Migration means activating Vifx as a no-Metro bundle producer while keeping existing app workflows available.

## Principles

- Preserve existing Metro, Expo CLI, EAS, and app scripts.
- Add Vifx-owned config and build commands explicitly.
- Compare Vifx output against Metro artifacts before widening claims.
- Keep rollback guidance visible in legacy migration surfaces.

## Expo Activation

Use [Expo Migration](/guide/expo-migration) as the recommended path for an existing Expo project.

```sh
pnpm vifx setup <expo-project-path> --yes --expo-go
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

- `vifx setup` is Expo-only and creates Vifx-owned config.
- `--expo-go` enables the early Vifx native manifest and bundle server path.
- It does not replace EAS or app build/run commands.
- Export output is bundle artifact output, not Expo Updates runtime support.

## Legacy Manual Surfaces

`vifx migrate expo` and `vifx migrate react-native` remain available when you explicitly want file-level planning instead of the setup flow.

```sh
pnpm vifx migrate expo <expo-project-path> --write
pnpm vifx migrate react-native <rn-project-path> --write
```

Use these surfaces only after a project inspection or Metro reference report exists.

## Related Reference

- [Expo Migration](/guide/expo-migration)
- [CLI Reference](/reference/cli)
- [Support Matrix](/reference/support-matrix)
