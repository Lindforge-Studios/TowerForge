# Tower Defense Constructor Architecture

Codename: **TowerForge**.

TowerForge is an open-source, local-first constructor for 2D tower-defense games with per-map hex/odd-r and square/cardinal grids. It is content-agnostic and draws on proven data-driven, deterministic-simulation ideas without depending on any specific game at runtime.

## Current State

This repository is a working local-first game constructor:

- `@towerforge/engine` is a pure TypeScript deterministic simulation engine with a sandboxed TowerScript runtime.
- `@towerforge/cli` validates `.tdproj` projects, applies schema migrations, compiles map sources, runs headless simulations, scaffolds new projects, builds normal/single-file web players, packages portable/native outputs, and imports/exports verified project packs.
- `@towerforge/renderer` is a browser rendering adapter over engine snapshots and map definitions. The static player can be emitted as a lightweight canvas player or a vendored Phaser player.
- `@towerforge/studio` is a local browser editor for gameplay, maps, scripts, assets, narrative, AI workflows, settings, and build targets.
- `@towerforge/desktop` packages TowerForge Studio as a Tauri desktop app with bundled Node, Codex, and Claude runtimes.
- `@towerforge/mcp` exposes the constructor through MCP tools used by external agents and Studio AI Chat.
- `examples/starter.tdproj` is the canonical starter project.

The current implementation keeps Phaser out of the engine and vendors it only for the optional Phaser build target. The generated player is engine-backed DOM UI plus either `@towerforge/renderer` canvas rendering or a Phaser scene adapter, without changing the engine contract.

## Current Product Boundary

The current "full constructor" means:

- Create or open a `.tdproj` project.
- Edit core TD content in Studio.
- Edit source maps and asset catalog data in Studio.
- Import PNG + Tiled TSJ/TSX tilesets, inspect mask coverage, and bind them by map or grid.
- Browse the filtered project tree and author custom object/gameplay rules under `scripts/`.
- Save project files with conflict protection and backups.
- Validate cross-references and numeric guards with engine validation.
- Run headless mission smoke simulations and multi-strategy balance sweeps.
- Preview seeded procedural maps, run cancellable evidence-only balance proposal batches, and stage
  generated images for explicit validated import.
- Build deterministic local/self-hosted co-op or asymmetric protocol clients when a mission opts in.
- Use AI Chat or external MCP agents to inspect, simulate, validate, patch, build, and package local projects through validation-gated tools.
- Build a playable static web bundle.
- Export Capacitor mobile and Tauri desktop scaffolds around the built web bundle.
- Install TowerForge Studio itself as a native desktop app for Windows, macOS, and Linux.
- Preview and interact with the built game in a browser.
- Hand off a project as one verified `.tdpack`, or a game as a single HTML / portable web ZIP.

Non-goals for this iteration:

- Full Tiled-style layer authoring UI.
- Cloud publishing or hosted gallery/remix services.
- Hosted multiplayer services, accounts, cloud saves, matchmaking, managed relays, or analytics.
- Store submission, signing automation, and upload/publish automation.

## Package Architecture

```text
packages/engine
  simulation rules, maps, snapshots, actions, TowerScript, content registry, validation,
  pure seeded generation, and a separate browser-safe multiplayer entrypoint

packages/cli
  project loading, schema normalization, migrations, map compilation,
  engine compilation, validate/sim/build/create, project packs, packaging

packages/studio
  local Node server and browser editor UI

packages/desktop
  Tauri shell, bundled Studio runtime, Node sidecar, desktop installers

packages/mcp
  transport-agnostic tool registry plus stdio MCP server for agents

packages/renderer
  browser canvas rendering plus shared deterministic presentation planning over snapshots,
  map definitions, and optional visuals-v3 Procedural Juice data

packages/player-runtime
  renderer-neutral browser profile persistence through injected storage and engine codec

examples/starter.tdproj
  reference project data
```

Canonical boundaries are in [../ARCHITECTURE.md](../ARCHITECTURE.md).

## `.tdproj` Format

`.tdproj` is a directory project:

```text
my-game.tdproj/
  project.json
  content/
    balance.json
    mechanics.json (optional)
    world-map.json
    visuals.json
    story-comics.json
    battle-backgrounds.json
  maps/
    src/*.tmj
    compiled/maps.json
  assets/
  scripts/
    **/*.tower.json
  build-targets.json
  .towerforge/
    towerscript-layouts/  (local Visual Graph presentation only)
    cache/auto-balancer/v1/  (completed local evidence cache only)
    generated-assets/  (private opaque staging; never committed as project source)
```

Source data is JSON so projects are portable and git-friendly. `.towerforge/` is local editor state,
cache, staging, and backup storage. TowerScript graph layouts, auto-balancer cache entries, and
uncommitted generated assets are not gameplay content, are ignored by the engine, and are excluded
from builds, players, project packs, and `.tdpack` output.

`content/mechanics.json` is an opt-in versioned catalog. A mission selects named module profiles through `mission.mechanics.profiles`; no file or selection means the established constructor behavior. Authored mechanics require project schema v3, while ordinary starter and legacy projects remain schema v2 and MUST NOT receive a synthesized catalog during read/save/build/package.

## Content Model

`content/balance.json` owns:

- constants
- difficulty variants
- meta currencies, upgrades, and mission rewards
- mission abilities
- enemies
- towers
- wave sets
- missions
- typed terrain definitions (`buildable`, `walkable`, `groundSpeedMultiplier`, `tags`)

Optional `content/mechanics.json` owns independent module profiles. `packages/engine/src/content/mechanics.ts` owns the stable module ID allowlist and resolves each mission to a read-only `CapabilitySet`. Authored `enabled` state is not proof of runtime support: only an engine-implemented, enabled module with a selected existing profile can be active.

`content/world-map.json` owns campaign regions and mission nodes.

`maps/src/*.tmj` owns editable source maps. `maps/compiled/maps.json` owns runtime maps and is generated by `npm run maps:compile`. Each map selects hex/odd-r or square/cardinal topology while retaining `{q,r}` coordinates. Square movement/range uses four directions and Manhattan distance; diagonal route segments are invalid.

`content/visuals.json` schema v2 owns `assetsRoot`, atlases, standalone/frame sprites, weighted tile variants, Wang/signature materials, map/grid tileset bindings, event SFX, looping music tracks, and per-mission music. Schema v3 is an explicit storage-compatible extension with optional closed `proceduralJuice` v1 catalogs for deterministic particles, oscillator audio, camera cues, and event bindings. Absence keeps the v2 path unchanged. Asset paths are project-relative only.

`content/story-comics.json` owns mission-linked narrative panels. `content/battle-backgrounds.json` owns mission colors and optional sprite backdrops.

`scripts/**/*.tower.json` owns deterministic project-specific gameplay. TowerScript v1-v7 remain supported; v7 alone may opt a script into Behavior Tree v1 target selection or HFSM v1 state control, without creating `content/mechanics.json`. The later versions add only closed typed engine events/actions/controllers. One action transaction may change at most 64 tiles and a run may hold at most 512 active overrides. Script source is JSON, not executable JavaScript, and has no host filesystem, network, module, DOM, clock, or randomness access. Visual Graph is a lossless projection of this canonical AST, never a second source or language.

## Engine Contract

The engine exposes:

- `createGameContentRegistry`
- `validateGameContentRegistry`
- `MechanicsCatalog`, `MissionMechanicsSelection`, and read-only `CapabilitySet`
- `TowerDefenseGame`
- `runHeadlessMission`
- serializable `SimulationAction`
- immutable `GameSnapshot`
- TowerScript definitions, validation, expression evaluation, diagnostics, and `emitScriptSignal`
- bounded TowerScript Trace v2, `TowerScriptDebugSession` v2, and Graph v2 AST projection/materialization helpers for explicit authoring/debug sessions
- pure `planDirectorWaveV1`, `runAutoBalancerBatch`, and `generateProceduralMap` contracts

The separate `@towerforge/engine/multiplayer` entrypoint exposes `MatchSession`,
`AsymmetricMatchSession`, match journals/replay, offline challenge/reconnect/desync helpers,
capability handshake, in-memory transport, and an adapter over an injected WebSocket-like port.
The root engine intentionally does not re-export this protocol runtime.

Studio and CLI must call those APIs instead of duplicating gameplay behavior. Validation and simulation are engine-backed in the current implementation.

Procedural Juice is deliberately outside the engine contract. The engine continues to own
authoritative `GameSnapshot.lastEvents`; it neither reads visual cue rules nor allocates particles,
audio nodes, camera state, or presentation clocks. The pure browser-safe planner lives in
`@towerforge/renderer`, consumes previous/current snapshots plus the optional visuals-v3 block, and
returns detached v1 instructions shared by Canvas and Phaser. This adds no snapshot/checkpoint/
command/journal field and consumes no simulation RNG. A shared bounded renderer buffer retains at
most 128 authoritative snapshots while hit stop/time dilation slows only world presentation, then
resumes from the newest authoritative snapshot. The boundary is [ADR 0052](adr/0052-opt-in-procedural-juice-presentation.md).

The R6 TowerScript DX 2.0 baseline is not a `mission.mechanics` capability. A caller explicitly attaches a bounded trace collector or creates `TowerScriptDebugSession`; an ordinary `TowerDefenseGame` retains no trace and does not add debug state to snapshots, checkpoints, journals, state digests, renderers, or generated players. R6 Trace schema v1 records the actual ordered runtime phases `event -> binding -> handler -> condition -> action -> state_diff/diagnostic`, including stable phase/action ordinals that survive bounded prefix eviction. The debugger advances the live game only through the existing journaled command path, keeps a bounded checkpoint ring and only the replay checkpoints still represented by the bounded trace, and exposes `tick | event | handler | action` inspection. Historical frames come from checkpoint plus deterministic replay-to-cursor, are marked `live:false`, and cannot replace or resume the live game. Rewind validates the retained checkpoint, reconstructs the journal prefix, and abandons the future branch.

The R6 Graph schema v1 retains stable AST paths plus detached raw data. Materializing a graph updates the canonical TowerScript definition; duplicate nodes, dangling edges, script-ID drift, and invalid canonical candidates fail closed. Unknown future actions are preserved as raw nodes and remain read-only when the installed engine cannot validate them. Events, actions, expression operators, scopes, field help, graph rules, trace phases, step modes, and limits come from the engine-owned `TOWER_SCRIPT_SCHEMA`. The R6 package and compatibility decision is [ADR 0047](adr/0047-towerscript-dx-2.md).

R9 TowerScript DX 3.0 advances TowerScript to schema v7 and the Graph, Trace, and Debugger documents
to v2; Behavior Tree/HFSM documents and optional checkpoint `scriptMachines` use inner v1, while
layout stays v1. The upgrade is script-local and opt-in: TowerScript v1-v6 keeps its previous bytes,
targeting UI, snapshots, checkpoints, replay digest, and package path. A v7 targeting tree receives
only canonical eligible candidates after alive/class/range/LoS filtering, then performs a bounded
synchronous `selector | sequence | condition | select_targets` decision. Binary-stable candidate
ordering makes input/content record order irrelevant. Failure, malformed input, or budget exhaustion
uses the tower's persisted target mode as fallback; active bindings present `Scripted` and reject
manual mode changes with an engine-owned stable reason.

