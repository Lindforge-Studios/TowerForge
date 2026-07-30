# ADR 0053: Opt-in Advanced Enemy Behaviors

- Status: Proposed
- Date: 2026-07-31
- Milestone: R12

## Context

TowerForge needs targetable boss parts and bounded formation behavior without turning every enemy
into a mandatory composite entity or replacing the shared navigation field with per-enemy search.
The existing combat resolver, shields, armor matrix, TowerScript HFSM, flow fields, snapshots,
checkpoints, journal replay, Studio mechanics transaction, and MCP authoring flow remain the
authoritative foundations.

## Decision

R12 adds a mission-selected `enemyBehaviors` module. Version 1 is optional and closed. An absent,
disabled, unsupported, or unselected module does not add state, snapshot fields, UI, player code,
or runtime work.

R12.1 defines boss-component records under `profile.bosses[enemyTypeId].components[componentId]`.
A root enemy may own at most 32 stable component IDs. Components have independent HP and an
authored circular hit region; optional label, tags, combat shield, armor override, and a bounded
allowlist of typed root abilities that become disabled after component destruction. Arbitrary
scripts, host calls, string-dispatched actions, and hidden overflow damage are forbidden.

Optional `profile.targeting.towers[towerTypeId].priorityTags` routes damage only after the existing
engine target acquisition has selected a root enemy. Eligible live components are considered by
authored tag priority and then binary component ID. A missing binding, no matching live component,
or all components destroyed falls back to the root. Support towers cannot own a targeting binding.
No manual component command or new TowerScript action is introduced in R12.1.

`DamageTargetRef` for an enemy may carry `componentId`. Root defense remains first; component armor,
shield, and HP are then resolved without transferring excess damage to root HP. Component
destruction is exactly once, grants no reward, does not run root death/spawn logic, and can only
disable the authored typed abilities `towerAttack`, `towerDisrupt`, or `healAura`. Root death or
leak still settles reward/death exactly once and cleans all component state.

Component state is exposed only through optional active `snapshot.enemyBehaviors` and matching
optional checkpoint state. The outer `GameCheckpointV1`, command/journal v6, profile, campaign,
multiplayer, and project v3 domains do not change. R12.2 may add typed component events and HFSM
read-only context in a separate RED/GREEN slice; Visual Graph changes are later still.

R12.3 keeps the shared flow field authoritative and adds only bounded deterministic local formation
steering through spatial buckets, at most 16 neighbours per enemy, stable tie-breaks, and no
renderer-owned movement. R12.4 composes vanguard protection from the existing shield/damage
pipeline rather than replacing armor or resistances.

## TDD delivery

Each of R12.1 content foundation, R12.1 runtime, R12.2 HFSM events, R12.3 formations, and R12.4
vanguard protection begins with an independently recorded RED. Production implementation follows
only after the contract is frozen. Every source freeze requires Code Verifier and Constructor
Integration Verifier sign-off; a subsequent source change invalidates both.

R12.1 content foundation explicitly excludes runtime HP/shield mutation. Its first acceptance is:
closed own-data normalization, hostile-input safety, 32-component fail-before-read budget,
active/error versus inactive/warning cross-reference semantics, capability discovery, and a
fail-closed active resolver. The next RED separately covers DamagePacket routing, active-only
snapshot/checkpoint state, deterministic restore/replay, and exact-once settlement.

## Consequences

- Legacy projects and ordinary enemies retain their exact path.
- Target selection remains an engine rule; Canvas, Phaser, Studio, and MCP only display or author
  validated contracts.
- The existing guarded mechanics preview/apply transaction remains the only writer.
- GameCommand v7 stays reserved for R14 runtime tower-module configuration.
- Full Boids, per-enemy A*, arbitrary component scripts, homing targeting, and renderer hit-testing
  authority are outside R12.
