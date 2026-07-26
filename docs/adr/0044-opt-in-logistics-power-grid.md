# ADR 0044: Opt-in logistics power grid

Status: Accepted

Date: 2026-07-27

Roadmap: R5.7A

## Context

TowerForge currently treats every placed tower as having infinite infrastructure supply. R5.7A is
the first Logistics vertical slice: a developer may author generators, relays/pylons, and powered
consumers, while every project without that explicit mission selection must retain the exact legacy
attack, cooldown, checkpoint, player, and package behavior.

Power is intentionally separate from later ammunition, local inventories, storage, production,
factories, and item transfer. The current `TowerType.attack` field is mandatory, so a generator or
relay remains an ordinary authored tower and may still have its existing attack/support behavior.
Power roles must not rewrite the base tower schema or turn every tower into a consumer.

The engine already owns topology distance, live tower instances, firing cooldowns, placement/move/
sell/destruction lifecycle, checkpoints, stable digests, and optional snapshots. Studio, MCP, and
renderers therefore need an authoritative logistics projection rather than a second network solver.

## Decision

### Opt-in module and closed authoring schema

R5.7A makes stable module ID `logistics` executable at schema v1. Every v1 profile is the exact
closed own-data object `{ power }`, where `power` is required and nullable. `null` is the literal
opt-out and reserves later logistics versions for independent ammo/inventory/production fields.
A non-null power definition is:

```json
{
  "power": {
    "generators": {
      "power_plant": { "output": 20, "linkRadius": 4, "coverageRadius": 3 }
    },
    "relays": {
      "power_pylon": { "linkRadius": 5, "coverageRadius": 4 }
    },
    "consumers": {
      "arc_tower": { "demand": 8, "priority": 10 }
    }
  }
}
```

The three records are required, dense closed own-data records and are normalized in binary tower-
type ID order. A tower type may occur in exactly one role. Every referenced type must exist.
Generator/relay references may use any existing attack kind and remain independently operational;
consumer references must use a fire-capable attack kind (`single`, `pulse`, `sniper`, `antiair`,
`splash`, or `pipeline`). Passive `support` and `support_buff` consumers fail validation because
their effects do not pass through the firing loop in this slice.

Limits are shared by validation, runtime, descriptors, Studio, MCP, and recipes:

- IDs use the existing 1–128 UTF-8-byte mechanics identifier contract.
- Each role has at most 4,096 authored tower-type entries and all three records together have at
  most 4,096 entries.
- `output` and `demand` are finite positive numbers at most `1_000_000_000_000`.
- `linkRadius` and `coverageRadius` are finite non-negative integers at most 64.
- `priority` is a safe integer from 0 through 1,000,000; lower values are served first.
- A live mission has at most 4,096 power participants, including at most 1,024 generator/relay
  nodes. The materialized graph has at most 65,536 undirected node edges (131,072 directed snapshot
  link IDs). Placement or movement that would exceed any active bound is rejected before resource
  spend, coordinate/occupancy mutation, or events. Checkpoint restore rejects the same candidate
  before adopting tower state or building the graph.

Unknown fields, inherited fields, symbols, accessors, sparse/hostile containers, non-finite values,
unsafe integers, duplicate roles, and over-budget data fail closed. Structural checks apply even
when the module is disabled, the profile is unselected, or `power` is null. Broken tower references
and invalid consumer attack kinds are errors for the active selected profile and warnings for an
inactive/unselected profile.

Loading, validation, build, and play never synthesize Logistics. There is no implicit migration
from a legacy project. Studio/MCP writes use the existing guarded transaction. Unsupported future
Logistics v2+ remains opaque, lossless, and read-only; runtime fails closed instead of partially
executing only the v1-looking `power` field.

### Deterministic topology and components

Only live placed generator and relay instances are power nodes. Only live placed consumer instances
are power consumers. For two node towers A and B, the topology edge distance is:

```text
max(0, topology.distance(A.coord, B.coord)
       - A.type.footprintRadius - B.type.footprintRadius)
```

The undirected edge exists only when that distance is at most both nodes' authored `linkRadius`.
Connected components use deterministic traversal with binary-sorted node IDs. A component ID is
the binary-lowest live node tower ID in that component. Its supply is the finite sum of member
generator outputs; relays contribute zero.

Consumer coverage uses the same footprint edge-distance formula against a node and the node's
`coverageRadius`. A consumer covered by multiple nodes attaches to the smallest edge distance, then
the binary-lowest node tower ID. It belongs to that node's component. A consumer with no covering
node has nullable node/component IDs and is unpowered. No implicit wireless component merging is
performed through consumers.

Input record order, live tower array order, square/hex topology, renderer choice, and host locale do
not affect components, attachment, allocation, snapshot order, checkpoint suffix, replay, or digest.
The engine does not use RNG.

### Supply allocation and brownout

