# Opt-In Elemental Armor Matrix

This fixture mirrors the bundled `basic_elemental_armor_matrix` recipe. It is example data, not a mandatory taxonomy and not an elemental-reaction module.

To use it in a compatible project:

1. Set `project.json` to project schema v3.
2. Copy `mechanics.json` to `content/mechanics.json`.
3. Merge `mission-selection.json` into the target mission.
4. Ensure the assigned enemy ID exists. This example targets the starter's first binary-sorted enemy, `armored_brute`.
5. Preview and validate before applying; prefer Mechanics Hub or the revision-guarded MCP flow for an existing project.

Removing the mission selection or disabling `modules.combat.enabled` restores the legacy runtime path without deleting the profile. The armor-only profile adds no combat snapshot state. If armor content changes, old checkpoints are rejected through the simulation content digest.
