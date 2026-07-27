# Opt-In Tile Displacement Physics

This fixture demonstrates the explicit R3.4a `physics` v1 module. Every file is a separate,
reviewable authoring choice; copying the mechanics profile alone does not alter a tower, ability,
enemy, terrain type, or mission.

1. Add the intended explicit hazard tag to a terrain definition with
   `terrain-type.fragment.json`, or omit hazards entirely.
2. Preview and apply `mechanics.json` through the guarded mechanics transaction.
3. Add a typed effect from `effects.fragment.json` only to a pipeline tower or custom ability.
4. Merge `mission-selection.json` only into the mission that should activate physics, then run
   `validate_project` and playtest the result.

`basic_displacement_physics` returns an empty profile. `tagged_fall_hazards` returns only
`{ "fallHazardTerrainTags": ["fall_hazard"] }`. Neither recipe enables physics, selects a
mission, edits terrain, or changes towers or abilities.

Physics v1 moves ground enemies by bounded whole topology tiles. Flying enemies are immune,
authored-route enemies never leave their track, dynamic-flow enemies reuse the existing shared
field, and the core/goal tile is a blocker. A tagged fall is terminal and uses the normal
exactly-once kill/reward lifecycle; it is not damage. With physics absent, disabled, unselected,
missing, or future-versioned, the typed effect is an exact gameplay no-op.

Terraforming, flood, moat, bridge mutation, TowerScript actions, Visual Graph nodes, continuous
velocity, and per-enemy pathfinding are deliberately not part of this fixture; they remain later
versioned work.
