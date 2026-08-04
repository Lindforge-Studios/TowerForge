# TowerForge Engine Review And Production Roadmap

Last reviewed: 2026-08-05

This document is the compact engineering review. Product sequencing and live PR state are canonical
in [ROADMAP.md](ROADMAP.md); release and production gaps are canonical in
[quality-gaps.md](quality-gaps.md).

## Current State

TowerForge now has:

- a deterministic, browser-safe, Node-free TypeScript simulation engine shared by headless runs,
  Studio Playtest, Canvas, Phaser, and generated players;
- an optional versioned mechanics platform with shared damage/modifier, navigation/topology,
  checkpoint/journal/replay, profile, campaign, hero, logistics, and multiplayer contracts;
- TowerScript v7 Behavior Trees/HFSM plus lossless Graph, structured Trace, and checkpoint-backed
  Debugger v2 without arbitrary project code execution;
- compute-only Persona QA, deterministic procedural quests, and visuals-v3 Procedural Juice;
- accepted R12 targetable boss components, component-driven phases, bounded formation steering,
  and vanguard protection;
- accepted R13 direct/arc projectiles, clearance, ricochet, transactional destructibles, and
  independent seeded Weather;
- accepted R14 CampaignRunV2, opt-in modular Arsenal and deterministic gem crafting;
- accepted R15 seeded local market, explicit deposits and atomic rituals;
- accepted R16 checksummed Replay Archive, detached Ghost/What-If Lab and isolated reference relay;
- accepted R17 reproducible publish manifests, explicit-confirm provider adapters, licensed Remix
  provenance and host-only monetization placements;
- accepted R18 large-screen web targets with shared viewport transforms, action registry, recovery,
  localization, accessibility and PWA quality controls;
- accepted R19 first-class native desktop targets, confined Tauri persistence/lifecycle, six-format
  release workflows and an opt-in signed updater contract;
- accepted R20 renderer-owned top-down/isometric/dimetric camera projections with shared inverse
  hit testing, depth ordering and guarded view-specific assets;
- accepted R21 data-only responsive HUD catalogs, screen graphs, build-menu presets and one semantic
  DOM shell shared by Canvas, Phaser, Studio, web, native and `.tdpack` outputs;
- accepted R22 build-target-selected project splash playlists with immutable TowerForge-first boot,
  bounded static frames, active-only packaging and guarded Studio/MCP authoring;
- local-first Studio, guarded MCP/AI authoring, Tauri desktop, PWA/single-file builds, `.tdpack`,
  Codex plugin packaging, and mobile/desktop game scaffolds.

The extension boundary is typed, versioned data plus engine descriptors. New gameplay must extend
that boundary; arbitrary JavaScript/Lua, host imports, renderer-owned rules, or broad filesystem
tools remain out of scope.

## Published Baseline

R0–R21 are accepted, merged and published in the unsigned
[`v0.8.0` pre-release](https://github.com/Lindforge-Studios/TowerForge/releases/tag/v0.8.0).
Manual candidate workflow `30839934975` and tagged workflow `30846092399` built exact source commit
`7e4cba99bb23b43f0118fb97b756e388001fd7d1`. All six public installers match `SHA256SUMS`, the
release-note hashes match the downloaded checksum file, and the downloaded macOS app/DMG passed
signature and container verification. No roadmap delivery gate remains open; the items below are
post-roadmap product hardening rather than unfinished R18–R21 acceptance.

R22 is accepted and merged as PR #40. The resulting source is the basis of the unsigned `v0.9.0`
candidate, but `v0.8.0` remains the published baseline until the exact tag and six public installer
checks complete.

## Post-Roadmap Hardening

| Priority | Area | Remaining boundary |
| --- | --- | --- |
| P2 | Renderer scale | Enforce repeatable 500–1000-enemy frame budgets and bounded presentation pools in CI |
| P2 | Asset breadth | Expand bundled tower/enemy sprite families and guarded batch binding |
| P2 | Profiles | Add named save slots/loadouts and user-facing export/import controls without changing `PlayerProfileV3` implicitly |
| P2 | Tiled coverage | Extend intentional map import coverage without weakening topology or path validation |
| P3 | Signed distribution | Add Developer ID notarization and Windows signing only when deployment credentials and policy are available |

## Engineering Invariants

- Engine behavior MUST stay deterministic: no wall clock, ambient randomness, filesystem, network,
  DOM, or Node dependencies.
- Every gameplay extension MUST remain opt-in; absence or deselection MUST preserve legacy state,
  snapshot, checkpoint, replay digest, UI, bundle composition, and hot-path work.
- Studio, CLI, MCP, generated players, Canvas, and Phaser MUST consume the same engine contracts.
- Project writes MUST remain local, confined, revision-aware, validated, backed up, and reversible.
- AI tools MUST expose application concepts, not raw shell or filesystem access.
- Project/version-domain changes MUST be explicit and ship with migrations, hostile-data tests,
  fixtures, documentation, and compatibility coverage.
- One roadmap R uses one branch and one PR. Each vertical slice records RED before production; the
  final exact commit needs independent Code Verifier and Constructor Integration Verifier sign-off.

## Completion Evidence

Use the command-to-change mapping in [../AGENTS.md](../AGENTS.md). A mechanic is not complete until
engine tests, schema validation, checkpoint/journal determinism, headless evidence, Studio/MCP
authoring, both generated renderers, packages, disabled legacy behavior, and documentation agree.
Use live CI/test output and `progress.md` for counts; do not treat stale prose or an open PR as proof
of release.
