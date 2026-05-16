# Compatibility Report Format

Status: Current.

The `vifx compat run` command can render the same compatibility results in three formats:

- `terminal`: concise output for local development
- `json`: machine-readable output for automation
- `markdown`: shareable report output for docs, issues, or PR comments

## Terminal

Use terminal output during local development:

```bash
pnpm --filter @vifx/cli vifx compat run --adapter all
```

The terminal formatter includes:

- adapter id
- overall pass or fail status
- passed case count
- category pass rates
- fixture path, expected-versus-actual message, and docs link for failures

## JSON

Use JSON output for CI, tooling, or snapshots:

```bash
pnpm --filter @vifx/cli vifx compat run --adapter vifx --report json
```

JSON output includes:

- `adapterId`
- `generatedAt`
- `status`
- `totalCases`
- `passedCases`
- `failedCases`
- `categories`
- `cases`

Each case includes the case id, category, fixture id, pass/fail state, expected value, actual value, message, docs path, and resolved fixture path.

## Markdown

Use Markdown output when a compatibility run should be pasted into an issue or PR:

```bash
pnpm --filter @vifx/cli vifx compat run --adapter all --report markdown
```

The Markdown formatter includes:

- front-matter style summary bullets for adapter, status, and generation time
- a category table
- a failures section that links each failing case back to its docs path

## Current Adapters

The current first-pass adapters are:

- `metro`: reference adapter backed by captured Metro-like fixture expectations
- `vifx`: adapter backed by current Vifx primitives

Use `--adapter all` to run both adapters in one invocation and compare the current foundation against the Metro reference surface.
