# R14 opt-in Modular Arsenal

This fixture shows the complete `arsenal` v1 mechanics shape for the starter's `cannon_tower`.
Copy `mechanics.json` to `content/mechanics.json`, merge the mission selection,
and validate. The starter remains unchanged and recipes never enable or select the module.

Use the AI flow:

`describe_schema(arsenal) -> get_capabilities -> get_recipe(basic_modular_arsenal) -> preview_mechanics_module -> apply_mechanics_module(ifRevision) -> validate_project`.

During setup or between waves, use `GameCommandV7 configureTowerModules`. Read compatible choices
and effective multipliers only from `snapshot.arsenal`; Studio, Canvas and Phaser must not duplicate
the compiler. `craftGem` requires exact unsocketed artifact instance IDs. Therefore every referenced
input and output artifact must also exist in the mission's selected Roguelite artifact profile.

The fixture includes a minimal Roguelite artifact profile because its sample recipe references
`ruby_t1` and `ruby_t2`; module assembly itself remains independent from Roguelite. CampaignRun v1
imports as v2 with an empty `arsenal.moduleInventory`. Module ownership and crafted
artifact instances are campaign-run state, not persistent profile state. Disabling or unselecting
Arsenal removes its snapshot, checkpoint and controls and restores the legacy tower path.
