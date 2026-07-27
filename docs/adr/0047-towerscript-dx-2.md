# ADR 0047: TowerScript DX 2.0 is an opt-in authoring and debug surface

- Status: Accepted
- Date: 2026-07-28

## Context

TowerScript is already the canonical deterministic JSON language for project-specific gameplay. The engine validates versioned definitions, executes event/binding/handler/action chains under strict budgets, includes authoritative script state in checkpoints, and exposes bounded runtime diagnostics. Studio currently edits the raw JSON source and Playtest exposes only a general event timeline plus a fixed-size tick button. MCP exposes the schema descriptor and guarded script reads/writes, but neither surface can explain a script execution, move through it at meaningful boundaries, or edit it visually.

R6 adds structured tracing, step debugging, rewind, a Visual Graph, and schema-driven completion. These are developer tools, not gameplay. They must not become a mission mechanic, alter a project merely because Studio opened it, add debug state to ordinary snapshots or checkpoints, or change the digest of a simulation that is not being debugged.

The existing deterministic foundations are deliberately reused:

- `GameCheckpointV1` captures complete authoritative TowerScript state, timers, cursors, budgets, diagnostics, RNG, engine compatibility, and the simulation-content digest.
- `GameCommand` includes ticks and every public deterministic player command.
- command journals and replay validate results and post-state digests through the one engine runtime.
- `TOWER_SCRIPT_SCHEMA` is the engine-owned descriptor for scopes, events, event fields, expressions, actions, targets, diagnostics, and limits.
- Studio and MCP already have confined script paths, revision guards, validation, backups, and rollback.

## Decision

### Product and version boundaries

TowerScript DX 2.0 is an explicit authoring/debug capability of Studio, CLI/MCP, and the pure engine API. It is not a `content/mechanics.json` module and is never selected through `mission.mechanics`. It does not advance the project schema, mechanics catalog, player profile, campaign run, multiplayer protocol, `GameCommand`, command journal, or outer checkpoint schema merely by existing.

Ordinary simulation keeps its current path. Trace collection and debug replay begin only when a caller explicitly creates a debug transaction/session. No trace, cursor, graph, layout, breakpoint, or ring state is added to `GameSnapshot`, `GameCheckpointV1`, gameplay events, `scriptState`, state digests, generated players, or packaged `.tdproj` content.

R6 is delivered in four ordered vertical increments. Each increment begins with failing contracts and closes the relevant engine, Studio, MCP/AI, packaging, documentation, legacy-path, and independent-verification surfaces before the next increment is accepted.

### R6A: Structured TowerScript trace

The engine adds a versioned, detached, bounded `TowerScriptTraceV1` debug result. Its ordered records represent the runtime chain:

`engine event -> script binding/context -> handler -> condition -> action -> script-state diff or diagnostic`.

Every record has a monotonically increasing session-local sequence, a stable phase ordinal, stable action ordinal where applicable, and explicit parent references. Trace identities use canonical runtime facts: event ordinal, script ID, authored binding index, bound scope/object key, event name, handler ID or authored index, and authored action index. Traces follow actual engine execution order; they do not invent a second scheduler or re-sort handlers/actions for presentation.

The trace reports at least:

- the engine event type and a detached bounded event view;
- the matched script, binding, scope, bound object, and script-state key;
- skipped or entered handlers, including `every` and condition outcomes;
- each attempted action, its authored payload, and changed TowerScript state keys;
- existing runtime diagnostics linked to the exact handler/action trace location;
- an inspection state digest for each replayed cursor and the authoritative live-tail digest for complete commands.

State diffs are limited to TowerScript binding state. The trace does not duplicate arbitrary full simulation states per action. A caller that needs the gameplay view at a cursor uses the R6B replay boundary.

Trace capture is injected through an engine-internal observer used by the public debug executor. The observer never becomes a host callback available to authored TowerScript and cannot expose filesystem, DOM, network, clock, environment, renderer, or arbitrary JavaScript access. With no observer, the runtime takes the existing branch, allocates no retained trace collection, and produces byte-identical snapshots, checkpoints, events, journals, and state digests.

Trace limits cap retained records and canonical UTF-8 bytes. Deterministic prefix eviction is reported through `droppedEntries` while absolute sequences and phase/action ordinals remain stable. Trace retention never injects a gameplay `scriptDiagnostic`, mutates the simulation, or conceals a pre-existing gameplay diagnostic.

