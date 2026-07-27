# ADR 0025: Opt-In Authored High-Ground Modifiers

Date: 2026-07-25

## Status

Accepted. Engine and surface RED→GREEN evidence, full verification gates, and independent code and constructor-integration sign-offs completed on 2026-07-25. The code re-review additionally required and verified explicit DoT and downed-source guards plus full-runtime pulse, chain-secondary, and ability-exclusion coverage.

## Context

R3.1 introduced immutable authored elevation and R3.2 accepted optional deterministic line of sight. R3.3 must let authors reward towers placed above their targets without coupling elevation to displacement, hazards, terrain mutation, TowerScript, or renderer-owned rules. Damage must continue through the existing modifier/damage pipeline, while range remains an engine-owned pairwise acquisition rule.

## Decision

### Version and closed profile

Elevation module v3 adds one optional sibling section:

```ts
interface ElevationProfileV3 {
  readonly lineOfSight?: {
    readonly terrainBlockerTags: readonly string[];
  };
  readonly highGround?: {
    readonly maximumEffectiveElevationDelta: number;
    readonly rangeBonusPerElevation: number;
    readonly damageBonusBasisPointsPerElevation: number;
  };
}
```

- v1 remains exactly `{}`; v2 accepts only optional `lineOfSight`; v3 accepts optional `lineOfSight` and `highGround`.
- All objects are closed own-data records. `highGround` is invalid in v1/v2.
- A v3 profile with no `highGround` preserves R3.2 behavior. LoS and high-ground activate independently.
- Adding or removing a section never silently downgrades the authored module version.
- Activation requires an available, enabled elevation v3 module and a mission-selected existing profile with a valid `highGround` section. All absent, disabled, unselected, missing-profile, older, empty, and future-version paths retain legacy range/damage.
- A defensive runtime resolver ignores only malformed `highGround`; it must not disable a valid LoS sibling. Full project validation still rejects malformed authored content before simulation/build.

Project v3, mechanics catalog v1, player profile v2, checkpoint v1, command/journal/replay, TowerScript, and multiplayer version domains do not change.

### Limits

The engine exports this closed public contract:

```ts
const HIGH_GROUND_LIMITS = {
  maximumEffectiveElevationDelta: 64,
  rangeBonusPerElevation: 16,
  damageBonusBasisPointsPerElevation: 10_000,
  totalRangeBonus: 64,
  totalDamageBonusBasisPoints: 100_000,
  modifiersPerDamagePacket: 1
};
```

All three authored values are safe integers. `maximumEffectiveElevationDelta` is `1..64`; both bonuses are non-negative and at least one is positive. Products must stay within the total range and damage budgets. Limits are validation/runtime contracts, not UI-only hints.

### Deterministic pair math

For a tower/enemy pair:

```text
rawDelta = elevation(tower.coord) - elevation(enemyCoord(enemy))
effectiveDelta = rawDelta > 0
  ? min(rawDelta, maximumEffectiveElevationDelta)
  : 0
rangeBonus = effectiveDelta * rangeBonusPerElevation
damageBonusBasisPoints = effectiveDelta * damageBonusBasisPointsPerElevation
```

Equal height and downhill are exact no-ops; there is no penalty. Negative authored elevations use the same subtraction. Undefined/out-of-bounds elevation fails closed to no bonus. Dynamic navigation uses the existing deterministic discrete enemy coordinate; flying enemies are anchored to the underlying tile and gain no separate altitude model. Basis points are multiplied as integers and divided by `10_000` once.

### Range semantics

`topology.distance(tower, enemy) <= legacyTowerRange + rangeBonus` determines pair eligibility. Pairwise high-ground range is applied after HP/target-class checks and before the existing deterministic target ordering. Any candidate admitted by extra range must still pass active R3.2 LoS filtering.

The rule applies to direct acquisition for single, sniper, antiair, splash primary, pulse, and pipeline direct/primary recipients, including offensive pipeline aura delivery. Pulse coverage uses the same pairwise range when deciding whether its existing DoT is suppressed, so an enemy inside the expanded pulse does not take immediate pulse and parallel DoT in one tick; the DoT packet itself never receives the high-ground damage modifier. The rule does not expand support/support-buff auras, splash/area secondary radii, chain jump radii, ability radii, placement, movement, navigation cost, or reachability.