The HFSM evaluator owns nested initial states, absolute transition targets, leaf-to-ancestor ordered
resolution, and one transition per machine/context/event. It commits the target leaf before running
the common typed exit/transition/entry actions, so an action error leaves the new state active,
stops the remaining transition actions, and produces a diagnostic. Active state path, entered time,
and transition count are checkpointed only when an active v7 HFSM exists; terminal entity cleanup
removes entity-scoped state after death/destruction/sale settlement. Graph v2 adds controller,
composite, state, transition, containment, and transition-target records without creating a second
AST truth; legacy Graph v1 remains accepted and unknown future nodes remain raw. Trace/Debugger v2
adds behavior/transition provenance and step modes over the same checkpoint + replay-to-cursor
runtime. Studio computes missing layout-v1 positions through a pure containment-DFS helper: authored
edge order is stable, pinned records follow stable Graph node IDs, and new BT/HFSM cards are moved to
the first non-overlapping slot. Reads do not persist auto-layout, manual coordinates remain local
presentation state, and the engine Graph stays free of DOM/layout concerns. Failed BT branches
restore their incoming selection, and over-budget controller arrays are rejected before descriptors
or hostile tails are inspected. The accepted boundary is [ADR 0050](adr/0050-towerscript-dx-3-behavior-hfsm.md);
all gates and both independent sign-offs passed without open P0-P2 findings.

The engine also owns canonical `PlayerProfileV3`, its explicit v2 and bounded legacy migrations, canonical codec, launch options, and immutable progression reducers. V3 keeps exactly the existing clears, stars, currencies, upgrades, and selected difficulty; run state is not part of this schema. `packages/player-runtime` is a browser-safe adapter around those contracts: it accepts content, codec, and a Storage-like port by dependency injection; it does not import browser globals, DOM, Node, or either renderer. Loading is read-only, explicit save validates before a single preflight read and refuses to overwrite a future profile even when its opaque payload exceeds current codec budgets, and reset removes only the exact app-scoped profile key. Storage failures and corrupt data fail closed to a playable frozen empty profile without exposing raw/error details.

Canvas and Phaser generated-player templates now consume this boundary through one shared profile fragment. Normal reset removes only the exact profile key; emergency boot recovery removes that key plus the current app's story namespace. The complete decision is recorded in [ADR 0016](adr/0016-player-profile-runtime-and-persistence.md).

## Agent And MCP Contract

`packages/mcp/tools.mjs` is the shared constructor tool registry for the stdio MCP server and Studio AI Chat. Current tools cover compact gameplay/visual/audio/narrative/script reads, the filtered project tree, schema and recipe retrieval, validation, simulation/playtest diagnosis, map compilation/authoring, balance reports, granular entity/asset/narrative/script writes, project packs, web/native packaging, and build.

`packages/mcp/agent-instructions.mjs` is the canonical mechanism-selection and safe-workflow policy for Studio direct APIs, Codex, Claude, and external MCP initialization. `describe_schema({domain})` progressively exposes implemented domain descriptors, including `director` and the presentation-only `proceduralJuice`, while `get_capabilities` is read-only and never creates the optional mechanics catalog or upgrades a project. Preview/apply reject unavailable modules, unsupported versions, and unmet dependencies before any write. Executable mechanics modules include combat v1–v3, reactions/navigation/physics/terraforming/director v1, elevation v1–v3, roguelite v1–v4, heroes v1–v7, logistics v1–v3, and multiplayer v1–v2. Dependencies and promotions remain explicit; mechanics recipes are detached candidates and the common guarded mechanics transaction owns the catalog/mission write. Procedural Juice instead uses its own combined project+visuals revision preview/apply transaction; its recipes and event preview are compute-only. The stdio server queues frames FIFO, drains stdout before normal exit, and keeps one controlled lifetime error path for late broken pipes.

Agent-facing write tools are local-only and validation-gated:

- `dry_run_balance_patch` and `compile_maps_dry_run` compute without source-file writes.
- `propose_balance_patches` runs a bounded cancellable Node worker matrix, caches only completed
  evidence by content/engine identity, and returns proposal-only patches. `preview_procedural_map`
  returns a seeded `MapGenerationSpecV1` candidate plus canonical compile, terrain, tileset and
  deterministic headless runtime evidence without writing source or compiled maps; the runtime
  smoke is not a balance claim. `commit_procedural_map(ifRevision)` is the only generated-map commit
  path and owns source/compiled backup, validation, and rollback.
- `apply_validated_patch`, `apply_balance_patch`, `set_enemy_stat`, `upsert_tower`, and `add_wave_group` write `content/balance.json` only after a successful dry-run and keep rollback backups under `.towerforge/mcp-backups`.
- `import_asset`, `bind_sprite`, and `bind_mission_music` write confined asset/catalog changes only after schema validation, revision checks, backup, and rollback protection.
- `stage_generated_asset`, `inspect_staged_asset`, `commit_staged_asset`, and
  `discard_staged_asset` form a provider-neutral opaque-handle lifecycle. Only explicit guarded
  commit imports bytes; provider credentials and prompts are never project metadata.
- Procedural Juice reads and inert recipes are non-mutating. Event preview returns the shared pure
  instruction frame without launching Canvas/Web Audio. The narrow preview/apply pair guards the
  exact visuals revision, validates the complete candidate and project, preserves unrelated visual
  data, backs up the source, and rolls it back on failure; no broad raw visuals writer is added.
- `list_tile_presets`, `inspect_tileset`, `preview_tileset_import`, and `preview_tile_binding` expose tile discovery and coverage without writes. `render_tileset_preview` additionally returns a bounded PNG contact sheet as an MCP image block so an agent can inspect real atlas frames and missing-mask placeholders. `apply_tileset_import`, `upsert_terrain_type`, and `bind_map_tileset` use strict schemas, revision guards, backups, validation, and rollback.
- `upsert_story_comic` and `set_battle_background` support dry-run diffs and independently guard their source-file revisions.
- `list_project_tree` and `get_tower_script` are read-only; `upsert_tower_script` supports dry-run, catalog revision guards, candidate/full validation, atomic write, backup, and rollback. It cannot write outside `scripts/`. Graph authoring adds a granular read/preview/apply transaction over the same canonical script source: reads do not create `.towerforge`, preview materializes and validates without writes, and apply requires the exact composite script+layout revision before independently guarded atomic writes and rollback. Graph v2 reads expose Behavior Tree/HFSM nodes while preview/apply also accept legacy Graph v1; no broad R9 writer is added. The canonical AI sequence is descriptor discovery, compact script/graph read, dry-run or graph preview, exact-revision apply, full validation, then optional compute-only trace. `preview_tower_script_trace` accepts at most 128 exact commands, supports v2 behavior/transition cursors, and writes no project/editor state.
- `get_progression` returns complete difficulty/meta source plus the balance revision; `dry_run_progression_patch` previews and `apply_progression_patch` commits only those sections with full validation, backup, and rollback.
- `build_project`, `package_web`, `package_mobile`, and `package_desktop` write generated output or scaffolds under the active project.

Remaining agent-surface work is broader adversarial eval coverage and progressive capability discovery as the shared registry grows; arbitrary filesystem/shell tools remain intentionally out of scope.

## Studio Modules

Current Studio modules:

- Wave Editor: mission wave-set editing, enemy groups, counts, intervals, delays, route IDs.
- Enemy Editor: stats, rewards, movement class, special mechanics such as spawn-on-death, heal aura, armor.
- Tower Editor: costs, footprint, range, legacy attack models, the universal targeting/delivery/ordered-effects pipeline, and aura dependencies.
- Mission Editor: map, wave set, resources, authored objectives/stars, economy, tower/ability availability, sunlight modifier.
- World Map Editor: regions, mission nodes, difficulty, unlock requirements, canvas preview.
- Settings: global constants, project manifest, AI account/API connections, and provider/model/reasoning defaults.
- Build Targets: target metadata plus one-click web build.
- Mechanics Hub: a separate opt-in workspace for engine-owned module cards and capability state,
  including the Director authored-counter editor; unavailable or unselected mechanics do not add
  disabled controls to the ordinary tower, enemy, or mission forms.
- Map Authoring: per-map grid selection, source dimensions, spawn/core, path centerline, named routes, typed terrain overrides, exact square/hex picking, and compile action. During R3.1 it gains a separate elevation draft/layer only for an applicable opt-in elevation capability; ordinary map forms stay unchanged while inactive.
- Project Home: release-readiness checks, project summary, recent activity, and direct navigation to current problems.
- Playtest: engine-backed live canvas playtest with difficulty selection, mouse/keyboard placement, selling/targeting/abilities, inspector, objectives, kills/leaks, and event timeline. The explicit R6 debug session adds structured trace, `tick | event | handler | action` cursor stepping, resume, and bounded tick rewind without changing the ordinary playtest path.
- Balance: deterministic multi-strategy Balance Lab with mission/budget filters, advisor flags, passive mission badges, and contextual Ask AI.
- AI Chat: a right-side provider-neutral workspace with Ask/Plan/Act permissions, ChatGPT OAuth through Codex App Server, Claude account auth through Claude Agent SDK/Claude Code, and direct Anthropic/OpenAI/OpenRouter APIs. It reuses MCP `callTool`, streams calls/results, discovers models, applies reasoning effort, accepts validated images/sampled video frames, and shows applied diffs with Keep/Revert.
- Asset Catalog: safe project-relative sprite/atlas/SFX/music import plus a Tileset Workbench for PNG/TSJ/TSX slicing, topology, materials, masks, weights, transforms, terrain properties, coverage, and guarded commit. Verdant Frontier and Frostbound Citadel include square edge-16 and hex edge-64 sheets.
- Juice workspace: an isolated opt-in visuals-v3 JSON/recipe editor for particle, procedural-audio, camera, and event-binding records with synthetic-event instruction preview, exact revision guard, validation, backup, and rollback. Shared Studio/player runtime motion preferences apply at presentation time. It does not appear in Mechanics Hub or ordinary gameplay forms.
- Project & Scripts: filtered `.tdproj` navigation, read-only source inspection, nested script folders, and one canonical TowerScript workbench with JSON diagnostics, JSON/Graph views, descriptor-generated palette/help, raw future-node preservation, and guarded save/rename/delete.

Top-bar actions:

- Validate project.
- Run selected mission smoke simulation.
- Save all changed project files.

## CLI Commands

```bash
npm run validate
npm run sim tutorial_01 60
npm run sim tutorial_01 60 -- --json
npm run balance -- --project examples/starter.tdproj
npm run maps:compile -- --project examples/starter.tdproj
npm run migrate -- --project examples/starter.tdproj --write
npm run build
npm run build -- --single-file
npm run package:web -- --project examples/starter.tdproj
npm run project:export -- --project examples/starter.tdproj --out game.tdpack
npm run project:import -- game.tdpack --dir ./projects
npm run themes:list
npm run themes:apply -- verdant-frontier --project examples/starter.tdproj --dry-run
npm run build -- --json
node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop
node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile
npm run desktop:dev
npm run desktop:build
npm run mcp -- --project examples/starter.tdproj
npm run test:e2e
npm run studio
npx towerforge create my-game --template classic --dir /tmp
```

`npm run build` validates the project, compiles `packages/engine` to ES modules, copies the engine/renderer and safe referenced visual/audio assets, emits gameplay, TowerScripts, narrative, and background data, and writes a playable web player. `--single-file` also emits an asset-inlined `file://`-runnable HTML.

`node packages/cli/package.mjs` creates a portable web archive or wraps a web build into a native project scaffold. It does not install native SDKs, sign, upload, or publish binaries.

`npm run desktop:build` builds installable TowerForge Studio desktop bundles through `packages/desktop`. This is separate from game export packaging: it prepares a bundled runtime with the Studio server, CLI/MCP libraries, renderer files, and precompiled engine dist, then launches it through a Tauri v2 shell with a Node sidecar.

`npm run mcp` starts the stdio MCP server. Use `tools/list` to inspect tool schemas, `riskClass`, and `sideEffect` metadata.

