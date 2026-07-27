# Opt-In Authored Elevation

This fixture demonstrates the R3.1 elevation data foundation without enabling line of sight, high-ground bonuses, displacement, hazards, or terraforming.

To use it in a compatible project:

1. Preview and apply `map-source.fragment.json` to one `maps/src/*.tmj` map through the guarded elevation map transaction. The fragment uses the preferred top-level `elevationOverrides` form; the compiler also accepts the same array encoded as JSON in a Tiled property.
2. Copy or merge `mechanics.json` into `content/mechanics.json`.
3. Merge `mission-selection.json` into the mission that uses the edited map.
4. Preview and validate before applying. Prefer Map Authoring and Mechanics Hub, or the equivalent revision-guarded MCP tools, for an existing project.

Authoring elevation upgrades the project manifest to schema v3. It never upgrades a legacy project merely because the project is opened, validated, built, or packaged. Entries are sparse signed safe integers; a missing tile and an explicit zero both compile to the implicit default `0`, and compiled nonzero entries are canonicalized by numeric `(r,q)`.

The elevation module v1 profile is deliberately `{}`. It selects whether a mission exposes the edited map's elevation through the optional snapshot and presentation surfaces; it does not duplicate map data. The bundled `basic_authored_elevation` recipe likewise returns only the empty profile and does not modify the map, enable the module, or select a mission.

With the module absent, disabled, or unselected, the elevation snapshot and renderer cues are absent and the existing constructor/player behavior remains unchanged. Changing authored map elevations still changes the simulation content digest, so a checkpoint from different content is rejected even when elevation presentation is disabled.
