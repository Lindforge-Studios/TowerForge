# ADR 0050: TowerScript DX 3.0 Behavior Trees and HFSM

- Status: Accepted
- Date: 2026-07-29
- Milestone: R9

## Context

TowerScript v1-v6 can react to typed engine events, but tower target selection and long-lived
hierarchical phases still require engine-authored behavior. R9 must expose those decisions as
deterministic, bounded JSON without turning them into mandatory mission mechanics, adding arbitrary
code, or changing the byte shape and hot path of legacy projects.

## Decision

TowerScript schema v7 is the sole opt-in boundary. A v7 script may independently define
`behaviorTrees` and `stateMachines`; no `content/mechanics.json` entry or mission selection is
created. Scripts v1-v6, and v7 scripts without either controller, retain ordinary targeting,
snapshot, checkpoint, replay, UI, and packaging behavior.

### Behavior Tree v1

- A tree owns a stable ID, one or more tower-only bindings, and a root composed exclusively from
  stable-ID `selector`, `sequence`, `condition`, and `action` nodes.
- Evaluation is synchronous and returns only `success | failure`. `selector` stops at the first
  successful child; `sequence` stops at the first failed child. `Running`, waits, hidden clocks,
  randomness, host APIs, and user code are excluded.
- A condition evaluates the existing bounded TowerScript expression language either once against
  `context` or against `any_candidate`. The detached expression roots are `tower`, `game`, `state`,
  `candidates`, and the current `candidate`. Candidate data includes HP ratio, tags, shield,
  statuses, marks, exposures, distance, and route progress.
- The only v1 action is `select_targets`, with an optional expression filter and an existing target
  mode such as `first`, `last`, `closest`, `furthest`, `strongest`, or `weakest`.
- The engine applies alive/class/range/LoS eligibility first, binary-sorts and bounds candidates,
  then evaluates the tree at the shared target-acquisition boundary. A failed, invalid, or
  over-budget evaluation falls back to the tower's saved target mode. An active binding presents
  `Scripted`; manual target-mode changes are rejected with a stable reason. Overlapping targeting
  bindings and bindings to support towers fail validation.

### HFSM v1

- A machine owns stable IDs, bindings in any existing TowerScript scope, an initial state, nested
  states, entry/exit actions, and ordered event transitions. Transition targets are absolute state
  paths beginning with `/`.
- For each machine/context/event, transition lookup walks from the active leaf to its ancestors and
  preserves authored transition order. At most one transition may fire. A self-transition performs
  the normal exit and entry sequence.
- Exit, transition, and entry phases use the existing typed TowerScript actions and the shared
  action/recursion limits plus a separate transition budget. Parallel regions, history, delayed
  transitions, hidden timers, and arbitrary code are excluded.
- The target leaf is committed before actions execute. If an action fails, the new state remains
  active, remaining transition actions stop, and a diagnostic is recorded. Every committed transition
  emits `stateMachineTransitioned` with script, machine, context, transition, and state-path
  provenance.
- Active state path, entered time, and transition count use inner schema v1. Entity-scoped runtime
  state is removed only after the owning entity's terminal death, destruction, or sale processing.

### Authoring and inspection

Graph, Trace, and Debugger advance independently to schema v2; local graph layout stays v1. Graph v2
adds behavior/controller, composite, machine, state, and transition nodes plus containment and
transition-target edges. The graph remains a lossless projection of the canonical TowerScript AST:
legacy Graph v1 remains accepted, target edges are derived/validated against absolute AST targets,
and unknown future nodes stay raw rather than being downgraded.

Trace v2 adds `behavior` and `transition` records with controller/node/state/action provenance.
Debugger v2 adds `behavior` and `transition` step modes but still uses the existing validated
checkpoint plus deterministic replay-to-cursor runtime; debug state never becomes gameplay state.

Studio and AI surfaces consume engine descriptors instead of owning controller semantics. JSON and
Graph saving retain the existing `preview -> revision-guarded apply -> validation ->
backup/rollback` transaction. MCP adds no broad writer. The canonical AI workflows are:

Studio computes missing layout-v1 positions in a presentation-only helper over Graph containment
edges. It preserves existing stable-ID layout records and places only new nodes in deterministic
authored order with collision avoidance. The helper does not enter the engine, canonical AST,
gameplay hash, build output, or read-only graph transaction.

- `describe_schema(scripts) -> get_tower_script -> upsert_tower_script(dryRun:true) ->
  upsert_tower_script(ifRevision) -> validate_project`;
- `describe_schema(scripts) -> get_tower_script_graph -> preview_tower_script_graph ->
  apply_tower_script_graph(ifRevision) -> validate_project -> preview_tower_script_trace`.

`preview_tower_script_trace` remains compute-only and accepts at most 128 exact versioned commands.
The reference opt-in fixture is `docs/examples/opt-in-towerscript-dx3/`.

## Version domains

- TowerScript: v7.
- Behavior Tree and HFSM documents: v1.
- Graph, Trace, and Debugger/cursor: v2.
- Local layout: v1.
- Optional checkpoint `scriptMachines` section: inner schema v1.
- Project v3, `GameCheckpointV1`, `towerforge-sim-v2`, `GameCommand`/journal v6, profile,
  campaign, mechanics, renderer/player, and multiplayer versions do not change.

Only an active HFSM adds optional machine runtime state. Removing or disabling controllers returns
targeting and presentation to the legacy path without synthesizing mechanics content.

## Security and compatibility

All R9 documents use closed own-data validation with bounded depth, count, bytes, and expression
work. Accessors, proxies, sparse arrays, cyclic input, malformed references, and unsupported future
controller versions fail closed. TowerScript remains data-only and cannot access `eval`,
`Function`, filesystem, network, DOM, modules, host credentials, wall clock, or unseeded randomness.
Renderers and Studio display engine-owned snapshots/traces and do not duplicate targeting or state
transition rules.

## Excluded scope

R10/R11, asynchronous behavior nodes, `Running`, waits, parallel/history states, delayed
transitions, new action families, arbitrary code, release/tagging, and automatic merge are outside
R9.

## Acceptance status

The four R9 RED/GREEN slices, the verifier-led transactional-selection and bounded hostile-input
repair slice, all repository gates named in the roadmap, legacy golden and package matrix checks,
visual collision audit, Rust/Tauri tests, and local macOS app/DMG verification are green. Final
Vitest is 3,028/3,028 across 263 files and sequential Playwright is 133/133. The independent Code
Verifier and Constructor Integration Verifier both report PASS with no open P0-P2 findings, so R9
is accepted.
