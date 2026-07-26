# ADR 0030: Rogue-lite tower synergies are an opt-in derived combat modifier

- Status: Accepted
- Date: 2026-07-26

## Context

R4 needs tower tags and 2/4/6 collection synergies before artifacts, draft, or campaign semantics.
Putting tag counters into persistent profile/run state, ordinary tower forms, renderers, or checkpoints
would duplicate authority and make an optional genre mechanic part of the legacy constructor.

## Decision

Add an independent `roguelite` mechanics module at schema v1. Tower definitions may carry a bounded
unique `tags` array, but those tags have no gameplay effect unless the module is implemented,
enabled, and selected by the mission. A closed profile maps synergy IDs to label, tag, optional
`highest | cumulative` mode, and ordered tiers. Each tier contains only allowlisted damage
modifiers (`flat`, `additive_ratio`, or `multiplier`) at the shared `run` stage.

The engine counts live placed tower instances by unique tag. `highest` applies the greatest reached
tier once; `cumulative` applies every reached tier. Disabled/silenced towers still count because
they are live placed instances. Placement, sale, destruction, reset, and checkpoint restore rebuild
the derived state; move and upgrade do not change it. Modifiers affect direct, area, and DoT damage
whose source is a tower, but not abilities, TowerScript, statuses, reactions, or enemy attacks.

`snapshot.roguelite` is optional and derived from tower state. It is not stored inside the
checkpoint. The renderer exposes one bounded descriptor-safe projection; Canvas and Phaser/player
surfaces display that projection and never recount towers or evaluate tiers.

Mechanics Hub owns the isolated editor. The guarded mechanics transaction may accept exact
`towerTags` only while applying enabled `roguelite`; it updates project manifest, mechanics catalog,
mission selection, and balance tower definitions atomically with revision validation, backup, and
rollback. `basic_elemental_synergy` accepts 1–16 authored tower type IDs and returns an inert profile
with additive 2/4/6 tiers plus merged `elemental` tags. It does not write, enable, or select anything.

## Consequences

- Missing, disabled, unselected, or unsupported roguelite data adds no snapshot section, gameplay
  modifier, or player panel.
- Structural validation remains bounded for inactive data; active unknown/unreachable tags use the
  existing error/warning capability policy.
- Project v3 and mechanics catalog v1 are unchanged; profile, checkpoint, command, replay,
  TowerScript, and multiplayer versions remain independent.
- Artifacts, sockets, draft, campaign nodes, run reducers, persistence, and new commands require
  separate TDD increments.

## Verification

Acceptance requires RED-before-GREEN engine/runtime, CLI/MCP, Studio, renderer, and generated-player
contracts; legacy absent/disabled fixtures; deterministic checkpoint/replay equivalence; guarded
save/reload/disable/re-enable and stale-revision rollback; Canvas/Phaser plus hex/square builds; and
independent code and constructor-integration sign-offs.
