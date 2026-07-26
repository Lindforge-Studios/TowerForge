# ADR 0026: Opt-In Tile Displacement Physics

Date: 2026-07-25

## Status

Accepted. R3.4a completed RED → GREEN engine → GREEN surfaces → independent code verification → independent constructor-integration verification on 2026-07-25.

## Context

R3.1–R3.3 added authored elevation, line of sight, and high-ground modifiers without changing legacy movement. R3.4 must add push/pull and fall hazards, while route-breaking terrain mutation remains a separate R3.4b transaction. The first physics slice must not introduce continuous velocity, per-enemy pathfinding, renderer-owned rules, or an off-route representation that checkpoints and generated players cannot reproduce.

## Decision

### Independent opt-in module

Physics is a new independent mechanics module at schema v1:

```ts
interface PhysicsProfileV1 {
  readonly displacementImmuneEnemyTypeIds?: readonly string[];
  readonly fallImmuneEnemyTypeIds?: readonly string[];
  readonly fallHazardTerrainTags?: readonly string[];
}

interface DisplacementEffectV1 {
  readonly kind: "displacement";
  readonly mode: "push" | "pull";
  readonly distance: number;
  readonly stopAtBlocker: boolean;
}
```

- `DisplacementEffectV1` is added only to pipeline tower effects and enemy-targeted ability effects.
- The profile and effect are closed own-data records. Lists are duplicate-free, bounded arrays of non-empty UTF-8-bounded strings.
- Enemy ids are author-defined cross-references. A broken reference in an inactive profile is a warning; the same reference in the active selected profile is an error.
- The effect shape is always structurally validated. It is a deterministic no-op when physics is absent, unavailable, disabled, unselected, missing, malformed at the defensive runtime boundary, or authored at a future version.
- An empty selected profile enables ordinary displacement with no immunity or fall hazards. Recipes never enable the module, select a mission profile, or mutate content outside the proposed profile.

Project v3, mechanics catalog v1, player profile v2, checkpoint v1, command/journal/replay, TowerScript, and multiplayer version domains do not change.

### Limits

The engine exports:

```ts
const PHYSICS_LIMITS = {
  displacementDistance: 8,
  displacementEffectsPerSource: 8,
  displacementTargetsPerActivation: 64,
  immuneEnemyTypeIds: 4_096,
  fallHazardTerrainTags: 64,
  idOrTagUtf8Bytes: 128,
  stepsPerEffectApplication: 8,
  stepAttemptsPerActivation: 4_096,
  stepAttemptsPerTick: 32_768
};
```

`distance` is a positive safe integer no greater than eight. An active reachable ability or pipeline source may contain at most eight displacement effects. Runtime admits the first 64 target slots and first eight displacement effects in the already deterministic target/effect order. It reserves the requested distance before resolution, with at most 4,096 topology-step attempts per ability action or pipeline activation and 32,768 across all pipeline activations in one tick. Exhausted displacement is a silent fail-closed no-op; ordered damage, status, and resource effects continue. These budgets are ephemeral command-local state and never enter snapshots or checkpoints. Inactive, absent, disabled, unselected, malformed, and future physics capabilities do not impose these cardinality limits on legacy sources.

### Deterministic geometric rule

- Displacement is immediate and tile-discrete. It stores no velocity, force, or additional enemy state.
- The source coordinate is the live source tower coordinate or the ability center. A source on the target coordinate is a no-op.
- For every step, inspect topology neighbors in the topology registry's stable order. Pull selects the first neighbor whose topology distance to the source strictly decreases; push selects the first whose distance strictly increases.
- Geometric selection happens before blocker checks. A blocked candidate stops the effect; physics never slides sideways, reroutes, or starts a search.
- Only ground enemies are displaced in v1. Flying enemies are displacement- and fall-immune. Author-defined movement profile names such as `floating` or `burrowing` imply no hidden behavior.
- Enemies do not block one another in v1, avoiding target-order-dependent collision results.

### Route and dynamic-flow adapters

- In authored-route mode, a candidate must equal the immediately previous or next coordinate on the enemy's existing track and must be topology-adjacent. The rendered current tile is the rounded existing `pathProgress`; success writes the exact destination route index. Repeated/equidistant/off-route ambiguity stops safely.
- Displacement cannot enter the final core/goal coordinate in R3.4a. The goal is a blocker, so the slice cannot create an ambiguous leak-versus-kill ordering.
- In dynamic-flow mode, displacement anchors at the existing deterministic `enemyCoord`: `nextCoord` when `edgeProgress >= 0.5`, otherwise `currentCoord`. A destination must be present in the already cached field for the enemy's movement profile and goal. No field rebuild or per-enemy search occurs.
- A successful dynamic displacement writes the destination to `currentCoord`, resets `edgeProgress` to zero, preserves `stepsEntered`, writes `pathProgress = stepsEntered`, and refreshes canonical `nextCoord` from the same field lookup.
- Existing movement-profile terrain and tower-occupancy rules are inherited from field membership. Authored routes remain confined to their authored coordinates. Map boundaries are blockers.

### Blockers and atomicity

- `stopAtBlocker: true` preserves successful earlier steps and stops on the first ordinary blocker.
- `stopAtBlocker: false` preflights ordinary displacement and applies zero steps if any requested step would hit an ordinary blocker.
- A fall hazard is terminal rather than an ordinary blocker. Reaching it commits the traversed displacement and fall regardless of `stopAtBlocker`; no later step or later ordered effect runs for that enemy.
- Dead or leaked targets never receive later ordered effects. Delivery target membership stays fixed after acquisition, but each effect observes the target's current live coordinate.

