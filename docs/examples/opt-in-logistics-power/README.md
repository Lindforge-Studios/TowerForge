# Opt-in Logistics power grid

This R5.7A fixture activates one bounded `logistics` v1 power profile. It does not add ammunition,
inventories, storage, factories, production, or item transfer.

1. Define three distinct tower types named `power_plant`, `power_pylon`, and `arc_tower` in the
   normal tower catalog. The consumer must use a fire-capable attack kind; generator and relay
   towers keep their ordinary authored attack/support behavior.
2. Persist the normal project migration, then set `project.json.schemaVersion` to `3` as part of
   the guarded mechanics transaction.
3. Copy `mechanics.json` to `content/mechanics.json`, or stage the inert `basic_power_grid` recipe
   through Mechanics Hub / `preview_mechanics_module` with the three explicit tower-type IDs.
4. Merge `mission-selection.json` into only the missions that should use the grid.
5. Run `npm run validate`, then playtest Canvas and Phaser. The optional power panel must show
   component supply, brownout, node links, and consumer coverage from the authoritative snapshot.

The engine connects generator/relay nodes only when their footprint edge distance is inside both
authored link radii. Each consumer attaches to its nearest covering node, with binary tower ID as
the deterministic tie-break. A component allocates complete demand by ascending `priority` and
then binary tower instance ID; after the first deficit, that consumer and every later one is
unpowered. An unpowered consumer freezes its exact firing cooldown and creates no attack or pulse
effect until supply returns.

Do not calculate components, links, coverage, or brownout in Studio or a renderer. Read only
`snapshot.logistics` v1. Removing the mission selection, disabling the module, or authoring
`"power": null` restores the literal infinite-supply legacy path with no Logistics snapshot or UI.
Future Logistics v2+ modules remain opaque, lossless, and read-only.

The active graph is bounded to 4,096 live participants, 1,024 generator/relay nodes, and 65,536
undirected node links. Placement, movement, and checkpoint restore reject an over-budget candidate
before mutation. R5.7A adds no command, event, checkpoint section, journal version, profile state,
campaign state, TowerScript action, or input binding.

See [ADR 0044](../../adr/0044-opt-in-logistics-power-grid.md).
