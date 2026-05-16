# Migration

Migration is intentionally framed as a bounded experiment, not a forced replacement path.

## Principles

- Start with dry-run mode.
- Preserve existing scripts and Metro config.
- Keep rollback instructions visible and tested.
- Keep existing Expo and bare React Native workflows available while experimenting.

## Expo Migration

Use `vifx migrate expo` only after doctor and reference inspection.

```sh
vifx migrate expo --dry-run
vifx migrate expo --write
```

- Never replace `expo start` automatically.
- Use generated config and helper scripts as preparation for experiments, not as proof of parity.
- Keep Router and EAS gaps explicit.

## React Native Migration

Use `vifx migrate react-native` only after a reference report already exists.

```sh
vifx migrate react-native --dry-run
vifx migrate react-native --write
```

- Preserve Metro config and scripts.
- Preview generated changes before writing files.
- Keep rollback guidance prominent.

## Related Reference

- [CLI Reference](/reference/cli)
- [Support Matrix](/reference/support-matrix)