## Build Output

Default starter output:

```text
examples/starter.tdproj/dist/
  index.html
  styles.css
  player.mjs
  project-data.js
  index.single.html (with --single-file)
  manifest.webmanifest
  offline-sw.js
  engine/
  renderer/
  player-runtime/
  assets/
```

The player imports `./engine/index.js` and `./player-runtime/index.mjs`, runs `TowerDefenseGame` in the browser, and renders with Canvas or Phaser. Both renderer templates use the same immutable profile reducers and persistence fragment for difficulty, meta currencies/upgrades/rewards, campaign unlocks, warnings, and reset behavior. The build precaches the runtime for PWA use and embeds each relative module once in a flat `index.single.html` registry; a tiny bootstrap materializes dependency-ordered Blob URLs so graph growth stays linear and direct `file://` launch remains valid. Plugin and desktop runtime preparation mirror the same package.

Preview with:

```bash
python3 -m http.server 5175 --bind 127.0.0.1 --directory examples/starter.tdproj/dist
```

## Design Heritage

TowerForge draws on proven tower-defense design ideas without depending on any specific game at runtime:

- deterministic headless simulation
- data-driven content
- hex and square TD topology
- balance-oriented CLI workflows
- a cohesive default visual tone (fully overridable per project)

The kit must not import from the reference repository, hardcode its local path, or require its private assets. Any extracted pattern must become generic `.tdproj` data, engine code, docs, or examples.

## Validation Rules

Validation currently guards:

- default mission exists
- map dimensions and coordinates
- per-map grid kind, topology-specific adjacency, route bounds, and typed walkability
- source map shape
- wave enemy references, counts, intervals, delays, and route IDs
- tower IDs, ranges, attack parameters, aura dependencies
- tower pipeline targeting, delivery, and ordered effect parameters
- enemy stats and special references
- mission map/wave/tower/ability references
- difficulty, economy, objectives, currencies, meta upgrades, and reward references
- world-map region and unlock references
- one world-map node per mission
- project schema versions
- TowerScript schemas, bindings, ids, event/action shapes, and project references
- visual asset path safety
- tileset atlas/frame references, material signatures, weighted transforms, bindings, and reachable-mask release coverage
- music, narrative mission, and sprite references
- build target output path safety

Validation warnings are allowed for incomplete authoring states such as missions without world-map nodes. Build stops on errors.

## Persistence Rules

Studio's ordinary editor save writes:

- `content/balance.json`
- `content/world-map.json`
- `content/visuals.json`
- `content/story-comics.json`
- `content/battle-backgrounds.json`
- `maps/src/*.tmj`
- `project.json`
- `build-targets.json`

R0A preserves an existing `content/mechanics.json` unchanged and never creates it through the ordinary save route. A later implemented module must use the dedicated guarded mechanics transaction to write the manifest, catalog, and mission selection together.

Writes are atomic per file and guarded by a content hash across mutable project files. Before overwriting, Studio creates `.towerforge/*.bak` backups.

TowerScript writes use a second file revision guard and backups under `.towerforge/backups/scripts`. Visual Graph preview/apply additionally guards the combined script-source and local-layout revision; its confined layout codec rejects traversal and symlink escapes and restores prior exact layout bytes on rollback. The generic project tree hides sensitive names, generated/editor directories, binary files, and symlinks; only `.tower.json` files below `scripts/` are editable from that tree.

Studio writes action traces for save, sim, build, map compile, and asset import under `.towerforge/runs/*.jsonl`.

## Roadmap

The staged R0–R11 program, TDD roles, forbidden increment combinations, compatibility baseline, and status live in [ROADMAP.md](ROADMAP.md). R0A establishes the opt-in capability harness, R0B adds the shared modifier/damage foundation, and completed R0C supplies deterministic session/profile foundations. Completed R1.1 proves resolver equivalence through one private application boundary; R1.2 adds shields; R1.3 adds the independently versioned armor matrix; R1.4 adds bounded marks; R1.5 adds a separate bounded reactions module; completed R2 adds opt-in dynamic-flow navigation, movement profiles, safe placement analysis, and shared Studio/player presentation. Completed R3.1 adds the opt-in authored elevation foundation; completed R3.2 adds deterministic elevation LoS; completed R3.3 adds elevation v3 high-ground through engine-owned pairwise acquisition range and one common-pipeline spatial damage modifier. R3.4a completes the isolated `physics` v1 increment with bounded tile-discrete push/pull, explicit terrain-tag fall hazards, authored-route confinement, cached-field dynamic movement, and engine-event-only presentation. Completed R3.4b separately introduces opt-in `terraforming` v1 and the TowerScript v6 batch/event contract with fail-closed, mission-scoped validation. Runtime C1 adds atomic persistent terrain batches and complete authored-route safety; C2A adds detached dynamic resolver preflight and atomic adoption; C2B1/B2A/B2B add the bounded canonical spawn/obligation graph and full-field proofs before resolver construction. Exact ceilings remain `16 384` sources/causes, `256` shared fields, and `8 388 608` baseline+candidate field/proof cells, with one candidate field at the accepted 8,191-live-enemy boundary and non-counting snapshot peeks. C3–C5 complete runtime compatibility and authoring, while C6 supplies the accepted shared Canvas/Phaser/player projection and package surface. Accepted R6 adds the detached structured trace, checkpoint-backed historical `tick | event | handler | action` inspection, bounded rewind, lossless Visual Graph, descriptor-driven Studio/MCP authoring, and guarded local layout transactions. Exact incremental journal accounting and monotonic replay-checkpoint pruning keep the opt-in debugger bounded without changing ordinary snapshots, checkpoints, digests, renderers, or generated players. Implemented R7 adds the authored deterministic Director, proposal-only cancellable worker auto-balancer, seeded procedural preview, and provider-neutral guarded asset staging. Implemented R8 adds the separate multiplayer entrypoint, local co-op and asymmetric sessions, checksummed replay/challenges, handshake/transports/reconnect/desync, and conditional player packaging without hosted services. Accepted R9 adds script-local TowerScript v7 Behavior Tree/HFSM controllers plus v2 Graph/Trace/Debugger surfaces. Accepted R10 adds compute-only Persona QA and mission-selected procedural quests. Accepted R11 independently layers deterministic JSON particle/audio/camera presentation over the authoritative event surface without changing gameplay state.

Accepted C3A adds engine-only persistent elevation. `set_elevation` and `restore_elevation` require both an active elevation v1–v3 profile and the active terraforming profile's elevation policy; authored elevation remains the immutable restore base. Terrain/elevation operations may share a cell and commit atomically in declared event order. Each layer is bounded to 512 runtime overrides and the combined ceiling is 1,024. A pure-elevation batch performs no navigation resolver creation, read, or adoption, while `GridMap.elevationAt`, `snapshot.elevation`, LoS, and high-ground immediately use the effective value; reset discards the runtime layer. A committed change emits the real TowerScript-dispatched `elevationChanged` event, and a no-op emits nothing.

C3A's historic inner checkpoint form is exactly `{schemaVersion:1,runtimeElevationOverrides}`. Accepted C3B adds native set-only timed batches: the 512-group capacity is checked before expression evaluation, duration is resolved once before targets/values and must be finite in `(0, 1_000_000_000]`, and only effective changes allocate one group plus one monotonic sequence. Same-layer ownership is exclusive, cross-layer ownership is valid, and pending ownership ceilings are 512 terrain, 512 elevation, and 1,024 combined targets. Historic legacy timers advance before native groups; an ULP-bounded countdown makes fractional tick partitions deterministic. All due groups restore through one candidate and one navigation proof in sequence→original-operation order. Unsafe expiry retains every due group at `remaining: 0` without diagnostics/events and retries atomically, including through `tick(0)`.

Active snapshots expose exact `terraforming` schema v1 pending group state and inactive snapshots retain their legacy shape. Exact inner checkpoint schema v2 is `{schemaVersion:2,runtimeElevationOverrides,nextExpiryGroupSequence,pendingExpiryGroups}`; group entries preserve applied values, original order, and exact terrain/elevation before-images. Historic terrain-only v0 and C3A v1 restore and re-emit without form/digest changes until a successful timed non-noop promotion; fresh active terraforming emits v2, and terrain-only v2 rejects hidden elevation state. Outer `GameCheckpointV1`, `towerforge-sim-v2`, command, journal, and replay contracts remain unchanged. C3B RED → GREEN evidence is 71/71 focused, 1,671/1,671 full Vitest across 132 files, 198/198 focused golden/checkpoint/replay/template conformance, 53/53 renderer/template regressions, full Playwright 17/17, and isolated 4 templates × 2 grids × 2 renderers matrix 1/1. Typecheck/build:engine/validate/sim/build/plugin gates are GREEN; independent code and constructor-integration sign-offs are PASS.

Accepted C4A adapts only the existing TowerScript `setTileTerrain` and `restoreTileTerrain` runtime actions when the selected terraforming capability is active. A direct set accepts a known authored terrain destination without requiring a transition or source tag, but both set and restore then enter the same detached candidate, authored-route/dynamic-flow proof, and atomic publication tail as `terraformTiles`. The order is fixed: existing action budget, one terrain-operation reservation, then for a timed set the group-capacity check and one duration evaluation, followed by `q`, `r`, destination/ownership validation, candidate, proof, and publish. A true effective no-op stops before navigation proof, group/sequence allocation, publication, events, or historic checkpoint-form promotion.

An active timed legacy set now uses the C3B native group, exact before-image, same-layer ownership, deterministic expiry, and inner checkpoint v2 rather than writing a new legacy `expiresIn`. Existing native ownership and restored historic legacy timers both reject active set/restore with `terraform.target_owned`. Absent, disabled, and unselected missions still execute the literal legacy branches with their earlier evaluation order, repeat/max timer semantics, snapshot/checkpoint shape, and digest behavior. C4A changes no public TowerScript v6, project, outer-checkpoint, snapshot, Studio, MCP, renderer, or player API. Its initial contract was 7 RED/4 GREEN; corrected/migrated focused fixtures reached 42/42, an independent authored-route no-op RED was added and closed, and relevant engine regression finished at 149/149. Independent code verification covered focused 134 plus C4A 5×12 and full engine/shared 1,661; constructor integration covered focused 302, scripts 80, template/conformance 284, full 1,683, Playwright 17/17, all prescribed gates, and byte-identical plugin runtime.

Accepted C4B adapts `path_water` only when terraforming is active. The ability first selects the complete radius intersection with immutable authored `path`; more than 64 cells rejects atomically without truncation before group, duration, destination, or ownership checks. The remaining priority is group capacity → duration → known `water` terrain → same-layer native or historic ownership. Its direct ability-source operations then enter one common candidate, authored-route/dynamic-flow proof, and atomic publish. One native group owns only effective changes and exact before-images, while no active ability override writes outer `expiresIn`.

All-no-op and partial-no-op uses remain successful ability activations: both consume full cooldown and emit `waterAbilityUsed` with the complete immutable-base selection. All-no-op allocates no group/sequence, emits no terrain change, and does not promote historic checkpoint form; partial no-op groups and emits only changed cells. `temporaryWaterTiles` is reconstructed as a detached compatibility view from historic legacy ability-water timers followed by positive-remaining native ability-water targets in group-sequence then target-order order, with coordinate deduplication. A route-unsafe expiry retained at zero therefore keeps terrain and ownership for retry but removes the water cue and path-water-specific slow; arbitrary persistent water does not gain that slow.