Studio Playtest gets a structured TowerScript trace panel separate from the existing general event timeline. MCP receives a compute-only, bounded trace operation and the same trace descriptor. Neither surface persists trace data in the project.

### R6B: Deterministic replay-to-cursor and bounded rewind

The pure engine adds a debug replay API over one validated command journal, a target command sequence, and a trace cursor. Ticks remain normal versioned tick commands. The API validates the complete journal before execution, restores its initial checkpoint through `TowerDefenseGame.fromCheckpoint`, replays the prefix before the target through the shared command replay boundary, and executes the target `GameCommand` through the shared command executor and TowerScript runtime. A validated pre-transaction checkpoint cached by the debugger may accelerate the same operation, but it is bound to the journal content/sequence and cannot replace journal validation or change the result. The API may stop the target transaction at a trace cursor for inspection. It must not implement a second interpreter, expression evaluator, action executor, or simulation model.

Supported step modes are:

- `tick`: one complete tick command boundary;
- `event`: one traced engine-event boundary;
- `handler`: one entered TowerScript handler boundary;
- `action`: one attempted TowerScript action boundary.

Action, handler, and event views are produced by replaying from the command checkpoint to the requested cursor. A partial debug frame is inspection-only: it cannot be resumed as a live game, exported as a checkpoint, used as a journal entry, or recorded as a journal post-state digest. Reaching the complete command boundary must produce the same normalized result, final checkpoint/state digest, trace, and snapshot as uninterrupted execution.

Internal cursor stops are control flow, not TowerScript failures. They must bypass normal handler exception-to-diagnostic conversion and must not consume a gameplay budget differently from uninterrupted execution.

Studio routes debug-enabled Playtest input through a journaled session and owns a bounded in-memory tick history built from valid `GameCheckpointV1` entries paired with their exact journal positions. The engine provides the bounded ring and restore operations, while Studio selects its entry capacity within engine limits. Old entries are evicted deterministically. Per-command replay checkpoints are retained only while their trace entries remain in the bounded trace; command metadata remains under the existing journal limits. Rewinding N ticks restores through the normal checkpoint validator, reconstructs the retained journal prefix, discards the abandoned future, and never dispatches `gameStarted` again.

Journal schema/version and ordering, checkpoint schema version, engine version, simulation-content digest, command shape, recorded results/post-state digests, and checkpoint state digest are revalidated before debug execution or rewind. Future/incompatible/malformed/accessor-bearing/over-budget inputs fail before map construction or command execution. Content edited after a checkpoint was recorded invalidates that debug history rather than attempting migration.

Studio uses this API for the four step modes and rewind controls. Step pins Playtest speed at zero until the explicit Resume control restores the prior live speed. MCP exposes compute-only replay/trace inspection with closed limits; it does not create a remote long-lived mutable simulation or accept an unconfined checkpoint path.

### R6C: Canonical AST and lossless Visual Graph

The TowerScript JSON definition remains the only gameplay source of truth. Visual Graph is a deterministic projection of that canonical AST, not a second language and not a separately compiled gameplay format.

The engine scripting package provides pure projection and materialization helpers. A projection contains typed visual nodes/edges plus stable AST locations and retains the detached canonical source needed for exact reconstruction. Studio applies descriptor-driven typed edits to a detached AST and reprojects it before preview; Studio and MCP save the materialized candidate definition, never a graph-specific gameplay document.

Recognized bindings, handlers, conditions, and actions receive typed visual nodes. An unrecognized future action is represented as a raw node containing detached strict JSON and its exact AST location; unknown root/handler fields remain inside their detached canonical node payloads. Projection followed by materialization without edits must be byte-semantically lossless under canonical JSON serialization, including unknown fields and raw actions.

Raw future nodes are preserved but not silently interpreted. If the current engine cannot validate the resulting canonical definition, the combined graph save stays disabled and reports the validation issues. The editor never downgrades a future schema, drops raw data, replaces an unknown node with a guessed current node, or writes an invalid graph.

Node layout is local editor state under:

`.towerforge/towerscript-layouts/`

