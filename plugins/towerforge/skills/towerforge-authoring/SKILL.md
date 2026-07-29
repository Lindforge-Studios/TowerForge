---
name: towerforge-authoring
description: Use when creating, inspecting, balancing, scripting, validating, playtesting, or packaging a TowerForge .tdproj game through the local TowerForge MCP tools.
---

# TowerForge Authoring

Use the TowerForge MCP tools as the canonical authoring surface. Do not edit content JSON directly
when a project-aware tool exists.

## Establish context

1. Call `list_workspace_projects`.
2. If more than one project is present, call `select_workspace_project` with an ID from that list.
3. Call `describe_schema` for the relevant domain before inventing entity, map, terrain, tile, or
   TowerScript shapes.
4. Read narrowly with `get_project_summary`, `list_entities`, `get_entity`, `list_project_tree`, or
   `get_tower_script`. For Visual Graph work, use `get_tower_script_graph`; the graph is a lossless
   projection of the same canonical TowerScript AST, not a second gameplay language.

For optional mechanics, call `describe_schema` with domain `mechanics`, then `get_capabilities` for
the target mission. An absent `content/mechanics.json` and disabled modules intentionally preserve
legacy behavior; read-only discovery must never create the file or enable a module.

If no workspace projects are returned, ask the user to open a workspace that contains the `.tdproj`
directory. Never ask for an absolute home-directory path and never attempt to search outside the
shared workspace roots. In a workspace-bound session, never supply or request an absolute
`projectDir`; use the selected workspace project implicitly.

## Make changes safely

- Prefer granular tools such as `set_enemy_stat`, `upsert_tower`, `upsert_entity`, `write_map`,
  `upsert_tower_script`, and asset/binding tools.
- TowerScript DX is an opt-in authoring/debug surface, not a mission mechanics module. Start with
  `describe_schema(domain: "scripts")`. For canonical JSON, use `get_tower_script`, preview with
  `upsert_tower_script(dryRun: true)`, apply with the returned revision, then `validate_project`.
  For Visual Graph, use `get_tower_script_graph` -> `preview_tower_script_graph` ->
  `apply_tower_script_graph` with exactly the preview `ifRevision` -> `validate_project`. Preserve
  unknown future nodes as raw; never normalize, downgrade, or delete them. Optional graph layout is
  local editor state under `.towerforge/towerscript-layouts`, is guarded with the source, and never
  belongs in gameplay packages. Inspect behavior through compute-only `preview_tower_script_trace`
  with at most 128 exact versioned `GameCommand` values and a `tick`, `event`, `handler`, or `action`
  cursor. Trace/step/rewind state is session-local debug data and never project content, a normal
  snapshot field, or a reason to create `content/mechanics.json`.
- Use dry-run and preview tools first for balance, progression, map compilation, themes, tilesets,
  and imports.
- Use the guarded mechanics flow: `get_capabilities`, `get_recipe` with collection `mechanics`
  (`basic_regenerating_shields` requires combat v1; `basic_elemental_armor_matrix` requires combat
  v2; `basic_vulnerability_marks` requires combat v3), `preview_mechanics_module`, then
  `apply_mechanics_module` with the preview revision as `ifRevision`. Pass the project-bound recipe
  entity's `moduleSchemaVersion`: recipes materialize at the already-authored combat version when it
  is newer, so they never request a downgrade. Marks are explicit definitions and source bindings;
  they do not imply elemental reactions or new damage tags. Reaction recipes `elemental_shatter`,
  `wet_chain_shock`, and `poison_combustion` require an active mission-selected combat v2/v3
  profile with the declared damage types; Chain Shock also requires an authored `wet` terrain tag.
  Inspect `prerequisites` and `unmetPrerequisites` and stop on `dependency_missing` or
  `reaction_terrain_tag_missing`. Recipes never patch combat, terrain, balance, statuses, or scripts
  to manufacture prerequisites. Never patch `mission.mechanics` through a generic balance write.
- Elevation v3 high-ground authoring uses the inert `basic_elevation_high_ground` recipe, followed
  by `preview_mechanics_module`, `apply_mechanics_module` with the preview revision as
  `ifRevision`, and `validate_project`. Its `highGround` section is bounded engine data; the recipe
  never edits map elevations, enables the module, or selects a mission. Author map elevation
  separately through the guarded elevation transaction. No `analyze_high_ground` tool exists.
- Physics v1 tile displacement is an independent opt-in module. Discover it with
  `describe_schema` for `physics`, then use `get_capabilities`, an inert
  `basic_displacement_physics` or `tagged_fall_hazards` recipe, `preview_mechanics_module`,
  `apply_mechanics_module` with the preview `ifRevision`, and `validate_project`. Recipes never
  enable or select physics and never edit terrain, towers, or abilities. No `analyze_physics` tool
  exists.