Checkpoint restore permits a native ability-source terrain entry only with active terraforming, an authored mission `path_water` ability, applied `water`, and immutable authored base `path`. A later effective use promotes historic form to inner v2; reset clears terrain, cues and groups, resets sequence/cooldown, and checkpoint/journal replay plus fractional partitions preserve state digest. Absent, disabled, and unselected square/hex missions keep the literal legacy path, including selections above 64 and outer `expiresIn`. C4B adds no public TowerScript, project, outer-checkpoint, snapshot, Studio, MCP, renderer, or player version/API. Initial evidence was 16 RED/7 GREEN; final C4A+C4B is 35/35, all terraforming 172/172, broader root 194/194, code verification 23×3 plus full 1,706, and constructor integration focused 194, golden/checkpoint/replay/template/conformance 326, Playwright 17/17, all gates, and plugin byte-sync. Both reviewers reported PASS with no findings.

Accepted C5A exposes terraforming v1 through the existing project/CLI mechanics transaction and exact engine descriptor projection. `tagged_flood`, `tagged_moat`, and `tagged_destructible_bridge` require project-authored source tags and destination terrain IDs, accept an optional transition ID, and return only one detached profile transition plus a TowerScript v6 `terraformTiles` snippet. They do not enable/select mechanics, mutate terrain/maps, or install scripts. Parameters are exact closed own-data, UTF-8 bounded, proxy-safe, and rejected by recipes that do not declare them. The AI order is `describe_schema → get_capabilities → get_recipe → preview(explicit missionId, enabled:true) → guarded mechanics apply → separate guarded script upsert → validate`. Agent guide v15 is the only version increment. The MCP stdio queue preserves and drains large FIFO frames before exit 0; a late `EPIPE` yields one controlled exit-1 diagnostic. The existing Studio recipes endpoint continues to materialize its prior recipes and returns the three new parameterized definitions as inert metadata, without writing the project. C5A final evidence is repair 44/44, relevant 249/249, full Vitest 1,743/1,743, Playwright 17/17, all prescribed build/plugin gates, and byte-identical runtime. Independent code verification additionally covered 160 large frames / 4,840,932 bytes, broken-reader races, and self-revoking proxies; both final reviewers reported PASS without findings.

Accepted C5B adds a separate Terraforming card only inside Mechanics Hub. Its narrow `POST /api/mechanics/recipe` delegates to shared `get_recipe` with the active project and forced `mechanics` collection, accepts exactly `{recipeId,parameters}`, removes private paths, and writes nothing. Studio holds the returned v1 profile and TowerScript v6 snippet as detached read-only data until the author explicitly previews or applies the common revision-guarded mechanics request; it never installs a script automatically. Transition IDs, source tags, destination terrain, and optional elevation policy use the exact engine descriptor limits. Choices come only from binary-sorted project-authored terrain IDs/tags, while missing authored values remain visible for repair. Future terraforming v2 data is raw/lossless and all writes are disabled. First enable explicitly migrates project v2 to v3; save/reload preserves exact profile data; global disable keeps schema, profiles, and all mission selections while returning `module_disabled`; direct re-enable restores the same intent. C5B began with 18 RED/4 GREEN and finishes at focused 25/25, Studio 104/104, Chromium lifecycle 8/8, full Vitest 1,762/1,762, and full Playwright 25/25. Independent code verification covered 64 concurrent recipes and XSS/prototype/path boundaries; constructor integration covered legacy byte identity, template×grid×renderer/player, all build/plugin gates, and byte-identical plugin runtime. Both sign-offs are PASS without findings. Ordinary forms and Visual Graph remain unchanged.

Accepted C6 completes R3.4b through one shared renderer/player contract. `projectTerraformingPresentation` validates exact active snapshot schema v1 through own-data descriptors and strict budgets, returns detached deeply frozen roots, and fails closed on malformed or future data. Effective `snapshot.tiles` and `snapshot.elevation` are authoritative across first render, reset, checkpoint restore, event loss, and malformed input. Current `terrainChanged`/`elevationChanged` events are bounded invalidation hints only; pending expiry targets validate ownership wire state but never trigger recurring per-frame invalidation. The projector delegates elevation cues to the existing shared elevation presentation rather than recalculating height rules.

Canvas and Phaser union event hints with authoritative snapshot-diff roots, then use the common `expandAutotileInvalidations`: square expands to self plus eight neighbors, odd-r hex to self plus six, filters current tiles, deduplicates, and sorts by `(r,q)`. Over-budget unions and failed expansion select full redraw rather than dropping snapshot changes. Studio Playtest, generated Canvas/Phaser players, PWA, single-file, web package, and `.tdpack` ship the same runtime files; `docs/examples/opt-in-transactional-terraforming/` is the public opt-in fixture. Absent, disabled, and unselected missions expose neither `snapshot.terraforming` nor terraforming-specific presentation and remain on the legacy path. Initial C6A was 11 RED; repair regressions added exact-key and malformed-UTF-16 boundaries. The stale Studio `drawElevationCues` call was caught and fixed before final acceptance. Evidence is focused 48/48, package 3/3, Studio 8/8, player 2/2, full Vitest 1,777/1,777, E2E 27/27, the template/grid/renderer matrix, and all required typecheck/build/validate/sim/plugin gates. Both independent verifiers reported PASS without findings; ADR 0027 is Accepted. R4.0A subsequently promoted the independent persistent profile to v3, and R4.0B added the separate inert `CampaignRunV1`; rogue content and R4 UI remain later opt-in slices.

## Shared Damage Pipeline

`packages/engine/src/simulation/modifiers.ts` defines the closed, bounded `ModifierSpec` order. `packages/engine/src/simulation/damage.ts` defines serializable source/target references, the closed damage-tag vocabulary, `DamagePacket`, and the stateless `DamageResolver`. `TowerDefenseGame.resolveAndApplyDamage` is the single private application boundary: target-specific wrappers assemble packets/context, then every tower delivery, ability, TowerScript damage action, status/DoT tick, enemy tower attack, and core leak resolves once before HP mutation. Before resolution or mutation, the boundary fails closed unless the packet target kind and exact enemy/tower id and type match the mutable target. Enemy/core HP clamp at zero; destructible tower HP keeps its legacy subtraction before immediate destruction. Death, reward, status, and gameplay events stay outside the resolver and therefore retain exactly-once ownership. Setting a leaked enemy to zero is a removal marker; the actual leak damage is the separately resolved core packet.

R0B preserves legacy behavior. Existing level-scaled attack values enter as the base; existing meta damage and sunlight bonuses are expressed at the `meta` and `spatial` stages. R1.1 changed no public schema, Studio/MCP authoring, snapshot, renderer, or player surface; absent, disabled, enabled-empty, and engine-unavailable combat variants produce the same gameplay snapshot. Their `getStateDigest()` values and content fingerprints may differ because authored mechanics catalog/version intentionally participates in the simulation content digest. Engine schema descriptors are exported to MCP `describe_schema` for both `combat` and `all`, so agents discover the same allowlists used by the runtime. See [ADR 0017](adr/0017-damage-routing-equivalence.md).

## Opt-In Combat Shields

R1.2 makes `combat` the first executable mechanics module. Its closed v1 profile currently accepts only `shields.enemies` and `shields.towers`, keyed by authored type ID. Tower targets must already be destructible. `capacity` is required; regeneration is optional and bounded. Catalog presence is insufficient: the module must be enabled and the mission must select the profile.

At runtime the keys change to entity instance IDs. The optional `snapshot.combat` / checkpoint section contains only `{ current, capacity, regenerationDelayRemaining }` for each active target. In v1, resolved damage uses `modifiers → resistance/pierce compatibility → shield → HP`. Shield absorption, regeneration, and typed TowerScript v3 restoration emit deterministic change events and preserve exactly-once death/reward handling.

Mechanics Hub and MCP obtain bounds, fields, runtime shape, events, and actions from the engine descriptor. The `basic_regenerating_shields` recipe remains an explicit choice and guarded writes update project schema, catalog, and mission selection together. Canvas and Phaser share `packages/renderer/src/combat-presentation.mjs`, a pure own-property projection over the optional snapshot/events. It renders state and cues but never reads the authored profile or reproduces combat logic. A terminal break event can outlive its entity and combat state for one presentation frame; the projection uses a detached previous, spawn, or same-frame placement coordinate while continuing to reject an explicitly present future combat schema. Studio playtest inherits Canvas behavior; PWA and single-file builds ship the same module. The reference pair is under `docs/examples/opt-in-basic-shields/`; the full decision is [ADR 0018](adr/0018-opt-in-combat-shields.md).

R1.3 adds combat module v2. Its profile retains optional `shields` and adds `damageTypes`, `armorTypes`, and `armorAssignments.enemies`. Damage and armor IDs are author-defined; a missing packet `damageType` falls back to `physical`, and any non-empty assignment set therefore requires a declared `physical` type. Each armor type has a required bounded multiplier record and may define `defaultMultiplier`; a missing entry and default means `1`, while `0` is a valid immunity. Enemy `resistances` remain a per-enemy override applied after the matrix. The fixed shared order for tower delivery, ability, TowerScript, status/DoT, enemy attack, and leak packets is `source modifiers → armor matrix → entity resistance → legacy pierce_only → shield → HP`. The `armor_piercing` tag bypasses only `pierce_only`, never the authored matrix.

Only enemy armor assignment is supported in R1.3; tower armor, marks, vulnerabilities, exposures, and reactions are rejected or remain unavailable. Limits are 256 damage types, 256 armor types, 4,096 assignments, 16,384 matrix entries, 128 characters per label, and a `0..1,000,000` multiplier range. Active cross-references are semantic errors; broken references in disabled profiles remain warnings, but unsafe/non-data shapes and structural budget violations still fail validation.

Armor is immutable derived content, so an armor-only profile adds neither mutable state nor `snapshot.combat`/checkpoint combat data. `content/mechanics.json` still participates in the simulation content digest: restoring a checkpoint against changed armor definitions is rejected before simulation. Studio keeps the editors inside Mechanics Hub; MCP uses `get_capabilities → get_recipe({collection:"mechanics", recipeId:"basic_elemental_armor_matrix"}) → preview_mechanics_module → apply_mechanics_module → validate_project`. A guarded v1-to-v2 upgrade preserves profiles and selection; downgrade/future versions fail closed. The recipe's elemental names are data presets only and do not activate reactions. See [ADR 0019](adr/0019-opt-in-armor-matrix.md) and `docs/examples/opt-in-elemental-armor-matrix/`.

R1.4 adds combat module v3. `marks.definitions` is keyed by author-defined mark ID; each definition owns duration, maximum stacks, a per-stack multiplier, consume policy, and an optional damage-type filter. Optional bindings key ordered mark applications by tower, ability, or TowerScript ID. Matching marks are applied in binary ID order after all source modifiers and before armor. The multiplier is `1 + stacks * (multiplier - 1)`; consumption occurs after successful resolution, including hits later reduced to zero by armor or fully absorbed by a shield. Automatic bindings are limited to positive direct tower/ability/TowerScript damage against a surviving enemy. Status/DoT may consume existing marks but does not auto-apply them.

Mark state is enemy-instance keyed and ages deterministically at the start of each positive tick after shield regeneration. Combat v3 uses optional runtime schema v2 containing both `shields` and `marks`; v1/v2 shield state remains schema v1 and empty state remains absent. The outer checkpoint and simulation versions do not change. TowerScript v4 adds `enemyMarkChanged`, `applyEnemyMark`, and `clearEnemyMark`; v1-v3 reject them. Studio/MCP use the shared descriptor and guarded `basic_vulnerability_marks` recipe, while Canvas/Phaser consume only bounded presentation projections. Reactions, exposures, tag filters, and Visual Graph are excluded. See [ADR 0020](adr/0020-opt-in-vulnerability-marks.md) and `docs/examples/opt-in-basic-vulnerability-marks/`.

