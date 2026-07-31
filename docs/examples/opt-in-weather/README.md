# R13.5 opt-in Weather

This fixture shows the complete authoring shape for the independent `weather` v1 module. Copy
`mechanics.json` to `content/mechanics.json`, merge `mission-selection.json` into the intended
mission, and validate before play. The example explicitly selects `basic_blizzard_weather`; the
same catalog also contains `basic_acid_rain_weather` and `basic_sandstorm_weather` as alternatives.
Nothing is enabled merely by loading a recipe.

Weather profiles contain closed `zones`, `definitions`, and `schedule` records. Zones are either
`all_map` or a bounded canonical `tiles` list. Definitions use only the typed effects
`periodic_damage`, `status`, `visibility_range`, `enemy_speed`, and `tower_fire_rate`. Each wave is
selected from binary-ordered choices plus `calmWeight` by a separate deterministic Weather RNG
domain; it never advances the main simulation RNG and never calls host randomness.

The equivalent AI authoring flow is:

`describe_schema(weather) -> get_capabilities -> get_recipe(basic_blizzard_weather) -> preview_mechanics_module -> apply_mechanics_module(ifRevision) -> validate_project`.

`preview_mechanics_module` is compute-only. `apply_mechanics_module` requires the exact preview
`ifRevision`, validates before replacement, creates a backup and uses rollback if a write or
post-write validation fails. There is no broad `write_weather` tool. Replace the recipe ID with
`basic_acid_rain_weather` or `basic_sandstorm_weather` to start from those inert candidates.

Only an enabled module selected by the mission publishes optional `snapshot.weather` schema v1.
Presentation consumes the authoritative active occurrence and the read-only events
`weatherStarted`, `weatherEnded`, `weatherEffectApplied`, and `weatherBudgetExceeded`. Canvas and
Phaser use the same fail-closed snapshot projector; neither renderer calculates zone membership,
RNG choices, damage, statuses, movement speed, range, or fire rate.

Removing the mission selection, disabling the module, or leaving it unselected removes Weather
snapshot/checkpoint/UI work and restores the exact legacy path. R13.5 adds no Ballistics coupling,
terrain mutation, TowerScript action/event, Visual Graph node, automatic Procedural Juice cue, or
renderer-owned gameplay rule.
