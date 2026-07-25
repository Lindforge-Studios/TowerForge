# Opt-In Elemental Reactions

This fixture mirrors the bundled `elemental_shatter` recipe and its explicit combat prerequisite. It declares `fire`, `ice`, and `physical` as authored damage types, then enables a separate reactions v1 profile for one mission. The engine never infers behavior from those IDs.

To use it in a compatible project:

1. Set `project.json` to project schema v3.
2. Copy `mechanics.json` to `content/mechanics.json` or merge both modules into the existing catalog.
3. Merge `mission-selection.json` into the target mission.
4. Ensure damaging towers, abilities, or TowerScript actions actually emit the authored `fire` and `ice` damage types.
5. Preview and validate before applying; prefer Mechanics Hub or the revision-guarded MCP flow for an existing project.

An eligible ice hit applies a four-unit exposure. A later fire hit consumes it and schedules a physical secondary hit equal to `2 ×` the primary damage after source modifiers. The inverse direction is authored separately. Secondary damage passes through marks, armor, resistance, legacy armor, shields, and HP, but does not recursively trigger reactions in this recipe.

The other bundled profiles remain independent: `wet_chain_shock` requires an active `lightning` damage type plus an authored terrain tag `wet`; `poison_combustion` requires `fire` and consumes the existing poison status. Recipes report missing prerequisites and never patch combat, terrain, balance, or mission content automatically.

Removing the reactions mission selection or disabling `modules.reactions.enabled` restores the combat-only path without deleting either profile. Live exposures use optional `snapshot.reactions` schema v1 and an independently validated checkpoint state; the runtime FIFO is synchronous and is never serialized.
