# Contributing to Vifx

Thanks for taking the time to contribute. Bug reports with a reproduction, fixes, new library compatibility cases and documentation improvements are all welcome. For a larger change, please open an issue first so the approach can be discussed before you spend time on it.

## Setting up

The repository uses [Vite+](https://viteplus.dev), which manages Node.js, pnpm and the whole toolchain through one command, `vp`. Install it once ([instructions](https://viteplus.dev/guide/)), then:

```bash
git clone https://github.com/Salnika/vifx.git
cd vifx
vp install
vp run build
```

`vp install` also installs a pre-commit hook that formats and lints staged files.

Packages import one another through their built `dist/` output, so run `vp run build` after cloning and after pulling changes to a package another one depends on. It builds every package in dependency order.

## Repository layout

| Path                | Contents                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `packages/*`        | The published `@vifx/*` packages. `cli` is the entry point; see the README for the others.   |
| `apps/docs`         | The documentation site (VitePress).                                                          |
| `apps/playground-*` | Small projects that exercise the CLI end to end (`pnpm playground:validate`).                |
| `fixtures`          | Test projects, captured Metro output and synthetic library packages used by the test suites. |
| `docs/benchmarks`   | Benchmark reports; `scripts/bench` produces them.                                            |

## Checks

Run these before opening a pull request; CI runs the same ones:

```bash
vp check          # format, lint and type-aware lint
pnpm typecheck    # TypeScript, per package
vp run test       # unit and integration tests of every package
```

`vp check --fix` fixes formatting and the lint issues that can be fixed automatically. A single package's tests run with `pnpm --filter @vifx/<name> test`.

Other suites, for changes in the areas they cover:

```bash
pnpm compat:metro && pnpm compat:vifx   # Metro vs Vifx compatibility fixtures
pnpm docs:support-matrix                # regenerate the library support matrix in the docs
pnpm docs:dev                           # documentation site with live reload
pnpm playground:validate                # end-to-end runs of the CLI on the playground apps
```

## Trying a change on a real app

Build, then put the local `vifx` on your `PATH` (it links `packages/cli/dist/bin.mjs` into `~/.local/bin`, `~/bin` or pnpm's global bin directory, whichever is on your `PATH`):

```bash
vp run build
pnpm cli:link
vifx doctor /path/to/your/app
```

Rebuild after each change (`vp run build`, or `pnpm --filter @vifx/<name> build` for one package) for the linked command to pick it up.

`scripts/bench/expo-vs-vifx.mjs` (`pnpm bench:expo --project <app>`) compares Metro and Vifx on an installed Expo app. `scripts/dev` has two helpers for device sessions: `send-message.mjs` triggers a reload through the dev server, `crash-frames.mjs` prints the faulting thread of an iOS crash report.

## Making a change

- Add or update tests with every behavior change. Tests live next to each package in `tests/`.
- Errors that reach users are `VifxError`s from `@vifx/errors`, with a stable code, a message that says what happened and a hint that says what to do.
- Keep the docs in `apps/docs` in step with user-visible changes (flags, config, behavior).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`…).

### Changesets

A change that affects a published package needs a changeset, which records the version bump and the changelog entry:

```bash
vp run changeset
```

Pick the packages you changed and the bump (`patch` for fixes, `minor` for features while Vifx is 0.x), then write a one-line summary for the changelog. Commit the generated file in `.changeset/` with your change. All `@vifx/*` packages are released together with the same version.

## Releasing

Maintainers only. Releases are automated by `.github/workflows/release.yml`:

1. Pushes to `master` with pending changesets open or update a **"chore: release packages"** pull request that bumps the versions and writes the changelogs.
2. Merging that pull request publishes the new versions to npm (with provenance), tags them and creates the GitHub releases.

One-time setup on a new repository or npm scope:

- Create the `vifx` organization on npm (free for public packages).
- Create an npm access token that can publish to the `@vifx` scope and store it as the `NPM_TOKEN` repository secret. Once the packages exist on npm, you can configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) for each of them against this workflow and remove the token.
- In the repository settings, under Actions > General, allow GitHub Actions to create pull requests.
- For the documentation site, under Pages, set the source to GitHub Actions (`.github/workflows/docs.yml` deploys it).

## Code of conduct

Be respectful and constructive. Harassment or personal attacks are not tolerated in issues, pull requests or any other project space.
