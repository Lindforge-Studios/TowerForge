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
| Persona QA smoke | `npm run persona-qa -- --project examples/starter.tdproj --mission tutorial_01 --seed smoke --seconds 20` | Runs the three fixed evidence-only personas without applying a patch. |
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
| Build and run native macOS Studio | `./script/build_and_run.sh --verify` | Kills the local shell, builds explicit ARM64, launches the app, and requires both shell and Studio sidecar readiness. |
| E2E smoke | `npm run test:e2e` | Starts Studio against a temp project and verifies build/player interactions with Playwright. |

Russian is the default Studio language. Switch between Russian and English under **Settings > Appearance > Language**; the choice is stored only on the current device as `towerforge:language`. In desktop builds the same setting also rebuilds the native menu. Project content is never translated or modified by this preference.

The template/grid/renderer conformance gate is part of `npm run test` and `npm run test:e2e`: Classic, Maze, Idle, and Roguelike are built on hex and square grids with Canvas and Phaser. The 16-output matrix must boot, render nonblank tile pixels, expose difficulty/meta UI, and place a tower through exact pointer picking and keyboard focus plus Enter.

## Milestone And CI Verification

The authoritative delivery snapshot is [ROADMAP.md](ROADMAP.md); chronological RED/GREEN and exact
gate evidence lives in `progress.md`. Before describing an R as accepted, verify the remote state
rather than relying on local history:

```bash
git status --short
git rev-parse HEAD
gh pr view <number> --json state,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup
gh pr checks <number>
```

As of 2026-08-01, R12 and R13 are merged and the repaired R13 exact commit passed remote CI. The
`v0.6.0` release line unifies accepted R0–R17: fully opt-in Macro-Economy v1 and
GameCommand/Journal v8, checksummed Ghost Replay Lab/What-If/reference relay, and the constructor-only
Distribution Hub with reproducible publish, provider adapters, licensed Remix provenance and
host-only monetization hooks. Legacy projects remain unchanged. R17 passed full exact-tree gates,
remote CI and independent Code Verifier plus Constructor Integration Verifier review before merge.
The line is public only after the matching tag and six installers plus `SHA256SUMS` are verified.

## Opt-In Mechanics

Open **Mechanics** in Studio to use the isolated Mechanics Hub. Pick a mission and switch between the implemented combat, reactions, navigation, elevation, physics, terraforming, rogue-lite, Arsenal, Macro-Economy, heroes, logistics, Director, quests, multiplayer, enemy-behavior, Ballistics, and Weather capabilities. Preview before apply. The ordinary mechanics transaction updates `project.json`, `content/mechanics.json`, and mission selections with validation, backup, and rollback; domain-specific multi-file editors such as campaign graphs, tower tags, or destructibles use their narrower documented transaction. Recipes return inert candidates and never enable dependencies or select a mission automatically. Disable preserves authored data and restores the lower-capability runtime path. Ordinary tower, enemy, map, mission, and TowerScript forms remain unchanged.

In Playtest, the dynamic-navigation overlay analyzes all cells when the viewport contains at most 4,096 tiles. On a larger viewport it shows a deterministic focus window around the most recent pointer or keyboard interaction coordinate and reports `analyzed/total` partial coverage; move focus near the area you want to inspect. The overlay is advisory: every click still runs authoritative `canPlaceTower` preflight and `placeTower`, so a cell outside the current window cannot bypass last-path validation.

R3.1 elevation authoring is accepted after independent code and constructor-integration sign-offs on 2026-07-25. Its operational boundary is deliberately split inside Mechanics Hub: edit sparse map `elevationOverrides` through the dedicated elevation map panel, then separately enable/select the empty elevation v1 profile. Do not place elevation values in the mechanics profile or the ordinary map form. Missing cells use `0`; explicit zero rows are removed during compilation; nonzero rows are canonicalized by numeric `(r,q)`. Authoring the field explicitly upgrades the project to schema v3, but opening, validating, saving, building, or packaging a legacy map must not add it.

For an agent, create a missing map with `write_map` first; `write_map` itself does not author elevation. Then use `describe_schema({domain:"elevation"})`, read the selected source map, call compute-only `preview_map_elevations`, and commit with `apply_map_elevations` and its exact whole-map-authoring revision. After map compilation/validation succeeds, use `get_capabilities` and the ordinary mechanics preview/apply transaction to select `basic_authored_elevation`, then validate the project again. The revision covers the manifest, compiled aggregate, and every map source; the transaction backs up and rolls back only its owned target-source, compiled-output, and manifest writes while preserving conflicting external edits. Resolve unsaved ordinary map edits before applying it. The recipe returns only `{}` and never edits a map, enables a module, or selects a mission.

An active mission exposes detached sparse data under optional `snapshot.elevation`; Canvas, Phaser, Studio Playtest, PWA, and single-file builds may show only the shared level/contour cues. There is no R3.1 line-of-sight, range/damage bonus, displacement, fall, or terraforming behavior. Removing the selection or disabling the module removes the snapshot/cues and restores the legacy draw path. The reference fixture is `docs/examples/opt-in-authored-elevation/`; the contract is [ADR 0023](adr/0023-opt-in-authored-elevation-foundation.md).

R3.2 LoS is enabled only by upgrading the authored elevation module monotonically to v2 and saving a profile with `lineOfSight.terrainBlockerTags`. Use `get_capabilities`, preview the exact profile through the guarded mechanics transaction, run `analyze_line_of_sight` with its `ifRevision`, then apply and validate. The analyzer is read-only and rejects stale revisions; Studio exposes the same source/target diagnostic inside Mechanics Hub. `basic_elevation_line_of_sight` expects an already-authored `opaque` terrain tag and never creates or patches one. Removing `lineOfSight` keeps the module at v2 but returns to elevation-only behavior; disabling/unselecting returns to the full legacy path. Enter simple tags as comma-separated text; use a JSON array for tags containing commas, newlines, surrounding whitespace, or a leading `[`. Studio preserves duplicates and over-budget candidates so canonical validation can reject them explicitly instead of silently rewriting input. Do not diagnose LoS from renderer cues or snapshot elevation. Reference data is in `docs/examples/opt-in-elevation-line-of-sight/`; the accepted contract is [ADR 0024](adr/0024-opt-in-deterministic-elevation-line-of-sight.md).

