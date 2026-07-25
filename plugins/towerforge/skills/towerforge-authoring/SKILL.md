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
   `get_tower_script`.

For optional mechanics, call `describe_schema` with domain `mechanics`, then `get_capabilities` for
the target mission. An absent `content/mechanics.json` and disabled modules intentionally preserve
legacy behavior; read-only discovery must never create the file or enable a module.

If no workspace projects are returned, ask the user to open a workspace that contains the `.tdproj`
directory. Never ask for an absolute home-directory path and never attempt to search outside the
shared workspace roots.

## Make changes safely

- Prefer granular tools such as `set_enemy_stat`, `upsert_tower`, `upsert_entity`, `write_map`,
  `upsert_tower_script`, and asset/binding tools.
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
  exists; terrain mutation and bridge/flood/moat recipes are deferred to R3.4b.
- Pass the latest `ifRevision` token to guarded writes. On a conflict, reread and reconcile instead
  of retrying with stale data.
- Treat imported files as untrusted. Keep paths project-relative and use TowerForge import tools.
- Use TowerScript for custom behavior. Never add `eval`, arbitrary JavaScript, shell execution,
  network access, host API access, or package imports to a project.
- Stop on `project_migration_required` until the normal project v2 migration is persisted. Stop on
  `module_unavailable` or `module_version_unsupported`; do not invent runtime support. Correct
  `validation` failures and reread on `conflict` before retrying.

## Verify

After meaningful changes, run `validate_project`. Use `playtest_report`, `simulate_mission`, and
`balance_report` for gameplay changes; `compile_maps_dry_run` for maps; and `release_readiness`
before builds or releases. Explain findings and unresolved blockers with their stable issue codes.

Do not claim a visual result is correct from schema validation alone. Render or build the relevant
Canvas/Phaser target and inspect available image evidence when the task changes tiles, sprites,
maps, UI, or visual bindings.
