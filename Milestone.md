# Current Milestones

> This file is now a pointer. The active roadmap and milestones live in
> **`PLAN.md`** (full Metro replacement, phases 0–6) and the architecture
> decision records in **`docs/adr/`**. The shipped 20-unit batch and the
> next-up work are summarized in **`NEXT.md`**; live progress is in
> **`STATUS.md`**; the V2 Expo Go product corridor and its acceptance gate are
> in **`SPECS.md`**.

Vifx's promise has widened from "replace Metro bundle production with Vite" to a
**complete Metro replacement** for Expo (and later bare RN) projects — covering
dev, debugging, and release workflows (`PLAN.md` §3).

The roadmap is sequenced in `PLAN.md` §4:

- **Phase 0** — Decisions & cleanup (ADRs 001–005, CLI split, `ws`, doc refresh).
- **Phase 1** — Minimal viable dev loop (watcher → rebuild → reload).
- **Phase 2** — Module format + Fast Refresh (the core engineering bet).
- **Phase 3** — Real ecosystem transforms (kill the mocks; real worklets).
- **Phase 4** — Debugging & DX parity (inspector proxy, dev-client).
- **Phase 5** — Production parity (`export:embed`, prod assets, Hermes bytecode).
- **Phase 6** — SDK matrix & breadth (SDK 55/56, bare RN, `metro.config` interop).
- **Phase 7** — Hardening & adoption (benchmarks, device E2E, publication).

These phases were executed as a **20-unit parallel batch**; see `NEXT.md` for the
unit-by-unit breakdown.

Genuine non-goals are unchanged (`PLAN.md` §3): replacing the Expo native
runtime, EAS Build / Submit, and hosted Updates **signing**. Note that **full
Fast Refresh parity and Expo Go are no longer out of scope** — they are central
to the current plan (ADR-001, ADR-003); the earlier "outside current scope"
framing is superseded.
