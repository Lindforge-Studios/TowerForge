# Opt-in destructible environment

This R13.4 reference authors one inert-capable Ballistics v1 profile named
`basic_destructible_environment`, selects it explicitly for a mission, and places one
`basic_crate_1` object in an authored map source. Copy the JSON fragments into the matching
project sections; do not add this data to the canonical starter.

The guarded AI/CLI workflow is:

1. `preview_destructible_environment` with the complete profile, mission ID, map ID and placements.
2. Inspect validation and retain the returned composite revision.
3. `apply_destructible_environment` with the identical request and `ifRevision`.
4. Run `validate_project` and the normal simulation/package gates.

Apply owns a five-file transaction: `project.json`, `content/mechanics.json`,
`content/balance.json`, the selected `maps/src/*.tmj`, and `maps/compiled/maps.json`. It creates a
backup before replacement and performs rollback on validation or write failure. All raw map sources
participating in compilation are covered by the revision even though only those five files are
written.

An active project publishes Ballistics snapshot v2 and checkpoint Ballistics v4 and may emit
`destructibleObjectDamaged` and `destructibleObjectDestroyed`. Canvas and Phaser read the same
presentation-only projection in PWA, single-file, web package and `.tdpack` carriers. Procedural
Juice cues remain optional authored bindings; no debris is generated automatically.

Absent, disabled and mission-unselected modules keep the legacy snapshot, replay, UI and package
path. R13.4 adds no TowerScript actions or events and no broad write tool. Weather, arbitrary
physics and gameplay rules in renderers remain excluded.
