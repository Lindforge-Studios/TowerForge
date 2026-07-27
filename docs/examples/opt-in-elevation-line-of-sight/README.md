# Opt-In Elevation Line of Sight

This fixture demonstrates the R3.2 optional deterministic LoS profile. It does not enable high-ground bonuses, physics, hazards, terraforming, or TowerScript actions.

1. Merge the terrain definition fragment so the declared blocker tag already exists.
2. Author any desired sparse map elevations through `preview_map_elevations` / `apply_map_elevations`; the LoS recipe itself never edits a map.
3. Preview the mechanics v2 profile and run `analyze_line_of_sight` with the same revision and candidate.
4. Apply the guarded mechanics transaction and merge/select the mission profile only after reviewing diagnostics.

The bundled `basic_elevation_line_of_sight` recipe produces the same profile and reports `elevation_terrain_tag_missing` if `opaque` does not exist. It never adds that tag, edits map data, enables the module, or selects a mission. Remove `lineOfSight` to keep an elevation-only v2 profile; disable or unselect elevation for the full legacy path.
