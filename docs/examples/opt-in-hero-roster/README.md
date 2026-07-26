# Opt-in static hero roster

This R5.1A fixture activates one bounded `heroes` v1 roster without enabling movement or combat
abilities.

1. Persist the normal project migration, then set `project.json.schemaVersion` to `3` as part of
   the guarded mechanics transaction.
2. Copy `mechanics.json` to `content/mechanics.json` or stage the same profile through Mechanics
   Hub / `preview_mechanics_module`.
3. Merge `mission-selection.json` into the target mission.
4. Optionally merge `visual-binding.fragment.json` into `content/visuals.json` after adding a local
   `commander_idle` sprite. If the binding is absent, both renderers use their shape fallback.
5. Run `npm run validate` and playtest both renderer targets.

The active engine snapshot contains one selected unit at the map core:

```json
{
  "heroes": {
    "schemaVersion": 1,
    "units": [
      {
        "id": "commander",
        "definitionId": "commander",
        "label": "Field Commander",
        "coord": { "q": 0, "r": 0 }
      }
    ]
  }
}
```

The coordinate above is illustrative; the engine always copies the selected mission map's actual
`coreCoord`. The profile supports 1–32 definitions, while only `selectedHeroId` is instantiated.
Definition IDs and labels are limited to 128 UTF-8 bytes.

This v1 slice has no `moveHero`, hero command, checkpoint state, RNG, event, TowerScript extension,
HP, shield, mana, cooldown, ability, skill, aura, blocking, or navigation behavior. Do not mutate
the snapshot or add a hero checkpoint section. Removing the mission selection or disabling the
module removes the optional snapshot and renderer surface. R5.1B owns movement,
GameCommand/Journal v4, mutable state, checkpointing, replay, and input handling.

See [ADR 0037](../../adr/0037-opt-in-static-hero-roster-foundation.md).

## Optional deterministic movement (R5.1B)

Use `mechanics-mobile.json` instead of `mechanics.json` to opt this same mission into Heroes v2.
The module owns its movement profile and does not require or enable the separate `navigation`
module. Mouse, touch, keyboard, headless, checkpoint, and replay all dispatch the same exact
`GameCommandV4 moveHero`; the engine remains the only pathfinding authority.

The optional runtime section becomes `snapshot.heroes` v2. Each unit keeps the v1 identity fields
and adds exact nullable movement state:

```json
{
  "movement": {
    "targetCoord": null,
    "nextCoord": null,
    "edgeProgress": 0
  }
}
```

Disabling Heroes or keeping schema v1 preserves the static/legacy paths. Movement v2 still does
not add HP, mana, abilities, auras, blocking, or TowerScript hero actions. See
[ADR 0038](../../adr/0038-opt-in-deterministic-hero-movement.md).

## Optional durability (R5.2A)

Use `mechanics-durable.json` to opt into Heroes v3. Every v3 definition retains v2 movement and
adds exact `durability: {maxHp,shield}`. `shield` may be `null` or `{capacity}`; this recipe uses
100 HP and a 25-point shield. The recipe is also available as `basic_durable_commander_hero` and
does not enable the module or select the mission until the guarded apply is explicitly committed.

Enemy attacks route through the shared damage resolver, consume the hero shield before HP, and set
the authoritative `defeated` state at zero HP. The optional runtime section is
`snapshot.heroes` v3:

```json
{
  "durability": {
    "hp": 100,
    "maxHp": 100,
    "shield": { "current": 25, "capacity": 25 },
    "defeated": false
  }
}
```

Do not reconstruct combat state from presentation cues. This slice adds no mana, abilities,
healing, regeneration, revival, auras, blocking, or TowerScript hero actions. See
[ADR 0039](../../adr/0039-opt-in-hero-durability.md).

## Optional targeted ability (R5.3A)

Use `mechanics-targeted-ability.json` to opt into Heroes v4. Each definition retains the complete
v3 shape and adds exact `mana: {max,starting,regenerationPerUnit}` plus one exact inline
`activeAbility`. The bundled `basic_targeted_hero_ability` recipe materializes the same bounded
shape, but remains inert: it does not enable Heroes, select a mission, enable navigation or
logistics, bind a sprite, or install TowerScript.

At runtime, read mana, cooldown, range metadata, and readiness only from `snapshot.heroes` v4.
Invoke the spell with exact `GameCommandV5 useHeroAbility` fields `heroId`, `abilityId`, and
`targetEnemyId`; a successful cast emits `heroAbilityUsed`. The engine alone validates target
liveness and range, spends mana, starts cooldown, and resolves damage. This slice has no multiple
abilities, skills, auras, blocking, logistics coupling, or TowerScript hero actions. See
[ADR 0040](../../adr/0040-opt-in-targeted-hero-ability.md).

## Optional battle-local skill tree (R5.4A)

Use `mechanics-skill-tree.json` to opt into Heroes v5, or stage the equivalent inert
`basic_hero_skill_tree` recipe through the guarded preview/apply flow. Every v5 definition retains
the exact v4 fields and adds required `skillTree`; set it to `null` for an explicit per-definition
opt-out. The recipe does not enable Heroes, select a mission, bind visuals, install scripts, or
activate navigation, roguelite, or logistics.

A non-null tree grants its `starting` points at battle creation and `perInterwave` points after
each cleared non-final wave. Unlock only with exact `GameCommandV6 unlockHeroSkill` fields
`heroId` and `skillId`. Read points, management availability, missing prerequisites, and
unlockability only from `snapshot.heroes` v5. Effects use the common modifier/damage pipeline and
apply only to the selected hero's active-ability packet.

Points and unlocks are battle-local: reset and every new campaign battle start from the authored
tree, while `CampaignRunV1` and `PlayerProfileV3` remain unchanged. V5 definitions with
`skillTree:null` keep snapshot v4 and nested checkpoint v3; absent, disabled, unselected, and v1–v4
paths have no skill panel or state. See
[ADR 0041](../../adr/0041-opt-in-battle-local-hero-skill-tree.md).

## Optional passive tower-damage aura (R5.5A)

Use `mechanics-passive-aura.json` to opt into Heroes v6, or stage the inert
`basic_passive_hero_aura` recipe through the guarded preview/apply flow. Every v6 definition keeps
the complete v5 shape and adds required nullable `passiveAura`; use `null` for explicit opt-out.
When explicitly promoting a v5 module, the authoring transaction writes `passiveAura:null` on
every definition in every existing Heroes profile before adding an aura to the selected hero.
Loading never migrates content. Preview builds that atomic v6 candidate without mutating project
source; only guarded apply writes it.

The bundled aura uses one allowlisted `tower_damage` modifier at the common `spatial` stage. The
engine applies its one-to-four effects only to immediate damage from live placed towers whose
anchor is within the authored topology radius of the living hero's authoritative `currentCoord`.
DoT, status damage, hero and mission abilities, range, fire rate, logistics, blocking, and
TowerScript are unchanged.

Only a non-null selected aura publishes snapshot v6. Read `active` and the binary-sorted
`affectedTowerIds` from that snapshot; renderers must not recompute distance or membership. If the
independent skill tree is null, snapshot v6 contains `skills:null` and the nested checkpoint stays
v3. An active tree keeps checkpoint v4. A null aura retains the earlier snapshot v4/v5 shapes.
No command, event, journal, profile, or CampaignRun version changes. See
[ADR 0042](../../adr/0042-opt-in-passive-hero-damage-aura.md).
