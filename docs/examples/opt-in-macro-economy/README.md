# R15 opt-in deterministic Macro-Economy

This fixture enables the independent `macroEconomy` v1 module for one mission. Copy
`mechanics.json` to `content/mechanics.json`, merge `mission-selection.json` into the selected
mission, then validate the project. Projects without this module or mission selection keep the
legacy economy, snapshots, checkpoint shape, controls, and player bundle path.

The local market is deterministic for the game seed, mission, cleared wave, and commodity ID.
Trades use `GameCommandV8`; their net demand changes the next wave's quote, never the current one.
Deposits lock an explicit amount and settle principal plus authored basis-point interest after the
configured number of cleared waves. Rituals preflight the full tower selection before destroying
anything and then apply only allowlisted engine effects.

Use the AI flow:

`describe_schema(macroEconomy) -> get_capabilities -> get_recipe(basic_local_market) -> preview_mechanics_module -> apply_mechanics_module(ifRevision) -> validate_project`.

Studio, Canvas, and Phaser read prices, holdings, deposit maturity, and altar metadata from the
authoritative snapshot. They do not recalculate market shocks, interest, ritual eligibility, damage,
statuses, or temporary modifiers.
