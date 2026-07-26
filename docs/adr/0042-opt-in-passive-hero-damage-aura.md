# ADR 0042: Opt-in passive hero damage aura

Status: Accepted

Date: 2026-07-27

Roadmap: R5.5A

## Context

Heroes v1–v5 provide roster selection, movement, durability, one targeted active ability, and an
independently nullable battle-local skill tree. The next small vertical slice needs the first
passive spatial hero effect without making skill progression, Dynamic Navigation, blocking,
logistics, or TowerScript mandatory companions. The engine already owns topology distance and the
closed `ModifierSpec` order, including the `spatial` stage, so a hero aura must reuse those
contracts rather than introduce another buff runtime or let Studio/renderers infer gameplay.

The nullable boundary is important. A developer must be able to use a passive aura without a skill
tree, keep a skill tree without an aura, or use neither while retaining the exact v4/v5 runtime
shapes. Merely promoting authoring to a newer Heroes schema must not activate a mechanic.

## Decision

### Authoring and capability selection

R5.5A monotonically extends the `heroes` module to schema v6. The v6 definition retains every v5
field and adds required nullable `passiveAura`. `skillTree` and `passiveAura` are independent:

```json
{
  "passiveAura": {
    "id": "command_link",
    "label": "Command link",
    "radius": 3,
    "effects": [
      {
        "kind": "modifier",
        "scope": "tower_damage",
        "modifier": {
          "target": "damage",
          "operation": "additive_ratio",
          "value": 0.2
        }
      }
    ]
  }
}
```

`passiveAura:null` is the literal opt-out. A non-null aura is a closed own-data object with exact
fields `id`, `label`, `radius`, and `effects`. There is one aura per definition and 1–4 effects per
aura. Aura ID and label are non-empty, trimmed, and at most 128 UTF-8 bytes. Radius is a safe
integer in `0..65_536`, matching the active-map-cell ceiling. Every effect has the exact shape
above; `kind`, `scope`, and `target` are closed to `modifier`, `tower_damage`, and `damage`.
Operations reuse `flat | additive_ratio | multiplier`. Values are finite and use the established
safe authored damage-modifier ranges: flat absolute value at most `1_000_000_000_000`, additive
ratio in `[-1, 1_000]`, and multiplier in `[0, 1_000]`. `-0` canonicalizes to `0`.

Structural validation, hostile-object rejection, canonical binary definition order, and all
budgets apply even while the module is disabled. Active semantic validation additionally reserves
the aura effect count in the shared maximum of 64 modifiers per tower packet. The existing
`ROGUELITE_DAMAGE_MODIFIER_RESERVE` remains unchanged at meta `1` plus spatial `2`: changing that
global reserve would reject legacy Roguelite content even when no aura is selected. Instead, one
pure capability-aware helper returns `0` or the active selected aura's `effects.length`. The exact
per-tower count is

```text
rogueliteRunWorstCase(towerTypeId, mission/deck)
  + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total
  + activeHeroAuraModifierReserve(missionId)
  <= MAX_MODIFIERS_PER_RESOLUTION
```

`rogueliteRunWorstCase` is the canonical existing maximum across synergies, compatible artifact
slots, authored interwave draft choices, and any supplied campaign deck. The same formula must be
used by content validation, direct game construction, campaign preparation/loadout normalization,
artifact socket preflight, and checkpoint restore. It must not be copied as a second Studio or MCP
rule.

Count safety alone is not numeric safety. For each buildable tower's authored immediate base-damage
amounts and level variants, an engine helper constructs the canonical worst-case stage sequence:
the active difficulty/meta bound, the same Roguelite synergy/artifact/draft or supplied-deck
choices, existing high-ground/sunlight spatial bounds, then every aura effect. Within a stage it
uses the real `flat -> additive_ratio -> multiplier -> binary id` order and evaluates a conservative
absolute-value upper bound when one of several authored choices may occupy a slot. Content
validation checks every selectable difficulty and the maximum authored interwave stack; campaign
prepare/restore reruns it with the actual carried deck plus remaining authored choices. A
non-finite result is rejected before runtime state or inventory is installed.