R3.4a physics is an independent v1 module. Use `basic_displacement_physics` for an empty profile or `tagged_fall_hazards` for the open selector `fall_hazard`; neither recipe enables/selects physics, edits terrain, or adds an effect. Add `{kind:"displacement", mode:"push"|"pull", distance:1..8, stopAtBlocker:boolean}` to a pipeline tower or custom ability separately. With `stopAtBlocker:true`, completed steps remain; `false` makes ordinary blocked movement atomic. Ground enemies stay on authored routes or reuse their cached dynamic field, flying enemies are immune, and the core tile is a blocker. A matching hazard tag produces terminal `enemyFell`, not damage, and uses the normal exactly-once reward/objective/spawn-on-death lifecycle. Active physics admits at most the first 8 displacement effects and first 64 deterministic target slots per activation, reserving at most 4,096 topology steps per ability/pipeline activation and 32,768 pipeline steps per tick; exhausted displacement is a no-op while later damage/status/resource effects continue. These counters are not checkpoint state, and inactive physics does not impose them on legacy content. There is no `snapshot.physics`, `analyze_physics`, TowerScript extension, terrain mutation, or inferred elevation fall. Follow `describe_schema({domain:"physics"})` → `get_capabilities` → `get_recipe` → guarded preview/apply → `validate_project`; reference data is in `docs/examples/opt-in-physics-displacement/` and the contract is [ADR 0026](adr/0026-opt-in-tile-displacement-physics.md).

R3.4b terraforming is a separate opt-in v1 module. Author transitions/elevation policy in the Terraforming Mechanics Hub card or use `describe_schema({domain:"terraforming"})` → `get_capabilities` → project-bound `get_recipe(parameters)` → mechanics preview/apply with its revision → separate guarded TowerScript v6 upsert → `validate_project`. Recipes stage a profile and read-only snippet only; they do not enable/select the module, install a script, or invent terrain. In play, `snapshot.tiles` and `snapshot.elevation` are authoritative. Current terrain/elevation events merely hint which existing autotile/elevation regions to refresh, while pending expiry groups are validation-only and must not be treated as recurring redraw work. Canvas and Phaser share square self+8 and odd-r hex self+6 invalidation; bounded projection/expansion failure intentionally falls back to full redraw so the snapshot change stays visible. Studio Playtest, generated PWA/single-file players, web packages, and `.tdpack` use the same projection. Use `docs/examples/opt-in-transactional-terraforming/` as the public reference. Removing the mission selection or disabling the module removes the terraforming snapshot/surface and restores the legacy behavior; global Disable preserves profiles and selections for later re-enable. The accepted contract is [ADR 0027](adr/0027-opt-in-transactional-terraforming.md).

For an agent, use `describe_schema({domain:"mechanics"})`, the focused combat/reactions/navigation descriptor, and `get_capabilities` first. Combat recipes remain `basic_regenerating_shields`, `basic_elemental_armor_matrix`, and `basic_vulnerability_marks`; reaction recipes are `elemental_shatter`, `wet_chain_shock`, and `poison_combustion`; navigation uses `basic_dynamic_navigation`. For dynamic navigation, call compute-only `analyze_navigation` before proposing a placement-sensitive change. Follow `get_recipe({collection:"mechanics", recipeId})` → inspect prerequisites → `preview_mechanics_module` → `apply_mechanics_module` with the preview's `ifRevision` → `validate_project`. Recipes never auto-enable modules or assign navigation presets to enemies. Guarded upgrades preserve other profiles; downgrade and future versions are rejected. Do not write `mission.mechanics` through a generic balance patch. A raw schema-v1 project must first persist the normal v2 migration; the mechanics transaction then performs the explicit project-v3 authoring upgrade.

For R7, start from `docs/examples/opt-in-adaptive-director/` or the inert
`basic_adaptive_wave_director` recipe. Validate enemy references and inspect the authoritative
`directorDecision` explanation; do not edit the authored wave to imitate the runtime plan. Run
`propose_balance_patches` only as a cancellable evidence job, then separately review, dry-run, and
guard any accepted balance patch. `preview_procedural_map` writes nothing: review structural
evidence, canonical compile, terrain validation, tileset coverage, and the deterministic runtime
smoke (which is not a balance claim), then call `commit_procedural_map` with the returned revision.
That guarded transaction backs up, recompiles, validates, and rolls source plus compiled maps back
together on failure. Generated images must follow
`stage_generated_asset → inspect_staged_asset → commit_staged_asset(ifRevision)` or explicit
discard. Never put provider keys, account credentials, or prompts in project files or staged
metadata.

For R8, copy `docs/examples/opt-in-local-multiplayer/` and validate before building. Import match
APIs only from `@towerforge/engine/multiplayer`; negotiate the capability handshake before accepting
envelopes. Local co-op v1 uses one fixed-tick session and independently selects shared or
partitioned resources/routes. Partitioned routes require at least one authored route per player;
consume engine snapshot wallets/route ownership instead of recomputing them. Asymmetric v2 requires a separate profile
with exactly two lanes and an authored send pool. Use the in-memory pair for local tests or inject a
WebSocket-like port into the adapter; TowerForge does not create a socket, lobby, account, or
matchmaking service. Confirm an inactive build has no `dist/engine/multiplayer`, then enable/select
the profile and rebuild to confirm both normal and single-file players include the protocol hook.

R10 exposes the pure engine contracts through the public `persona-qa` CLI command, the read-only
Studio Persona QA Lab, and compute-only MCP `run_persona_qa`. For focused verification run:

```bash
npm run test -- --run \
  packages/engine/src/simulation/r10-persona-qa.contract.test.ts \
  packages/engine/src/content/r10-quests.contract.test.ts \
  packages/engine/src/simulation/r10-quest-selector.contract.test.ts \
  packages/engine/src/simulation/r10-quests-runtime.contract.test.ts
npm run test -- --run packages/cli/lib/persona-qa-worker.contract.test.mjs
npm run persona-qa -- --project examples/starter.tdproj --mission tutorial_01 --seed smoke --seconds 20
```

The worker library writes only completed cache envelopes under
`<project>/.towerforge/cache/persona-qa/v1`; `cache:false` and cancelled work leave no cache entry.
Do not copy this directory into builds or `.tdpack` files, and do not treat its findings as authored
balance patches. A corrupt/future cache file is disposable derived state and is recomputed on the
next run.