R1.5 implements the separately selected `reactions` module v1 without changing combat v3. Profiles define bounded exposure applications and directional reaction rules whose requirements are AND predicates over exposure, legacy status, or authored terrain tags. Eligible direct tower, ability, and TowerScript enemy hits finish `modifiers → marks → armor → resistance → legacy → shield → HP` before the engine captures/consumes reaction state and drains secondary damage through the same boundary. Status/DoT, enemy/leak, zero/immune hits, and secondary packets are ineligible unless an effect explicitly allows reactions. Binary rule/effect order, topology distance plus enemy ID ordering, depth 4, and 256 packets per root make the FIFO deterministic; `removeDeadEnemies()` remains the only reward/kill settlement.

Live exposures use optional top-level `snapshot.reactions` / checkpoint reaction-state schema v1; combat-state schema v2 and all outer version domains remain unchanged. TowerScript v5 adds typed exposure actions and exposure/reaction events but cannot directly trigger the matrix. Mechanics Hub and MCP expose prerequisite-aware `elemental_shatter`, `wet_chain_shock`, and `poison_combustion` recipes through the existing guarded transaction. Recipes never patch missing combat types or terrain tags. Canvas/Phaser consume a shared fail-closed projection with bounded badges/cues and no rule evaluation. See [ADR 0021](adr/0021-opt-in-elemental-reactions.md) and `docs/examples/opt-in-elemental-reactions/`.

## Opt-In Dynamic Navigation

R2 implements `navigation` v1 as a discriminated `authored_routes | dynamic_flow` profile. Inactive, disabled, unselected, and authored-routes missions retain the original route movement and placement path without a solver, navigation snapshot, or overlay. Active dynamic flow resolves one cached reverse-Dijkstra field per movement-profile/goal pair through the engine topology registry; renderers and Studio never calculate paths.

The engine-owned `analyzeNavigation` query accepts bounded explicit coordinates and returns canonical field diagnostics plus spatial placement rows without changing commands, RNG, journal, events, checkpoint, state, or digest. MCP exposes it as compute-only `analyze_navigation`. Studio's `/api/navigation/analyze` endpoint is a thin sanitized facade over that tool for saved-project authoring. Live Playtest queries its current game instance so runtime tower occupancy and terrain are included, then forwards the detached result to the shared renderer projection; the server endpoint is only its compatibility fallback. A viewport of at most 4,096 cells is analyzed completely. Larger viewports use an input-order-independent window nearest to the latest pointer/keyboard interaction anchor, tie-broken by numeric `(r,q)`, and the UI exposes analyzed/total partial coverage. Actual placement always runs the authoritative `canPlaceTower` preflight followed by the engine action.

Mechanics Hub owns the isolated navigation editor for mode, default profile, movement profiles, terrain/tower policies, fixed-point costs, optional overrides, and explicit enemy assignments. `basic_dynamic_navigation` supplies ground/floating/burrowing/flying data presets but no assignments or writes. Enable/save/disable/re-enable continues through the same revision-guarded project-v3 transaction. See [ADR 0022](adr/0022-opt-in-dynamic-flow-navigation.md).

## Opt-In Authored Elevation Foundation

R3.1 gives project-v3 map sources one sparse `elevationOverrides` array. An entry is a closed `{q,r,elevation}` safe-integer row; coordinates are unique and in bounds, elevation is within `-1_000_000..1_000_000`, and the total is capped at 65,536. A missing tile is exactly `0`, explicit zero rows compile away, and output is sorted by numeric `(r,q)`. Sources may use the top-level field or a JSON Tiled property. Legacy maps receive neither the field nor an automatic project upgrade.

The independent elevation module v1 uses a closed empty profile `{}` as the mission-level switch over the map data. Only enabled + selected + available produces `snapshot.elevation = {schemaVersion:1, defaultElevation:0, overrides}`; an active flat map uses an empty array, while every inactive/future/missing path omits the section. `GridMap.elevationAt` returns the override/default for an in-bounds coordinate and `undefined` outside the map. Existing tile rows, checkpoint v1, command/journal, TowerScript, and multiplayer contracts do not change. Elevation remains immutable content and therefore participates in the content digest even if the module is disabled.

## Opt-In Deterministic Elevation Line of Sight

R3.2 extends only the elevation module contract to schema v2. A v1 profile stays exactly `{}`; a v2 profile is also elevation-only unless it explicitly authors `lineOfSight.terrainBlockerTags`. Activation still requires module enablement and mission selection. Source/target endpoints use eye height `elevation + 1`; an interior cell blocks on a configured terrain tag or when its elevation reaches or exceeds the integer-interpolated ray. Terrain tags win on the same cell, and all ordering/tie breaks are binary/canonical.

The same engine tracer filters direct tower acquisition and serves bounded detached analysis. It does not recheck splash/area secondaries or chain hops, and it does not affect support, abilities, enemy attacks, reactions, DoT, or TowerScript. MCP and Studio may analyze active content or the exact preview candidate with the current mechanics revision; this is compute-only. Renderer/player code can project the engine result but cannot inspect blocker tags, map lines, or elevations to derive visibility. Optional `snapshot.elevation` remains schema v1, and no new event, checkpoint, command, or journal section is introduced. See accepted [ADR 0024](adr/0024-opt-in-deterministic-elevation-line-of-sight.md).

Map Authoring holds elevation in a detached capability-gated draft. Studio and MCP share `preview_map_elevations` and `apply_map_elevations`, which guard one source revision, perform the explicit v3 manifest update, compile and validate, back up, and roll back the source/compiled map/manifest transaction. Mechanics Hub separately enables/selects the closed v1 profile or a v2 profile with optional LoS. `basic_authored_elevation` and `basic_elevation_line_of_sight` return profile data only and never edit either boundary. Canvas and Phaser consume shared fail-closed presentation projectors; badges/contours and detached LoS diagnostics remain presentation cues, never gameplay-rule implementations. See accepted [ADR 0023](adr/0023-opt-in-authored-elevation-foundation.md), accepted [ADR 0024](adr/0024-opt-in-deterministic-elevation-line-of-sight.md), and the matching reference fixtures. R3.1 and R3.2 are complete with independent code and constructor-integration sign-offs.

## Deterministic Session Foundation

R0C.1 adds the pure engine `SeededRng` utility without changing current gameplay. Its `xoshiro128**` state schema and typed seed-expansion v1 have immutable vectors; malformed, future, sparse, non-uint32, and all-zero states fail closed. `nextInt` uses deterministic rejection sampling, including the full `2^32` range. Production engine code is statically guarded against `Math.random()`.

At the R0C.1 boundary, `TowerDefenseGame` does not consume RNG; state digest, checkpoints, journals/replay, external surfaces, and the shared profile runtime remain separately gated work. UI/editor IDs and vendored renderer internals are outside gameplay RNG state and must never affect a simulation digest.

R0C.2 now provides `GameCommandV1` for `tick`, wave start, tower placement/move/sell/upgrade/target mode, ability use, and external TowerScript signals. `dispatchGameCommand` accepts untrusted input, snapshots only own data descriptors, validates a closed shape, clones coordinates and payloads, and then calls exactly one existing engine method. Invalid/future input cannot mutate the game; an exception from an already validated engine method is intentionally propagated rather than misreported as malformed input. Legacy headless actions remain an adapter until the later Canvas/Phaser/Studio surface migration.

R0C.3 adds a synchronous browser-safe canonical serializer and versioned state/content digests. Canonical input is the strict JSON subset captured through own data descriptors; accessors, hidden properties, sparse or subclassed arrays, cycles, non-finite numbers, and configured budget overflow fail closed. Simulation content hashing excludes presentation-only catalogs, world-map layout, derived `mapFactory`, and known definition metadata without recursively dropping author IDs that happen to be named `label`, `color`, or `__proto__`. The digest is a deterministic compatibility fingerprint, not a cryptographic integrity or authentication primitive; checkpoint codecs must still validate their complete envelope before restore.

R0C.4 implements that codec as `GameCheckpointV1`. A checkpoint is detached JSON containing independent checkpoint and engine versions, the simulation-content digest, mission/difficulty/meta identity, initial and current seeded RNG states, the complete authoritative mutable game state, and one digest over the compatibility envelope. Restore validates closed nested shapes, cross-references, topology-derived footprints, generated-ID counters, queue and route bounds, entity state, TowerScript timers/state/budgets, and canonical set ordering before `mapFactory` can run. It then creates a fresh game without dispatching `gameStarted` and rebuilds only derived map state. Hex and square prefix/checkpoint/suffix runs must produce the same snapshot and state digest as uninterrupted simulation, including the legal boundary immediately after `startNextWave` and before the first tick.

R0C.5 adds an opt-in command-recording wrapper without changing ordinary simulation. `JournaledGameSession` captures a detached initial checkpoint, routes each accepted versioned command through the same single-pass parser/executor as `dispatchGameCommand`, and records a zero-based sequence, detached command, normalized durable result, and post-state digest. Structurally invalid input is omitted; a structurally valid gameplay rejection is retained. Out-of-band mutations, engine exceptions, and capacity exhaustion fault the session before it can claim a complete journal. `decodeGameCommandJournal` is a closed, bounded, validation-only codec: it validates content and the embedded checkpoint without `mapFactory`, and never executes entries. Journal data remains absent from checkpoints, snapshots, project files, players, and multiplayer envelopes until an explicit later surface consumes it.

R0C.6 adds that consumer as the pure engine-only `replayGameCommandJournal` API. Replay first uses the validation-only journal decoder to validate and parse the complete detached journal before `mapFactory` can run, restores one fresh game from the initial checkpoint, and sends each already parsed command through the shared executor exactly once. At every sequence boundary it compares the normalized durable result before calculating and comparing the post-state digest; `GameCommandReplayDivergenceError` reports the first mismatching sequence and kind, while engine failures are wrapped separately with their sequence and original cause. The returned game is independent and can continue deterministically. Replay introduces no Studio, MCP, renderer, player, project, profile, checkpoint, or multiplayer state, and its compatibility contract remains independent of those version domains.

R0C.7.1–R0C.7.4 establish the shared profile foundation in four isolated contracts: the original engine-owned `PlayerProfileV2` codec/migrations, immutable difficulty/meta/mission reducers, the renderer-neutral fail-closed persistence adapter, and generated-player integration. R4.0A promotes only that persistent contract to canonical `PlayerProfileV3`; v2 and legacy values migrate in memory and are written as v3 only after an explicit mutation. Descriptor-safe capture detaches every untrusted object once, so decode, serialization, launch options, and reducers do not re-read hostile proxies. The adapter retains the exact legacy `towerforge:progress:` key derivation but does not read a browser global, silently write migrations, overwrite opaque future versions, or enumerate/reset sibling profile/story keys. Canvas and Phaser use one byte-identical marker fragment; PWA, single-file, plugin, and desktop bundles ship the same runtime boundary defined by [ADR 0016](adr/0016-player-profile-runtime-and-persistence.md) and amended by [ADR 0028](adr/0028-player-profile-v3-migration.md).

R4.0B introduces `CampaignRunV1` as another independent pure-engine version domain. Its exact content-independent document carries `seed`, nullable `nodeId`, ordered inert deck/artifact instance references, and non-negative run resources. The codec has no `GameContentRegistry` argument: semantic node/card/artifact/resource validation belongs to later opt-in modules. Explicit create/decode/import/export operations use one descriptor-safe bounded capture, deep freeze, aggregate collection limits, and canonical serialization. A future in-memory root is classified before opaque nested data, while raw JSON import keeps a hard pre-parse byte boundary. The engine index and generated plugin runtime export the codec, but no project schema, mechanics capability, MCP authoring domain, browser storage key, Canvas/Phaser template, Studio route, simulation command, snapshot, checkpoint, replay, or digest consumes it. See [ADR 0029](adr/0029-campaign-run-v1-codec.md).

