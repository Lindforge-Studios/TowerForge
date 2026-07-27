# Opt-in ammunition supply

This R5.8B fixture activates one bounded `logistics` v3 supply profile. It adds a shell producer,
a depot, and deterministic refill for one finite cannon magazine. It does not add raw materials,
conveyors, loot, manual refill/transfer commands, TowerScript actions, or renderer-owned routing.

1. Define three distinct existing tower types: `shell_factory`, `shell_depot`, and the fire-capable
   `cannon_tower`. Producer and storage towers may keep any ordinary attack/support behavior.
2. Persist the normal project migration and use an explicit guarded v2-to-v3 Mechanics transaction.
3. Copy `mechanics.json` to `content/mechanics.json`, or materialize the inert
   `basic_factory_ammunition_supply` recipe with all explicit tower, amount, radius, and interval
   parameters.
4. Merge `mission-selection.json` only into missions that should run the network.
5. Preview, apply with the returned revision, validate, then inspect Canvas and Phaser on the
   mission's real grid.

The factory produces four shells per time unit into its separate 120-shell output compartment. A
ready transfer may send up to eight matching shells within footprint-edge distance four. The depot
stores up to 240 shells and may send up to twelve within distance five. Transfer planning is
atomic: consumers are served before storage, closer destinations before farther ones, then binary
tower ID. Incoming depot stock cannot be forwarded in the same tick.

Power and disruption pause only production and outgoing transfer. Passive incoming refill remains
allowed. The cannon retains the accepted R5.8A firing order and spends one shell per successful
activation. A ready depleted cannon may resume in the same tick after refill without resetting its
cooldown.

Use only authoritative `snapshot.logistics` v3 for stock, progress, powered/operational cues, and
directed links. Studio and renderers must not rebuild topology or choose destinations. Removing the
mission selection, disabling Logistics, or saving `supply:null` removes the supply runtime while
preserving exact v1/v2 behavior. Future Logistics v4+ remains opaque, lossless, and read-only.

See [ADR 0046](../../adr/0046-opt-in-ammunition-supply.md).