For quest fixtures, start from `docs/examples/opt-in-procedural-quests/`, or use Mechanics Hub / the
AI sequence `describe_schema(quests) → get_capabilities → get_recipe(basic_procedural_quests) →
preview_mechanics_module → revision-guarded apply_mechanics_module → validate_project`. The recipe
chooses only mission-available damaging tower/ability sources, remains inert until explicit apply,
and fails closed when no valid source exists.
Only the active mission may expose `snapshot.quests` and `state.quests` in a checkpoint. A
`preserve_shield` objective tolerates partial shield loss and fails only when an eligible tower or
hero shield is depleted from positive to zero; enemy shields do not count. Removing the selection
or disabling the module must remove all quest snapshot/checkpoint/events and preserve the legacy
digest. The accepted architectural source is
[ADR 0051](adr/0051-r10-persona-qa-and-procedural-quests.md).

For R11, author presentation only through `content/visuals.json` schema v3 and its optional
`proceduralJuice` schema v1 block. It is not a Mechanics Hub module and must not be added to
`content/mechanics.json` or `mission.mechanics`. In Studio use the separate Juice workspace. For an
agent, follow `describe_schema({domain:"proceduralJuice"})` → read the current catalog and combined
project+visuals authoring revision → optional inert recipe or compute-only event preview → exact
preview → guarded apply with that revision → `validate_project` → playtest. Preview must not launch Web Audio or write source;
recipes return detached fragments only. Future juice versions stay visible/read-only and must not be
downgraded.

An R11 event binding uses one supported event plus optional mission/enemy filters and plural
particle/audio/camera cue references. Keep it within the published descriptor budgets: at most 64
particle emitters, 64 audio cues, 64 camera cues, 128 bindings, 16 references of each kind per
binding, and 256 particles per emitter. Test full, reduced, and off motion. Reduced/off preferences
override authored camera and particle intensity; mute and browser autoplay policy override authored
audio. The adapter permits at most 32 simultaneously live procedural Web Audio sources and releases
them on completion or suspension. An explicitly bound asset SFX precedes a matching procedural cue, which precedes the legacy
synth fallback; an unmatched event uses the existing path. Hit stop/time scale is presentation-only: never compensate
for it by changing `tick(delta)`, multiplayer fixed ticks, cooldowns, journal commands, or replay.

After removing `proceduralJuice`, rebuild and verify that both Canvas and Phaser return to the
literal legacy visuals/audio surface, with no new snapshot/checkpoint/digest fields. For active and
absent cases verify square and hex, PWA, single-file, portable web, `.tdpack`, desktop packaging,
Studio Playtest, and plugin runtime parity. The proposed boundary and exact exclusions are in
[ADR 0052](adr/0052-opt-in-procedural-juice-presentation.md).

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
- declare supported `schemaVersion: 1..6`, a unique `id`, one or more `bindings`, optional `initialState`, and lifecycle `handlers`; v2 adds terrain events/actions, v3 shields, v4 marks, v5 elemental exposures/reactions, and v6 transactional terrain/elevation authoring;
- bind to `global`, `mission`, `map`, `wave` (wave-set id), `tower` (tower-type id), `enemy` (enemy-type id), `ability` (ability id), or v2 `terrain` (terrain id);
- read values with `{ "$get": "event.enemyTypeId" }` and compose conditions/math with `{ "$op": "eq", "args": [...] }`;
- run typed actions such as resource/core/enemy changes, statuses, tower cooldown/stacks, enemy spawning, state updates, custom signals, v2 `setTileTerrain`/`restoreTileTerrain`, and v3 `restoreEnemyShield`/`restoreTowerShield`;
- can receive author-defined JSON events through the engine `emitScriptSignal` method or a headless `{ type: "emitSignal" }` action.

Save validates the candidate definition and all project references before an atomic write. A stale source revision returns a conflict; invalid post-write state restores the previous file. The runtime also caps expression work, actions, events, recursion, spawns, state, and payload size. A runtime error appears in `snapshot.scriptState.diagnostics` and as a `scriptDiagnostic` event instead of crashing the game.

TowerScript deliberately cannot run JavaScript, import packages, access files/network/DOM/environment, read wall-clock time, or generate randomness. Add a missing capability as a typed engine event/action with deterministic tests; do not add `eval`, `Function`, or raw host bridges.

Terrain changes are runtime-only. A duration restores authored terrain; no duration keeps the override until explicit restore or run end. Scripts may change at most 64 tiles per event transaction and hold 512 active overrides. Active route cells cannot become non-walkable; changing `buildable` never deletes an existing tower.

### TowerScript DX 2.0 / 3.0

TowerScript DX is an explicit authoring/debug mode, not a gameplay mechanics module and not a
`mission.mechanics` selection. R9 controllers activate only inside a TowerScript schema v7 document:
`behaviorTrees` enables tower target controllers and `stateMachines` enables HFSM controllers. Do
not create `content/mechanics.json` for either feature. TowerScript v1-v6 and v7 scripts with both
controller arrays absent keep ordinary target modes, legacy UI, snapshots, checkpoints, replay
digests, and generated-game behavior. Only an active HFSM adds optional checkpoint
`scriptMachines` inner schema v1.

In **Project > Scripts**, use **JSON** for the canonical source and **Graph** for its lossless visual
projection. Choose the controller before editing. Graph v2 lays out Behavior Tree composites as a
tree and HFSM states as nested containers with transition-target edges. The graph palette, known-node
property forms, inspector, and help come from `GET /api/towerscript/schema`, which projects the engine
descriptor; do not maintain a separate event/action/operator/scope list. Create nodes from the
palette, connect/reparent them through typed controls, and drag them to store local positions.
When layout v1 has no position for a node, Studio follows containment edges in authored order and
places the missing card in the first non-overlapping tree slot. Existing stable-ID positions remain
pinned, including deliberately overlapping manual layouts; the automatic pass never rewrites them.
`GET /api/project/script/graph` reads the canonical AST, optional local layout v1, and their composite
revision without creating `.towerforge`. Reads emit Graph v2; preview/apply also accept legacy Graph
v1. Only unknown future nodes expose raw JSON, and it remains read-only. If the installed engine
cannot validate a canonical script, keep it read-only—do not downgrade its schema or replace a raw
node with a guessed current node.

Graph save is always two-phase:

1. `POST /api/project/script/graph/preview` materializes the candidate canonical AST and validates it without writing.
2. `POST /api/project/script/graph/apply` repeats the exact candidate with `ifRevision` from preview.
3. Reload the graph and run project validation.

The composite revision covers the script bytes and optional layout. A stale revision writes neither. The script uses the existing confined atomic writer, full-project validation, backup, and rollback. Node positions and viewport are stored separately under `.towerforge/towerscript-layouts/`; this local presentation state is traversal/symlink-safe and is excluded from PWA, single-file, web/native package, `.tdpack`, plugin project content, and gameplay hashes.

