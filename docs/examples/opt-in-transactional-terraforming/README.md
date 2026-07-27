# Opt-In Transactional Terraforming

This fixture demonstrates the explicit R3.4b `terraforming` v1 module. Its files are separate,
reviewable authoring choices: a terrain catalog, starting map cells, mechanics profiles, a mission
selection, and a TowerScript v6 action. Applying only one part does not silently apply any other
part.

1. Adapt and preview `terrain-type.fragment.json` through the terrain-aware editor. The IDs and
   tags are examples, not built-in terrain semantics.
2. Adapt `map-source.fragment.json` to the intended `maps/src/*.tmj` map and run
   `compile_maps_dry_run`. This decides which authored tiles initially carry the source tags.
3. Preview and apply `mechanics.json` through Mechanics Hub or the guarded mechanics tools. The
   file contains three independent profiles modelled after `tagged_flood`, `tagged_moat`, and
   `tagged_destructible_bridge`.
4. Merge exactly one profile choice from `mission-selection.json` into the intended mission. The
   included choice activates only `tagged_flood`; selecting either other profile is a separate
   edit.
5. Wrap the action in `towerscript.fragment.json` in a schema-v6 TowerScript binding and handler,
   then preview and upsert that script through the guarded TowerScript surface. The fragment is
   data only and does not install itself.
6. Run `validate_project`, then playtest the affected square/hex and Canvas/Phaser targets.

The sample action changes only an `eventTile` whose current terrain has the authored `floodable`
tag. Its positive `duration` records the exact terrain before-image and requests a deterministic
restore after three simulation-time units. A native timed target has one owner per layer. If either the
initial mutation or a due restore would break required authored routes or dynamic-flow
reachability, the candidate navigation state is rejected as one transaction: no partial terrain
publication, event, or timer ownership escapes. A restore that is temporarily unsafe stays due at
zero and is retried deterministically until the whole restore batch is safe.

Canvas and Phaser consume the same renderer projection. `snapshot.tiles` and
`snapshot.elevation` remain authoritative; `terrainChanged`, `elevationChanged`, and pending
expiry data are bounded presentation hints, never a second gameplay implementation. Both
renderers therefore update the same autotile neighbourhood and elevation cue when a transaction
publishes or restores.

The bundled recipes are inert detached candidates. They require an existing project-authored
`sourceTerrainTag` and `destinationTerrainId`, and optionally an explicit `transitionId`; they do
not add terrain, edit a map, enable a module, select a mission, or install a script. An AI authoring
flow is:

`describe_schema(terraforming) -> get_capabilities -> get_recipe(mechanics, parameters) ->
preview_mechanics_module(explicit missionId) -> guarded apply_mechanics_module -> reread the
independent scripts revision -> guarded upsert_tower_script -> validate_project`.

When `content/mechanics.json` is absent, `terraforming.enabled` is false, or the mission does not
select a terraforming profile, `terraformTiles` is a deterministic no-op and the optional
terraforming snapshot/presentation section is absent. The ordinary constructor and generated
players keep their legacy behavior.