An active count or numeric overflow is an error; the equivalent semantic combination is a warning
while the Heroes module or profile is disabled/unselected. Game construction repeats both active
invariants before installing runtime state, so an accepted aura cannot fail only when a tower
eventually fires. Structural value/budget violations remain errors even when inactive.

An explicit Studio/MCP promotion from v5 to v6 is a module-level guarded transaction. Its candidate
writes `passiveAura:null` on every missing definition in every existing v5 profile before applying
the selected profile edit, so the complete v6 module remains valid and all unrelated profile data
is preserved atomically. Loading, validation, build, and play never migrate content implicitly;
only the explicit v6 preview/apply request performs this promotion. Unsupported future Heroes v7+
content remains opaque, lossless, read-only in authoring surfaces, and fail-closed at runtime.

### Deterministic spatial semantics

An aura is active exactly when its selected v6 hero is alive and the mission outcome is
`playing`. During setup, interwave, or an optional draft pause it remains spatially active; those
phases do not create a new pause or command. Defeat and a terminal mission outcome deactivate it.

The affected set contains every currently placed non-destroyed tower whose anchor coordinate has
canonical map-topology distance `<= radius` from the hero's authoritative `currentCoord`. Hex maps
use the registered hex topology and square maps use the registered square topology. Footprint,
elevation, line of sight, terrain cost, movement profile, tower range, and renderer interpolation
do not alter this test. A hero part-way across an edge continues to project the aura from
`currentCoord`; the presentation-only interpolated point never enters simulation. Radius zero can
affect only a tower sharing the hero's anchor coordinate. Tower IDs are deduplicated and sorted by
binary ascending ID in all public projections.

For an affected source tower, each aura effect becomes a collision-safe engine-owned
`ModifierSpec` with stage `spatial`. Its stable ID length-prefixes the hero definition ID and aura
ID and ends with the zero-padded effect index; insertion order therefore cannot affect resolution.
The modifiers join the existing packet before `DamageResolver` and follow the fixed order
`run -> spatial -> temporary`.

The initial scope covers immediate tower-sourced damage packets carrying the exact live tower
instance ID, including primary, multi-target, area/splash secondary, and chain deliveries. It does
not modify tower DoT/`over_time` ticks, statuses, resources, tower range, fire rate, cooldown,
mission abilities, hero abilities, reactions, enemy attacks, core/leak damage, or TowerScript
damage. All packets continue through the one shared resolver; there is no aura-specific damage
formula.

### Snapshot, checkpoint, command, and event domains

Only a selected non-null aura publishes `snapshot.heroes` v6. Its one unit uses the complete v4
movement/durability/mana/active-ability base and adds exact fields:

```text
skills: HeroSkillsStateSnapshotV5 | null
passiveAura: {
  id, label, radius,
  active,
  affectedTowerIds
}
```

`skills` is the authoritative v5 skill projection when the independently authored tree is
non-null and is literal `null` otherwise. `passiveAura.active` and `affectedTowerIds` are
authoritative engine output. Shared renderer projection validates, detaches, and bounds them but
does not recalculate liveness, phase, distance, or membership. The list is dense, duplicate-free,
binary sorted, contains at most 65,536 bounded runtime tower IDs, and must be empty when `active`
is false. Canvas and Phaser may draw the radius/status and highlight only the published tower IDs.

The compatibility matrix is exact:

| Selected definition | Snapshot | Nested Heroes checkpoint |
| --- | --- | --- |
| v6 `skillTree:null`, `passiveAura:null` | v4 | v3 |
| v6 tree non-null, `passiveAura:null` | v5 | v4 |
| v6 `passiveAura` non-null, tree null | v6 with `skills:null` | v3 |
| v6 tree and `passiveAura` non-null | v6 with v5 skills | v4 |

Aura identity, range, effects, active state, and affected tower IDs are derived from content plus
already checkpointed hero/tower/outcome state. They add no mutable checkpoint field and do not
advance the nested Heroes checkpoint beyond v3/v4. Restore validates the content digest, restores
the existing state, and derives the same affected set and state digest.

