# Opt-in local ammunition

This R5.8A fixture activates one bounded `logistics` v2 ammunition profile. It gives only
`cannon_tower` a finite local magazine and does not enable power, refill, factories, storage,
production, transfer, loot, or a TowerScript action.

1. Define an existing fire-capable tower type named `cannon_tower` in the ordinary tower catalog.
2. Persist the normal project migration, then set `project.json.schemaVersion` to `3` as part of
   the guarded mechanics transaction.
3. Copy `mechanics.json` to `content/mechanics.json`, or materialize the inert
   `basic_local_ammunition` recipe through Mechanics Hub / `get_recipe`.
4. Merge `mission-selection.json` only into missions that should consume ammunition.
5. Use preview plus revision-guarded apply, run `npm run validate`, and playtest Canvas and Phaser.

Each new cannon starts with 12 of 30 shells and consumes exactly one shell per successful splash
activation, regardless of secondary targets. No target consumes nothing. At zero ammunition the
engine freezes the exact cooldown and emits no attack/effect; R5.8A intentionally provides no way
to refill a live tower. Moving or upgrading preserves stock, while sell/destruction removes it.

The engine snapshot is authoritative for amount/capacity and the depleted cue. Studio and
renderers must not derive consumption, power, or combined operational state. Removing the mission
selection, disabling Logistics, or authoring `"ammunition": null` restores infinite legacy
ammunition with no inventory, checkpoint section, snapshot, or UI. Logistics v1 opens without
implicit migration; the first explicit ammunition save promotes the whole module to v2 and
preserves any authored power section.

See [ADR 0045](../../adr/0045-opt-in-local-ammunition.md).
