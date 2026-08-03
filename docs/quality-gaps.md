# Quality Gap Tracker

Last reviewed: 2026-08-04

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

- R0–R21 are merged. R18–R21 each passed independent RED/GREEN increments, exact-commit gates,
  remote CI and fresh Code Verifier plus Constructor Integration Verifier sign-offs.
- The immutable `v0.6.0` tag exposed a Windows-only CRLF pruning defect before publication, so no
  public release was created for that tag. Cross-platform `v0.6.1` is published from exact commit
  `db1dd07`; all six installers, `SHA256SUMS`, release-note hashes, source links and downloaded DMG
  verification passed. The remaining delivery gap is publishing and independently verifying the
  `v0.8.0` six-installer candidate containing R18–R21.

## Known Product Gaps

| Priority | Area | Current gap | Planned milestone |
| --- | --- | --- | --- |
| P2 | Renderer scale | Canvas and Phaser share gameplay projections, but repeatable 500–1000-enemy frame budgets, geometry/index profiling, and bounded presentation pools are not CI-enforced. | Separate production hardening |
| P2 | Asset breadth | Theme packs and guarded generation/import hooks exist, but bundled tower/enemy sprite families and batch binding remain incomplete. | Separate content milestone |
| P2 | Profiles | `PlayerProfileV3` persists one app-scoped profile; named save slots/loadouts and user-facing export/import/migration controls remain open. | Unscheduled |
| P2 | Tiled coverage | Core terrain/path/object contracts are supported, but full arbitrary Tiled multi-layer/object-layer round-trip is intentionally absent. | Unscheduled |
| P3 | Signed distribution | v0.8.0 remains an unsigned pre-release candidate. Developer ID notarization, Windows signing, store submission, hosted auth/matchmaking, and TowerForge Cloud need external deployment decisions and credentials. | Deployment milestone |

R14 and R15 are independent opt-in gameplay capabilities. R16 is an isolated replay/runtime surface;
R17 is an isolated constructor distribution capability. Neither is included in ordinary legacy
gameplay bundles unless its explicit surface is used.
