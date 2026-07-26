# Opt-In Boss Artifact Loot

This fixture demonstrates the isolated R4.2A/B `roguelite` v2 artifact catalog and deterministic
boss-loot inventory. Nothing in this directory is enabled automatically.

1. Confirm that `arrow_tower` and `armored_brute` exist in the target project.
2. Use Mechanics Hub, or call `describe_schema({domain:"roguelite"})` and `get_capabilities`.
3. Materialize `basic_boss_artifact_loot` with explicit `towerTypeIds:["arrow_tower"]` and
   `bossEnemyTypeId:"armored_brute"`.
4. Preview and guarded-apply the detached v2 profile, then validate and playtest both renderers.

The authored trophy has one typed `core` slot and the boss has one deterministic weighted roll. An
active mission starts with an empty battle-local inventory. A successful drop appears in
`snapshot.roguelite.artifacts.inventory` with `socket:null` and emits `artifactDropped` after
`enemyKilled`. The dedicated loot RNG and inventory cursor are restored from the optional artifact
checkpoint state.

This slice does not socket the item, apply its authored modifier, persist it into `CampaignRunV1`,
or add a new command. If the catalog is absent, the module is disabled/unselected, or it remains v1,
there is no artifact inventory, drop event, RNG consumption, or artifact UI.
