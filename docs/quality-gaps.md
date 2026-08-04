# Quality Gap Tracker

Last reviewed: 2026-08-05

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

## Release And Integration Status

- R0–R22 are merged. R18–R22 each passed independent RED/GREEN increments, exact-commit gates,
  remote CI and fresh Code Verifier plus Constructor Integration Verifier sign-offs.
- The immutable `v0.6.0` tag exposed a Windows-only CRLF pruning defect before publication, so no
  public release was created for that tag. Cross-platform `v0.6.1` remains the previous verified
  R0–R17 baseline. The current public R0–R21 baseline is the unsigned
  [`v0.8.0` pre-release](https://github.com/Lindforge-Studios/TowerForge/releases/tag/v0.8.0), built
  from exact commit `7e4cba9`; all six public installers, `SHA256SUMS`, release-note hashes, source
  links, plugin mirror and downloaded DMG verification passed.
- R22 exact candidate `5136d99` and PR #40 are accepted; the merged source is preparing the
  unsigned `v0.9.0` candidate. It is not a public baseline until the tag workflow and downloaded
  six-installer checksum verification pass.

## Known Product Gaps

| Priority | Area | Current gap | Planned milestone |
| --- | --- | --- | --- |
| P2 | Renderer scale | Canvas and Phaser share gameplay projections, but repeatable 500–1000-enemy frame budgets, geometry/index profiling, and bounded presentation pools are not CI-enforced. | Separate production hardening |
| P2 | Asset breadth | Theme packs and guarded generation/import hooks exist, but bundled tower/enemy sprite families and batch binding remain incomplete. | Separate content milestone |
| P2 | Profiles | `PlayerProfileV3` persists one app-scoped profile; named save slots/loadouts and user-facing export/import/migration controls remain open. | Unscheduled |
| P2 | Tiled coverage | Core terrain/path/object contracts are supported, but full arbitrary Tiled multi-layer/object-layer round-trip is intentionally absent. | Unscheduled |
| P3 | Signed distribution | v0.8.0 is a verified unsigned pre-release and v0.9.0 is being prepared under the same unsigned policy. Developer ID notarization, Windows signing, store submission, hosted auth/matchmaking, and TowerForge Cloud need external deployment decisions and credentials. | Deployment milestone |

R14 and R15 are independent opt-in gameplay capabilities. R16 is an isolated replay/runtime surface;
R17 is an isolated constructor distribution capability. Neither is included in ordinary legacy
gameplay bundles unless its explicit surface is used.
