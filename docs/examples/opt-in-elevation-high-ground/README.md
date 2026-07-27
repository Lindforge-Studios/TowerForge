# Opt-In Elevation High Ground

This fixture demonstrates the explicit R3.3 elevation v3 high-ground profile. It is split into
three authored boundaries so adopting the example remains an intentional, reviewable operation.

1. Apply `map-source.fragment.json` to the intended map through
   `preview_map_elevations` / `apply_map_elevations`.
2. Preview and apply the profile from `mechanics.json` through the guarded mechanics transaction.
3. Merge `mission-selection.json` only into the mission that should use the profile, then run
   `validate_project` and playtest the result.

The bundled `basic_elevation_high_ground` recipe returns only the closed `highGround` profile. It
does not edit a map, never enables the elevation module, and does not select a mission. It also does
not add line of sight, physics, displacement, hazards, terraforming, or TowerScript behavior.
Removing `highGround` keeps an elevation v3 profile but restores the legacy range and damage path.