R4.1A implements the independent `roguelite` v1 capability without consuming `CampaignRunV1`. Optional tower-type tags and closed synergy tiers are author data; only live placed instances count. The engine emits stage-`run` damage modifiers and a derived optional snapshot section. Mechanics Hub, MCP schemas/recipe, renderer projection, and generated Canvas/Phaser players share that contract; absent, disabled, and unselected projects remain on the legacy path. The reference fixture is `docs/examples/opt-in-elemental-synergies/`; artifacts, draft, campaign nodes, run inventory, and persistence remain later slices.

R4.2A/B extends only the opt-in module to `roguelite` v2. Closed artifact definitions, typed tower slots, and authored boss loot tables are normalized and cross-reference validated. An active mission owns an empty battle-local inventory and a dedicated seeded RNG domain; checkpoint restore preserves that stream and inventory, while binary sorting prevents authored object order from changing drops. The snapshot exposes read-only `socket:null` entries, and `artifactDropped` follows `enemyKilled` before spawn-on-death. Studio, MCP, Canvas, Phaser, PWA, single-file and package surfaces consume this optional contract. Authored modifiers are inert and `CampaignRunV1` remains disconnected until later socket/persistence increments. The reference fixture is `docs/examples/opt-in-boss-artifact-loot/`; see [ADR 0031](adr/0031-opt-in-roguelite-artifact-loot.md).

R4.2C keeps the authored module at `roguelite` v2 and independently versions runtime surfaces. `GameCommandV2` adds exact socket/unsocket actions and promotes only sessions that receive a structurally valid v2 command to journal v2; replay decodes journal v1/v2. Mutation is limited to a real between-wave boundary. Nested artifact checkpoint v1 remains byte-stable until the first successful socket mutation, while nested v2 restores assignments after validating tower, slot, compatibility, uniqueness, and the shared 64-modifier budget. Snapshot v3 exposes inventory sockets, live tower slots, and management availability. Artifact modifiers enter the common stage-`run` resolver only for immediate damage from the exact live tower instance. Studio playtest and generated Canvas/Phaser players provide native-button controls from the renderer projection; MCP describes commands/events without a new write tool. `CampaignRunV1`, draft, campaign map, and persistent inventory remain disconnected. See [ADR 0032](adr/0032-opt-in-roguelite-artifact-socketing.md).

R4.3 extends the authored module to closed `roguelite` v3. `synergies` stays required, while
`artifacts?` and `draft?` are independent: a draft-only profile creates no inventory, and an
artifact-only profile creates no offer or pause. The engine samples three unique weighted cards with
a dedicated seeded RNG after a cleared non-final wave. Pending offers freeze simulation time and
block manual or scheduled wave start until exact `GameCommandV3 chooseDraftOption`; chosen typed
damage modifiers use the shared bounded `run` stage and tower scope checks. Journal/replay v3 and
optional inner draft checkpoint v1 preserve the offer, selection order, and state digest without
changing outer `GameCheckpointV1`. Snapshot v4 is emitted only for active draft and is projected by
the shared renderer adapter into Studio and both generated players. Mechanics Hub and the guarded
CLI/MCP transaction author the same v3 profile; there is no special draft writer. The ordinary
starter and all absent/disabled/unselected/no-draft paths remain unchanged. See
[ADR 0033](adr/0033-opt-in-deterministic-wave-draft.md) and the fixture
`docs/examples/opt-in-wave-draft/`.

R4.4A extends the authored module to `roguelite` v4 without changing its battle snapshot,
checkpoint, command, journal, or replay contracts. The new optional profile marker
`campaign: {schemaVersion:1}` activates only with an authored `worldMap.campaign` DAG and matching
mission selections. Battle, elite, and boss nodes reference missions; merchant and event nodes are
visible structural waypoints whose gameplay remains a later slice. The pure engine validates and
binary-normalizes the bounded graph, while a read-only legacy projection maps existing mission
nodes to battle nodes without writing or activating anything.

`CampaignRunV1.nodeId` now has content-aware semantics as the last completed node. Explicit APIs
validate the run, expose entry/direct-successor choices, and record one battle victory into separate
immutable run and profile results. Campaign coordination lives above individual
`TowerDefenseGame` instances. Studio and MCP share one guarded project/world-map/balance/mechanics
transaction; Canvas and Phaser use the engine codec for explicit import/export and do not persist a
run automatically. See [ADR 0034](adr/0034-opt-in-campaign-graph-and-run-lifecycle.md) and
`docs/examples/opt-in-campaign-run/`.

Campaign authoring publishes one exact closed graph schema to Studio and MCP. Its four-file write
transaction binds the project and content parent identities by real path, device, and inode before
staging and rechecks them before every ownership read, replace, rollback, and cleanup; a concurrent
symlink swap therefore fails before any content write can escape the project. Content-aware run
operations detach an untrusted `CampaignRunV1` exactly once and use that frozen value throughout
validation, availability, and victory reduction. R4.4A acceptance is 1,938/1,938 Vitest and 44/44
Playwright tests, all required build/plugin gates, and independent code plus constructor sign-off.

R4.4B independently advances only `worldMap.campaign` to schema v2. The graph adds a bounded
`runResources` definition catalog and exact structural choices `{id,label,costs,grants}` on
`merchant` and `event` nodes. `resolveCampaignStructuralChoice` is a pure coordinator above battle
simulation: it captures the run once, checks availability and every cost against the pre-effect
balance, rejects underflow/overflow, publishes a detached canonical resource bag, and advances the
node only after the whole transaction succeeds. Player profile, `TowerDefenseGame`, snapshot,
checkpoint, command, journal/replay, and RNG contracts remain unchanged. Studio/MCP retain the
dedicated guarded campaign transaction; the shared renderer projection is presentation-only and
Canvas/Phaser call the engine reducer. Graph v1 remains accepted with presentation-only structural
nodes. See [ADR 0035](adr/0035-deterministic-campaign-structural-choices.md) and
`docs/examples/opt-in-campaign-structural-choices/`.

R4.4B acceptance is 1,960/1,960 full Vitest plus 112/112 focused campaign contracts and 3/3
campaign browser scenarios. Independent code verification closed aggregate-budget overflow,
choice-list complexity, and prototype-key authoring regressions; constructor integration covered
the guarded Studio/AI lifecycle, both renderers and grids, pointer/keyboard/touch controls,
packaging, legacy/future paths, and plugin parity. Both sign-offs are PASS with no open P0–P2.

R4.4C keeps the graph and portable run schemas unchanged and advances only the independently
versioned campaign marker to v2. `prepareCampaignBattle` validates the run once, reserves remaining
DAG draft capacity and the shared modifier budget, derives a per-node seed/launch ID, and creates a
battle whose carried cards apply immediately and whose carried artifacts start unsocketed. Active
handoff checkpoints use nested campaignBattle v1, draft v2, and artifact v3 while the outer
checkpoint remains v1. `settleCampaignBattleVictory` validates the exact victorious engine binding,
removes socket assignments, merges launch-scoped card/loot instances, records the profile clear,
and advances the node atomically. Marker v1, defeat, abandon, direct Studio Playtest, and absent or
disabled campaigns retain their earlier behavior. See [ADR 0036](adr/0036-opt-in-campaign-battle-handoff.md).

R4.4C acceptance is 1,994/1,994 full Vitest and 46/46 Playwright. Independent code verification
closed hostile IDs, forged checkpoint carry, content-binding, aggregate-budget, and ordering
boundaries; constructor verification covered guarded Studio/AI authoring, future-marker read-only,
both renderers/grids/input families, packaging, legacy paths, and plugin parity. Both sign-offs are
PASS with no open P0–P3.

### R5.1A static hero roster foundation

R5.1A activates the planned `heroes` module as schema v1 while keeping active control in a later
increment. A closed profile contains `selectedHeroId` and 1–32 binary-keyed definitions. Every
definition is exactly `{label, spawn:"core"}`; definition IDs and labels are bounded to 128 real
UTF-8 bytes. Structural shape and budgets are always validated. A missing selected definition is a
semantic cross-reference: it is an error for an active selected profile and a warning while the
profile is inactive.

The simulation derives one immutable selected unit from content and the map core. Only an active
capability publishes `snapshot.heroes` schema v1, whose exact unit fields are `id`, `definitionId`,
`label`, and `coord`. The roster is presentation-visible but has no mutable simulation behavior.
There is no RNG stream, command, event, TowerScript surface, HP, mana, ability, aura, blocking, or
navigation allocation. Checkpoint v1 and `towerforge-sim-v2` remain unchanged and contain no hero
state; restore safely re-derives the unit because the checkpoint content digest already binds the
profile and map.

Studio authors the roster only in Mechanics Hub through the existing revision-guarded three-file
mechanics transaction. MCP/AI uses the same descriptor and `describe -> capabilities -> recipe ->
preview -> guarded apply -> validate` flow. Canvas and Phaser consume one shared fail-closed hero
projection. `visuals.bindings.heroes` is optional and no empty binding is synthesized for legacy
projects. Missing, disabled, unselected, and unsupported future modules publish no hero snapshot or UI.
This v1 path remains static and byte-compatible; the separately selected v2 movement extension is
described below. See [ADR 0037](adr/0037-opt-in-static-hero-roster-foundation.md).

### R5.1B deterministic hero movement

Heroes v2 adds movement as an independent opt-in profile extension. The profile owns
`movementProfiles` in the same closed shape as `MovementProfileV1`; each selected definition adds
exact nested `movement: {movementProfileId, speed}`. This reuses the engine topology and bounded
reverse-field implementation but does not require, enable, select, or mutate the separate
`navigation` module. The inert `basic_mobile_commander_hero` recipe likewise writes nothing until
the normal preview/revision/apply transaction is explicitly committed.

Movement enters simulation only through exact `GameCommandV4 moveHero`. Mutable coordinate,
nullable target/next coordinate, and fractional edge progress live in the optional active heroes
checkpoint section and replay through journal v4. The optional `snapshot.heroes` v2 is the only
renderer input. Its movement record is exact and nullable; the shared renderer projects an
interpolated point and presentation-only hit test. Canvas and Phaser keep selection outside the
snapshot and dispatch commands for pointer/touch and Enter, with Escape and every run-context
handoff clearing selection. Heroes v1 remains the static snapshot contract and receives no new
input behavior. HP, mana, abilities, skills, auras, blocking, and TowerScript hero actions remain
outside this slice. See [ADR 0038](adr/0038-opt-in-deterministic-hero-movement.md).

### R5.2A hero durability

Heroes v3 retains the exact v2 movement profile and requires each definition to add closed
`durability: {maxHp,shield}`. HP and capacity are finite positive values bounded at
`1_000_000_000_000`; shield is `null` or exact `{capacity}`. Structural validation applies while
disabled, while activation and runtime allocation still require the ordinary enabled module plus
mission profile selection.

A live in-range v3 hero can be targeted by enemy `towerAttack`. Damage passes the shared
`DamagePacket` / `DamageResolver` boundary and the authored hero shield absorbs the resolved amount
before HP. Zero HP emits one defeat transition, disables movement, and removes the hero from future
attack targeting. There is no regeneration, healing, revival, threat configuration, mana, ability,
aura, blocking, or TowerScript hero surface in R5.2A.

