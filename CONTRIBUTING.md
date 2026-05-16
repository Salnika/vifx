# Contributing

## Tooling

This repository uses Vite+ as its unified toolchain. Start by syncing dependencies:

```bash
vp install
```

## Validation

Run the full repository checks before handing work off:

```bash
vp check
vp run -r test
vp run -r build
```

## Scope

- Keep experimental features clearly labeled.
- Prefer small typed packages with focused responsibilities.
- Use fixtures and tests instead of speculative implementations.
- Update `SPECS.md` when implementation status changes.