For MCP/AI, use:

`describe_schema({domain:"scripts"}) -> get_tower_script_graph -> preview_tower_script_graph -> apply_tower_script_graph(ifRevision=preview.revision) -> validate_project`.

For canonical JSON authoring use:

`describe_schema({domain:"scripts"}) -> get_tower_script -> upsert_tower_script(dryRun:true) -> upsert_tower_script(ifRevision=preview.revision) -> validate_project`.

The tools are respectively read-only, compute-only, and guarded local-write operations. Apply only
the exact revision returned by preview. Validation runs before write; script and layout transactions
retain their existing backup/rollback behavior. R9 adds descriptors and recipes, not a broad write
tool, and graph tools do not introduce a second scripting language.

For a bounded behavior inspection, call `preview_tower_script_trace` after validation with no more
than 128 exact versioned `GameCommand` values plus `stepMode` and `stepSequence`. It runs a
deterministic in-memory debug session, returns Trace v2, the selected historical frame, and live-tail
digest, and writes no project or `.towerforge` files.

In **Playtest**, explicitly enable the TowerScript debugger before using its controls. Select `tick`,
`event`, `handler`, `action`, `behavior`, or `transition`, then step through the bounded structured
trace. Trace v2 follows actual execution order and reports binding/handler context, condition
results, Behavior Tree node result and selected targets, HFSM transition/state/action phase,
TowerScript state diffs, and linked diagnostics. Every historical frame comes from the same
checkpoint + deterministic replay-to-cursor boundary and is inspection-only; it never replaces the
live game. Step pins Playtest speed at `0` so the frame remains visible. **Resume** clears the
inspection cursor and restores the prior speed. **Rewind N ticks** restores a retained validated
checkpoint, reconstructs the matching journal prefix, and discards the abandoned future. If the
engine version, content digest, checkpoint, or replay result does not match, start a fresh debug
session instead of forcing restore.

Use `docs/examples/opt-in-towerscript-dx3/` as the copyable R9 fixture. It demonstrates the rule
“boss below 20% HP -> boss only, otherwise weakest” plus enemy- and map-scoped nested HFSMs. Removing
both controller arrays, disabling the script, or returning it to schema v6 restores the legacy
targeting and editor surface.

## Targetable Boss Components

R12.1 is an opt-in `enemyBehaviors` v1 mission mechanic. In **Mechanics Hub**, select Enemy
Behaviors, load `basic_targetable_boss_components` or author a closed profile, preview it, and save
only against the revision returned by that preview. The equivalent AI sequence is:

