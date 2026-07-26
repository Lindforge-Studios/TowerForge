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

This slice has no `moveHero`, hero command, checkpoint state, RNG, event, TowerScript extension,
HP, shield, mana, cooldown, ability, skill, aura, blocking, or navigation behavior. Do not mutate
the snapshot or add a hero checkpoint section. Removing the mission selection or disabling the
module removes the optional snapshot and renderer surface. R5.1B owns movement,
GameCommand/Journal v4, mutable state, checkpointing, replay, and input handling.

See [ADR 0037](../../adr/0037-opt-in-static-hero-roster-foundation.md).
