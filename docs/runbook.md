# Runbook

## Local Development

| Task | Command | Notes |
| --- | --- | --- |
| Install | `npm install` | Uses npm workspaces. |
| Run Studio | `npm run studio` | Opens `http://localhost:5174`, default project `examples/starter.tdproj`. |
| Run Studio for another project | `node packages/studio/server.mjs --project /path/to/game.tdproj` | Set `PORT=<n>` when `5174` is busy. |
| Run MCP server | `npm run mcp -- --project examples/starter.tdproj` | JSON-RPC over stdio for MCP-capable agents. |
| Build Codex plugin | `npm run plugin:build` | Regenerates the self-contained runtime and brand assets under `plugins/towerforge`. |
| Validate Codex plugin | `npm run plugin:validate` | Checks manifest, marketplace, component paths, and bundled runtime. |
| Smoke Codex plugin | `npm run plugin:smoke` | Exercises initialize, workspace roots, project discovery, path rejection, and bundled validation. |
| Validate | `npm run validate` | Uses engine validation through the Node project loader. |
| Validate JSON | `npm run validate -- --json` | Machine-readable validation for CI and agents. |
| Simulate | `npm run sim tutorial_01 60` | Runs an engine-backed headless smoke simulation. |
| Simulate JSON | `npm run sim tutorial_01 60 -- --json` | Machine-readable smoke simulation with aggregate events, timelines, milestones, strategy, and next actions. |
| Balance sweep | `npm run balance -- --project examples/starter.tdproj` | Multi-strategy deterministic balance report with advisor flags. |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` | Writes `maps/compiled/maps.json` from `maps/src/*.tmj`. |
| Migrate project schema | `npm run migrate -- --project examples/starter.tdproj --write` | Writes migrated files after creating `.towerforge/migration-backups`. |
| Typecheck | `npm run typecheck` | Engine only. |
| Compile engine runtime | `npm run build:engine` | Writes `packages/engine/dist`. |
| Unit/integration tests | `npm run test` | Engine, CLI, MCP, renderer contracts, templates, packs, and shared logic. |
| Build web player | `npm run build` | Writes `examples/starter.tdproj/dist`, including engine, renderer, project data, and safe project assets. |
| Build single-file player | `npm run build -- --single-file` | Also emits `index.single.html`, runnable directly from `file://`. |
| Package portable web archive | `npm run package:web -- --project examples/starter.tdproj` | Writes a PWA, single-file fallback, loopback launcher, and deterministic ZIP under `<project>/web`. |
| Export project handoff | `npm run project:export -- --project examples/starter.tdproj --out game.tdpack` | Writes a deterministic checksummed archive after validation. |
| Import project handoff | `npm run project:import -- game.tdpack --dir ./projects` | Confines extraction, validates, and refuses an existing destination. |
| List bundled themes | `npm run themes:list` | Lists local packs without reading or changing a project. |
| Preview a theme | `npm run themes:apply -- verdant-frontier --project examples/starter.tdproj --dry-run` | Reports affected files/missions and the revision without writing. |
| Apply a theme | `npm run themes:apply -- verdant-frontier --project examples/starter.tdproj` | Copies only bundled assets, backs up catalogs, validates, and rolls back on failure. |
| Regenerate bundled tile sheets | `npm run tiles:build-presets` | Deterministically writes square/hex sheets for Verdant Frontier and Frostbound Citadel. |
| Package mobile scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` | Builds the web bundle into a Capacitor project under `<project>/mobile`. |
| Package desktop scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` | Builds the web bundle into a Tauri v2 project under `<project>/desktop`. |
| Run packaged Studio shell | `npm run desktop:dev` | Prepares the bundled runtime and launches the Tauri desktop wrapper around Studio. |
| Build desktop Studio installers | `npm run desktop:build` | Produces Tauri bundles under `packages/desktop/src-tauri/target/release/bundle`. |
| Test desktop shell | `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` | Native menu/state/close lifecycle tests. |
| E2E smoke | `npm run test:e2e` | Starts Studio against a temp project and verifies build/player interactions with Playwright. |

Russian is the default Studio language. Switch between Russian and English under **Settings > Appearance > Language**; the choice is stored only on the current device as `towerforge:language`. In desktop builds the same setting also rebuilds the native menu. Project content is never translated or modified by this preference.

The template/grid/renderer conformance gate is part of `npm run test` and `npm run test:e2e`: Classic, Maze, Idle, and Roguelike are built on hex and square grids with Canvas and Phaser. The 16-output matrix must boot, render nonblank tile pixels, expose difficulty/meta UI, and place a tower through exact pointer picking and keyboard focus plus Enter.

## Opt-In Mechanics

Open **Mechanics** in Studio to use the isolated Mechanics Hub. Pick a mission and switch between combat, reactions, navigation, elevation, physics, terraforming, and rogue-lite mechanics. Combat profiles edit shields, the v2 damage/armor matrix, or v3 marks; reactions v1 profiles edit exposures, predicates, and bounded effects; navigation v1 profiles choose `authored_routes` or `dynamic_flow`; physics v1 profiles edit immunity and fall-hazard selectors; terraforming v1 profiles edit transitions and elevation policy; roguelite v1 profiles edit synergies, v2 adds artifacts, v3 adds optional draft, and v4 adds an independent optional campaign marker. Preview before apply. The ordinary mechanics transaction updates `project.json`, `content/mechanics.json`, and mission selections with validation, backup, and rollback; its rogue-lite form also owns tower-tag arrays. Campaign graph authoring uses the narrower four-file transaction described below. Disable preserves authored data and restores the lower-capability runtime path. Ordinary tower, enemy, map, mission, and TowerScript forms remain unchanged.

In Playtest, the dynamic-navigation overlay analyzes all cells when the viewport contains at most 4,096 tiles. On a larger viewport it shows a deterministic focus window around the most recent pointer or keyboard interaction coordinate and reports `analyzed/total` partial coverage; move focus near the area you want to inspect. The overlay is advisory: every click still runs authoritative `canPlaceTower` preflight and `placeTower`, so a cell outside the current window cannot bypass last-path validation.

R3.1 elevation authoring is accepted after independent code and constructor-integration sign-offs on 2026-07-25. Its operational boundary is deliberately split inside Mechanics Hub: edit sparse map `elevationOverrides` through the dedicated elevation map panel, then separately enable/select the empty elevation v1 profile. Do not place elevation values in the mechanics profile or the ordinary map form. Missing cells use `0`; explicit zero rows are removed during compilation; nonzero rows are canonicalized by numeric `(r,q)`. Authoring the field explicitly upgrades the project to schema v3, but opening, validating, saving, building, or packaging a legacy map must not add it.

For an agent, create a missing map with `write_map` first; `write_map` itself does not author elevation. Then use `describe_schema({domain:"elevation"})`, read the selected source map, call compute-only `preview_map_elevations`, and commit with `apply_map_elevations` and its exact whole-map-authoring revision. After map compilation/validation succeeds, use `get_capabilities` and the ordinary mechanics preview/apply transaction to select `basic_authored_elevation`, then validate the project again. The revision covers the manifest, compiled aggregate, and every map source; the transaction backs up and rolls back only its owned target-source, compiled-output, and manifest writes while preserving conflicting external edits. Resolve unsaved ordinary map edits before applying it. The recipe returns only `{}` and never edits a map, enables a module, or selects a mission.

An active mission exposes detached sparse data under optional `snapshot.elevation`; Canvas, Phaser, Studio Playtest, PWA, and single-file builds may show only the shared level/contour cues. There is no R3.1 line-of-sight, range/damage bonus, displacement, fall, or terraforming behavior. Removing the selection or disabling the module removes the snapshot/cues and restores the legacy draw path. The reference fixture is `docs/examples/opt-in-authored-elevation/`; the contract is [ADR 0023](adr/0023-opt-in-authored-elevation-foundation.md).

R3.2 LoS is enabled only by upgrading the authored elevation module monotonically to v2 and saving a profile with `lineOfSight.terrainBlockerTags`. Use `get_capabilities`, preview the exact profile through the guarded mechanics transaction, run `analyze_line_of_sight` with its `ifRevision`, then apply and validate. The analyzer is read-only and rejects stale revisions; Studio exposes the same source/target diagnostic inside Mechanics Hub. `basic_elevation_line_of_sight` expects an already-authored `opaque` terrain tag and never creates or patches one. Removing `lineOfSight` keeps the module at v2 but returns to elevation-only behavior; disabling/unselecting returns to the full legacy path. Enter simple tags as comma-separated text; use a JSON array for tags containing commas, newlines, surrounding whitespace, or a leading `[`. Studio preserves duplicates and over-budget candidates so canonical validation can reject them explicitly instead of silently rewriting input. Do not diagnose LoS from renderer cues or snapshot elevation. Reference data is in `docs/examples/opt-in-elevation-line-of-sight/`; the accepted contract is [ADR 0024](adr/0024-opt-in-deterministic-elevation-line-of-sight.md).

R3.4a physics is an independent v1 module. Use `basic_displacement_physics` for an empty profile or `tagged_fall_hazards` for the open selector `fall_hazard`; neither recipe enables/selects physics, edits terrain, or adds an effect. Add `{kind:"displacement", mode:"push"|"pull", distance:1..8, stopAtBlocker:boolean}` to a pipeline tower or custom ability separately. With `stopAtBlocker:true`, completed steps remain; `false` makes ordinary blocked movement atomic. Ground enemies stay on authored routes or reuse their cached dynamic field, flying enemies are immune, and the core tile is a blocker. A matching hazard tag produces terminal `enemyFell`, not damage, and uses the normal exactly-once reward/objective/spawn-on-death lifecycle. Active physics admits at most the first 8 displacement effects and first 64 deterministic target slots per activation, reserving at most 4,096 topology steps per ability/pipeline activation and 32,768 pipeline steps per tick; exhausted displacement is a no-op while later damage/status/resource effects continue. These counters are not checkpoint state, and inactive physics does not impose them on legacy content. There is no `snapshot.physics`, `analyze_physics`, TowerScript extension, terrain mutation, or inferred elevation fall. Follow `describe_schema({domain:"physics"})` → `get_capabilities` → `get_recipe` → guarded preview/apply → `validate_project`; reference data is in `docs/examples/opt-in-physics-displacement/` and the contract is [ADR 0026](adr/0026-opt-in-tile-displacement-physics.md).

R3.4b terraforming is a separate opt-in v1 module. Author transitions/elevation policy in the Terraforming Mechanics Hub card or use `describe_schema({domain:"terraforming"})` → `get_capabilities` → project-bound `get_recipe(parameters)` → mechanics preview/apply with its revision → separate guarded TowerScript v6 upsert → `validate_project`. Recipes stage a profile and read-only snippet only; they do not enable/select the module, install a script, or invent terrain. In play, `snapshot.tiles` and `snapshot.elevation` are authoritative. Current terrain/elevation events merely hint which existing autotile/elevation regions to refresh, while pending expiry groups are validation-only and must not be treated as recurring redraw work. Canvas and Phaser share square self+8 and odd-r hex self+6 invalidation; bounded projection/expansion failure intentionally falls back to full redraw so the snapshot change stays visible. Studio Playtest, generated PWA/single-file players, web packages, and `.tdpack` use the same projection. Use `docs/examples/opt-in-transactional-terraforming/` as the public reference. Removing the mission selection or disabling the module removes the terraforming snapshot/surface and restores the legacy behavior; global Disable preserves profiles and selections for later re-enable. The accepted contract is [ADR 0027](adr/0027-opt-in-transactional-terraforming.md).

For an agent, use `describe_schema({domain:"mechanics"})`, the focused combat/reactions/navigation descriptor, and `get_capabilities` first. Combat recipes remain `basic_regenerating_shields`, `basic_elemental_armor_matrix`, and `basic_vulnerability_marks`; reaction recipes are `elemental_shatter`, `wet_chain_shock`, and `poison_combustion`; navigation uses `basic_dynamic_navigation`. For dynamic navigation, call compute-only `analyze_navigation` before proposing a placement-sensitive change. Follow `get_recipe({collection:"mechanics", recipeId})` → inspect prerequisites → `preview_mechanics_module` → `apply_mechanics_module` with the preview's `ifRevision` → `validate_project`. Recipes never auto-enable modules or assign navigation presets to enemies. Guarded upgrades preserve other profiles; downgrade and future versions are rejected. Do not write `mission.mechanics` through a generic balance patch. A raw schema-v1 project must first persist the normal v2 migration; the mechanics transaction then performs the explicit project-v3 authoring upgrade.

For R4.1A use `describe_schema({domain:"roguelite"})` → `get_capabilities` →
`get_recipe({collection:"mechanics",recipeId:"basic_elemental_synergy",parameters:{towerTypeIds:[...]}})`.
Preview and apply the returned `profile` and `towerTags` together with the same mechanics revision,
then validate. The recipe accepts 1–16 authored tower type IDs, merges `elemental` into their existing
tags, and returns the 2/4/6 additive damage candidate. It does not enable the module or select a
mission. Do not patch tower tags separately after preview: they are part of the guarded transaction.
Use `docs/examples/opt-in-elemental-synergies/` as the reference fixture.

For R4.2A/B use the same discovery and guarded transaction with
`get_recipe({collection:"mechanics",recipeId:"basic_boss_artifact_loot",parameters:{towerTypeIds:[...],bossEnemyTypeId:"..."}})`.
Both IDs must already exist in project content. The recipe stages a detached v2 profile and does not
enable/select it. The generated inventory is read-only in this slice: `socket` stays `null`, artifact
modifiers are not applied, and no data is copied into `CampaignRunV1`. Validate and playtest both
renderers after apply; disable/re-enable must remove/restore the optional surface without rewriting
the profile. Reference data is in `docs/examples/opt-in-boss-artifact-loot/`; the accepted boundary is
[ADR 0031](adr/0031-opt-in-roguelite-artifact-loot.md).

For R4.3, author a `roguelite` v3 profile with required `synergies` and an independent optional
`draft` block. Use Mechanics Hub or the usual AI path
`describe_schema({domain:"roguelite"})` → `get_capabilities` → `preview_mechanics_module` →
guarded `apply_mechanics_module` → `validate_project`; no dedicated draft writer exists. Every pool
must contain at least three unique valid card IDs. Cards contain only typed damage modifiers scoped
to all towers, one authored tower type, or one authored tower tag.

After a non-final wave clears, choose one of the three authoritative snapshot options. UI controls
dispatch exact `GameCommandV3 chooseDraftOption`; do not mutate the snapshot or call an unvalidated
game method. A pending offer intentionally freezes ticks and blocks the next wave. Choosing starts a
fresh prep timer. Checkpoint and journal replay must reproduce the same offer and digest. Removing
`draft`, disabling/unselecting the module, or using v1/v2 removes the draft RNG, checkpoint section,
pause, and UI without affecting artifacts or synergies. Use `docs/examples/opt-in-wave-draft/` as the
copyable fixture; see [ADR 0033](adr/0033-opt-in-deterministic-wave-draft.md).

For R4.4A use the dedicated flow `describe_schema({domain:"roguelite"}) → get_campaign →
preview_campaign → apply_campaign` with the preview revision → `validate_project`. Enabling upgrades
the selected rogue-lite profile to v4 without changing its synergies, artifacts, or draft; new
authoring adds the exact `campaign:{schemaVersion:2}` marker; writes the bounded
`worldMap.campaign` graph; and selects
the profile for every mission-backed campaign node. Its revision covers `project.json`,
`content/world-map.json`, `content/balance.json`, and `content/mechanics.json`. A stale write changes
nothing, and a post-write failure rolls back every transaction-owned file. Disabling removes only
the marker while preserving the graph and other rogue-lite mechanics for later re-enable.

A fresh run has `CampaignRunV1.nodeId = null`; after a recorded battle, elite, or boss victory the
field identifies that completed node and its direct successors become available. Campaign graph v1
keeps merchant/event nodes presentation-only. To author deterministic structural choices, explicitly
upgrade only the graph to schema v2, declare its root `runResources`, and add exact
`choices[{id,label,costs,grants}]` to every merchant/event node. The unchanged v4 marker activates
either graph version. The engine checks all costs before grants, rejects insufficient or overflowing
transactions, removes zero balances, and advances the run only on full success.

Campaign marker v2 additionally opts into the R4.4C battle handoff. Generated players must call
`prepareCampaignBattle` before adopting a campaign mission and `settleCampaignBattleVictory` only
for the matching victorious engine game. Carried cards and unsocketed artifacts are engine-owned
loadout state; do not merge them from renderer snapshots. Marker v1 remains supported for projects
that want the R4.4A/B graph lifecycle without carryover. Importing a different run while a prepared
battle is active is rejected; defeat or abandon leaves both run and profile unchanged.

Import and export run JSON explicitly in Canvas or Phaser. The player never copies it into
persistent profile storage, a battle checkpoint, or a command journal, and renderer code never
calculates resource effects. Without the v4 marker and matching graph the campaign controls remain
hidden and legacy mission navigation is unchanged. Use `docs/examples/opt-in-campaign-run/` for the
marker-v1 coordinator, `docs/examples/opt-in-campaign-structural-choices/` for graph-v2 choices, and
`docs/examples/opt-in-campaign-battle-handoff/` for marker-v2 carry; see
[ADR 0034](adr/0034-opt-in-campaign-graph-and-run-lifecycle.md) and
[ADR 0035](adr/0035-deterministic-campaign-structural-choices.md), and
[ADR 0036](adr/0036-opt-in-campaign-battle-handoff.md).

Treat settlement as an atomic compare-and-swap: replace the exact input `CampaignRunV1` and
`PlayerProfileV3` with both returned documents, then clear the pending launch before the next
render/update. Never retry settlement with stale pre-battle inputs. The generated players already
enforce this boundary. A future nested campaign marker (v3+) is opaque and read-only: Studio,
`preview_mechanics_module`, and `preview_campaign` reject writes rather than dropping or
downgrading it; disabling such a marker also requires a compatible runtime.

For R5.1A, enable a static hero roster only through Mechanics Hub or the ordinary guarded mechanics
flow: `describe_schema({domain:"heroes"})` -> `get_capabilities` ->
`get_recipe({collection:"mechanics",recipeId:"basic_commander_hero"})` ->
`preview_mechanics_module` -> `apply_mechanics_module` with the preview revision ->
`validate_project`. The recipe stages one `heroes` v1 profile and never enables the module or
selects a mission by itself. The profile must contain 1–32 definitions, one own
`selectedHeroId`, and exact definitions `{label,spawn:"core"}`. IDs and labels are limited to 128
UTF-8 bytes.

An active v1 profile displays exactly one engine-derived hero at the map core through
`snapshot.heroes` v1. Renderers may use an explicitly authored `visuals.bindings.heroes` sprite or
their built-in shape fallback. Do not infer roster activation from `mechanics.json` or add v1 hero
state to a checkpoint. Disabling or unselecting removes the snapshot and presentation without
rewriting the roster.

For deterministic movement, select the separate inert `basic_mobile_commander_hero` recipe and run
the same guarded flow. It stages `heroes` v2 with heroes-owned `movementProfiles` and exact nested
`movement: {movementProfileId,speed}`; it does not create, enable, or select `navigation`. Inspect
the complete shared MovementProfileV1 shape through `describe_schema({domain:"heroes"})`, then
preview before guarded apply. Active movement accepts only exact `GameCommandV4 moveHero` and
publishes `snapshot.heroes` v2 with nullable target/next coordinates and edge progress. Mouse,
touch, keyboard, headless dispatch, checkpoint, and journal replay all use that command; never
mutate snapshot state. Heroes v1 stays static, while unsupported future modules are lossless/read-only.
Use `docs/examples/opt-in-hero-roster/mechanics-mobile.json` for the v2 profile. HP, mana,
abilities, auras, blocking, and TowerScript hero extensions remain later opt-in increments.

For R5.2A durability, choose the separate inert `basic_durable_commander_hero` recipe or copy
`docs/examples/opt-in-hero-roster/mechanics-durable.json`, then use the same
`describe -> capabilities -> recipe -> preview -> guarded apply -> validate` flow. Heroes v3 keeps
the complete v2 movement contract and requires exact `durability: {maxHp,shield}` on every
definition. `maxHp` and shield `capacity` are finite, positive, and at most `1_000_000_000_000`;
shield may be `null`. The recipe never enables Heroes, selects a mission, enables Navigation, or
binds a sprite.

At runtime, read HP, capacity/current shield, and defeat only from `snapshot.heroes` v3. Enemy
attacks are resolved by the engine and consume shield before HP. A defeated hero cannot move and
is no longer attacked. Never mutate snapshot durability or reconstruct it from renderer cues.
Disabling/unselecting Heroes and all v1/v2 profiles keep their earlier snapshot/checkpoint shapes.
Future heroes v4+ remains lossless/read-only in Studio. This slice has no healing, regeneration,
revival, mana, abilities, auras, blocking, or TowerScript hero actions. See
[ADR 0039](adr/0039-opt-in-hero-durability.md).

For R5.3A, stage `basic_targeted_hero_ability` or copy
`docs/examples/opt-in-hero-roster/mechanics-targeted-ability.json`. Heroes v4 adds bounded mana and
one enemy-targeted damage ability without activating any other module. Dispatch only exact
`GameCommandV5 useHeroAbility`; read mana, cooldown, target readiness, and results from snapshot v4
and `heroAbilityUsed`. See [ADR 0040](adr/0040-opt-in-targeted-hero-ability.md).

For R5.4A, use the separate inert `basic_hero_skill_tree` recipe or
`docs/examples/opt-in-hero-roster/mechanics-skill-tree.json`, then follow the same
`describe -> capabilities -> recipe -> preview -> guarded apply -> validate` flow. Heroes v5
requires `skillTree` on every definition: use `null` for explicit opt-out. A non-null tree owns
battle-local `points` and a bounded DAG of `nodes`; every effect is a data-only
`hero_ability_damage` modifier. Mechanics Hub exposes all one-to-four effects and prevents invalid
trees from being saved.

At runtime, dispatch only exact `GameCommandV6 unlockHeroSkill` during setup or a clear non-final
interwave. Read `managementAvailable`, points, missing prerequisites, and `unlockable` from
snapshot v5; do not reconstruct them in Studio or renderer code. A tree does not pause normal wave
scheduling. Its state resets with the battle and is not exported through CampaignRun or profile.
Definitions with `skillTree:null`, v1–v4, disabled/unselected, and future v6 paths retain their
previous or fail-closed behavior. See [ADR 0041](adr/0041-opt-in-battle-local-hero-skill-tree.md).

For R5.5A, use the inert `basic_passive_hero_aura` recipe or
`docs/examples/opt-in-hero-roster/mechanics-passive-aura.json`. Heroes v6 requires nullable
`passiveAura` on every definition. An explicit v5→v6 edit atomically materializes
`passiveAura:null` for every definition in every existing Heroes profile inside the preview
candidate. Read, validation, and build never migrate content; preview never mutates project source,
and only the guarded apply writes the validated module-wide promotion. Then use the ordinary
`describe -> capabilities -> recipe -> preview -> guarded apply -> validate` transaction.

The engine owns aura membership and modifier resolution. Consume `snapshot.heroes` v6
`passiveAura.active` and `affectedTowerIds`; do not calculate radius, liveness, or affected towers
in Studio, renderers, or player code. The aura affects only immediate live-tower damage packets.
It adds no command, event, pause, persistent profile/run state, navigation, blocking, logistics, or
TowerScript surface. A null aura retains snapshot v4/v5 and nested checkpoint v3/v4. See
[ADR 0042](adr/0042-opt-in-passive-hero-damage-aura.md).

For R5.6A, stage the inert `basic_dynamic_hero_blocking` recipe or copy
`docs/examples/opt-in-hero-roster/mechanics-blocking.json`. Heroes v7 requires nullable `blocking`
on every definition. A non-null value contains `blockCapacity` and explicit Dynamic Navigation
`movementProfileIds`. Before enabling it, independently author and select an enabled Navigation v1
`dynamic_flow` profile for the same mission; the recipe and Studio never create or auto-enable that
dependency. Use `mission-blocking-selection.json` as the reference selection fragment.

Follow `describe -> capabilities -> recipe -> preview -> guarded apply -> validate`. Promotion is
an explicit atomic v6→v7 transaction that writes `blocking:null` to every definition in every
Heroes profile. A missing profile, `authored_routes`, unknown movement-profile ID, stale revision,
or malformed candidate must remain a no-write result. Future Heroes v8 remains opaque/read-only.

At runtime, consume only snapshot v7 `blocking.active` and `blockedEnemyIds`. Do not recompute
co-location, liveness, reachability, profile eligibility, capacity, or assignment in Studio or a
renderer. Blocking does not modify flow-field occupancy and must not trigger navigation rebuilds.
It adds no input, command, event, checkpoint field, campaign/profile state, logistics, or
TowerScript surface. A null value retains the literal v4/v5/v6 snapshot path. See
[ADR 0043](adr/0043-opt-in-dynamic-hero-blocking.md).

For R5.7A, define three distinct existing tower types, then stage the inert `basic_power_grid`
recipe with exact `generatorTowerTypeId`, `relayTowerTypeId`, and fire-capable
`consumerTowerTypeId` parameters, or copy `docs/examples/opt-in-logistics-power/mechanics.json`.
The recipe does not create tower types, enable Logistics, select a mission, or add ammo/factory
content. Follow `describe -> capabilities -> recipe -> preview -> guarded apply -> validate`, then
merge the mission selection only after preview is valid. A stale revision, duplicate role, broken
reference, passive consumer, future v3 module, or malformed candidate must remain a no-write result.

At runtime, consume only `snapshot.logistics` v1 for components, links, coverage, and powered state.
Do not solve the network in Studio or a renderer. Test Canvas and Phaser on the mission grid and
confirm visible component supply, brownout, link, and coverage cues. Placement/movement/restore over
4,096 participants, 1,024 nodes, or 65,536 links must fail before mutation. Removing the selection,
disabling Logistics, or saving `power:null` must remove the snapshot and power UI and restore the
literal infinite-supply legacy path. This slice adds no input, command, event, checkpoint field,
profile/run state, TowerScript surface, ammo, inventory, production, or transfer graph. See
[ADR 0044](adr/0044-opt-in-logistics-power-grid.md).

For R5.8A, select an existing fire-capable tower and stage `basic_local_ammunition` with explicit
ammo ID/label, capacity, starting amount, and cost per activation. Reading Logistics v1 does not
migrate it: use Mechanics Hub **Add ammunition** or the MCP preview/apply transaction to promote
the complete module to v2 while preserving `power`. Always inspect the dry-run, apply with its
revision, then run `npm run validate` and reload before playtesting.

At runtime, treat `snapshot.logistics` v2 as the only source of magazine amount/capacity and
depleted state. Do not subtract shots, combine brownout with ammo, or infer refill in Studio or a
renderer. Verify Canvas and Phaser on the mission's square/hex grid: amount decreases once per
successful activation, multi-target effects cost once, no-target costs nothing, and zero ammo
freezes cooldown and removes active pulse cues. This slice cannot refill a live tower; move/upgrade
must preserve its amount, while sell/destruction/reset remove it.

To roll back gameplay, disable Logistics, remove the mission selection, or save
`ammunition:null` through the same guarded authoring path. Confirm that the inventory checkpoint,
snapshot, panel, and cues disappear and that legacy infinite ammunition returns. A stale revision,
malformed or over-budget amount, bad reference, passive tower binding, or future Logistics v3 must
be a no-write result. See [ADR 0045](adr/0045-opt-in-local-ammunition.md) and the copyable fixture at
`docs/examples/opt-in-local-ammunition/`.

For R5.8B, define distinct existing producer, storage, and fire-capable consumer tower types, then
stage `basic_factory_ammunition_supply` with all explicit recipe, stock, interval, radius, and
transfer parameters. Adding supply is an explicit guarded v2-to-v3 promotion; it must preserve the
existing power/ammunition sections and must not create or patch tower definitions. Preview first,
apply with the returned revision, validate, reload, then merge the mission selection.

At runtime, inspect only `snapshot.logistics` v3. Confirm producer/storage stock and progress,
powered/paused state, and directed links in Studio Playtest plus Canvas/Phaser on the mission grid.
Do not calculate topology, destinations, production, refill, or combined firing readiness in a
surface. A ready depleted consumer may fire after same-tick refill; brownout/disruption freezes only
production and outgoing transfer, while incoming stock remains allowed.

To roll back, save `supply:null`, disable Logistics, or remove the mission selection through the
same revision-guarded flow. Confirm that supply state/links disappear while v2 ammunition and v1
power retain their exact behavior. Unknown references, overlapping producer/storage roles,
over-budget topology, stale revisions, malformed progress, and future v4 must fail without partial
writes. There is no manual refill/transfer tool. See [ADR 0046](adr/0046-opt-in-ammunition-supply.md)
and `docs/examples/opt-in-ammunition-supply/`.

Combat v1 accepts only `shields`. A target definition requires positive bounded `capacity` and may add `{ ratePerUnit, delayAfterDamage }` regeneration. Tower shields require a tower with `maxHp`. At runtime shield state is keyed by entity instance ID and appears only under active `snapshot.combat`; Canvas and Phaser consume the same presentation projection. A copyable v1 reference is under `docs/examples/opt-in-basic-shields/`.

Combat v2 retains shields and adds `damageTypes`, `armorTypes`, and `armorAssignments.enemies`. Every assigned enemy requires an existing armor type, and any non-empty assignment set requires a declared `physical` damage type because an untyped packet falls back to `physical`. Multipliers are finite numbers from `0` through `1,000,000`; `0` is a valid immunity, an absent explicit/default multiplier means `1`, and per-enemy `resistances` apply after the matrix. The fixed order is `source modifiers → armor matrix → entity resistance → legacy pierce_only → shield → HP`. `armor_piercing` bypasses only legacy `pierce_only`, not the matrix.

The limits are 256 damage types, 256 armor types, 4,096 enemy assignments, 16,384 matrix cells, and 128 characters per label. Unknown fields and unsafe object shapes are structural errors. Active bad cross-references are errors; the same references in a disabled profile are warnings, but disabling does not waive structural or budget checks. Armor-only profiles have no runtime shield state and therefore no `snapshot.combat` section; nevertheless changed armor content invalidates an old checkpoint through the content digest. The elemental armor recipe is only a data preset—it does not enable reactions. See `docs/examples/opt-in-elemental-armor-matrix/`.

Combat v3 adds `marks.definitions` and optional bindings for towers, abilities, and TowerScript. A mark requires a label, positive duration, safe-integer `maxStacks`, multiplier greater than `1`, and `retain | consume_one | consume_all`; `damageTypes` is an optional allowlist of declared damage types. Limits are 256 definitions, 4,096 bound sources, 16 applications per source, 16,384 live applications, duration `≤ 1,000,000,000`, stacks `≤ 256`, and multiplier `≤ 1,000,000`. The engine applies marks after source modifiers and before armor. Do not add reaction/exposure fields to a v3 mark profile.

TowerScript mark actions require schema v4. `applyEnemyMark` accepts an enemy target, existing `markId`, and optional stacks expression; `clearEnemyMark` removes that mark. Use `enemyMarkChanged` for typed application/consume/expiration/script events. Live marks appear only in optional combat runtime schema v2 and are checkpointed; renderers consume the projection and never recompute vulnerability. See `docs/examples/opt-in-basic-vulnerability-marks/`.

Reactions v1 requires the same mission to select an enabled combat v2/v3 profile. Exposure definitions need a label, duration, and bounded stack count; applications map declared combat damage types to exposure IDs. Reaction triggers are directional damage-type allowlists, requirements are AND predicates, and effects choose `primary`, bounded `radius`, or authored `terrain_tag` targets. Full shield absorption remains eligible; armor immunity, status/DoT, enemy/leak, and zero damage do not trigger. Secondary effects use the shared damage pipeline and are non-recursive unless `allowReactions` is explicitly enabled; depth is capped at 4 and each root at 256 packets.

TowerScript reaction actions require schema v5: use `applyEnemyExposure` and `clearEnemyExposure`, and observe `enemyExposureChanged` / `enemyReactionTriggered`. Scripts cannot bypass the matrix or invoke a reaction directly. Live exposures appear only under optional `snapshot.reactions` schema v1, are checkpointed, and expire before status/DoT processing. The runtime queue is synchronous and is not serialized. See `docs/examples/opt-in-elemental-reactions/` and [ADR 0021](adr/0021-opt-in-elemental-reactions.md).

## Codex Marketplace Plugin

The canonical source and development marketplace live in this repository. Public installation uses
the generated mirror `Lindforge-Studios/towerforge-codex-plugin`. In Codex
**Add plugin marketplace**, use:

- Source: `Lindforge-Studios/towerforge-codex-plugin`
- Git ref: `main` during development, or a release tag that contains the plugin
- Sparse paths: leave empty

Then install `towerforge@towerforge`. The equivalent CLI flow is:

```bash
codex plugin marketplace add Lindforge-Studios/towerforge-codex-plugin --ref main
codex plugin add towerforge@towerforge
```

Start a new Codex task after installation or update. Open a workspace that contains the target
`.tdproj`. One discovered project is selected automatically; for several, use
`list_workspace_projects` and `select_workspace_project`.

The plugin requires Node.js 22+ as `node`, but does not run `npm install`, download dependencies,
or require TowerForge credentials. Its MCP process is local. Codex still sends user prompts and
the tool results needed for the task to the selected OpenAI service; do not describe the overall
agent session as offline. The server itself has no network integration, accepts projects only from
filesystem roots shared by the current workspace, rejects absolute `projectDir` arguments, skips
symlinks, bounds discovery depth/count, and redacts local paths in tool results.

After changing MCP, CLI, engine dist, renderer, or bundled themes, run:

```bash
npm run build:engine
npm run plugin:build
npm run plugin:validate
npm run plugin:smoke
```

Commit the regenerated `plugins/towerforge/runtime` and `plugins/towerforge/assets`. CI rebuilds
them and fails on any diff, preventing a stale marketplace bundle. A source tag or manual
`Build Codex Plugin Export` workflow produces a verified diagnostic artifact with the exact
TowerForge source commit and per-file SHA-256 values.

The public mirror owns `Sync from TowerForge`. It runs every six hours or on manual dispatch,
rebuilds from public `TowerForge/main`, and commits only a verified export. Publication uses the
short-lived `GITHUB_TOKEN` scoped to the mirror itself; neither repository stores a PAT, SSH key,
or credential that can write to both repositories. Run the mirror workflow manually when a release
must appear immediately rather than waiting for the schedule.

## Grid And Tileset Authoring

Every map selects `hex`/`odd-r` or `square`/`cardinal`. Square routes accept only north/east/south/west neighbors; movement, ranges, auras, splash, direct-flight lines, and footprints use Manhattan topology. Run `npm run maps:compile -- --project <project>` after source edits.

Project-v3 maps may author sparse elevation at top-level `elevationOverrides` or as the same JSON array in a Tiled property. Rows must be closed `{q,r,elevation}` safe-integer data, unique and in bounds, with elevation within `-1_000_000..1_000_000` and no more than 65,536 entries. Prefer the guarded elevation preview/apply workflow over a broad map save so revision, compilation, backup, full validation, and rollback remain one transaction.

Open **Assets > Tileset Workbench** to import a PNG spritesheet with a Tiled `.tsj` or `.tsx` descriptor. Select both files, verify topology and slicing, inspect the mask coverage list and image grid, then edit material/signature weights or typed terrain JSON if mapping is incomplete. Any edit invalidates the commit until **Preview tileset** runs again.

Supported Tiled data is limited to tileset image/slicing, Wang sets, tile probability, transformations, and `towerforge.terrainId`, `buildable`, `walkable`, `groundSpeedMultiplier`, `tags`, `connectGroup`, `connectionSource`. PNG is limited to 10 MB, descriptors to 2 MB, and 4096 tiles. Remote images, absolute/traversing paths, symlinks, non-PNG content, XML DTD/entities, unknown properties, invalid dimensions, and stale revisions fail closed. Apply writes the image and both catalogs atomically with backups and rollback.

Studio may show color fallback while a tileset is incomplete. This is a draft state only: `npm run build` and MCP `release_readiness` fail when any reachable map tile needs a missing signature. Agent workflow is `describe_schema({domain:"tiles"})` -> `inspect_tileset`/`preview_tileset_import` -> `preview_tile_binding` -> `bind_map_tileset` -> `render_tileset_preview` -> `release_readiness`. The agent must inspect the PNG contact sheet returned by `render_tileset_preview`; a clean structured coverage report alone is not a visual seam check.

## TowerScript Authoring

Open `Project > Scripts` or the **Scripts** sidebar item. The left pane is a filtered project tree; project/content/map files can be inspected there, while generic editing and file operations are intentionally limited to `scripts/`.

TowerScript files:

- live under `scripts/` and end in `.tower.json`;
- declare `schemaVersion: 1`, `2`, or `3`, a unique `id`, one or more `bindings`, optional `initialState`, and lifecycle `handlers`; use v2 for terrain events/actions and v3 for shield events/actions;
- bind to `global`, `mission`, `map`, `wave` (wave-set id), `tower` (tower-type id), `enemy` (enemy-type id), `ability` (ability id), or v2 `terrain` (terrain id);
- read values with `{ "$get": "event.enemyTypeId" }` and compose conditions/math with `{ "$op": "eq", "args": [...] }`;
- run typed actions such as resource/core/enemy changes, statuses, tower cooldown/stacks, enemy spawning, state updates, custom signals, v2 `setTileTerrain`/`restoreTileTerrain`, and v3 `restoreEnemyShield`/`restoreTowerShield`;
- can receive author-defined JSON events through the engine `emitScriptSignal` method or a headless `{ type: "emitSignal" }` action.

Save validates the candidate definition and all project references before an atomic write. A stale source revision returns a conflict; invalid post-write state restores the previous file. The runtime also caps expression work, actions, events, recursion, spawns, state, and payload size. A runtime error appears in `snapshot.scriptState.diagnostics` and as a `scriptDiagnostic` event instead of crashing the game.

TowerScript deliberately cannot run JavaScript, import packages, access files/network/DOM/environment, read wall-clock time, or generate randomness. Add a missing capability as a typed engine event/action with deterministic tests; do not add `eval`, `Function`, or raw host bridges.

Terrain changes are runtime-only. A duration restores authored terrain; no duration keeps the override until explicit restore or run end. Scripts may change at most 64 tiles per event transaction and hold 512 active overrides. Active route cells cannot become non-walkable; changing `buildable` never deletes an existing tower.

## Desktop Studio Navigation

The packaged Studio uses a native application menu. macOS exposes `TowerForge`, `File`, `Edit`, `View`, `Project`, `Window`, and `Help` in the system menu bar. Windows and Linux expose the equivalent menu on the application window, with Exit and About in their conventional menus.

- `File > New Project` opens the Studio project wizard and a native location picker. Templates are Classic, Maze, Idle, and Roguelike.
- `File > Open Recent` stores up to ten valid projects in `<app-data>/desktop-state.json`; missing projects are removed automatically and Clear Recent preserves the active project.
- Save, Undo, Redo, navigation, validation, simulation, map compilation, balance, theme, zoom, and help reuse the same Studio command registry as toolbar buttons, shortcuts, and the command palette.
- New/Open/Recent/Close/Quit show `Save / Discard / Cancel` when the current project is dirty. A failed save cancels the requested action.
- On macOS, closing the window keeps the app available from the Dock; Quit stops the sidecar. On Windows and Linux, closing the only window exits the app.

## Preview Built Player

```bash
npm run build
python3 -m http.server 5175 --bind 127.0.0.1 --directory examples/starter.tdproj/dist
```

Open `http://127.0.0.1:5175`.

For a no-server handoff, run `npm run build -- --single-file` and open `dist/index.single.html`. For a distributable web ZIP with its own loopback launcher, use `npm run package:web`.

Player progress is stored under the exact app-scoped key `towerforge:progress:<appId-or-project-name>`. Loading legacy, v1, or v2 progress migrates it only in memory; the next explicit difficulty/meta/mission action writes canonical v3. A newer-version profile is left byte-identical, including opaque data beyond current collection/byte budgets, and the player shows a warning. Corrupt progress falls back to a playable empty session and may be replaced by an explicit profile action. Reset remains the only operation that intentionally removes the protected exact key.

Use **Reset progress** for an ordinary reset: it removes only the current app's profile and preserves story state and other app profiles. Use **Reset local progress** in the boot-error overlay only when the player cannot start: it removes the current profile and that app's `story_seen_...` namespace, while preserving unrelated app profile/story keys.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PROJECT_DIR` | no | Overrides the default `.tdproj` project for Studio/CLI. |
| `PORT` | no | Overrides Studio port, default `5174`. |
| `ANTHROPIC_BASE_URL` | no | Overrides the AI Chat Anthropic base URL, default `https://api.anthropic.com`. |
| `OPENAI_BASE_URL` | no | Overrides the AI Chat OpenAI base URL, default `https://api.openai.com/v1`. |
| `OPENROUTER_BASE_URL` | no | Overrides the AI Chat OpenRouter base URL, default `https://openrouter.ai/api/v1`. |

Packaged Studio builds set internal desktop variables such as `TOWERFORGE_DESKTOP`, `TOWERFORGE_BUNDLED_RUNTIME`, `TOWERFORGE_RUNTIME_ROOT`, `TOWERFORGE_USER_DATA_DIR`, and `TOWERFORGE_SESSION_TOKEN`. `TOWERFORGE_DESKTOP` enables loopback/session security, while `TOWERFORGE_BUNDLED_RUNTIME` requires the precompiled engine shipped in the app. These are runtime diagnostics only; normal users should not need to set them manually.

Configure AI under `Settings > AI Connections`; provider, model, and reasoning defaults are under `Settings > AI Chat Defaults`. Open the right-side chat from the top bar, sidebar, command palette, or native `Project > AI Chat` command. AI Chat has two authentication paths:

- **Account runtimes**: Codex uses ChatGPT OAuth through Codex App Server; Claude Code uses the official Claude Agent SDK/runtime login. Click Connect and finish the provider-owned browser flow. TowerForge never receives the OAuth token and does not read the runtime credential cache. Credentials live under the provider runtime's protected directory in `<app-data>/agent-runtimes`; Codex is configured to use the OS keyring.
- **Direct APIs**: Anthropic, OpenAI, and OpenRouter keys remain separate browser `localStorage` entries for that device and are sent only to the loopback Studio server for the selected request. The old `towerforge:anthropic-key` entry is migrated automatically.

Both paths send the user prompt and the tool results needed for the task to the selected provider. Account isolation protects credentials; it does not make inference offline. TowerForge disables local account-runtime transcript persistence, gives each runtime a private home and empty working directory, restricts Codex filesystem reads to that workspace, disables Claude built-in tools, exposes only validated TowerForge tools, and does not inherit API/cloud/proxy credentials into the runtime process. Never put provider credentials in `.tdproj` files, committed docs, traces, or support logs.

AI Chat accepts up to eight JPEG/PNG/GIF/WebP images per turn, at most 4 MB each and 10 MB total. For a selected video up to 200 MB, the WebView decodes it locally and samples up to four JPEG frames. Only those frames are sent; the filename, original video, and audio are not sent. Codex attachment files use generated names inside its isolated turn directory and are deleted after the turn.

## Debugging

- Studio load failures: run `npm run validate`, then restart `npm run studio`.
- Engine compile failures: run `npm run typecheck`, then `npm run build:engine`.
- Build failures: inspect validation output first; build stops on validation errors.
- Project write conflicts: Studio returns a conflict when files changed on disk after load; reload before saving again.
- Browser player issues: serve the normal `dist` directory over HTTP. Only the generated `index.single.html` is designed and tested for direct `file://` use.
- Map compile issues: run `npm run maps:compile -- --project <project> --json` and inspect source map issues.
- High-ground authoring issues: inspect `describe_schema(elevation)` for the engine-owned v3 limits, confirm the mission selects an enabled elevation v3 profile, and validate the map's authored `elevationOverrides`. The `basic_elevation_high_ground` recipe only proposes an inert profile; map edits, module enablement, and mission selection are separate guarded operations. There is intentionally no `analyze_high_ground` tool.
- Physics authoring issues: inspect `describe_schema(physics)`, confirm the mission selects an enabled physics v1 profile, and verify the effect is on a pipeline tower or custom ability. An inactive capability intentionally makes the effect a no-op. If movement stops, inspect `enemyDisplacementResolved.stopReason`; authored routes cannot leave their track, dynamic flow cannot enter a tile outside its cached field, and the core is always blocked. `tagged_fall_hazards` only proposes a tag selector, so author the matching terrain tag separately when a fall is desired. There is intentionally no `analyze_physics` tool.
- Tileset import issues: verify that PNG filename matches the descriptor image basename, slicing fits the decoded image, all properties are allowlisted, and the descriptor's topology matches the destination map. Use `preview_tile_binding` to distinguish missing reachable masks from unused preset masks.
- Studio action traces: inspect `.towerforge/runs/*.jsonl` inside the active `.tdproj`.
- MCP edits: call domain-scoped `describe_schema`, then prefer compact reads, `get_progression`, recipes, `dry_run_progression_patch`, `preview_theme_pack`, and granular commit tools such as `apply_progression_patch`, `upsert_tower_script`, `apply_theme_pack`, or entity/map/asset/narrative writes. Commits validate, accept revision guards, and keep rollback backups under `.towerforge/mcp-backups` or `.towerforge/backups`.
- TowerScript load failures: run `npm run validate` and inspect the reported script file/field. Parse errors are associated with the source path; reference/schema errors identify the script id and field path.
- TowerScript runtime issues: inspect Studio Playtest events or `snapshot.scriptState.diagnostics`. Budget errors usually indicate recursive signals, broad `allEnemies/allTowers` work, or an unbounded tick handler; add `when`/`every`, narrow the binding, or split the rule.
- MCP tool discovery: run `npm run mcp -- --project <project>` and issue `tools/list`; tools include `riskClass` and `sideEffect` metadata for permission decisions.
- AI Chat direct-provider issues: verify the selected provider has a saved browser-local key and a tool-capable model, check `/api/ai/chat`, then reproduce the same action through `validate_project`, `simulate_mission`, or `balance_report`. OpenRouter model discovery uses `/api/ai/models?provider=openrouter`; Codex and Claude use the same endpoint with `provider=codex|claude-code`. Custom model IDs remain available when a live catalog is offline.
- Codex/Claude account issues: use Disconnect, restart Studio, and Connect again. The safe status endpoint is `/api/ai/runtime/status?provider=codex` or `provider=claude-code`; it never returns tokens. A packaged build must contain compatible packages under `runtime/node_modules/@openai` and `runtime/node_modules/@anthropic-ai`. `TOWERFORGE_CODEX_BIN` and `TOWERFORGE_CLAUDE_BIN` are internal test/diagnostic overrides only and must point to an absolute trusted executable path.
- Native packaging issues: inspect `<project>/mobile/README.md` or `<project>/desktop/README.md`; TowerForge only scaffolds Capacitor/Tauri projects and does not install native SDKs, sign binaries, or submit to stores.
- Desktop Studio packaging issues: run `npm run desktop:dev` first to verify the sidecar starts, then inspect `packages/desktop/src-tauri/runtime` for Studio files and production agent-runtime dependencies, and `packages/desktop/src-tauri/binaries` for the Node sidecar binary. If `/api/health` works but the app UI does not load, check the desktop session token/cookie handshake in the Tauri console.
- Linux AppImage agent runtime issues: the bundled Claude executable is stored with a masked ELF header plus a SHA-256 manifest so `linuxdeploy` does not rewrite or inspect the standalone runtime. On first use Studio verifies it, restores a `0700` copy under the private desktop app-data `agent-runtimes/bin` directory, verifies it again, and only then executes it. Do not unpack or patch this file manually.
- Desktop menu/bridge issues: confirm `packages/desktop/src-tauri/capabilities/main.json` allows only the main `http://127.0.0.1:*` WebView, then inspect the WebView console for `Desktop bridge setup failed`. Delete only `<app-data>/desktop-state.json` to reset last/recent projects without touching project data.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

Deployable web-game artifacts are the static bundle from `npm run build`, its optional `index.single.html`, or the deterministic archive from `npm run package:web`. The installable TowerForge Studio artifacts come from `npm run desktop:build`:

- Windows: `packages/desktop/src-tauri/target/release/bundle/nsis/*.exe` and `packages/desktop/src-tauri/target/release/bundle/msi/*.msi`
- macOS: `packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg`
- Linux: `packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`, `packages/desktop/src-tauri/target/release/bundle/deb/*.deb`, and `packages/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates. `.github/workflows/desktop-release.yml` builds unsigned desktop artifacts on Windows, macOS, and Ubuntu. A manual run uploads a consolidated `towerforge-release-candidate` Actions artifact. Pushing a matching `vX.Y.Z` tag additionally publishes that candidate as a GitHub pre-release after version, installer, and checksum validation. Production macOS distribution requires Developer ID signing plus notarization; production Windows distribution requires a code-signing certificate.

Public desktop releases follow [the desktop release policy](releasing.md). Until signing is configured, they remain GitHub pre-releases with `Unsigned build` in the title. To inspect a cross-platform candidate without publishing, run **Actions > Unsigned Desktop Builds > Run workflow** against the intended commit. To publish, merge the release commit, then create and push an annotated tag whose version matches all desktop manifests:

```bash
git tag -a vX.Y.Z -m "TowerForge vX.Y.Z"
git push origin vX.Y.Z
```

The workflow refuses to overwrite an existing release. After publication, the release operator must download all GitHub-hosted installers and `SHA256SUMS`, recalculate every checksum, run `hdiutil verify` for the DMG on macOS, and verify the tag, commit, and source links. GitHub Actions artifacts are build evidence, not a substitute for the published GitHub Release.

## Rollback

For local project edits:

1. Stop Studio.
2. Inspect `.towerforge/*.bak`, `.towerforge/migration-backups/*.bak`, `.towerforge/mcp-backups/*.bak`, `.towerforge/backups/scripts`, and `.towerforge/backups/theme-*` in the affected `.tdproj`.
3. Restore the relevant JSON file manually.
4. Run `npm run validate`.

For generated builds, delete the project `dist` directory and rerun `npm run build`.

For generated portable web packages, delete only the selected `<project>/web` output and rerun `npm run package:web`; project source files are not modified.

For generated native scaffolds, delete `<project>/mobile` or `<project>/desktop` and rerun the matching `node packages/cli/package.mjs` command.

For desktop Studio runtime preparation, delete `packages/desktop/src-tauri/runtime` and `packages/desktop/src-tauri/binaries`, then rerun `npm run desktop:dev` or `npm run desktop:build`.

For a public desktop release with a wrong asset, checksum, or source link, remove public access immediately and follow `docs/releasing.md`. Never replace an installer silently under an existing version; issue a corrected patch release.

## Incidents

1. Capture the command, project path, changed files, and full error output.
2. Run `npm run validate`, `npm run typecheck`, and `npm run sim tutorial_01 60` when applicable.
3. Reproduce in Studio or the built player.
4. Add a focused validation guard, test, or runbook note so the same failure is cheaper to diagnose next time.
