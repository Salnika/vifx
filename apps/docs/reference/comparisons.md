# Comparisons

## Metro

The current reference implementation for React Native and Expo bundling behavior.

### Strengths

- Deep ecosystem integration.
- Defines the behavior Vifx must understand in practice.

### Tradeoffs

- Much of the contract is implicit.
- Comparing Metro behavior to alternatives is hard without dedicated inspection tools.

### Vifx Takeaway

Use Metro as evidence and comparison input, not as an invisible implementation dependency.

## Re.Pack

A serious alternative path built around Webpack or Rspack rather than Vite.

### Strengths

- Shows that non-Metro approaches can be credible.
- Provides a real-world alternative architecture.

### Tradeoffs

- It solves a different set of bundler tradeoffs than Vifx is exploring.
- Adopting it wholesale would skip the docs-first compatibility layer Vifx wants to build.

### Vifx Takeaway

Learn from its seriousness without duplicating it blindly.

## Vite

Appealing for its plugin model, dev server, and ecosystem leverage.

### Strengths

- Fast iteration.
- Good plugin surface.
- Strong Rollup and Rolldown adjacency.

### Tradeoffs

- It does not solve the React Native contract by default.
- Too-early plugin work would risk a shallow demo instead of a trustworthy toolchain.

### Vifx Takeaway

Treat Vite as the eventual execution surface, not the first milestone.

## Vifx

A compatibility toolkit and experimental modern bundling layer for React Native and Expo.

### Strengths

- Makes the contract explicit.
- Phases work so primitives and reports come first.

### Tradeoffs

- Not a production Metro replacement in the first version.
- Much of the catalog is still spec-defined at this docs stage.

### Vifx Takeaway

Earn trust through reports, docs, and conservative migration flows before claiming parity.
