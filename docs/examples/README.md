# Reference Examples

Reference examples show expected project and code patterns.

## Current Examples

| Pattern | Location | Notes |
| --- | --- | --- |
| Starter project | `examples/starter.tdproj` | Canonical legacy-compatible `.tdproj`; the in-memory v1 -> v2 migration demonstrates hex defaults, typed terrain, visuals v2, and preserved bindings. |
| TowerScript example | `examples/starter.tdproj/scripts/gameplay/starter-gameplay.tower.json` | Minimal lifecycle/state script that runs unchanged in Studio, headless simulation, Canvas, and Phaser. |
| Terrain TowerScript v2 | `docs/examples/terrain-mutation.tower.json` | Terrain-scoped tile-entry rule using bounded temporary `setTileTerrain`. |
| Script runtime | `packages/engine/src/scripting` | Canonical safe expressions, schema validation, events/actions, and deterministic limits. |
| Project tree and script files | `packages/cli/lib/project-tree.mjs`, `packages/cli/lib/project-scripts.mjs` | Filtered reads plus confined, revision-guarded, atomic script writes and backups. |
| Project loader | `packages/cli/lib/project-loader.mjs` | Canonical Node-side project loading, normalization, engine build, validation, and sim integration. |
| Map compiler | `packages/cli/lib/map-compiler.mjs` | Canonical source map to runtime map conversion. |
| Schema migrations | `packages/cli/lib/project-migrations.mjs` | Canonical in-memory `.tdproj` migration layer plus explicit write path. |
| Engine validation | `packages/engine/src/content/validate.ts` | Canonical cross-reference and numeric guard implementation. |
| Mechanics capability contract | `packages/engine/src/content/mechanics.test.ts` | Stable module IDs and read-only resolution of unavailable, disabled, unselected, missing-profile, and active states. |
| Mechanics project boundary | `packages/cli/lib/project-schema.test.mjs`, `packages/cli/lib/project-migrations.test.mjs` | Canonical schema v3/no-file invariant, future-version rejection, and disabled-reference warning cases. |
| Opt-in combat shields | `docs/examples/opt-in-basic-shields/` | Copy the catalog to `content/mechanics.json`, merge the selection into `missions.<id>`, and set project schema v3; the ordinary starter remains mechanics-free. |
| Opt-in elemental armor matrix | `docs/examples/opt-in-elemental-armor-matrix/` | Combat module v2 reference with author-defined damage/armor types and one enemy assignment; elemental IDs are recipe data and do not enable reactions. |
| Opt-in vulnerability marks | `docs/examples/opt-in-basic-vulnerability-marks/` | Combat module v3 reference with one bounded consumable mark and one tower binding; reactions remain disabled. |
| Opt-in elemental reactions | `docs/examples/opt-in-elemental-reactions/` | Separate reactions v1 reference with explicit combat v2 damage-type prerequisite and directional Shatter rules; Chain Shock and Combustion remain independent recipes. |
| Opt-in authored elevation | `docs/examples/opt-in-authored-elevation/` | R3.1 reference with sparse signed map overrides, an empty elevation v1 activation profile, and no LoS, high-ground, displacement, or terraforming behavior. |
| Opt-in elevation line of sight | `docs/examples/opt-in-elevation-line-of-sight/` | R3.2 elevation v2 reference with an existing `opaque` terrain-tag prerequisite; the recipe does not edit maps/terrain or auto-enable the module. |
| Opt-in elevation high-ground | `docs/examples/opt-in-elevation-high-ground/` | R3.3 elevation v3 reference with bounded pairwise range/damage bonuses plus a separate map fragment; the recipe itself never edits the map, enables the module, or selects a mission. |
| Opt-in tile displacement physics | `docs/examples/opt-in-physics-displacement/` | R3.4a physics v1 reference with bounded push/pull, explicit immunity and terrain-tag fall hazards; effects, terrain tagging and mission selection remain separate opt-in edits. |
| Opt-in transactional terraforming | `docs/examples/opt-in-transactional-terraforming/` | R3.4b terraforming v1 reference with separate authored terrain, map, mission, mechanics and TowerScript v6 choices; flood, moat and bridge recipes remain inert until explicitly selected and bound. |
| Opt-in elemental synergies | `docs/examples/opt-in-elemental-synergies/` | R4.1A roguelite v1 reference with tower tags, highest-tier damage modifiers, and no inventory or campaign coupling. |
| Opt-in boss artifact loot | `docs/examples/opt-in-boss-artifact-loot/` | R4.2 roguelite v2 reference with typed slots, deterministic boss drops, battle-local between-wave socketing, exact-tower modifiers, and no campaign persistence. |
| Opt-in deterministic wave draft | `docs/examples/opt-in-wave-draft/` | R4.3 roguelite v3 reference with three seeded interwave options, scoped run modifiers, exact GameCommand v3 choice, and no mandatory artifacts or legacy pause. |
| Opt-in campaign run | `docs/examples/opt-in-campaign-run/` | R4.4A roguelite v4 reference with a bounded typed campaign DAG, separate CampaignRun/Profile reducers, explicit run import/export, and no implicit storage or battle checkpoint coupling. |
| Opt-in campaign structural choices | `docs/examples/opt-in-campaign-structural-choices/` | R4.4B campaign graph v2 reference with declared run resources and atomic merchant/event costs and grants; battle-local draft/artifact transfer remains disabled. |
| Opt-in campaign battle handoff | `docs/examples/opt-in-campaign-battle-handoff/` | R4.4C marker-v2 reference with an imported CampaignRun deck, unsocketed artifact carry, engine-owned prepare/settle, and marker-v1/absent compatibility. |
| Opt-in hero roster, movement, durability, and targeted ability | `docs/examples/opt-in-hero-roster/` | `mechanics.json` is static Heroes v1; `mechanics-mobile.json` independently adds v2 movement; `mechanics-durable.json` adds v3 HP/shield; `mechanics-targeted-ability.json` adds v4 mana and one enemy-targeted spell without enabling adjacent mechanics. |
| Opt-in Logistics power grid | `docs/examples/opt-in-logistics-power/` | R5.7A Logistics v1 reference with explicit generators, relays, fire-capable consumers, deterministic priority brownout, authoritative presentation links/coverage, and no ammo or factory coupling. |
| Opt-in local ammunition | `docs/examples/opt-in-local-ammunition/` | R5.8A Logistics v2 reference with one finite fire-capable tower magazine, exact per-activation consumption, nested checkpoint state, authoritative depleted presentation, and no refill/supply coupling. |
| Opt-in ammunition supply | `docs/examples/opt-in-ammunition-supply/` | R5.8B Logistics v3 reference with producer/storage compartments, bounded deterministic transfers, same-instance refill, authoritative progress/links, and no manual routing or raw-material layer. |
| Opt-in adaptive Wave Director | `docs/examples/opt-in-adaptive-director/` | R7 Director v1 reference with an authored counter pool, deterministic priority/severity/binary-ID selection, threat budget, fairness caps, and no generated or implicit enemies. |
| Opt-in local multiplayer | `docs/examples/opt-in-local-multiplayer/` | R8 Multiplayer v1 local co-op reference with fixed tick, explicit ownership, checksummed command replay, local transports, and conditional player packaging; hosted auth/lobbies/matchmaking are excluded. |
| TowerScript DX 3.0 controllers | `docs/examples/opt-in-towerscript-dx3/` | R9 TowerScript v7 fixture for scripted boss-priority targeting plus nested HFSM phases; removing the controllers restores the saved target mode and legacy script path. |
| Procedural quests | `docs/examples/opt-in-procedural-quests/` | R10 mission-selected quests v1 reference with deterministic selection and no reward/profile/campaign coupling. Persona QA itself is compute-only and uses the starter project through the CLI/Studio/MCP surfaces. |
| Procedural Juice | `docs/examples/opt-in-procedural-juice/` | R11 visuals-v3 fragment for deterministic particle/audio/camera presentation; it never enters simulation checkpoints, journals, or gameplay digests. |
| Targetable boss components | `docs/examples/opt-in-targetable-boss-components/` | R12.1 `enemyBehaviors` v1 reference with bounded component HP/shield/armor and exact tower routing. |
| Formation steering | `docs/examples/opt-in-formation-steering/` | R12.3 bounded cohort/role reference that requires an independently selected dynamic-flow Navigation profile. |
| Vanguard protection | `docs/examples/opt-in-vanguard-protection/` | R12.4 one-hop interception recipe that composes formation cohorts with existing root Combat shields. |
| Projectile Ballistics | `docs/examples/opt-in-projectile-ballistics/` | R13.1/R13.2 direct/arc projectile and clearance reference; unbound attacks retain immediate legacy damage. |
| Projectile ricochet | `docs/examples/opt-in-projectile-ricochet/` | R13.3 bounded terrain/armor-surface recipe using topology-owned reflection and common damage resolution. |
| Destructible environment | `docs/examples/opt-in-destructible-environment/` | R13.4 five-file reference for object durability plus route-safe atomic terrain/elevation mutation. |
| Deterministic Weather | `docs/examples/opt-in-weather/` | R13.5 independent seeded Weather profile and mission selection; Blizzard, Acid Rain, and Sandstorm remain inert recipes until explicitly applied. |
| Headless smoke sim | `packages/cli/sim.mjs` | CLI wrapper for engine-backed mission smoke runs. |
| Static web build | `packages/cli/build.mjs` | Generates the playable web bundle from project data, compiled engine modules, renderer, and safe assets. |
| Native packaging | `packages/cli/lib/packaging.mjs` | Canonical Capacitor/Tauri scaffold generation around a built web bundle. |
| MCP tool registry | `packages/mcp/tools.mjs` | Canonical agent tool contracts, risk metadata, dry-run/validated writes, and rollback paths. |
| Mechanics authoring surfaces | `packages/mcp/mechanics.test.mjs`, `packages/studio/public/mechanics-surface.test.mjs`, `packages/cli/build.mechanics.test.mjs` | Capability discovery, unavailable-module no-write behavior, planned Hub cards, and optional build embedding. |
| Codex plugin source | `plugins/towerforge` | Canonical marketplace manifest, authoring skill, assets, and generated local runtime source. |
| Codex plugin release verifier | `distribution/codex-plugin/scripts/verify-release.mjs` | Mirror-owned verification of the source commit manifest and SHA-256 hashes before sync. |
| Grid topology | `packages/engine/src/simulation/topology.ts` | Canonical odd-r hex and cardinal square neighbors, distance, lines, directions, and footprints. |
| Autotile resolver | `packages/renderer/src/autotile.mjs` | Shared Wang/signature, route connectivity, sector composition, deterministic variant, and coverage contract for Canvas/Phaser. |
| Tileset importer | `packages/cli/lib/tileset-importer.mjs` | Bounded TSJ/TSX parser and strict workbench override contract. |
| Canvas renderer | `packages/renderer/src/index.mjs` | Shared browser renderer for Studio map/playtest preview and generated Canvas player, including square/hex cells, tile cache, sprites, and atlas frames. |
| Phaser player target | `packages/cli/build.mjs` | Canonical optional vendored Phaser build target; stays outside the engine boundary. |
| Studio editor shell | `packages/studio/public/app.js` | Browser UI pattern for data editors, validation, sim, balance, right-side AI Chat, save, and build actions. |
| Unsigned release notes | `docs/examples/unsigned-release-notes.md` | Canonical warning, checksum, tag/source links, and supported Gatekeeper guidance for pre-signing desktop releases. |

## Add Examples For

- A focused engine unit test when adding new mechanics.
- A `.tdproj` migration when changing schema shape.
- Additional invalid `.tdproj` fixtures for migration, asset path, and map route regressions.
- Balance fixtures for misleading placement strategies, boss-heavy waves, flying-heavy waves, idle economy, roguelike variants, and multi-currency projects.
- MCP fixtures for malformed input, invalid-write rollback, stale revisions, concurrent writers, permission denial, provider protocol drift, and agent-authored maps/scripts.
- Renderer fixtures that prove sprite/atlas parity and enforce swarm-scale performance budgets.
- A focused R13/R4.4B browser regression fixture proving expected guarded 400/409 responses do not become uncaught application errors.
- `opt-in-modular-arsenal/` — R14 Arsenal v1 plus the minimal Roguelite gem catalog needed by its exact crafting recipe.
- `opt-in-macro-economy/` — R15 local seeded market, fixed-term deposit and atomic ritual authoring.
- R16–R17 reference fixtures only when their contracts enter RED/GREEN implementation; planned schemas must not be presented as available authoring examples.