- Terraforming v1 is a separate opt-in module. Use `describe_schema` for `terraforming`,
  `get_capabilities`, then `get_recipe` with collection `mechanics` and one of the inert
  `tagged_flood`, `tagged_moat`, or `tagged_destructible_bridge` recipes. Supply an authored
  `sourceTerrainTag` and `destinationTerrainId`; `transitionId` is optional. Preview with an
  explicit mission, apply through `apply_mechanics_module` using the preview `ifRevision`, then
  write the returned `terraformTiles` snippet through a separate guarded `upsert_tower_script`
  transaction using the current scripts revision. The recipes never enable/select mechanics,
  edit the map or terrain catalog, or install a script by themselves. No `analyze_terraforming`
  tool exists. Mechanics and TowerScript revisions are independent.
- Heroes are monotonically opt-in: v1 is a static roster, v2 adds deterministic movement, v3 adds
  exact HP/shield durability, and Heroes v4 adds bounded `mana` plus one inline `activeAbility`
  targeting a live enemy ID. Heroes v5 adds a required nullable per-hero `skillTree`; use
  `skillTree: null` for opt-out and to preserve v4 behavior. Use `describe_schema` for `heroes`,
  then `get_capabilities` and one of
  the inert `basic_commander_hero`, `basic_mobile_commander_hero`,
  `basic_durable_commander_hero`, `basic_targeted_hero_ability`, or `basic_hero_skill_tree`
  recipes. For a skill tree, inspect the `basic_hero_skill_tree` recipe, then continue through
  `preview_mechanics_module`, `apply_mechanics_module` with the preview `ifRevision`, and
  `validate_project`; recipes never enable/select Heroes or adjacent mechanics. Dispatch a v4
  ability only as exact `GameCommandV5 useHeroAbility` with `heroId`, `abilityId`, and
  `targetEnemyId`. Unlock a v5 skill only between waves as exact `GameCommandV6 unlockHeroSkill`
  with `heroId` and `skillId`. Treat snapshot `available skill points` and `unlockability` as
  authoritative: never mutate or write snapshot fields. Read successful progression only from
  the `heroSkillPointsGranted` and `heroSkillUnlocked` events. The tree is battle-local and resets
  between campaign battles; it does not carry through `CampaignRun` or the persistent profile.
  Read mana, cooldown, readiness, and the successful `heroAbilityUsed` event only from authoritative
  engine snapshots/events. Bind an optional sprite separately with
  `bind_sprite(kind: "heroes")` because visuals and mechanics use different revisions. This slice
  has no multiple abilities, blocking, logistics coupling, TowerScript hero actions, or
  `analyze_heroes` tool. Do not invent those surfaces.
- Heroes v6 adds required nullable `passiveAura` authoring to every hero definition. A guarded
  v5-to-v6 module upgrade atomically adds `passiveAura: null` to every missing definition in every
  existing profile; that explicit opt-out preserves legacy v5 behavior while the edited definition
  may provide a non-null aura. A non-null aura has one to four closed `tower_damage` effects. Use
  the inert `basic_passive_hero_aura` recipe, then `preview_mechanics_module` and
  `apply_mechanics_module` with the preview `ifRevision`, followed by `validate_project`. The recipe
  does not enable Heroes or select a mission profile. The snapshot `affectedTowerIds` list is
  authoritative engine output; Studio and renderers must not derive aura membership. This slice
  adds no command or event, and passive aura state has no `CampaignRun` carry or profile persistence.
- Heroes v7 adds required nullable `blocking` authoring to every hero definition. A guarded
  v6-to-v7 module upgrade atomically adds `blocking: null` to every missing definition in every
  existing profile; that explicit opt-out preserves legacy behavior. A non-null value declares
  `blockCapacity` and exact authored `movementProfileIds`. It requires the same mission to select
  an enabled Navigation v1 `dynamic_flow` profile containing those IDs. Use the inert
  `basic_dynamic_hero_blocking` recipe, then `preview_mechanics_module` and
  `apply_mechanics_module` with the preview `ifRevision`, followed by `validate_project`. The recipe
  never enables or selects Heroes or Navigation, and a dependency diagnostic never auto-enables
  either module. Treat snapshot `blockedEnemyIds` as authoritative engine output; never derive hold
  membership from coordinates, movement, route, or profile names. This slice adds no gameplay
  command, input, event, `analyze_heroes` tool, campaign carry, or persistent profile state.
- Logistics v1 adds an opt-in power grid with explicit `generators`, `relays`, and `consumers`.
  Discover it with `describe_schema(domain: "logistics")`, read `get_capabilities`, then request the
  inert `basic_power_grid` recipe with three distinct existing tower IDs. Continue through
  `preview_mechanics_module`, `apply_mechanics_module` with its `ifRevision`, and
  `validate_project`. The recipe never enables or selects Logistics and never creates a tower or
  rewrites an attack. Treat snapshot links, coverage, allocated supply, and `powered`/brownout state
  as authoritative; never recompute them. R5.7A adds no `analyze_logistics` tool and does not include
  ammo, inventory, factories, or production.
