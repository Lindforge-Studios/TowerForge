# Quality Gap Tracker

Last reviewed: 2026-07-31

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

- R12 is open as PR #23 with green CI. R13 is stacked as PR #24; its previous remote Playwright run
  was red at 140/141 because the fixture changed future-version bytes before an earlier guarded
  mechanics apply response completed.
- The race is covered by RED (1/12) and GREEN (20/20) evidence. Future mechanics bytes remain
  lossless/read-only and stale-revision behavior is unchanged.
- R13 MUST remain unaccepted until the repaired exact commit completes every gate and receives fresh
  Code Verifier plus Constructor Integration Verifier sign-offs.

## Known Product Gaps

| Priority | Area | Current gap | Planned milestone |
| --- | --- | --- | --- |
| P1 | Modular arsenal | Artifacts and sockets exist, but campaign-scoped modular bases/barrels/cores and deterministic gem crafting do not. | R14 |
| P1 | Macro-economy | Existing mission interest is static; there is no seeded local commodity market, explicit deposit contract, or atomic ritual system. | R15 |
| P2 | Replay UX | Checkpoint/journal replay and multiplayer reconnect exist, but there is no binary archive, detached ghost, immutable What-If branch, or Replay Lab. | R16 |
| P2 | Distribution | Static/PWA/package output exists, but provider-neutral one-click publish, licensed remix provenance, and host-only monetization placements do not. | R17 |
| P2 | Renderer scale | Canvas and Phaser share gameplay projections, but repeatable 500–1000-enemy frame budgets, geometry/index profiling, and bounded presentation pools are not CI-enforced. | Separate production hardening |
| P2 | Asset breadth | Theme packs and guarded generation/import hooks exist, but bundled tower/enemy sprite families and batch binding remain incomplete. | Separate content milestone |
| P2 | Profiles | `PlayerProfileV3` persists one app-scoped profile; named save slots/loadouts and user-facing export/import/migration controls remain open. | Unscheduled |
| P2 | Tiled coverage | Core terrain/path/object contracts are supported, but full arbitrary Tiled multi-layer/object-layer round-trip is intentionally absent. | Unscheduled |
| P3 | Signed distribution | Public v0.4.0 is an unsigned pre-release. Developer ID notarization, Windows signing, store submission, hosted auth/matchmaking, and TowerForge Cloud need external deployment decisions and credentials. | Deployment milestone |

R14–R17 are explicitly paused after R13. Planned contracts are not implemented capabilities and
MUST NOT appear in schema descriptors, recipes, Studio controls, player bundles, or agent claims.
