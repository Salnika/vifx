# Comparisons

## Metro

Metro is the current reference implementation for React Native and Expo bundling behavior.

### Vifx Takeaway

Use Metro as evidence and comparison input. Vifx should replace Metro bundle output only when the produced artifacts can be inspected and compared.

## Re.Pack

Re.Pack is a serious non-Metro path built around Webpack or Rspack rather than Vite.

### Vifx Takeaway

Learn from its production seriousness while keeping Vifx focused on the Vite plugin ecosystem and explicit compatibility evidence.

## Vite

Vite is the execution surface Vifx is targeting.

### Vifx Takeaway

Vite does not solve the React Native contract by default. Vifx owns the RN/Expo resolver, asset, source-map, and export artifact work needed to make Vite useful here.

## Expo CLI

Expo CLI remains the owner of Expo project orchestration, Expo Go, native build/run flows, and EAS-adjacent workflows.

### Vifx Takeaway

Vifx does not replace Expo CLI. It provides a Metro-free Vite bundling path that can feed comparison and export artifact workflows.