### Defensive runtime budgets

- Validation applies the eight-displacement-effect source cap only to abilities and towers reachable from a mission whose physics v1 profile resolves active. Tower reachability follows `mission.buildTowerIds` and the transitive `support.unlocksTowerIds` closure.
- Every displacement record is inspected through the same closed own-data boundary before validation or runtime dispatch. Accessors, inherited/non-enumerable/symbol fields, throwing proxies, extra keys, and malformed values fail closed without becoming executable content.
- Ability actions receive a fresh 4,096-step reservation budget. Every pipeline activation receives the same local budget, while all pipeline activations in a public `tick` share the additional 32,768-step ceiling.
- Requested distance is reserved before planning, so budget exhaustion never creates partial movement. Budget counters are reset at command boundaries, are not serialized, and reproduce identically under checkpoint restore and journal replay.

### Explicit fall hazards

- A destination falls when its in-bounds terrain definition has a tag listed by the active profile. Hazard tags are checked before ordinary walkability or cached-field membership, allowing an explicitly authored chasm to be terminal even when it is non-walkable.
- Out-of-bounds and the route goal are blockers, not falls. Elevation drops alone do not infer a fall in v1.
- A fall-immune enemy stops at the hazard edge without entering it.
- Falling is terminal, not a `DamagePacket`: set the enemy to the normal dead lifecycle, emit source-attributed `enemyFell`, and let the existing removal pass award the kill, objectives, reward, and authored spawn-on-death exactly once. It bypasses shield, armor, marks, resistance, high-ground, reactions, and damage events.

### Events, state, and presentation

Add bounded events:

- `enemyDisplacementResolved`: source, source coordinate, enemy, mode, requested and moved distance, from/to, and a closed stop reason.
- `enemyFell`: source, enemy, from/to, and terrain tag.

There is no `snapshot.physics`, persistent force field, new checkpoint section, new command, or TowerScript event/action in R3.4a. Existing authored-route or navigation fields contain the final position, so checkpoint restore and journal replay remain version v1 and must produce the same digest as uninterrupted play.

Canvas and Phaser consume a shared fail-closed event projector for optional displacement/fall cues. They display engine results and never calculate movement eligibility, blockers, or hazards.

### Authoring surfaces

- Mechanics Hub owns the closed physics profile editor. Ordinary enemy, map, mission, and TowerScript forms remain unchanged.
- Pipeline tower and custom ability effect editors expose displacement rows only when the mission has an active physics selection; raw existing content is preserved while inactive.
- MCP/AI uses `describe_schema("physics") -> get_capabilities -> get_recipe -> preview_mechanics_module -> apply_mechanics_module -> validate_project` with revision guard, validation, backup, and rollback. No `analyze_physics` tool is added.
- `basic_displacement_physics` proposes an empty v1 profile. `tagged_fall_hazards` proposes a bounded example tag and nothing else.

## Required RED and acceptance evidence

- Closed schema, exact limits, hostile own-data input, active/inactive cross-references, and every capability state.
- Square and both hex parities; push, pull, strict-distance ties, same-cell no-op, cap, partial and atomic blocker behavior.
- Authored straight/corner/loop/repeated routes; fractional progress; route ends; tower/map blockers; no off-route state.
- Dynamic `<0.5`/`>=0.5` anchors, canonical resume, cached-field membership, occupancy profiles, and unchanged field-build count for 1/500/1000 enemies.
- Exact 8-effect, 64-target, 4,096-step activation, and 32,768-step tick boundaries; overflow skips only displacement while later non-displacement effects continue.
- Accessor-safe closed effect records in validation and defensive runtime, including malformed no-op followed by a valid ordered effect.
- Ground/flying and explicit immunity, with no inference from author-defined movement-profile ids.
- Hazard-before-blocker, fall immunity, exactly one kill/reward/objective/spawn lifecycle, source attribution, no damage/reaction/shield event, and no leak/core damage.
- Ordered effects, area/chain target sets, dead recipients, checkpoint/journal/replay determinism, and absent/disabled byte-for-behavior legacy fixtures.
- Studio enable/edit/save/reload/disable/re-enable; AI guarded flow and stale revision; Canvas/Phaser on hex/square; build, package, plugin, and harness gates.
- Independent code and constructor-integration sign-offs by reviewers who did not author production code.

## Deferred and forbidden scope

R3.4a does not include terrain or elevation mutation, flood/moat/bridge recipes, transactional reachability rollback, TowerScript actions/events, Visual Graph nodes, reaction effects, legacy attack-model displacement fields, off-route authored positions, goal displacement, obstacle sliding, enemy collision, continuous velocity, accumulated force, inferred elevation falls, fall damage, flying displacement, or per-enemy pathfinding. R3.4b owns route-breaking transactional terraforming as a separate increment.

## Consequences

Authors gain bounded push/pull and explicit chasms without changing any legacy project. The restricted route adapters preserve checkpoint compatibility and make every movement decision replayable. More expressive physics remains possible through later versioned profiles rather than hidden semantics in v1.

Acceptance evidence: the final physics/build/package focused matrix passed 75/75, the full Vitest suite passed 1512/1512 across 120 files, Playwright passed 17/17, and typecheck, engine/build, validate, simulation, balance, map compile, plugin build/validate/smoke, harness audit, and diff checks were green. Independent code and constructor-integration reviewers reported no remaining findings.