R5.5A adds no gameplay command and no event. `GameCommandV6`, journal v6, outer
`GameCheckpointV1`, `towerforge-sim-v2`, project schema v3, mechanics catalog v1,
`PlayerProfileV3`, `CampaignRunV1`, multiplayer protocol, and TowerScript v6 all remain unchanged.
No `heroAuraChanged` event is synthesized; consumers observe the authoritative snapshot. MCP's
capability/schema guide may advance as an authoring descriptor version, not as a simulation or
transport protocol version.

### Package and surface boundaries

- `packages/engine` owns v6 normalization, semantic budgets, topology membership, modifier
  assembly, snapshot v6, and checkpoint/replay equivalence. It imports no Studio, renderer, DOM,
  Node, or filesystem code.
- CLI/project-loader code preserves future v7 data and exposes an inert
  `basic_passive_hero_aura` recipe. The recipe neither enables Heroes, selects a mission, changes a
  skill tree, enables navigation/elevation, nor binds visuals.
- Mechanics Hub owns explicit v6 promotion and all aura/effect fields. Main tower, enemy, and
  mission forms receive no disabled aura controls.
- MCP/AI exposes the engine-owned v6 descriptor and the existing
  `describe -> read -> recipe -> preview -> guarded apply -> validate` flow with revision guard,
  backup, and rollback. The shared agent instructions and public plugin skill must describe the
  same opt-in and null behavior.
- The shared renderer consumes only snapshot v6. Canvas and Phaser do not read mechanics content,
  derive the affected set, or dispatch a new command.

## Compatibility and exclusions

- Missing, disabled, unselected, v1–v5, v6-null-aura, and unsupported-future paths retain their
  existing snapshot/checkpoint/UI behavior and allocate no aura collection or modifier work.
- R5.5A has one selected hero and at most one aura. It does not add multiple-hero stacking,
  tower-type/tag filters, enemy debuffs, healing, shield/mana regeneration, range/fire-rate
  modifiers, aura toggles, skill-unlocked auras, or persistent/campaign aura state.
- Aura radius ignores LoS and elevation and does not activate either module. Dynamic Navigation is
  not required.
- `blockCapacity`, route occupancy, enemy delay, logistics/power/ammo, and every TowerScript hero
  scope/event/action remain separate TDD increments. In particular, R5.5A must not reserve a path,
  mutate occupancy, consume supply, or add typed script actions while adding the passive aura.

## TDD and acceptance evidence

The implementation started with independent RED contracts before production edits:

1. Engine/content RED: exact v6/null schemas, descriptor parity, UTF-8 and effect/radius/value
   boundaries, hostile accessors/proxies/sparse arrays, canonical order, disabled structural
   errors, inactive semantic warnings, active combined modifier overflow, and future v7 fail-close.
2. Engine/runtime RED: hex/square inclusive radius boundary, binary tower order, build/sell/destroy,
   movement entering/leaving range, mid-edge current-coordinate semantics, defeat/outcome
   deactivation, and no RNG/state mutation from reads.
3. Damage RED: existing run-before-spatial ordering, all immediate tower delivery kinds, exact
   exclusion of DoT/status/resource/non-tower sources, duplicate-ID safety, finite resolution, and
   no reward/death duplication.
4. Snapshot/checkpoint RED: the four-row compatibility matrix, authoritative affected IDs,
   checkpoint+journal replay digest equivalence, no aura checkpoint field, and byte-compatible
   v1–v5/null fixtures.
5. Surface RED: CLI recipe inertness and v5→v6 promotion, Studio edit/save/reload/disable/re-enable
   including all 1–4 effects and multi-definition null materialization, MCP guarded AI flow with
   stale revision/rollback/malformed/future cases, and public plugin parity.
6. Presentation/package RED: shared fail-closed snapshot projection, Canvas/Phaser on hex and
   square maps, all four templates without new input controls, affected-tower cues driven only by
   snapshot, and PWA/single-file/web-package/`.tdpack` preservation.

Acceptance completed with 2,257/2,257 Vitest tests in 201 files and 102/102 Playwright tests. The
full `typecheck`, engine build, validation, simulation, balance, map compile, web build, and plugin
build/validate/smoke gates passed. Absent/disabled/null and v1-v5 compatibility paths retained
their snapshot, checkpoint, player, and authoring behavior. The independent code verifier and
constructor-integration verifier both signed off with no open P0-P3 findings.
