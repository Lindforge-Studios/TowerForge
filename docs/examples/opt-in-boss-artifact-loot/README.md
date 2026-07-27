# Opt-In Boss Artifact Loot

This fixture demonstrates the isolated R4.2 `roguelite` v2 artifact catalog, deterministic boss
loot, and optional between-wave socketing. Nothing in this directory is enabled automatically.

1. Confirm that `arrow_tower` and `armored_brute` exist in the target project.
2. Use Mechanics Hub, or call `describe_schema({domain:"roguelite"})` and `get_capabilities`.
3. Materialize `basic_boss_artifact_loot` with explicit `towerTypeIds:["arrow_tower"]` and
   `bossEnemyTypeId:"armored_brute"`.
4. Preview and guarded-apply the detached v2 profile, then validate and playtest both renderers.

The authored trophy has one typed `core` slot and the boss has one deterministic weighted roll. An
active mission starts with an empty battle-local inventory. A successful drop appears in
`snapshot.roguelite.artifacts.inventory` and emits `artifactDropped` after `enemyKilled`. At a real
between-wave boundary, GameCommand v2 may socket the item into an authoritative compatible tower
slot; snapshot v3 exposes the assignment and management availability. The dedicated loot RNG,
inventory cursor, and post-mutation socket assignment restore from the optional artifact checkpoint.

Only immediate attacks from the exact socketed live tower receive the authored modifier. This fixture
does not persist the item into `CampaignRunV1` or add draft/campaign navigation. If the catalog is
absent, the module is disabled/unselected, or it remains v1, there is no artifact inventory, drop
event, RNG consumption, socket command, or artifact UI.