The optional snapshot advances to heroes v3 with exact `durability: {hp,maxHp,shield,defeated}`.
The optional nested heroes checkpoint advances to v2 for current HP/shield while outer
`GameCheckpointV1`, engine v2, GameCommand/Journal v4, replay, project v3, and mechanics catalog v1
stay unchanged. Studio v3 authoring is isolated in Mechanics Hub; future v4+ data remains exact and
read-only. CLI/MCP share the engine descriptor, inert `basic_durable_commander_hero` recipe, and
existing revision/validation/backup/rollback transaction. Canvas and Phaser consume only bounded
snapshot/event projections. See [ADR 0039](adr/0039-opt-in-hero-durability.md) and
`docs/examples/opt-in-hero-roster/mechanics-durable.json`.

### R5.3A targeted hero ability

Heroes v4 retains v3 and adds exact bounded `mana` plus one inline enemy-targeted
`activeAbility`. Exact `GameCommandV5 useHeroAbility` carries only hero, ability, and live target
IDs. The engine checks outcome, defeat, range, mana, and cooldown before spending state and routing
one ability packet through the shared resolver. Deterministic regeneration/cooldown state appears
only in optional snapshot v4 and nested heroes checkpoint v3; the outer checkpoint remains v1.

Studio and MCP use the inert `basic_targeted_hero_ability` recipe and the ordinary guarded
revision/validation/backup/rollback transaction. Canvas and Phaser read authoritative readiness and
dispatch the same command across pointer, touch, and keyboard. V1–v3 and absent/disabled paths keep
their earlier shape. See [ADR 0040](adr/0040-opt-in-targeted-hero-ability.md) and
`docs/examples/opt-in-hero-roster/mechanics-targeted-ability.json`.

### R5.4A battle-local hero skill tree

Heroes v5 retains the exact v4 definition and adds required nullable `skillTree`. `null` is an
explicit opt-out that continues to publish snapshot v4/checkpoint v3. A non-null tree contains
bounded starting/interwave points and a canonical all-of-prerequisite DAG. Nodes can contain one
to four allowlisted modifier effects, all scoped to `hero_ability_damage`; the engine compiles them
to collision-safe `run` modifiers for that packet only and rejects sequences that can overflow the
shared damage bounds.

Exact `GameCommandV6 unlockHeroSkill` is accepted only during setup or a clear non-final
interwave. Unlocking is atomic and deterministic, while the tree itself never pauses automatic
wave scheduling. Non-final clears emit `waveCleared` then `heroSkillPointsGranted` before an
optional draft offer. Snapshot v5 publishes authoritative points, phase availability,
prerequisites, and unlockability. Nested heroes checkpoint v4 validates binary unlock order,
prerequisite closure, earned-minus-spent accounting, retained event order, and authoritative final
state. Outer checkpoint v1, project v3, PlayerProfile v3, and CampaignRun v1 do not change.

Mechanics Hub owns explicit v4→v5 promotion and materializes `skillTree:null` on definitions that
do not opt in. MCP exposes guide v25 and inert `basic_hero_skill_tree`; both players create controls
only from valid snapshot v5 and dispatch command v6. No XP, respec, aura, blocking, logistics,
TowerScript hero scope, or cross-battle carry is added. See
[ADR 0041](adr/0041-opt-in-battle-local-hero-skill-tree.md) and
`docs/examples/opt-in-hero-roster/mechanics-skill-tree.json`.

### R5.5A passive hero damage aura

Heroes v6 retains every v5 field and adds required nullable `passiveAura`, independently of the
nullable skill tree. A non-null closed aura contains an ID, label, integer topology radius, and
one-to-four typed `tower_damage` modifier effects. The engine evaluates membership from the living
hero's authoritative `currentCoord` and tower anchors. Only immediate packets from live affected
towers receive the effects at the common `spatial` stage; DoT, status, hero/mission abilities,
range, fire rate, and adjacent mechanics are unchanged.

Snapshot v6 appears only for a non-null selected aura. It contains the v4 base, `skills` as the v5
projection or literal null, and authoritative aura activity plus binary-sorted affected tower IDs.
Renderers validate and display that set without recomputing gameplay. Aura state is derived from
already checkpointed hero/tower/outcome data, so nested checkpoint v3/v4 remains unchanged. Null
aura definitions keep literal snapshot v4/v5 behavior.

The shared finite-damage preflight follows canonical meta → run → spatial ordering and covers
direct construction, campaign preparation/loadout, artifact socket preflight, and checkpoint
restore. It is capability-aware and exits for no-aura projects, preserving old Roguelite timing.
Mechanics Hub performs explicit all-definition v5→v6 null promotion; MCP guide v26 and the inert
`basic_passive_hero_aura` recipe use guarded preview/apply. GameCommand/Journal v6, events, outer
checkpoint v1, project v3, PlayerProfile v3, CampaignRun v1, and TowerScript v6 do not change. See
[ADR 0042](adr/0042-opt-in-passive-hero-damage-aura.md) and
`docs/examples/opt-in-hero-roster/mechanics-passive-aura.json`.

### R5.6A dynamic hero blocking

Heroes v7 retains the complete v6 definition and adds required nullable `blocking`. A non-null
value has a safe-integer `blockCapacity` from 1 through 64 and one-to-32 unique, binary-sorted
`movementProfileIds`. These IDs are explicit references into the same mission's selected, enabled
Navigation v1 `dynamic_flow` profile. Structural checks always fail closed; broken cross-capability
references are activation errors only on the selected active path and warnings otherwise. Neither
the engine nor authoring surfaces infer eligibility from profile names, terrain mode, enemy class,
or tower-occupancy policy.

The living selected hero blocks at its authoritative `currentCoord`; interpolation remains a
presentation detail. At each enemy movement boundary the engine derives up to the authored
capacity of eligible co-located enemies in binary ID order. An exact-boundary arrival can take a
free slot before consuming remaining movement or leaking at the core. Overflow continues normally.
The hero is never inserted into flow-field occupancy, so blocking does not dirty or rebuild a
resolver, alter reachability or placement, or run per-enemy pathfinding.

Only non-null active blocking publishes snapshot v7 with nullable skills/aura and an authoritative
`blocking:{blockCapacity,active,blockedEnemyIds}` section. Null blocking retains literal snapshot
v4/v5/v6 and nested checkpoint v3/v4 forms; held IDs are derived after restore, so no checkpoint
field is added. Mechanics Hub performs an explicit module-wide v6→v7 null promotion. MCP guide v27
and the inert `basic_dynamic_hero_blocking` recipe use guarded preview/apply and never enable or
select Navigation. GameCommand/Journal v6, events, outer checkpoint v1, project v3, profile v3,
CampaignRun v1, and TowerScript v6 remain unchanged. See
[ADR 0043](adr/0043-opt-in-dynamic-hero-blocking.md) and
`docs/examples/opt-in-hero-roster/mechanics-blocking.json`.

### R5.7A Logistics power grid

Logistics v1 is an independent opt-in module with required nullable `power`. `null`, missing,
disabled, and unselected profiles preserve infinite legacy supply and add no snapshot or UI. A
non-null closed profile assigns disjoint tower types to generators, relays, and fire-capable
consumers. It does not add fields to ordinary tower or mission forms and does not imply ammo,
inventory, factories, production, or transfer.

The pure engine owns footprint-edge link distance, deterministic connected components, nearest-node
consumer coverage, and full-demand prefix allocation by ascending priority then binary tower ID.
An unpowered consumer freezes its exact cooldown and cannot acquire a target, fire, run a pipeline,
or keep a pulse field active. Generator and relay attack/support behavior remains independent.
Only towers with absent HP or positive HP are live power participants.

The derived graph rebuilds only after placement, movement, sale, destruction, or checkpoint restore.
It is bounded to 4,096 live participants, 1,024 generator/relay nodes, and 65,536 undirected links;
candidate placement, movement, and restore perform bounded preflight before mutation. Graph state is
not checkpointed. Restore derives it from the existing tower state while retaining runtime tower
order, so continuous and checkpoint/replay suffixes produce the same digest.

Optional `snapshot.logistics` v1 is authoritative for components, node links, consumer coverage,
and powered/brownout state. The shared fail-closed renderer projector validates the complete bounded
relationship graph; Studio Playtest and generated Canvas/Phaser players display the same visible
link and coverage cues without recalculating topology. Mechanics Hub, CLI, and MCP use the inert
`basic_power_grid` recipe and existing revision/validation/backup/rollback transaction. Future v2+
content is opaque/read-only. Commands, events, journal v6, outer checkpoint v1, project v3, profile
v3, CampaignRun v1, and TowerScript v6 do not change. See
[ADR 0044](adr/0044-opt-in-logistics-power-grid.md) and
`docs/examples/opt-in-logistics-power/`.

### R5.8A Local ammunition

R5.8A advances only the opt-in `logistics` module to v2. Its profile is the exact closed
`{power,ammunition}` pair with both fields required and nullable. V1 is read without migration;
adding ammunition is an explicit revision-guarded promotion that preserves the current power
section. Missing, disabled, unselected, `ammunition:null`, and all-null profiles allocate no
magazine, checkpoint section, snapshot, or UI and retain infinite legacy ammunition.

The ammunition catalog owns at most 256 exact `{label}` definitions and 4,096 tower-type bindings.
Each binding is exact `{ammoTypeId,capacity,startingAmount,consumptionPerActivation}` and may target
only an existing fire-capable attack kind. IDs and labels are limited to 128 UTF-8 bytes; amounts
are safe integers bounded by capacity and 1,000,000,000. Active reference faults are errors,
inactive faults are warnings, and structural or budget faults always fail closed.

The firing order is fixed as `disabled → power → ammunition → cooldown → target → consume →
effects`. Consumption is atomic once per successful single, pulse, sniper, antiair, splash, or
pipeline activation; target fan-out and secondary effects do not spend additional rounds. No
target spends nothing. Depletion freezes the precise cooldown and suppresses targeting, firing
events, damage, status, displacement, resources, and pulse refresh. Move and upgrade preserve the
live amount; sell, destruction, and reset remove it. There is no refill path in this slice.

Mutable amounts use nested Logistics checkpoint v1 without changing the outer checkpoint, engine,
command, journal, RNG, TowerScript, profile, or campaign versions. Snapshot v2 exposes independent
nullable power and ammunition sections; inventory rows are complete, detached, binary-sorted, and
include authoritative `hasRequiredAmmo`. The shared renderer projector validates that shape and
Canvas, Phaser, and Studio Playtest show only amount/capacity and depletion cues. MCP and Mechanics
Hub use the inert `basic_local_ammunition` recipe plus the existing preview/revision/validation/
backup/rollback workflow. See [ADR 0045](adr/0045-opt-in-local-ammunition.md) and
`docs/examples/opt-in-local-ammunition/`.

### R5.8B Ammunition supply

R5.8B advances only `logistics` to v3 with an exact required nullable `supply` sibling. Non-null
supply requires the same profile's non-null ammunition catalog and adds exact production recipes,
producer compartments, and storage compartments on existing tower types. Reading v1/v2 never
migrates them; Studio/MCP explicitly promote the whole profile while preserving power/ammunition.
Missing, disabled, unselected, all-null, and `supply:null` paths retain their literal earlier state.

The pure engine builds a bounded directed graph over live instances using topology distance minus
both footprint radii. Producers connect to every in-range matching consumer/storage; storage
connects to every in-range matching consumer even when a producer reaches the same target;
same-instance compartment refill is allowed. Each recipe batch must fit every producer bound to it.
Sources execute by binary tower ID and serve consumers before storage, then shorter edges, then
binary destination ID. Production runs before one detached transfer plan, while ordinary attacks
run after its atomic publish. Incoming stock cannot be forwarded and outgoing stock cannot free
incoming headroom during the same tick.

