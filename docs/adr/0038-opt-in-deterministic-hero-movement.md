# ADR 0038: Opt-in deterministic hero movement

- Status: Accepted for R5.1B implementation
- Date: 2026-07-26
- Supersedes: only the R5.1B deferral in ADR 0037; Heroes v1 remains supported

## Context

R5.1A deliberately shipped a static hero roster. The next slice must add deterministic click,
touch, keyboard, checkpoint, journal, and replay behavior without turning Dynamic Navigation into
a mandatory companion mechanic or moving gameplay rules into Studio/renderers.

## Decision

`heroes` schema v2 is a monotonic, mission-selected opt-in module. Its exact profile owns
`selectedHeroId`, closed `definitions`, and closed `movementProfiles`. Each definition remains
core-spawned and adds exact nested `movement: {movementProfileId, speed}`. Movement profiles reuse
the engine `MovementProfileV1` contract and topology/flow-field implementation, but Heroes v2 is
independent from the `navigation` capability. Neither recipe nor authoring flow enables or selects
either module implicitly.

Runtime movement is accepted only through exact versioned `GameCommandV4 moveHero`. The engine
owns current coordinate, nullable target/next coordinate, edge progress, deterministic tie-breaks,
dirty rebuilds, and bounded advancement. Retargeting retains fractional progress only when the
canonical next coordinate is unchanged; otherwise it restarts the unfinished edge. Unreachable
targets stall without teleporting and may resume after a deterministic dirty rebuild.

The outer checkpoint remains v1 while its active Heroes state is optional and versioned. Command
journal v4 preserves and replays exact v1–v4 commands. Snapshot v2 publishes one exact unit plus
`movement: {targetCoord, nextCoord, edgeProgress}` where coordinates are nullable. It publishes no
path, field, or authoring profile.

Studio keeps v1/v2 controls in Mechanics Hub and preserves future v3+ profiles losslessly and
read-only. MCP advertises both module/snapshot versions, exact command v4, and the guarded inert
`basic_mobile_commander_hero` recipe. The shared renderer validates/detaches v1/v2 snapshots,
interpolates a presentation point, and hit-tests only that projection. Canvas and Phaser keep hero
selection as ephemeral UI state and dispatch the exact command; reset, mission, difficulty, and
campaign handoffs clear it.

## Compatibility and exclusions

- Missing, disabled, or unselected Heroes retains literal legacy behavior.
- Heroes v1 stays static and does not allocate movement/checkpoint/input state.
- Dynamic Navigation remains separately opt-in; Heroes v2 neither activates nor selects it.
- HP/shield, mana, cooldowns, abilities, skills, auras, blocking, and TowerScript hero surfaces are
  separate future TDD increments.
- Renderers and Studio never compute a path or mutate an engine snapshot.

## Verification

Acceptance requires RED evidence, focused engine/surface contracts, deterministic checkpoint and
replay equivalence, Canvas/Phaser × hex/square pointer/touch/keyboard checks, legacy v1/absent
fixtures, package/plugin gates, and independent code plus constructor-integration sign-off.
