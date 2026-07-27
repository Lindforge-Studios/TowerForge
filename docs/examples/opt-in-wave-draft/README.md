# Opt-In Deterministic Wave Draft

This fixture demonstrates the isolated R4.3 `roguelite` v3 wave-draft feature. Nothing in this
directory is enabled automatically, and the profile does not create artifact inventory or socket
controls.

1. Confirm that `arrow_tower` exists in the target project and merge the exact tag array from
   `tower-tags.fragment.json` into that tower definition.
2. Open Mechanics Hub, or call `describe_schema({domain:"roguelite"})` and `get_capabilities`.
3. Preview and guarded-apply `mechanics.json` together with the mission selection, then validate and
   playtest Canvas and Phaser.

After every cleared non-final wave, the engine uses a dedicated seeded RNG to draw exactly three
unique cards from the authored pool. While that offer is pending, simulation time and automatic or
manual wave starts are frozen. `GameCommandV3 chooseDraftOption` selects one offered card, applies
its typed `run`-stage damage modifier, and starts a fresh preparation timer. Checkpoint and command
journal replay restore the same offer, choice order, and state digest.

The four cards demonstrate `all_towers`, `tower_type`, and `tower_tag` scopes. If the draft block is
removed, or the module is absent, disabled, or unselected, no draft RNG, checkpoint state, pause, UI,
or command is added. Artifact-only and synergy-only v3 profiles remain independent in the same way.