The layout codec is independently versioned, bounded, descriptor-safe, symlink-safe, and confined to the active project. It stores only presentation data such as positions, collapsed groups, viewport, and stable node references. It is ignored by git, excluded from project packs/builds/players/plugin project content, absent from project hashes that represent gameplay, and never loaded by the simulation engine.

Graph save uses a dedicated preview/apply transaction:

1. capture the exact source revision, scripts-catalog revision, layout revision, and candidate AST/layout;
2. project/materialize and prove semantic round-trip;
3. validate the candidate script and full project without writing;
4. return a guarded preview token/revisions and bounded diagnostics;
5. on apply, recheck the composite revision immediately before writes, stage the local layout, write the canonical `.tower.json` through the existing atomic script writer, and validate again;
6. on conflict, exception, or failed validation, roll back script and layout independently behind their exact post-write revisions. A layout or script failure cannot leave a partial combined save or overwrite a concurrent external edit.

Studio uses this transaction for Visual Graph. MCP/AI keeps canonical AST authoring through `get_tower_script` and guarded `upsert_tower_script`, and exposes granular graph read/preview/apply parity; no broad generic `.towerforge` write tool is exposed.

### R6D: Descriptor-generated completion and integrated help

Engine schema descriptors are the sole completion/help source. The TowerScript descriptor is extended with the exact supported schema versions, closed field shapes, version gates, event fields, expression roots/operators, target compatibility, action fields, limits, diagnostics, and debug/graph contracts needed by clients.

Studio Visual Graph palettes/property editors, inline help, and MCP `describe_schema({domain:"scripts"})` consume this descriptor. They must not maintain handwritten action/event lists that can drift from engine validation. New TowerScript events/actions added after R6 update the engine types, validator, descriptor, descriptor contracts, generated Studio palette/help, agent instructions, and plugin runtime in the same increment.

The shared agent guide documents the safe flow:

`describe scripts -> read canonical AST -> project/preview if needed -> guarded apply -> validate -> compute-only trace/debug`.

MCP write operations retain `riskClass`, `sideEffect`, revision, validation, backup, and rollback metadata. Debug and projection operations are read-only/compute-only. The MCP transport protocol version changes only if its transport contract changes; TowerScript debug, graph, and descriptor documents keep their own explicit versions.

## Public contracts and package boundaries

The intended pure-engine contracts are:

- `TowerScriptTraceSnapshotV1`, `TowerScriptTraceEntryV1`, and stable phase/action ordinals;
- `TowerScriptDebugSession` with inspection-only replay-to-cursor results;
- a bounded tick checkpoint ring contract;
- `TowerScriptGraphV1`, raw graph nodes, and lossless AST projection/materialization;
- expanded `TOWER_SCRIPT_SCHEMA` debug, graph, completion, and limit descriptors.

Exact naming may be refined before the first RED contract, but the ownership boundaries are fixed:

- `packages/engine/src/scripting/` owns trace, cursor, graph projection/edit types, codecs, limits, and schema descriptors;
- `packages/engine/src/simulation/` owns checkpoint validation, command replay integration, debug transaction execution, and bounded checkpoint history;
- `packages/cli/lib/` owns confined `.towerforge/towerscript-layouts` filesystem persistence and reuses existing script/project validation and atomic writes;
- `packages/studio/` owns graph and debugger presentation, browser session history, and guarded HTTP facades;
- `packages/mcp/` owns transport-agnostic read/preview/apply tools and generated agent guidance;
- renderers continue to consume ordinary snapshots only and never interpret TowerScript, trace, graph, or layout data.

Generated desktop and Codex plugin runtimes remain mirrors built from these canonical sources. They do not acquire independent R6 implementations.

## Excluded scope

R6 does not include:

- new TowerScript gameplay actions, events, scopes, host APIs, JavaScript/Lua execution, `eval`, package imports, shell, filesystem, network, clock, or unseeded randomness;
- mission mechanics, automatic enabling, project/profile/campaign migrations, or new mandatory UI in generated games;
- breakpoints persisted in gameplay JSON;
- a second graph language, graph bytecode, or renderer-owned script execution;
- continuation of a partially executed tick as authoritative gameplay state;
- hosted trace storage, collaborative graph editing, remote mutable debug sessions, telemetry upload, or multiplayer debugging;
- checkpoint/journal format changes unless an independently reviewed incompatibility proves unavoidable;
- arbitrary `.towerforge` reads/writes through the generic project tree or MCP.

