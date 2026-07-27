# ADR 0024: Opt-In Deterministic Elevation Line of Sight

Date: 2026-07-25

## Status

Accepted. Independent code and constructor-integration sign-offs were issued and reaffirmed after final authoring hardening on 2026-07-25.

## Context

R3.1 introduced immutable sparse elevation without gameplay effects. R3.2 must make line of sight available to authors without changing legacy projects, duplicating topology in renderers, or bundling high-ground bonuses, physics, terraforming, or new script actions into the same increment.

## Decision

### Version and activation

- Elevation module v1 remains the closed empty profile `{}`.
- Elevation module v2 is also elevation-only when `lineOfSight` is absent. The optional closed shape is `{lineOfSight:{terrainBlockerTags:string[]}}`.
- Blocker tags are dense, unique, bounded strings. Authored order is accepted; runtime uses a frozen binary-sorted copy.
- Only an available, enabled, mission-selected v2 profile with `lineOfSight` activates the rule. Missing, disabled, unselected, v1, v2-empty, missing-profile, and future-version paths retain legacy acquisition.
- Upgrades are monotonic. Disabling/removing LoS does not silently downgrade a v2 module.

### Engine rule

The engine obtains one topology-owned source-to-target line. Endpoints never block and use eye height `elevation + 1`. For interior index `i` of `n` steps, elevation blocks when:

```text
interiorElevation * n >= (sourceElevation + 1) * (n - i) + (targetElevation + 1) * i
```

Equality blocks. A configured terrain tag on the same cell has precedence over elevation; the binary-minimum matching tag is reported. The first blocking cell wins. Occupancy and entities are not blockers.

Direct acquisition is filtered for legacy single/sniper/antiair/splash-primary/pulse targets and pipeline single/multi/aura direct or primary recipients. Splash/area secondaries and chain hops are not rechecked. Support/buff behavior, abilities, enemy attacks, reactions, poison/DoT, and TowerScript remain unchanged.

### Bounded diagnostics

`TowerDefenseGame.analyzeLineOfSight({source,targets})` is pure and returns schema-v1 detached rows only when LoS is active. Coordinates are strict, unique, in-bounds safe integers and rows are canonical numeric `(r,q)`. The public limits are 65,536 active map cells, 64 blocker tags, 128 UTF-8 bytes/tag, 256 terrain definitions, 64 tags/definition, 8,192 tags total, ray distance 256, 4,096 acquisition candidates, 4,096 analysis targets, and 1,048,576 interior-cell inspections per operation. Distance and operation overflow fail closed with stable reason codes.

MCP `analyze_line_of_sight` and Studio's server facade accept active content or the exact preview candidate. Both require the current composite mechanics revision, perform no project write, and return the engine verdict. Stale revision, validation, malformed input, and budget failure cannot mutate project files.

### Surface and version boundaries

- Mechanics Hub owns the v2 toggle, blocker tags, detached source/target inputs, and diagnostics. Ordinary tower/enemy/map forms remain unchanged.
- `basic_elevation_line_of_sight` proposes v2 with tag `opaque`, reports an unmet prerequisite when absent, and never edits terrain/maps, selects a mission, or enables the module.
- Canvas/Phaser share a fail-closed presentation projector over engine analysis. The projector copies verdicts and never imports or recomputes topology/elevation/blocker rules.
- Runtime `snapshot.elevation` remains schema v1. No new snapshot, checkpoint, event, command, journal, TowerScript, profile, or multiplayer version is introduced.
- High-ground range/damage, displacement, fall hazards, terrain mutation, flood/moat/bridge recipes, and LoS animation are separate future increments.

## Required verification

- Proven RED before engine and surface implementation; pure unit/property/determinism and consumer-matrix coverage.
- Absent/disabled/unselected/v1/v2-empty/future fixtures preserve legacy snapshots, acquisition, builds, and packages.
- Hex/square and input-order equivalence, endpoint/equality/tag precedence, exact budgets, malformed/accessor/sparse/duplicate rejection.
- Studio enable/edit/preview/analyze/apply/reload/remove-LoS/disable/re-enable and stale-revision behavior.
- AI `describe -> capabilities -> recipe -> preview -> analyze exact candidate -> guarded apply -> validate`, with no writes from analysis.
- Canvas/Phaser, PWA, single-file, portable web, `.tdpack`, and plugin gates.
- Independent code and constructor-integration verifiers must approve before this ADR becomes Accepted.

## Consequences

Authors can opt into deterministic elevation-aware targeting while legacy projects and v1 profiles retain their exact behavior. The engine remains the single owner of visibility, and future high-ground/physics work can build on the same elevation/topology data without changing R3.2's scope.
