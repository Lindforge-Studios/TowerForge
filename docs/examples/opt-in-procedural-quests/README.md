# Opt-in procedural quests

This R10 fixture activates one deterministic `quests` v1 profile for `tutorial_01`. It selects two
battle-local secondary objectives: exact kills by `arrow_tower` and preservation of that tower's
shield for one cleared wave. Nothing in this directory enables itself or changes the primary
mission victory/defeat rules.

1. Start from a project that contains the `arrow_tower` tower type and includes it in the target
   mission's `buildTowerIds`. The bundled starter project already satisfies those references.
2. Merge `tower.fragment.json` into the ordinary tower catalog so `arrow_tower` is destructible.
   Combat shields may only target towers with `maxHp > 0`.
3. Persist the normal project migration and set `project.json.schemaVersion` to `3` in the guarded
   mechanics transaction.
4. Copy `mechanics.json` to `content/mechanics.json`, preserving any unrelated authored modules.
5. Merge `mission-selection.json` into only the mission that should use these quests.
6. Run `npm run validate`, then verify checkpoint restore and journal replay in a playtest before
   packaging.

The `combat` profile is an explicit dependency of only the shield objective; it gives placed
`arrow_tower` instances a 20-point shield. The `quests` module remains independently selected. Its
profile uses weighted sampling without replacement, but `selectionCount: 2` with exactly two
eligible definitions makes both objectives active in this minimal fixture. Selection is still
derived from the quest-specific seeded domain and does not advance the main simulation RNG.

`arrow_finish` increments only when a damage packet whose exact source is tower type
`arrow_tower` changes an enemy from positive HP to zero. Splash, status, reaction, ability, script,
or another tower source does not count. `shield_watch` tolerates partial shield damage and fails
once only if an eligible tower shield crosses from positive to zero before the required wave clear;
enemy shields never count.

Only the active supported profile adds the optional authoritative section:

```json
{
  "quests": {
    "schemaVersion": 1,
    "profileId": "starter_quest_pair",
    "entries": [
      {
        "questId": "arrow_finish",
        "label": "Arrow finishers",
        "kind": "kill_with_source",
        "current": 0,
        "target": 3,
        "status": "active"
      },
      {
        "questId": "shield_watch",
        "label": "Hold the shield line",
        "kind": "preserve_shield",
        "current": 0,
        "target": 1,
        "status": "active"
      }
    ]
  }
}
```

The same exact section is checkpointed as `state.quests`; restore recomputes the expected selection
from the original RNG identity and mission ID before adopting progress. Completion/failure emits
only `questCompleted` or `questFailed`. Quests add no command, reward, profile/campaign carry, or
multiplayer state.

Removing the `quests` mission selection or disabling the module removes quest selection, RNG work,
snapshot/checkpoint fields, events, and UI projection. Removing the separate combat selection also
makes `shield_watch` semantically invalid rather than silently inventing a shield. See Accepted
[ADR 0051](../../adr/0051-r10-persona-qa-and-procedural-quests.md).
