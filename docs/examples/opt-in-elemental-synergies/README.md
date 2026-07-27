# Opt-In Elemental Tower Synergies

This fixture demonstrates the isolated R4.1A `roguelite` v1 tower-tag and global damage-synergy
slice. Nothing in this directory is enabled automatically.

1. Merge the exact authored tower tag arrays from `tower-tags.fragment.json` into the intended
   definitions under `content/balance.json`.
2. Preview `mechanics.json` and the mission choice through Mechanics Hub, or use
   `describe_schema({domain:"roguelite"})` and `get_capabilities` before the guarded mechanics
   transaction.
3. Apply the profile and tower tags atomically, then run `validate_project` and playtest both
   renderers.

The bundled `basic_elemental_synergy` recipe produces the same 2/4/6 candidate when passed an
explicit `towerTypeIds` array. It only merges the `elemental` tag into those tower types and stages
the profile: it does not enable the module, select a mission, place towers, or alter a run.

Only live placed tower instances count. The default `highest` mode applies the greatest reached
tier once; `cumulative` is an explicit alternative. Modifiers enter the shared damage pipeline at
the `run` stage and affect tower-sourced damage only. The optional `snapshot.roguelite` section is
the rendering authority; Canvas and Phaser never recount towers or evaluate tiers.

If the catalog is absent, the module is disabled, or the mission has no `roguelite` profile
selection, the snapshot section and player status panel are absent and legacy gameplay is
unchanged.
