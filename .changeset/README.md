# Changesets

Every change that affects a published `@vifx/*` package comes with a changeset: a
small Markdown file that says which packages change and how (`patch`, `minor`,
`major`), with a summary that ends up in the changelog.

```bash
vp run changeset
```

All `@vifx/*` packages are versioned together (the `fixed` group in
`config.json`): one changeset bumps every package to the same version.

The release workflow turns pending changesets into a "Version Packages" pull
request; merging it publishes to npm. See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing)
and the [Changesets documentation](https://changesets.dev).
