# TowerForge Engine Review And Production Roadmap

Last reviewed: 2026-08-01

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
- local-first Studio, guarded MCP/AI authoring, Tauri desktop, PWA/single-file builds, `.tdpack`,
  Codex plugin packaging, and mobile/desktop game scaffolds.

The extension boundary is typed, versioned data plus engine descriptors. New gameplay must extend
that boundary; arbitrary JavaScript/Lua, host imports, renderer-owned rules, or broad filesystem
tools remain out of scope.

## Immediate Gate

R0–R17 are accepted, merged and published in unsigned pre-release
[`v0.6.1`](https://github.com/Lindforge-Studios/TowerForge/releases/tag/v0.6.1) from exact commit
`db1dd07`. The immutable `v0.6.0` tag exposed a Windows CRLF package-pruning defect before
publication and has no public Release. The replacement passed exact-commit CI, two fresh independent
sign-offs, a manual native cross-platform candidate, tagged native rebuilds, six-installer assembly,
published checksum verification and downloaded DMG verification.

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
