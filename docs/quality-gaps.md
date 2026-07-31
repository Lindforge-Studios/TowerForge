# Quality Gap Tracker

Last reviewed: 2026-08-01

## Current Quality Baseline

- CI runs Node 22 typecheck, engine build, plugin build/validation/smoke and source-mirror parity,
  unit/integration tests, project validation, tutorial simulation, map compilation, web build, and
  the Playwright browser suite.
- The canonical legacy starter omits `content/mechanics.json`; every gameplay extension must prove
  absent/disabled/unselected behavior and keep old snapshot/checkpoint/replay paths unchanged.
- TowerScript v7 Behavior Trees/HFSM and Graph/Trace/Debugger v2 are deterministic, typed, budgeted,
  checkpoint-backed, and free of host-code execution. TowerScript v1–v6 remain supported.
- Persona QA is compute-only and cancellable; quests v1, Procedural Juice v1, advanced enemy
  behaviors, Ballistics/destructibles, and Weather are separate opt-in contracts.
- Studio, MCP/AI, Canvas, Phaser, generated PWA/single-file players, `.tdpack`, and native scaffolds
  share engine-owned schemas and guarded preview/apply flows rather than duplicating gameplay rules.
- Tauri tests cover desktop state/menu/close behavior. Unsigned installers are built on native
  runners and require checksum plus platform bundle verification before publication.

## Active Integration Gap

- R12 and R13 are merged. The repaired R13 exact commit passed remote CI after its browser race was
  reproduced and fixed without weakening revision or future-version handling.
- R14 is the v0.5.1 release candidate. It must pass the exact-commit repository, browser, plugin,
  native scaffold, Tauri and macOS bundle gates before the tag is published.

## Known Product Gaps

| Priority | Area | Current gap | Planned milestone |
| --- | --- | --- | --- |
| P1 | Macro-economy | Existing mission interest is static; there is no seeded local commodity market, explicit deposit contract, or atomic ritual system. | R15 |
| P2 | Replay UX | Checkpoint/journal replay and multiplayer reconnect exist, but there is no binary archive, detached ghost, immutable What-If branch, or Replay Lab. | R16 |
| P2 | Distribution | Static/PWA/package output exists, but provider-neutral one-click publish, licensed remix provenance, and host-only monetization placements do not. | R17 |
| P2 | Renderer scale | Canvas and Phaser share gameplay projections, but repeatable 500–1000-enemy frame budgets, geometry/index profiling, and bounded presentation pools are not CI-enforced. | Separate production hardening |
| P2 | Asset breadth | Theme packs and guarded generation/import hooks exist, but bundled tower/enemy sprite families and batch binding remain incomplete. | Separate content milestone |
| P2 | Profiles | `PlayerProfileV3` persists one app-scoped profile; named save slots/loadouts and user-facing export/import/migration controls remain open. | Unscheduled |
| P2 | Tiled coverage | Core terrain/path/object contracts are supported, but full arbitrary Tiled multi-layer/object-layer round-trip is intentionally absent. | Unscheduled |
| P3 | Signed distribution | v0.5.1 remains an unsigned pre-release. Developer ID notarization, Windows signing, store submission, hosted auth/matchmaking, and TowerForge Cloud need external deployment decisions and credentials. | Deployment milestone |

R14 is implemented as an opt-in capability. R15–R17 remain paused; their planned contracts MUST NOT
appear in schema descriptors, recipes, Studio controls, player bundles, or agent claims.
