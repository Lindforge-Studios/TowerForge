# ADR 0046: Opt-in ammunition supply

Status: Proposed

Date: 2026-07-27

Roadmap: R5.8B

## Context

R5.8A establishes finite local magazines and deterministic attack consumption, deliberately
without a refill path. The final R5 Logistics slice must let authors opt selected tower types into
production, storage, bounded transfer, and same-instance refill without changing the existing
attack gate, enabling the module implicitly, or adding renderer-owned simulation.

Supply state is mutable and interacts with power, disruption, movement, destruction, checkpoints,
and catch-up ticks. Its topology and scheduling therefore require a closed deterministic contract
before implementation.

## Decision

### Version and opt-in boundary

Logistics v1 remains `{ power }`, v2 remains `{ power, ammunition }`, and v3 is the exact closed
profile `{ power, ammunition, supply }`. Every field for its version is required and nullable.
Non-null `supply` requires non-null `ammunition`; v3 `supply:null` retains v2 ammunition semantics.
Absent, disabled, unselected, all-null, v1, and v2 projects keep their established behavior and
shape. Reading never migrates content. Studio or MCP promotes v2 to v3 only through an explicit
previewed, revision-guarded write that preserves power and ammunition. Future v4+ is opaque,
lossless, read-only, and runtime-inactive.

Project v3, profile v3, outer `GameCheckpointV1`, engine v2, `GameCommandV6`, journal v6, RNG v1,
and TowerScript v6 do not change. The Logistics snapshot advances to v3 and its mutable nested
checkpoint advances to v2.

### Closed authoring contract

```json
{
  "power": null,
  "ammunition": {
    "types": { "shell": { "label": "Shell" } },
    "towerInventories": {
      "cannon": {
        "ammoTypeId": "shell",
        "capacity": 30,
        "startingAmount": 0,
        "consumptionPerActivation": 1
      }
    }
  },
  "supply": {
    "productionRecipes": {
      "forge_shell": {
        "label": "Forge shell",
        "ammoTypeId": "shell",
        "outputAmount": 4,
        "interval": 1
      }
    },
    "producers": {
      "shell_factory": {
        "recipeId": "forge_shell",
        "capacity": 120,
        "startingAmount": 0,
        "transferRadius": 4,
        "transferAmount": 8,
        "transferInterval": 0.4
      }
    },
    "storages": {
      "shell_depot": {
        "ammoTypeId": "shell",
        "capacity": 240,
        "startingAmount": 0,
        "transferRadius": 5,
        "transferAmount": 12,
        "transferInterval": 0.4
      }
    }
  }
}
```

Production recipe records are exactly `{ label, ammoTypeId, outputAmount, interval }`. Producer
records are exactly `{ recipeId, capacity, startingAmount, transferRadius, transferAmount,
transferInterval }`. Storage records replace `recipeId` with `ammoTypeId` and otherwise have the
same numeric shape. A tower type cannot be both producer and storage, but supply roles may overlap
power roles and attack-magazine bindings; output/storage and attack magazines remain distinct
compartments, including on the same instance.

All referenced tower, ammunition, and production recipe IDs must exist. Active broken references
are errors; inactive or unselected broken references are warnings; structural faults are always
errors. Unknown/inherited/symbol/accessor fields, hostile prototypes, sparse containers, unsafe
integers, and non-finite values fail closed.

The fixed limits are:

```ts
{
  productionRecipes: 256,
  producers: 4_096,
  storages: 4_096,
  authoredSourcesTotal: 4_096,
  liveSources: 1_024,
  liveAmmunitionInventories: 4_096,
  directedTransferEdges: 65_536,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128,
  inventoryCapacity: 1_000_000_000,
  amount: 1_000_000_000,
  transferRadius: 64,
  minimumInterval: 0.2,
  maximumInterval: 1_000_000
}
```

Amounts and capacities are safe integers. Capacity is `1..1_000_000_000`, starting amount is
`0..capacity`, output and transfer amounts are `1..capacity`, radius is an integer `0..64`, and
intervals are finite `0.2..1_000_000`. Placement, movement, and restore validate source and edge
budgets before mutation or resource spending.

### Transfer topology and ordering

The engine builds a directed graph over live towers (`hp` absent or positive). Edge distance is
`max(0, topology.distance(source.coord, destination.coord) - source.footprintRadius -
destination.footprintRadius)`. Matching-ammo edges are producer to consumer or storage, and storage
to consumer. Storage-to-storage and transfer into producer are forbidden. A self-edge between
different compartments on one instance is allowed. Terrain, line of sight, elevation, and power
topology do not alter edges.

Canonical edge order is binary source tower ID, source kind (`producer` before `storage`),
destination kind (`consumer` before `storage`), distance, then binary destination tower ID.
Sources execute by binary instance ID. Each source serves consumers before storage, then nearest
destinations, then binary destination ID. Earlier sources reserve destination capacity first.

The graph becomes dirty only after successful placement or movement, sell, destruction/downing,
and checkpoint restore. Production, transfer, consumption, normal ticks, snapshot reads, upgrades,
and failed actions do not dirty it. The cache contains topology only, never stock or progress.

### Tick and conservation semantics

Supply updates after tower disruption/enemy tower attacks and before ordinary tower attacks:

1. read authoritative power allocation;
2. exclude destroyed or downed sources;
3. advance production;
4. construct a detached transfer plan;
5. atomically apply transfers;
6. run the existing tower firing loop.

Producers and storage start with transfer progress equal to their interval, so `tick(0)` may
transfer; producer production progress starts at zero. A successful activation subtracts one
interval. Blocked progress is frozen. Production creates only full batches when they fit. Transfer
moves at most `transferAmount`, may split one batch among destinations, and a partial transfer still
counts as one activation. Planning reads post-production but pre-transfer balances: incoming stock
cannot be forwarded and outgoing stock cannot free incoming storage headroom in the same tick.

Power consumers use the authoritative power allocation; non-consumers are powered. Brownout and
`disabledFor > 0` freeze production and outgoing transfer, while passive incoming refill remains
allowed. Refill does not change cooldown. A ready tower refilled to its activation cost may fire in
the same tick; a smaller refill leaves the exact cooldown frozen. The R5.8A attack order remains
`disabled -> power -> ammunition -> cooldown -> target -> consume -> effects`.

Transfers conserve stock. Total stock changes only through successful production, authored
placement starting amounts, attack consumption, and stock removed by sell/destruction. Supply uses
no RNG, project resources, events, or host APIs.

Move and upgrade preserve both compartments and progress; upgrade does not resize or refill. Sell
and destruction remove stock without refund/drop. Reset clears runtime state; new placement uses
authored starting values. Failed actions create no partial state.

### Checkpoint, digest, and snapshot

Logistics v2 ammunition keeps nested checkpoint v1. Logistics v3 with non-null ammunition or supply
requires nested checkpoint v2:

```text
{
  schemaVersion: 2,
  ammunition: { inventories: [{ towerId, amount }] } | null,
  supply: {
    producers: [{ towerId, amount, productionProgress, transferProgress }],
    storages: [{ towerId, amount, transferProgress }]
  } | null
}
```

Rows are dense, exact, complete for live bound instances, unique, and binary-sorted. Refilled
ammunition may reach capacity. Supply amounts stay within authored capacity; progress is finite and
bounded by its authored interval. Restore validates towers, references, bounds, rows, and candidate
graph before atomic adoption. Stock and progress participate in the stable digest; the derived graph
does not. Continuous, restored, and journal-replayed runs produce the same digest and snapshot.

The v3 snapshot has exact `{ schemaVersion:3, power, ammunition, supply }`; the first two sections
retain their contracts. Supply publishes canonical detached producers, storages, and edges. Source
rows include authored IDs, stock/capacity, production/transfer progress and intervals, authoritative
`powered`, and engine-derived `operational`. If all three sections are null, Logistics is absent.
Renderer and Studio validate and display this projection; they never rebuild topology, route stock,
or derive combined firing state.

### Constructor and agent surfaces

Mechanics Hub adds a Supply subsection and explicit v2-to-v3 promotion, then CRUD for production
recipes, producers, and storages. Ordinary tower, mission, and map forms remain unchanged. Canvas,
Phaser, and Studio Playtest show stock, progress, paused/brownout cues, directed links, and refill
relationships from the authoritative snapshot on square and hex grids.

MCP descriptors publish Logistics versions `[1,2,3]`, exact limits, ordering, and checkpoint
semantics. Authoring keeps `describe -> capabilities -> recipe -> preview -> guarded apply ->
validate`, with revision guard, validation, backup, and rollback. No refill/transfer command,
inventory mutation tool, TowerScript action, or network API is added.

The inert `basic_factory_ammunition_supply` recipe requires exact parameters
`producerTowerTypeId`, `storageTowerTypeId`, `consumerTowerTypeId`, `ammoTypeId`, `ammoLabel`,
`productionRecipeId`, `productionRecipeLabel`, `consumerCapacity`, `consumerStartingAmount`,
`consumptionPerActivation`, `outputAmount`, `productionInterval`, `producerCapacity`,
`producerStartingAmount`, `producerTransferRadius`, `producerTransferAmount`,
`producerTransferInterval`, `storageCapacity`, `storageStartingAmount`, `storageTransferRadius`,
`storageTransferAmount`, and `storageTransferInterval`. The three existing tower types are distinct
and the consumer is fire-capable. The recipe returns a v3 profile with `power:null`; it never enables
or selects the module, creates or patches a tower, or adds a script.

## Compatibility and exclusions

R5.8B adds no raw materials, inputs, conveyors, storage-to-storage routing, alternate ammunition,
manual reload/refill command, loot, campaign/profile persistence, prices, multiplayer ownership,
Director hook, TowerScript action/event, new `GameCommand`/event, terrain or LoS rule, or renderer
simulation. Single-player without selected supply includes none of its runtime state or overlays.

## Required RED and acceptance plan

Independent RED waves cover content/versioning/limits, production, graph/transfer ordering,
power-ammunition-supply interaction, lifecycle and atomicity, checkpoint/digest/replay, Studio and
MCP guarded authoring, shared projector security, player/package matrices, and conservation/property
tests. Acceptance requires all applicable `AGENTS.md` gates plus independent Code Verifier and
Constructor Integration Verifier PASS; no implementation author may perform either sign-off.