Within each component, attached consumers are ordered by ascending authored `priority` and then
binary tower instance ID. Allocation is all-or-nothing and prefix-stable: a consumer is powered only
when its complete demand fits the remaining supply. At the first insufficient consumer, that
consumer and every later consumer in the component are unpowered even if a later smaller demand
would fit. This keeps brownout priority explicit and independent of incidental demand packing.

Only a powered consumer may enter target selection or execute its attack kind. An unpowered
consumer freezes its exact `TowerState.cooldown`: the engine does not decrement it, clamp it, spend
it, acquire targets, emit `towerFired`, apply pipeline resources/status/damage/displacement, or
participate in an active pulse field. Enemy `disabledFor` remains a separate timer and continues to
use its existing semantics. A restored consumer resumes the ordinary cooldown/attack path; it fires
immediately only when its frozen cooldown was already ready (`<= 0`).

Generators and relays never require their own output and keep their authored attack/support behavior.
Non-consumer towers stay on the byte-compatible legacy firing branch. R5.7A does not alter tower
costs, upgrades, selling, damage, range, targeting, synergies, artifacts, hero auras, LoS, or
Navigation.

### Dirty rebuild and bounded work

The engine owns one derived network cache. It builds once for an active non-null profile and marks
it dirty only when live topology changes: successful placement, move, sell, destruction, or
checkpoint restore. A failed action, read, normal tick, tower upgrade, target change, wave change,
or renderer request does not rebuild it. Batched destruction publishes one stable post-mutation
network. Rebuild uses the existing map topology registry and finite live-participant bound; it does
not import DOM, Node, filesystem, Studio, renderer, or networking code.

The live bounds cap a rebuild at 523,776 node-pair comparisons and fewer than 4,194,304
node/consumer coverage comparisons. Edge counting aborts before materializing links beyond the
65,536-edge limit. The cache is derived and is never authoritative checkpoint state. Snapshot reads
return detached frozen data and must not mutate cooldowns, resources, events, RNG, occupancy, or
the digest.

### Snapshot, checkpoint, commands, and version domains

An active selected non-null power profile adds optional `snapshot.logistics` v1:

```text
{
  schemaVersion: 1,
  power: {
    components: [{ id, output, demand, allocated, nodeIds, consumerIds }],
    nodes: [{ towerId, towerTypeId, role, componentId, output,
              linkTowerIds, coveredConsumerIds }],
    consumers: [{ towerId, towerTypeId, demand, priority,
                  nodeId, componentId, powered }]
  }
}
```

All arrays are dense, unique, bounded, and binary sorted. `role` is `generator | relay`; relay
output is zero. `demand` is total attached demand, while `allocated` is the sum of powered demand.
Node links and coverage are authoritative engine projections. Canvas, Phaser, Studio, and generated
players never recompute topology, assignment, or brownout.

Missing Logistics, disabled/unselected profiles, v1 `power:null`, and unsupported future versions
have no logistics snapshot and use the literal previous attack/checkpoint/player paths. Because the
network is derived from already checkpointed towers, coordinates, cooldowns, content, and map
topology, `GameCheckpointV1` and `towerforge-sim-v2` do not gain a logistics field. Restore rebuilds
the derived graph after the existing closed tower-state validation, then must reproduce the same
snapshot and digest.

R5.7A adds no game command or event. `GameCommandV6`, journal v6, outer checkpoint v1, project v3,
mechanics catalog v1, profile v3, `CampaignRunV1`, TowerScript v6, multiplayer protocol, and RNG v1
remain independent and unchanged.

### Constructor, AI, renderer, and package surfaces

- `packages/engine` owns v1 normalization, active/inactive validation, graph/cache/allocation,
  firing/pulse gating, snapshot projection, checkpoint restore equivalence, and deterministic bounds.
- CLI/project-loader/build code accepts Logistics v1, preserves future v2, and exposes an inert
  `basic_power_grid` recipe. Its exact required parameters are three distinct existing IDs:
  `generatorTowerTypeId`, `relayTowerTypeId`, and fire-capable `consumerTowerTypeId`. The recipe
  never guesses roles, enables the module, selects a mission, creates tower types, rewrites attacks,
  or installs scripts.
- Mechanics Hub gets a dedicated Logistics card with power enable/null state and full generator,
  relay, and consumer CRUD. Ordinary tower/mission/map forms do not gain disabled power fields.
- MCP/AI adds a Logistics domain descriptor and the normal
  `describe -> capabilities -> recipe -> preview -> guarded apply -> validate` flow. Writes retain
  revision guard, validation, backup, rollback, malformed-data rejection, and narrow side-effect
  metadata. No compute tool returns a second gameplay allocation.
- The shared renderer validates/detaches snapshot v1 and projects authoritative node links,
  coverage, component supply, and powered/brownout consumer cues. Canvas and Phaser display the same
  optional overlay on square and hex. No new pointer, touch, keyboard, or headless command is added.
