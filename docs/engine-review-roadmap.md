# TowerForge Engine Review And Production Roadmap

Last reviewed: 2026-07-31

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
- implemented R12 targetable boss components, component-driven phases, bounded formation steering,
  and vanguard protection in open PR #23;
- implemented R13 direct/arc projectiles, clearance, ricochet, transactional destructibles, and
  independent seeded Weather in stacked PR #24;
- local-first Studio, guarded MCP/AI authoring, Tauri desktop, PWA/single-file builds, `.tdpack`,
  Codex plugin packaging, and mobile/desktop game scaffolds.

The extension boundary is typed, versioned data plus engine descriptors. New gameplay must extend
that boundary; arbitrary JavaScript/Lua, host imports, renderer-owned rules, or broad filesystem
tools remain out of scope.

## Immediate Gate

R13 is not accepted yet. GitHub CI on prior head `b3069a4` passed 3,693 unit tests and every
pre-browser step, then failed one of 141 Playwright tests. Trace evidence proved a fixture race
between the completed file write and the pending guarded apply response; RED reproduced 1/12 and
the repaired contract passed 20/20. The new exact commit still requires full gates and two fresh
sign-offs. R12/R13 are merged and R14 is the current implemented release candidate; later planned items are not implemented APIs.

## Next Planned Increments

| Order | Area | Contract boundary |
| --- | --- | --- |
| R14.0 | Campaign run migration | `CampaignRunV2` codec and V1 migration, with no arsenal content in the same RED/GREEN slice |
| R14.1–R14.4 | Modular arsenal and gem crafting | Opt-in `arsenal` v1, engine-owned blueprint compiler, between-wave module commands, existing artifact instances on a bounded 3×3 board, shared Studio/MCP/player surfaces |
| R15.1–R15.3 | Macro-economy | Opt-in `macroEconomy` v1; separate seeded market, explicit deposits, and atomic rituals; command/journal v8 only when commands arrive |
| R16.1–R16.4 | Ghost Replay Lab | Checksummed binary archive over canonical JSON, detached ghost, immutable branch suffix, and a separate gameplay-free self-host relay |
| R17.1–R17.4 | Distribution | Reproducible publish manifest, explicit-confirmation provider adapters, licensed `.tdpack` remix provenance, and host-only monetization placements |

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