### Damage semantics

Immediate tower-to-enemy damage adds at most one existing `ModifierSpec`:

```ts
{
  id: "elevation:high-ground:damage",
  target: "damage",
  stage: "spatial",
  operation: "additive_ratio",
  value: damageBonusBasisPoints / 10_000
}
```

The source must identify a live tower whose type matches the packet, and the target must be an enemy. Primary hits, pulse hits, pipeline damage, splash/area secondaries, and chain hops use the source tower coordinate and each actual target coordinate. No modifier is added for a non-positive delta or zero damage bonus.

The bonus does not apply to status/DoT ticks, abilities, reactions, TowerScript damage, enemy attacks, tower/core/leak damage, or resource/status-only effects. `ModifierSpec` schema and target allowlist do not change. The order remains `base -> tower_upgrade -> meta -> run -> spatial -> temporary -> marks -> armor -> resistance -> legacy -> shield -> HP -> reactions`; within `spatial`, the existing operation order remains authoritative.

### State and presentation boundaries

- `snapshot.elevation` remains schema v1; there is no `snapshot.highGround`.
- No new event is introduced. `towerFired.damage` remains its existing pre-modifier value; resolved hit/shield/reaction outcomes may reflect the bonus.
- No mutable state or checkpoint section is introduced. Profile changes still alter the simulation content digest.
- Canvas, Phaser, Studio Playtest, generated players, and packages receive the behavior from the engine. Renderers may continue existing elevation cues but must not read the profile or calculate delta/range/damage.

### Authoring surfaces

- Mechanics Hub owns an optional high-ground toggle and three bounded integer fields. It preserves a `lineOfSight` sibling and upgrades effective authoring to v3 monotonically. Ordinary tower, enemy, map, and TowerScript forms remain unchanged.
- `describe_schema`, `get_capabilities`, and guarded mechanics preview/apply expose v3 and its limits.
- `basic_elevation_high_ground` proposes delta `3`, range `1`, and damage `1000` basis points per elevation. It edits no map, enables no module, and selects no mission.
- Authored map elevation remains a separate `preview_map_elevations` / `apply_map_elevations` transaction. No `analyze_high_ground` protocol is added in this slice.

## Required verification

- Prove RED before engine and surface GREEN.
- Cover exact version/shape/budget boundaries, hostile own-data input, inactive and v3-empty legacy paths, equal/downhill no-op, caps and basis-point arithmetic.
- Cover target acquisition and immediate damage across legacy and pipeline tower kinds, exclusions, modifier order, shields/marks/armor/reactions, R3.2 LoS interaction, square/hex, authored routes/dynamic flow, ground/flying anchoring, checkpoint/replay determinism, and no new state/event contract.
- Verify Studio enable/edit/preview/apply/reload/remove/disable/re-enable, LoS sibling preservation, stale revision, and AI `schema -> capabilities -> recipe -> preview -> guarded apply -> validate`.
- Verify Canvas/Phaser, both grids, PWA, single-file, portable web, `.tdpack`, and plugin gates.
- Obtain independent code and constructor-integration sign-offs before changing this ADR to Accepted.

## Deferred and forbidden scope

R3.3 does not include displacement, push/pull, collision physics, fall hazards/damage, entity altitude, projectile arcs, terrain/elevation mutation, flood/moat/bridge, navigation or placement changes, downhill penalties, LoS formula changes, support/secondary/ability radius changes, high-ground DoT/reaction/TowerScript effects, entity-specific overrides, a `range` modifier target, new snapshots/events/commands/journals/profiles, renderer gameplay math, project v4, broad writes, or a new diagnostics protocol.

## Consequences

Authors can opt into bounded high-ground range and damage while legacy projects, earlier elevation versions, and v3 profiles without the section remain unchanged. Physics and transactional terraforming remain separate later increments with independent tests and sign-offs.