## Acceptance and TDD gates

Every R6 increment must preserve an explicit RED record before implementation and cover malformed, future-version, stale-revision, rollback, budget, descriptor, and security cases.

Engine acceptance includes:

- tracing disabled versus enabled reaches byte-identical ordinary snapshots, checkpoints, events, journals, and state digests;
- trace ordering exactly matches execution for condition false/true, timer skip, multiple bindings, nested signals, action rejection, budget exhaustion, and runtime diagnostics;
- complete replay-to-cursor equals uninterrupted execution for every step mode on hex and square grids;
- debug dispatch stays journal-equivalent to uninterrupted command execution, while cursor frames never replace the live game;
- partial cursors cannot escape as resumable games/checkpoints/journal entries;
- checkpoint/content/engine mismatch and hostile strict-JSON shapes fail before execution;
- ring count eviction, bounded replay-checkpoint retention, and rewind are deterministic, and rewound suffix replay reaches the original digest;
- graph projection/materialization is lossless for supported ASTs and raw unknown/future nodes;
- invalid graph edits never write gameplay source.

Constructor integration acceptance includes:

- Studio raw JSON and Visual Graph edit -> preview -> save -> reload -> switch views without semantic drift;
- graph disable/close leaves the existing raw editor and legacy project byte path unchanged;
- layout survives Studio reload but is absent from project packs, PWA, single-file, web packages, `.tdpack`, generated players, and gameplay hashes;
- Studio debugger supports tick/event/handler/action stepping and bounded rewind without replacing the live game with a partial frame;
- MCP/AI follows describe -> read -> preview -> guarded apply -> validate, rejects stale revisions, and exposes equivalent descriptor/trace results;
- unknown future nodes remain visible/raw and cannot be accidentally committed as a downgraded current script;
- Canvas and Phaser on hex and square continue to render the same ordinary snapshots; no renderer forks debug semantics;
- starter projects without scripts and existing scripts without R6 use remain unchanged.

Required gates for affected layers are:

- `npm run typecheck`
- `npm run build:engine`
- `npm run test`
- `npm run validate`
- `npm run sim tutorial_01 60`
- `npm run build`
- `npm run test:e2e`
- `npm run plugin:build`
- `npm run plugin:validate`
- `npm run plugin:smoke`

Each increment requires independent Code Verifier and Constructor Integration Verifier sign-off. R6 is accepted only after Studio, MCP/AI, generated runtime mirrors, documentation, package/build coverage, and the disabled legacy path are green.

## Acceptance record

Accepted on 2026-07-28 after the RED contracts for trace ordering, replay cursors, bounded retention,
lossless graph materialization, guarded graph/layout transactions, descriptor parity, and Studio authoring
were made GREEN. Final focused verification covers 101 engine journal/trace/graph/debugger contracts and 39
CLI/MCP/Studio contracts; the full unit gate is 239 files and 2,876/2,876 tests. Studio graph/debugger
Playwright coverage is 2/2; independent packaging and renderer conformance is 23/23. Typecheck, engine build, project validation, tutorial simulation, balance,
map compile, web build, plugin build/validation/smoke, and diff checks pass. Independent Code Verifier and
Constructor Integration Verifier sign-offs are both APPROVED with no P0-P2 findings.

The accepted hot path uses exact incremental canonical UTF-8 byte/node accounting for journal appends and a
monotonic replay-checkpoint pruning cursor. Complete journal serialization remains an explicit export/decode
operation; retained trace, replay checkpoints, and the tick checkpoint ring remain independently bounded.

## Consequences

- Authors can inspect and visually edit TowerScript without replacing its deterministic JSON contract.
- Debugging reuses checkpoints, commands, and the actual engine runtime, so a debugger cannot quietly diverge into a different simulation.
- Ordinary games pay no persistent-state or compatibility cost for an unused developer tool.
- Future TowerScript syntax remains recoverable in older Studio versions even when it cannot be validated or executed there.
- Local graph ergonomics may evolve through the layout codec without changing portable gameplay content.
- Engine descriptors become a stronger compatibility surface and must evolve atomically with every future TowerScript language change.