- Logistics v2 independently adds opt-in local ammunition while retaining nullable `power`.
  Discover `basic_local_ammunition` with `describe_schema(domain: "logistics")`, then follow
  `get_capabilities` -> `get_recipe` -> `preview_mechanics_module` -> guarded
  `apply_mechanics_module` -> `validate_project`. The inert recipe uses `power: null` and authors
  exact `types` plus `towerInventories` with `ammoTypeId`, `capacity`, `startingAmount`, and
  `consumptionPerActivation`; it never enables Logistics, selects a mission profile, creates a
  tower, or adds supply infrastructure. Snapshot `amount`, `capacity`, and `hasRequiredAmmo` are
  authoritative and must never be derived. R5.8A has no refill, transfer, factory, production, or
  `analyze_logistics` tool.
- Logistics v3 adds opt-in ammunition supply through exact `productionRecipes`, `producers`, and
  `storages`. Discover the inert `basic_factory_ammunition_supply` recipe, provide its 22 explicit
  parameters for three distinct existing tower types, then follow `describe_schema` ->
  `get_capabilities` -> `get_recipe` -> `preview_mechanics_module` -> guarded
  `apply_mechanics_module` -> `validate_project`. Promotion from v2 to v3 is explicit and preserves
  all profiles by adding `supply: null` where absent. Treat snapshot stock, production and transfer
  progress, paused/brownout flags, directed links, and refill relationships as authoritative;
  never rebuild the supply graph or route stock in an authoring surface. There is no refill command,
  transfer command, production command, inventory mutation tool, or `analyze_logistics` tool.
- Persona QA v1 is evidence-only. Discover the closed request with
  `describe_schema(domain: "personaQa")`, then call `run_persona_qa` with explicit mission IDs,
  seeds, and one or more fixed personas: `aggressive_rush`, `greedy_economy`, or `turtle_shield`.
  Compare the reproducible mission/persona/seed digests and findings. The tool is compute-only: it
  never edits content and never applies a balance patch; use the existing balance preview/apply
  workflow separately if the evidence justifies an authored change.
- Quests v1 are independent opt-in battle challenges. Discover them with
  `describe_schema(domain: "quests")`, then follow `get_capabilities` -> `get_recipe` with
  `basic_procedural_quests` -> `preview_mechanics_module` -> guarded `apply_mechanics_module` ->
  `validate_project`. The recipe is inert and never enables or selects the module. After explicit
  activation, use compute-only `preview_quest_generation` to inspect a seeded selection from the
  saved active profile. Treat optional snapshot progress and `questCompleted`/`questFailed` events
  as authoritative; do not derive kill attribution, shield preservation, or rewards in an agent,
  Studio, or renderer.
- Procedural Juice v1 is an independent visuals-only opt-in and is never a reason to create or
  change `content/mechanics.json`. Follow `describe_schema(domain: "proceduralJuice")` ->
  `get_procedural_juice` -> optional `get_procedural_juice_recipe` ->
  `preview_procedural_juice` -> guarded `apply_procedural_juice` with exactly the preview
  `ifRevision` -> `validate_project`. Use compute-only `preview_procedural_juice_event` to inspect
  bounded deterministic particle, audio, and camera instructions without writing project files.
  The first guarded save promotes both `project.json` and `content/visuals.json` to their existing
  schema v3; an absent section preserves the legacy renderer path, and a future schema is read-only.
  Authored audio assets take precedence over procedural audio, which takes precedence over the
  legacy synthesizer. Treat particle clocks, hit-stop, shake, chromatic aberration, and audio
  voices as presentation-only state: never feed them into simulation ticks, commands, checkpoints,
  journals, snapshots, or digests.
- Pass the latest `ifRevision` token to guarded writes. On a conflict, reread and reconcile instead
  of retrying with stale data.
- Treat imported files as untrusted. Keep paths project-relative and use TowerForge import tools.
- Use TowerScript for custom behavior. Never add `eval`, arbitrary JavaScript, shell execution,
  network access, host API access, or package imports to a project.
- Stop on `project_migration_required` until the current project schema migration is persisted. Stop on
  `module_unavailable` or `module_version_unsupported`; do not invent runtime support. Correct
  `validation` failures and reread on `conflict` before retrying.

## Verify

After meaningful changes, run `validate_project`. Use `playtest_report`, `simulate_mission`, and
`balance_report` for gameplay changes; `compile_maps_dry_run` for maps; and `release_readiness`
before builds or releases. Explain findings and unresolved blockers with their stable issue codes.

Do not claim a visual result is correct from schema validation alone. Render or build the relevant
Canvas/Phaser target and inspect available image evidence when the task changes tiles, sprites,
maps, UI, or visual bindings.