- PWA, single-file, web package, `.tdpack`, Studio playtest, and public plugin runtime include the
  implementation only through normal source/build packaging. Untouched starter/templates contain no
  logistics content or UI state.

## Compatibility and exclusions

- No file/selection, disabled/unselected, or `power:null` means infinite legacy supply, no graph,
  no firing branch change, no logistics snapshot, and no per-tick allocation overhead.
- R5.7A has no batteries, charge/discharge, transmission loss, cycles with mutable flow, voltage,
  generator fuel, power prices, build-range restriction, enemy grid damage, repair, or timed output.
- It adds no ammo, magazines, storage, inventory, factory, production recipe, conveyor, transfer
  graph, loot, artifact, run/profile resource, merchant, campaign carry, or multiplayer ownership.
- It adds no TowerScript event/action/scope, Visual Graph node, hero interaction, Director input, or
  terrain conductivity. Those require separate TDD increments.

## Required RED and acceptance plan

Implementation starts only after independently authored failing contracts:

1. Content RED: exact nullable schema, all numeric/record boundaries, disjoint roles, tower refs,
   consumer attack-kind restriction, canonical binary order, hostile descriptors/containers,
   disabled structural errors, inactive semantic warnings, future v2 fail-close, and capability
   availability without legacy synthesis.
2. Runtime RED: square/hex footprint distance, mutual link radius, deterministic components,
   nearest/binary attachment, multiple generators, relay bridges, isolated nodes/consumers, strict
   prefix brownout, priority and tower-ID ties, output/demand boundary sums, and order independence.
3. Attack RED: every fire-capable attack kind, pulse field behavior, no target/pipeline side effect
   while unpowered, exact cooldown freeze/resume, zero-delta readiness, generator/relay/non-consumer
   legacy behavior, disruption interaction, sell/move/destroy recovery, and no duplicate firing.
4. Cache/checkpoint RED: rebuild only on dirty events, failed-action no rebuild, batch destruction,
   no RNG/events/read mutation, snapshot bounds/detachment, continuous/checkpoint/journal replay
   digest equivalence, malformed checkpoint rejection through existing tower validation, and literal
   absent/disabled/null compatibility.
5. Surface RED: inert recipe, CLI/project schema/future preservation, Studio CRUD and
   enable/edit/save/reload/disable/re-enable, invalid no-write, MCP guarded flow, stale revision,
   backup/rollback, malformed inputs, public skill/runtime parity, and no ordinary-form pollution.
6. Player/package RED: fail-closed shared projection, authoritative links/coverage/brownout cues,
   Canvas/Phaser × square/hex, four templates, Studio playtest, PWA, single-file, web package,
   `.tdpack`, and mechanics-free legacy starter with no new input.

Acceptance requires typecheck, engine build, full unit/property/determinism/golden tests, validation,
tutorial simulation, balance, map compile, web build, full browser E2E, and plugin build/validate/
smoke. The production author cannot provide either sign-off. An independent Code Verifier and an
independent Constructor Integration Verifier must both return PASS before this ADR becomes Accepted.

## Acceptance evidence

The initial independent RED waves failed exactly as intended: content contracts reported 42 failures
with seven compatibility passes, runtime contracts reported 23 failures with 13 compatibility passes,
and constructor/MCP/player contracts reported 23 failures with five compatibility passes. No
production implementation preceded those failures.

The verification loop then added focused regressions for an unpowered pulse field, participant/node/
edge resource bounds, downed `hp <= 0` participants, checkpoint tower-order continuity, renderer
aggregate and relationship invariants, visible link/coverage cues, canonical component IDs, exact
prefix brownout, and disjoint node/consumer instance IDs. Every reproduced failure was made green
without changing checkpoint, command, journal, profile, campaign, TowerScript, or RNG versions.

Final evidence on the accepted tree:

- Logistics engine/content/authoring/presentation focused contracts: 142/142 PASS.
- Full Vitest: 2,465/2,465 PASS across 214 files.
- Full Playwright: 112/112 PASS, including Logistics Studio lifecycle, future v2 read-only,
  Canvas/Phaser on square/hex, visible supply/brownout/link/coverage, and absent/null legacy paths.
- `npm run typecheck`, `npm run build:engine`, `npm run validate`, tutorial simulation, balance,
  map compilation, `npm run build`, and plugin build/validate/smoke: PASS.
- Independent Code Verifier: PASS with no open P0–P3 after checkpoint, resource-bound, hostile
  projector, source/plugin parity, and documentation-fixture review.
- Independent Constructor Integration Verifier: PASS with 41/41 focused contracts, 6/6 focused
  Chromium scenarios, guarded Studio/MCP flows, packaging/template matrix, and byte-parity review.