Power consumers use authoritative allocation; brownout and disruption freeze production/outgoing
transfer but do not block passive receipt. Refill never resets cooldown, so a ready tower reaching
its activation cost may fire in that tick through the unchanged R5.8A gate. Whole production
batches, partial bounded transfer, removal semantics, and placement/move/checkpoint topology
preflight preserve stock conservation and deterministic replay.

Mutable producer/storage stock and progress use nested Logistics checkpoint v2. Derived edges are
rebuilt. Snapshot v3 publishes detached producer/storage state, transfer configuration,
powered/operational cues, and directed edges including tower/type identities. The shared renderer
strictly validates this shape and exposes only presentation data; it does not route stock. Mechanics
Hub, CLI, and MCP use the inert `basic_factory_ammunition_supply` recipe and the existing guarded
transaction. No command, event, TowerScript action, raw material, conveyor, loot, campaign/profile
carry, or host-side refill API is added. See [ADR 0046](adr/0046-opt-in-ammunition-supply.md) and
`docs/examples/opt-in-ammunition-supply/`.

### R7 Director and Generative Studio

Director v1 is a closed opt-in profile over authored counters, budget, and fairness. Before an
unstarted wave, engine-owned analysis exposes bounded damage-share, coverage, movement-layer, and
Logistics-brownout metrics. Every condition on a candidate must match. The pure policy then applies
budget/group/enemy/consecutive-use caps and orders remaining counters by descending authored
priority, descending greatest matched-condition severity, and binary ascending ID. Threat cost is
an eligibility constraint rather than a tie-break. The selected groups exist only in a detached
wave plan; source content remains immutable. Snapshot history and `directorDecision` are optional,
bounded, and authoritative for Canvas/Phaser presentation. No active selection means no Director
state, event, UI, or RNG work.

The auto-balancer has a pure ranking contract in the engine and a bounded Node worker pool in the
CLI layer. Workers evaluate the explicit seed × strategy × candidate matrix, support cooperative
`AbortSignal` cancellation, and cache only completed results under a digest of content, engine, and
request. A cancelled run exposes no partial proposal ranking. Every result is evidence-only; a
human or agent must separately preview and revision-guard a balance patch.

`MapGenerationSpecV1` is the closed boundary between a prompt-capable author/agent and the pure
seeded generator. Square/cardinal and hex/odd-r candidates reuse the shared topology, then return
source plus reachability, entrance/materialized-loop, buildable-ratio, declared terrain IDs, and balance
smoke evidence. MCP preview writes neither source nor compiled maps. Generated images use a separate
provider-neutral lifecycle below `.towerforge/generated-assets`: signature/MIME, size, license,
provenance, real-file, symlink, path, and revision checks happen before explicit import; successful
commit discards the handle and failed validation rolls back owned writes. Secrets and prompts are
not staged or authored. See [ADR 0048](adr/0048-opt-in-director-and-generative-studio.md) and
`docs/examples/opt-in-adaptive-director/`.

### R8 Multiplayer protocol and local transport

`@towerforge/engine/multiplayer` is independently imported from the root engine. Local co-op v1
owns one `TowerDefenseGame`, fixed tick, sorted players, per-player sequence, tower ownership, match
journal, checksum timeline, and stable `tf-match-v1` checksum. Exact envelopes wrap an existing
parsed `GameCommand`; player/tick/transport concerns never enter the command schema. `MatchSession`
rejects malformed, duplicate, out-of-order, foreign, wrong-tick, client-tick, and owner-only
violations before mutation, and deterministic journal replay checks every recorded checksum.
Resources and routes are independently authored as shared or partitioned. Partitioned commands use
the author's wallet, fixed-tick resource deltas update every wallet deterministically, and sorted
authored routes are assigned round-robin to sorted players. The engine-owned wallets and route
ownership are part of match snapshots/checksums/replay; Studio and renderers never reconstruct them.

Multiplayer schema v2 independently selects `asymmetric_send_vs_build` for exactly two partitioned
lanes. The authored `sendPool` specifies cost, income, enemy, spawn delay, and an optional route ID
validated against every mission using the profile. A send constructs and validates both lane
checkpoints before publishing either, so cost/income/spawn is
atomic and a rejected send changes neither lane. It has its own checksummed journal/replay and does
not broaden local co-op v1. Module schema v2 is nevertheless a storage-compatible superset: saved
local profiles remain valid beside asymmetric profiles and keep their local semantics unchanged.

Offline challenges bind their seed, journal, expected match checksum, and `tf-challenge-v1`
checksum. Reconnect replays the bounded accepted journal and verifies its current checkpoint;
desync diagnostics identify the first unequal or missing fixed-tick checksum without repair.
Capability handshake compares protocol, engine, match, content digest, mode, and exact capability
list. The in-memory pair sends detached FIFO frames. The WebSocket adapter accepts an injected
WebSocket-like port and canonical-JSON encodes frames without importing or constructing a network
runtime.

Builds copy the multiplayer entrypoint and expose the player hook only when a supported enabled
profile is selected by a mission. Canvas, Phaser, PWA, and single-file use this same conditional
boundary; ordinary single-player output omits `engine/multiplayer`. Hosted identity, auth, lobbies,
matchmaking, NAT traversal, and a managed relay are intentionally absent. See
[ADR 0049](adr/0049-opt-in-multiplayer-protocol.md) and
`docs/examples/opt-in-local-multiplayer/`.

### R10 Persona QA and Procedural Quests foundation

R10 has two independent contracts. Persona QA is authoring analysis and does not require a
mechanics profile. The pure engine owns the fixed `aggressive_rush`, `greedy_economy`, and
`turtle_shield` policies; they issue only existing `GameCommandV6` commands and return detached
mission × seed × persona evidence with a stable final digest. Request dimensions and relevant
content records are binary-canonicalized before work. The existing balance sweep is unchanged.

`packages/cli/lib/persona-qa-worker.mjs` lifts that pure runner into bounded Node workers. The pool
accepts at most eight workers, enforces a 180-second task timeout, supports cooperative
cancellation, and returns byte-equivalent completed reports across concurrency settings. Completed
evidence may be cached privately at `.towerforge/cache/persona-qa/v1/<requestDigest>.json`; the key
includes the content digest, engine version, and canonical request. The cache is bounded to 16 MiB,
uses private directory/file modes, rejects confinement or symlink escapes, and ignores malformed or
future envelopes. Cancellation returns no partial findings and writes no cache entry. Every worker
rechecks engine/content identity before accepting work, and the pure runner rejects selected maps
above 65,536 cells before constructing a simulation. The public `persona-qa` CLI command,
read-only Studio QA Lab and compute-only MCP tool reuse this boundary without a write/auto-fix path.

Procedural quests are gameplay and therefore use the separate mission-selected `quests` v1 module.
Its closed profile chooses up to three weighted definitions from at most 256 through seeded sampling
without replacement. Selection uses a quest-domain-separated RNG and sorted IDs, so it neither
advances the main simulation RNG nor depends on source-record order. V1 supports exact
`kill_with_source` attribution for `tower | ability | tower_script | status | reaction`, and
`preserve_shield` over `tower | hero | any`.

Only an active supported profile adds the exact optional `quests` snapshot/checkpoint section and
typed `questCompleted`/`questFailed` events. Kill progress is credited only when an exact
`DamagePacket.source` produces the positive-HP-to-zero transition. Shield preservation fails once
only when an eligible tower or hero shield crosses from positive to zero; partial loss and enemy
shields are irrelevant. Wave clears advance surviving shield objectives. Checkpoint restore
recomputes the expected selection from the checkpoint's original RNG identity plus mission ID and
rejects mismatched profile, order, labels, kinds, targets, duplicates, impossible progress, and
future forms before adopting state.

The quest section is an inner schema v1 while outer `GameCheckpointV1`, `towerforge-sim-v2`,
`GameCommand`/journal v6, project v3, profile, campaign, TowerScript, renderer/player, and
multiplayer versions remain unchanged. Absent, disabled, or unselected quests add no snapshot,
checkpoint, event, UI, RNG movement, or digest change. Quests are secondary battle-local evidence:
they do not change primary victory/defeat, grant rewards, or persist into profile, campaign, or
multiplayer state. Mechanics Hub, MCP/AI, Studio Playtest, Canvas/Phaser players and generated
packages use the common guarded authoring and active-only projection contracts; see Accepted
[ADR 0051](adr/0051-r10-persona-qa-and-procedural-quests.md).

### R11 Procedural Juice presentation

Visuals schema v3 optionally stores `proceduralJuice` schema v1 with 64-entry particle, audio, and
camera catalogs plus at most 128 event bindings. The exact emitter describes at most 256 particles
through lifetime, speed, angle, size, color, gravity, and blend-mode values. The exact audio cue is
one oscillator/noise voice whose pitch may vary only from bounded damage, authored attack-speed,
target-size, and seeded-jitter coefficients. A camera cue combines normalized shake and chromatic
intensity with presentation-only hit-stop duration/time scale. Bindings may layer at most 16 IDs of
each cue kind and filter only by supported event, mission IDs, and enemy type IDs.

`packages/renderer` owns a fail-closed pure planner. It receives the optional catalog, project
content, previous/current authoritative snapshots, integer presentation time, and user motion
preference. Event coordinates win anchor selection; current entity coordinates, then previous
entity coordinates, then declared spawn/core fallbacks follow. Record inputs are binary ordered,
engine events keep their order, and `tf-juice-rng-v1` binds the visual catalog digest plus event and
cue identity. Particle position is evaluated from absolute age, so Canvas/Phaser frame cadence does
not alter the plan. Runtime ceilings include 64 source events, 2,048 live particles, and 32 new
audio voices per frame and 32 simultaneously live procedural Web Audio sources; overflow drops
later presentation work deterministically and ended/suspended sources are disconnected.

The Canvas and Phaser adapters rasterize the same particle/camera instructions. The Web Audio
adapter schedules the same voice instructions only after a user gesture and honors mute/suspend.
Reduced motion disables hit stop and chromatic separation and clamps shake/particle density;
motion-off returns neutral visual instructions. Hit stop never changes simulation delta, fixed
match tick, command order, cooldown, replay, or checksum. An explicitly bound asset SFX wins first,
a matching procedural cue is second, and the hardcoded synth is the final fallback; the complete
legacy asset/synth path remains literal when the block is absent.

Studio owns a separate Juice visual-authoring workspace and synthetic-event preview. MCP/AI owns
descriptor-driven read, inert recipes, compute-only event preview, and one narrow combined
project+visuals revision preview/apply transaction with validation, backup, atomic write, and
rollback. Neither surface may execute authored code or silently add the optional block. First
authoring promotes the manifest and visuals document to the already-defined project/visuals v3;
R11 introduces no further mechanics, engine, snapshot, checkpoint, command/journal, TowerScript,
profile, campaign, or multiplayer version. The proposed contract is
[ADR 0052](adr/0052-opt-in-procedural-juice-presentation.md).

## Done Criteria For Constructor Changes

- Engine changes pass `npm run typecheck`.
- Project-loader or runtime export changes pass `npm run build:engine`.
- Content/schema changes pass `npm run validate`.
- Simulation-affecting changes pass `npm run sim tutorial_01 60`.
- Shared engine/CLI/MCP/renderer changes pass `npm run test`.
- Build/player changes pass `npm run build` and browser smoke verification.
- Studio/player UI changes pass `npm run test:e2e`.
- Desktop shell changes pass `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` and the relevant platform build.
- Documentation is updated when commands, project format, or boundaries change.
