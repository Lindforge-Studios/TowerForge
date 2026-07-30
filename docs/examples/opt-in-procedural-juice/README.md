# Opt-in Procedural Juice

This R11 fixture adds deterministic hit sparks, a parametric impact tone, and presentation-only
camera feedback to `tutorial_01`. It does not add a mechanics module or change simulation state.

Use Studio → Assets → Procedural Juice Lab, or the guarded AI flow:

1. `describe_schema({domain:"proceduralJuice"})`;
2. `get_procedural_juice` and optionally `get_procedural_juice_recipe`;
3. `preview_procedural_juice` with the block from `visuals.fragment.json`;
4. `apply_procedural_juice` with the exact returned revision;
5. `validate_project` and `preview_procedural_juice_event`.

The first apply promotes `project.json` and `content/visuals.json` to schema v3 while preserving
all unrelated visual fields. The fixture filters the heavier camera cue to the starter enemy type
`armored_brute`; replace that ID with an authored boss type when copying it to another project.

Removing only `proceduralJuice` disables R11. Canvas, Phaser, Studio Playtest, and generated players
then use their unchanged legacy effects and audio path. Reduced-motion mode removes hit stop and
chromatic separation and limits particles/shake; audio remains independently muteable.

See [ADR 0052](../../adr/0052-opt-in-procedural-juice-presentation.md).
