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
- TowerScript examples for terrain bindings, `enemyEnteredTile`, `terrainChanged`, bounded `setTileTerrain`, v3 shield actions, and v4 mark actions; split/reaction actions remain future work.
