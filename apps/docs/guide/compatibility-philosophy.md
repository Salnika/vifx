# Compatibility Philosophy

Vifx does not start by trying to replace Metro. It starts by making the React Native and Expo bundler contract explicit, testable, and reviewable.

## Principles

- Observable behavior matters more than implementation internals.
- Reference evidence matters more than marketing parity claims.
- Warn and todo states are useful because they show unfinished work honestly.
- Migration must stay conservative and reversible while support is still maturing.

## What Counts As The Contract

The contract includes more than JavaScript bundling:

- platform file resolution
- asset scale groups and metadata
- source maps and symbolication quality
- Hermes bytecode workflows
- Expo-specific export shape
- development-server assumptions and compatibility reports

## Adapter Model

Vifx uses adapters to compare the same compatibility cases against different implementation surfaces.

- `metro`: reference behavior for captured Metro-compatible fixtures
- `vifx`: current Vifx primitives and first-pass CLI flows

This keeps the comparison surface stable while the implementation evolves.

## Why Reports Matter

Compatibility should produce evidence:

- fixture id
- expected output
- actual output
- category-level pass/fail summaries
- docs links for follow-up

That is why the first usable milestone is the compatibility suite itself, not a runtime replacement.