`describe_schema({domain:"enemyBehaviors"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_targetable_boss_components"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

The recipe is a detached inert candidate. It chooses the binary-first authored enemy ID and, when
present, tower ID so repeated materialization is deterministic; it does not enable the module,
select a mission, or modify enemy/tower definitions. Review those IDs before apply. A profile may
declare up to 32 components for each boss. Each component has stable ID, HP, a circular hit region,
and optional label, tags, combat shield, armor override, and `disablesAbilities` from the closed
`towerAttack | towerDisrupt | healAura` allowlist. A tower `priorityTags` binding routes damage only
after normal root acquisition. Missing/no-live matches retain root targeting.

At runtime, treat optional `snapshot.enemyBehaviors` v1 as the sole presentation source for
component IDs, HP, shields, and destroyed state. Canvas and Phaser display that projection; they do
not perform hit testing or damage routing. Component armor and shields pass through the engine
resolver, overflow is discarded rather than transferred to root HP, and component destruction
never grants a reward. Root death/leak still settles once and clears component state. The matching
checkpoint section is also active-only, so restore and journal replay preserve the same digest.

To disable the feature, remove the mission's `enemyBehaviors` profile selection or disable the
module through the same preview/guarded-apply transaction. Confirm that the snapshot/checkpoint
section and component UI disappear and ordinary root targeting returns. An absent catalog, a future
module version, or an unselected profile must remain read-only/no-op and must not be normalized into
an active v1 profile. See `docs/examples/opt-in-targetable-boss-components/` and Proposed
[ADR 0053](adr/0053-r12-advanced-enemy-behaviors.md).

### Component-driven boss phases

R12.2 keeps boss phases inside TowerScript schema v7. Call `describe_schema({domain:"scripts"})`
and select the inert `component_driven_boss_phase` controller recipe. Replace `$enemyTypeId` with
an authored composite enemy and `$componentId` with one of that enemy's stable component IDs from
the mission-selected `enemyBehaviors` profile. The descriptor does not write or enable anything.
Use the normal canonical script transaction:

`get_tower_script -> upsert_tower_script(dryRun:true) -> upsert_tower_script(ifRevision=preview.revision) -> validate_project -> preview_tower_script_trace`.

Only schema-v7 scripts may bind `bossComponentDamaged` or `bossComponentDestroyed`. During those
events, HFSM conditions/actions may read `component.id`, identity, HP/max/ratio, destroyed state,
tags, typed disabled-ability IDs, and optional shield current/capacity/ratio. The root is a detached
post-resolution event view: it cannot mutate component state and is not available as ambient state
for unrelated events. Transitions retain active-leaf-to-ancestor resolution, authored order, target
commit before actions, and the common action/transition/recursion budgets.

The Visual Graph stays schema v2 and represents these names through existing handler and transition
nodes. Do not create a component-event node kind or edit the layout schema. Use compute-only trace
to confirm the component event and its linked HFSM transition provenance; preview writes neither
the script nor `.towerforge` state. Schema-v1–v6 scripts and projects without an active
`enemyBehaviors` profile keep their previous event/UI/runtime path.

### Formation steering

R12.3 is an independent optional block inside `enemyBehaviors` v1. It requires an enabled
Navigation v1 `dynamic_flow` profile selected by the same mission; an authored-routes mission is an
authoring error, not a signal to auto-enable Navigation. Start with the inert
`basic_formation_steering` recipe, review its binary-first enemy assignments, and use:

`describe_schema({domain:"enemyBehaviors"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_formation_steering"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

The recipe creates no enemy, never enables/selects either module, and does not patch Navigation.
Author cohorts with unique enemy-type membership and only `vanguard`, `body`, or `support` roles.
`neighborRadius` is 1–2; cohesion, separation, and role weights are bounded by the engine descriptor.
The shared reverse flow field remains authoritative. Local steering examines at most 16
binary-ordered same-cohort neighbours in deterministic spatial buckets and chooses only an
equal-optimal flow candidate. Do not add per-enemy search, unbounded Boids, or presentation-owned
movement.

At runtime, read only `snapshot.enemyBehaviors.formations` inner v1. Its `enemies` record maps a
live enemy ID to `{cohortId, role}`; renderers display those labels and never derive or recompute
steering. The same optional section is checkpointed, so continuous, restore, and journal replay
must converge on one digest. Disable/unselect either required capability and verify that formation
snapshot/UI cues disappear and ordinary shared-field movement returns. See
`docs/examples/opt-in-formation-steering/` and Proposed
[ADR 0053](adr/0053-r12-advanced-enemy-behaviors.md).

### Vanguard protection

R12.4 is an optional `protection` block on an R12.3 formation cohort. Before enabling it, verify
that the same mission explicitly selects all three prerequisites: Navigation v1 `dynamic_flow`,
Combat with a root Combat shield on every authored vanguard type, and the `enemyBehaviors` v1
formation profile. Component shields are not substitutes for that root shield. Start from the inert
`basic_vanguard_protection` recipe and keep the common transaction:

`describe_schema({domain:"enemyBehaviors"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_vanguard_protection"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

The recipe supplies only a detached formation candidate. It never enables/selects the three
modules, edits Combat, or invents shields. `sourceKinds` is a closed subset of
`tower | ability | tower_script | status | reaction | enemy`; leak damage cannot be intercepted.
At runtime the engine examines at most 16 binary-stable same-cohort vanguard candidates for an
eligible body/support packet and permits at most 512 successful redirects per public tick. The
redirect is one-hop, uses the first living candidate with remaining root shield, and continues
through the common `DamageResolver`. It must not bypass armor/resistance or root exact-once death,
reward, and resource settlement.

Read protection only from `snapshot.enemyBehaviors.formations.protection`. Treat
`vanguardDamageIntercepted` as a read-only GameEvent for presentation/diagnostics; it is not a
TowerScript or Visual Graph event and must not be added to a script binding. Canvas and Phaser may
display the authoritative event but may not select an interceptor. Continuous, checkpoint restore,
and journal replay must converge on the same digest. Disable or unselect any prerequisite and
confirm that the protection snapshot/checkpoint/UI disappears while ordinary dynamic-flow combat
returns. See `docs/examples/opt-in-vanguard-protection/` and Proposed
[ADR 0053](adr/0053-r12-advanced-enemy-behaviors.md).

## Projectile Ballistics

R13.1 is an opt-in `ballistics` v1 mission mechanic. In **Mechanics Hub**, select Ballistics, load
`basic_projectile_ballistics` or author a closed profile, preview it, and save only against the
revision returned by preview. The equivalent AI sequence is:

`describe_schema({domain:"ballistics"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_projectile_ballistics"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

For R13.3 ricochet, use the same guarded sequence with recipe ID
`basic_projectile_ricochet`. It selects no module or mission and materializes a candidate only when
both an eligible authored tower ID and terrain tag exist. The profile uses closed
`projectiles.ricochet.terrainTags` / `armorTypes` surface catalogs and a per-tower
`ricochet { maxBounces, rangeCells }` binding; do not invent missing IDs.

The inert recipe chooses the binary-first authored unchained `single` tower, supplies an arc with
`travelTimeUnits: 0.4` and `maxAltitude: 2`, and, when terrain tags exist, adds the binary-first tag
to optional R13.2 `clearance.terrainBlockerHeights`. It never enables the module or selects a mission.
A profile may bind at most 256 eligible tower types. `direct` accepts no `maxAltitude`; `arc`
requires it. Both travel time and altitude are positive finite values bounded by the schema
descriptor. Remove `clearance` to keep exact R13.1 travel without obstacle checks.

At runtime, treat optional `snapshot.ballistics` v1 as the sole presentation source. The engine has
already fixed the target point and calculated authoritative altitude. Canvas and Phaser use the
shared projector only for screen interpolation. A moved, removed, or incompatible target produces
one `projectileMissed` event and no retargeting. With R13.2 clearance, the engine combines the
canonical topology line, launch-time effective tile elevation, and the highest matching authored
terrain-tag height. Equality blocks; the first blocker produces one `projectileBlocked` event and
no hidden damage. A landed packet enters the common damage resolver,
so impact-time armor, resistance, marks, shields, reactions, component/root death, and rewards keep
their normal exactly-once rules.
For selected R13.3 ricochet, display `projectileRicocheted` only through the shared presentation
projector. Its `collisionCoord`, `nextSourceCoord`, and `nextTargetCoord` are authoritative; Canvas,
Phaser, Studio, and agents must not derive reflection vectors or choose a new target.

To disable the feature, remove the mission's `ballistics` selection or disable the module through
the same preview/guarded-apply transaction. Confirm that the optional snapshot/checkpoint panel
disappears and the same tower attacks immediately again. Remove only the ricochet binding/catalogs
to retain ordinary projectile travel and clearance. Homing remains outside R13; Weather is the
independent R13.5 opt-in module documented below. Use `docs/examples/opt-in-projectile-ballistics/`
and `docs/examples/opt-in-projectile-ricochet/` with Accepted
[ADR 0054](adr/0054-r13-deterministic-2-5d-ballistics.md) as the copyable reference.

### R13.4 destructible environment

Use the separate **Destructibles** section in Mechanics Hub or the narrow agent flow:

`describe_schema({domain:"ballistics"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_destructible_environment"}) -> preview_destructible_environment -> apply_destructible_environment(ifRevision=preview.revision) -> validate_project`.

The complete request supplies the Ballistics v1 profile, mission/profile/map IDs and exact
`destructibleObjects` placements. Preview writes nothing. Apply owns exactly five files —
`project.json`, `content/mechanics.json`, `content/balance.json`, the selected authored `.tmj`, and
`maps/compiled/maps.json` — and creates a backup before replacement. A stale revision, invalid map
reference, failed reachability proof or post-write validation prevents partial state; write failure
uses rollback. Do not use a generic broad write for this boundary.

An active R13.4 mission exposes Ballistics snapshot v2 and checkpoint inner v4. Present object HP,
destroyed state and `destructibleObjectDamaged` / `destructibleObjectDestroyed` through the shared
Canvas/Phaser projection only. Procedural Juice may attach particles/audio/camera cues at the
authoritative event coordinate, but only through an authored binding; there is no automatic debris.
R13.4 adds no TowerScript action or event.

Verify Canvas and Phaser on hex and square, then `npm run build`, the PWA, single-file output,
`npm run package:web` web package and `.tdpack` carrier. An absent, disabled or mission-unselected
module must have no destructible snapshot/UI/work and preserve legacy replay behavior. Copy the
minimal reference from `docs/examples/opt-in-destructible-environment/`; the canonical starter must
remain mechanics-free.

### R13.5 Weather

Weather is an independent mission-selected `weather` v1 module; it is not a Ballistics profile and
does not inherit projectile, elevation or terrain rules. In **Mechanics Hub**, start from one of
the inert recipes and explicitly enable/select it only after preview. The equivalent AI flow is:

`describe_schema({domain:"weather"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_blizzard_weather"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

`basic_blizzard_weather`, `basic_acid_rain_weather` and `basic_sandstorm_weather` return detached
candidates only. `preview_mechanics_module` performs no write. `apply_mechanics_module` requires
the exact `ifRevision`, validates before replacement, creates a backup and uses rollback on write
or post-write validation failure. Do not add or use a broad `write_weather` tool.

A profile is exactly `{zones,definitions,schedule}`. Zones are `all_map` or bounded canonical
`tiles`; definitions contain only `periodic_damage`, `status`, `visibility_range`, `enemy_speed`
and `tower_fire_rate` effects. The engine samples at most one choice per authored wave, including a
possible `calmWeight` result, through the separate deterministic
`towerforge:weather:v1` RNG domain. Weather selection never advances simulation, draft, artifact
or quest RNG and never uses wall-clock or host random state.

Read presentation only from optional `snapshot.weather` schema v1 and the read-only events
`weatherStarted`, `weatherEnded`, `weatherEffectApplied` and `weatherBudgetExceeded`. Canvas and
Phaser use the shared fail-closed projector; neither renderer computes tile membership, damage,
status merging, enemy speed, visibility/range, tower fire rate or schedule selection. Weather adds
no TowerScript action/event, Visual Graph node, terrain mutation, Ballistics coupling or automatic
Procedural Juice cue.

To disable Weather, remove the mission's `weather` selection or apply the module with
`enabled:false` through the same preview/revision-guarded flow. Reload and confirm that the Weather
editor remains available for retained authored data while `snapshot.weather`, checkpoint state and
presentation disappear. Absent, disabled and unselected projects must preserve legacy simulation,
replay digest and player performance. Verify Canvas and Phaser on both hex and square, plus PWA,
single-file, web package and `.tdpack` carriers. Use
`docs/examples/opt-in-weather/` as the complete copyable reference.

### R14 Modular Arsenal and gem crafting

Arsenal is a separate mission-selected `arsenal` v1 module. In **Mechanics Hub**, start from the
inert `basic_modular_arsenal` recipe, inspect the JSON blueprint and explicitly preview before
enable/apply. The equivalent AI flow is:

`describe_schema({domain:"arsenal"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_modular_arsenal"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

Every blueprint selects exactly one compatible `base`, `barrel` and `core`. Runtime changes use
`GameCommandV7 configureTowerModules` only during setup or between waves. Read the exact tower ID,
available module options and effective damage/range/durability only from `snapshot.arsenal`; never
recompute them in Studio or a player.

Gem recipes use a bounded 3×3 relative pattern with optional rotations. Every input/output ID must
exist in the mission's selected Roguelite artifact profile. Dispatch `GameCommandV7 craftGem` with
concrete unsocketed artifact instance IDs from the authoritative inventory. A failure consumes
nothing; a success removes all inputs and adds one deterministic output artifact that uses the
existing socket system.

CampaignRun v1 imports explicitly as v2 with an empty `arsenal.moduleInventory`. Do not move this
state into `PlayerProfileV3` or browser-local profile storage. Disable/unselect Arsenal and reload to
confirm that `snapshot.arsenal`, its checkpoint tower loadouts and all Arsenal controls disappear.
Verify both Canvas and Phaser on hex/square plus PWA, single-file, web package and `.tdpack`. The
copyable reference is `docs/examples/opt-in-modular-arsenal/`.

### R15 deterministic Macro-Economy

Macro-Economy is a separate mission-selected `macroEconomy` v1 module. In **Mechanics Hub**, start
from the inert `basic_local_market` recipe and explicitly preview before enable/apply. The equivalent
AI flow is:

`describe_schema({domain:"macroEconomy"}) -> get_capabilities -> get_recipe({collection:"mechanics",recipeId:"basic_local_market"}) -> preview_mechanics_module -> apply_mechanics_module(ifRevision=preview.revision) -> validate_project`.

Trade only during setup or between waves with exact `GameCommandV8 buyCommodity` or
`sellCommodity`. The price shown in `snapshot.macroEconomy` is authoritative; current-wave net
demand is applied only at the next cleared-wave boundary. Use `openDeposit` with an authored product
and explicit amount. There is no early withdrawal: principal plus basis-point interest settles
automatically after the configured number of cleared waves.

`performRitual` takes an altar ID and exact live tower instance IDs while the game outcome is still
`playing`; unlike trades and deposits, combat-time rituals are allowed so damage and status effects
have an authoritative target. Do not pre-destroy towers or apply effects in UI code: the engine
atomically validates count, type, radius, live state and bounded effect capacity before destroying
the full selection and applying allowlisted resource, damage, status or temporary tower modifier
effects. Studio and players must dispatch commands and read `ritualAllowed` plus resulting events.

For local co-op, select Macro-Economy v1 only with `ownership.resources: shared`; validation and
match construction reject partitioned wallets. With `owner_only`, every selected ritual tower must
belong to the issuing player. Modifier capacity and finite products are checked before sacrifice.

Disable or unselect Macro-Economy and reload to confirm that the optional snapshot/checkpoint state
and management controls disappear while the legacy `mission.economy.interestRate` behavior remains
unchanged. Verify Canvas and Phaser on hex/square plus PWA, single-file, web package and `.tdpack`.
The inactive generated player must not contain or precache the Macro-Economy engine/renderer
implementation modules.
The copyable reference is `docs/examples/opt-in-macro-economy/`.

### R16 Ghost Replay Lab

Replay Lab is not a mission mechanic and does not modify `.tdproj` content. Open **Replay Lab** in
Studio, choose a `.tfreplay` archive and import it explicitly. The archive is validated against the
currently open project's engine, content, mission and capability identity before its journal can be
used. The tab is read-only (`data-project-write="none"`): timeline seek, Ghost overlay, What-If fork
and first-divergence diagnostics never call project save/apply APIs and never mutate the source
archive or the active playtest.

`ReplayArchiveV1` accepts at most 72 MiB and uses a fixed `TFRP` v1 header of 20 bytes. Malformed,
truncated, trailing, bad-checksum, non-canonical or incompatible payloads fail before replay. Ghost
frames are detached and immutable; the engine retains at most 256 cached frames and deterministically
reconstructs an evicted frame. A branch records its exact parent archive digest and fork sequence,
then journals only new commands from the fork checkpoint.

For an agent, follow the compute-only sequence:

`describe_schema({domain:"replayLab"}) -> inspect_replay_archive -> verify_replay_archive -> analyze_replay_branch`.

The tools accept bounded base64 archive data, write no project files and never open sockets. They do
not provide an archive writer, project writer or relay launcher. Ordinary starter builds, generated
web players, single-file output, PWA caches and mobile/desktop carriers must not contain
`engine/replay-lab`, Ghost presentation code or `@towerforge/reference-relay`.

The reference relay is an optional administrator-owned library at
`packages/reference-relay`. It requires the existing R8 capability handshake before any opaque
frame, supports at most four peers per invite-code room, caps frames at 1 MiB and each peer queue at
256 frames, and defaults its injected server adapter to `127.0.0.1`. It contains no gameplay,
accounts, auth or matchmaking and is never started by Studio/MCP. Integrators must supply and own
the actual server/socket port; do not expose it beyond loopback without a separate deployment and
security decision. Run its focused contract with:

```bash
npm --workspace @towerforge/reference-relay test
```

See accepted [ADR 0057](adr/0057-r16-ghost-replay-lab.md) and
[`packages/reference-relay/README.md`](../packages/reference-relay/README.md).

### R17 Web Distribution Hub

Distribution is constructor metadata, not a mission mechanic. An ordinary project has no
`content/distribution.json`, Distribution runtime or host-placement UI in its generated player.
Open **Distribution** in Studio only when preparing a public build. The first guarded save creates
Distribution v1 and explicitly promotes `project.json` to schema v4; merely opening the Hub,
previewing, validating, building, or editing mechanics/elevation does not create the file or promote
the project.

Configure the stable project ID, allowlisted SPDX license, attribution and Remix policy first.
`ARR` requires `forbidden`; either allowed policy requires public source inclusion, and
`allowed_with_attribution` requires non-empty attribution. Optional monetization JSON contains only
host placement descriptors (`banner`, `interstitial`, or `purchase_link`) on allowlisted surfaces.
Do not put URLs, scripts, provider IDs, payment keys, telemetry or gameplay rewards in those
descriptors. Preview, then apply with the displayed exact revision; stale candidates must be
reloaded and previewed again. The guarded writer validates `project.json` and
`content/distribution.json`, creates a private backup, and rolls both files back on failure.

Publishing is an explicit four-stage operation:

1. Preview the adapter target; this does not build, write, connect or upload.
2. Prepare a reproducible candidate in private `.towerforge/publish-staging`; inspect its
   `PublishManifestV1` and candidate/target digests.
3. Confirm the exact candidate, adapter and target in Studio. Approval is short-lived and
   single-use; changing any bound value requires a new preview and confirmation.
4. The injected `filesystem_v1`, `github_pages_v1`, or `cloudflare_pages_v1` provider runtime
   uploads and then returns the exact remote digest for verification. A missing runtime,
   authentication failure or digest mismatch fails closed and does not change project source.

Provider credentials belong to the OS/provider runtime. They MUST NOT be pasted into
`distribution.json`, target descriptors, publish manifests, Studio traces or generated bundles.
The filesystem adapter refuses a destination that overlaps private staging and refuses to overwrite
an existing destination.

Public Remix uses deterministic `.tdpack` v2 and does not change the ordinary project `.tdpack` v1
format. Export is available only when policy permits source inclusion. Inspection validates pack
size, canonical paths, per-entry checksums, aggregate digest and publish manifest without extracting
files. Import validates before writing, creates a new project ID and records
`RemixProvenanceV1`; `.towerforge`, hidden caches, deployment metadata, symlinks and credentials are
never copied. A failed import leaves no partial project.

For an agent, use the bounded local workflow:

`describe_schema({domain:"distribution"}) -> get_distribution -> preview_distribution -> apply_distribution(ifRevision) -> validate_project -> preview_publish_candidate`.

`inspect_remix_source_pack` is a separate read-only verification tool. MCP deliberately has no tool
to prepare an upload, mint a publish approval, upload to a provider, or open a network connection;
the user must perform those externally consequential steps in the Studio confirmation flow.

The accepted R17 gate verifies that the starter and a v1-v3 project do not gain
`content/distribution.json`, that inactive web/PWA/single-file/native carriers omit Distribution and
monetization runtime, and that an active host-placement build contains only inert host injection
points. Verify deterministic manifest/source-pack bytes, secret/path scans, failed upload/import
rollback, Studio save/reload and the MCP guarded workflow. See accepted
[ADR 0058](adr/0058-r17-web-publish-remix.md).

## Desktop Studio Navigation

The packaged Studio uses a native application menu. macOS exposes `TowerForge`, `File`, `Edit`, `View`, `Project`, `Window`, and `Help` in the system menu bar. Windows and Linux expose the equivalent menu on the application window, with Exit and About in their conventional menus.

- `File > New Project` opens the Studio project wizard and a native location picker. Templates are Classic, Maze, Idle, and Roguelike.
- Tauri's ACL is an internal command allowlist, not a project or user role. The main loopback WebView receives only the seven `desktop_*` commands registered in `build.rs`; a `not allowed by ACL` error means the packaged manifest and `capabilities/main.json` are out of sync.
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

- **Account runtimes**: Codex uses ChatGPT OAuth through Codex App Server; Claude Code uses the official Claude Agent SDK/runtime login. Click Connect and finish the provider-owned browser flow. TowerForge never receives the OAuth token and does not read the runtime credential cache. Provider configuration lives under `<app-data>/agent-runtimes`. On macOS, both official runtimes use the provider-owned login Keychain, so their child processes preserve the real login `HOME` only for Keychain discovery while `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, the working directory, and the exposed tool surface remain isolated.
- **Direct APIs**: Anthropic, OpenAI, and OpenRouter keys remain separate browser `localStorage` entries for that device and are sent only to the loopback Studio server for the selected request. The old `towerforge:anthropic-key` entry is migrated automatically.

Both paths send the user prompt and the tool results needed for the task to the selected provider. Account isolation protects credentials; it does not make inference offline. TowerForge disables local account-runtime transcript persistence, uses an empty private working directory, restricts Codex filesystem reads to that workspace, disables Claude built-in tools, exposes only validated TowerForge tools, and does not inherit API/cloud/proxy credentials into the runtime process. Linux runtimes also use a private `HOME`; macOS preserves the login `HOME` strictly because the official runtimes require it to discover the login Keychain. Never put provider credentials in `.tdproj` files, committed docs, traces, or support logs. Signing out can remove the provider-owned Keychain credential used by other Codex or Claude Code clients on the same macOS account; direct API keys are unaffected.

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
- TowerScript Graph conflicts: reload `GET /api/project/script/graph` and repeat preview/apply with the new composite revision. Do not copy layout into the script or bypass a stale guard. A missing layout is normal and a graph read must not create one.
- Persona QA worker issues: call the library with `cache:false` to separate execution from cache validation, then inspect the closed request limits (32 missions, 64 seeds, three fixed personas, 1,024 runs, 2,000,000 total ticks, and tick step 0.05–0.2). A cancelled result intentionally has no partial findings. Treat malformed/future cache envelopes below `.towerforge/cache/persona-qa/v1` as disposable generated state; do not edit them into project content.
- Quest runtime issues: confirm project schema v3, an enabled supported `quests` v1 profile, and the mission's exact profile selection. Inactive profiles intentionally produce no `snapshot.quests`, `state.quests`, or quest events. Checkpoint rejection usually indicates a mismatch between the restored active profile/initial RNG identity and the canonical selected IDs, labels, kinds, targets, progress, or status; never repair it in a renderer.
- TowerScript Behavior Tree issues: confirm the script is schema v7, the tree has non-overlapping tower-only bindings, and the bound type is an attacking tower. `Scripted` is active only for a resolved binding. A tree that returns failure or exceeds candidate/node/expression budgets intentionally uses the saved target mode; inspect `behavior` trace records and diagnostics instead of reimplementing candidate filtering in Studio or a renderer.
- TowerScript HFSM issues: confirm every transition target is an absolute existing state path and inspect `transition` records plus `snapshot.scriptState.machines`. Resolution is active-leaf to ancestors and authored order, with one transition per machine/context/event. An action error intentionally leaves the already selected new state active and stops the remaining transition actions.
- TowerScript debugger issues: confirm the debug session was explicitly enabled and inspect the structured `event -> binding -> handler -> condition -> behavior/transition -> action -> state_diff/diagnostic` trace. Rewind is limited to the retained checkpoint ring; an out-of-range request or content/engine mismatch must start a fresh session. Partial action frames are never resumable gameplay state.
- MCP tool discovery: run `npm run mcp -- --project <project>` and issue `tools/list`; tools include `riskClass` and `sideEffect` metadata for permission decisions.
- AI Chat direct-provider issues: verify the selected provider has a saved browser-local key and a tool-capable model, check `/api/ai/chat`, then reproduce the same action through `validate_project`, `simulate_mission`, or `balance_report`. OpenRouter model discovery uses `/api/ai/models?provider=openrouter`; Codex and Claude use the same endpoint with `provider=codex|claude-code`. Custom model IDs remain available when a live catalog is offline.
- Codex/Claude account issues: use Disconnect, restart Studio, and Connect again. The safe status endpoint is `/api/ai/runtime/status?provider=codex` or `provider=claude-code`; it never returns tokens. A packaged build must contain compatible packages under `runtime/node_modules/@openai` and `runtime/node_modules/@anthropic-ai`. `TOWERFORGE_CODEX_BIN` and `TOWERFORGE_CLAUDE_BIN` are internal test/diagnostic overrides only and must point to an absolute trusted executable path.
- Native packaging issues: inspect `<project>/mobile/README.md` or `<project>/desktop/README.md`; TowerForge only scaffolds Capacitor/Tauri projects and does not install native SDKs, sign binaries, or submit to stores.
- Desktop Studio packaging issues: run `npm run desktop:dev` first to verify the sidecar starts, then inspect `packages/desktop/src-tauri/runtime` for Studio files and production agent-runtime dependencies, and `packages/desktop/src-tauri/binaries` for the Node sidecar binary. If `/api/health` works but the app UI does not load, check the desktop session token/cookie handshake in the Tauri console.
- Linux AppImage agent runtime issues: the bundled Claude executable is stored with a masked ELF header plus a SHA-256 manifest so `linuxdeploy` does not rewrite or inspect the standalone runtime. On first use Studio verifies it, restores a `0700` copy under the private desktop app-data `agent-runtimes/bin` directory, verifies it again, and only then executes it. Do not unpack or patch this file manually.
- Desktop menu/bridge issues: confirm `packages/desktop/src-tauri/build.rs` registers every command in the Rust `generate_handler!` list and `packages/desktop/src-tauri/capabilities/main.json` grants the matching `allow-desktop-*` permissions only to the main `http://127.0.0.1:*` WebView. Then inspect the WebView console for `Desktop bridge setup failed`. Delete only `<app-data>/desktop-state.json` to reset last/recent projects without touching project data.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

Deployable web-game artifacts are the static bundle from `npm run build`, its optional `index.single.html`, or the deterministic archive from `npm run package:web`. The installable TowerForge Studio artifacts come from `npm run desktop:build`:

- Windows: `packages/desktop/src-tauri/target/release/bundle/nsis/*.exe` and `packages/desktop/src-tauri/target/release/bundle/msi/*.msi`
- macOS ARM64: `packages/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg`
- Linux: `packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`, `packages/desktop/src-tauri/target/release/bundle/deb/*.deb`, and `packages/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates. `.github/workflows/desktop-release.yml` builds unsigned desktop artifacts on Windows, macOS, and Ubuntu. A manual run uploads a consolidated `towerforge-release-candidate` Actions artifact. Pushing a matching `vX.Y.Z` tag additionally publishes that candidate as a GitHub pre-release after version, installer, and checksum validation. Production macOS distribution requires Developer ID signing plus notarization; production Windows distribution requires a code-signing certificate.

Public desktop releases follow [the desktop release policy](releasing.md). Until signing is configured, they remain GitHub pre-releases with `Unsigned build` in the title. To inspect a cross-platform candidate without publishing, run **Actions > Unsigned Desktop Builds > Run workflow** against the intended commit. To publish, merge the release commit, then create and push an annotated tag whose version matches all desktop manifests:

The v0.6.0 release line includes accepted R0–R17. Never describe `main` or an open PR as released merely because local installers or Actions artifacts exist; the GitHub tag and published installer assets remain authoritative.

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
