# ADR 0034: Opt-in campaign graph coordinates separate battle runs

- Status: Accepted
- Date: 2026-07-26
- Roadmap: R4.4A

## Context

`CampaignRunV1` already provides a content-independent transport document for a run seed, the last
node, deck and artifact instance references, and run resources. The existing world map, however,
only describes persistent mission unlocks. Reusing that map as an implicit rogue-lite campaign
would activate new navigation for legacy projects and would leave no independent identity for
merchant or event nodes.

Campaign progression also sits between battles. Putting it in `TowerDefenseGame`, its snapshot, or
its checkpoint would couple a multi-mission run to one battle simulation and change deterministic
replay contracts that do not need campaign state.

## Decision

R4.4A adds an optional `worldMap.campaign` schema v1. It contains a bounded directed acyclic graph,
explicit entry node IDs, a `rogueliteProfileId`, and typed nodes:

- `battle`, `elite`, and `boss` nodes reference an authored mission;
- `merchant` and `event` nodes carry a label and remain presentation-only in R4.4A;
- all nodes have an independent ID, region, position, difficulty, and explicit successors.

Activation requires all of the following: a `roguelite` module at schema v4, an enabled module, the
referenced exact profile with `campaign: { schemaVersion: 1 }`, an authored campaign graph, and the
same selected profile on every mission-backed node. An authored graph without that marker remains
inactive. Disabled and unselected graphs are preserved for later re-enable.

The engine validates closed own-data shapes, UTF-8 and collection budgets, references, duplicate
IDs and edges, self edges, cycles, and reachability. Normalized entry IDs, successors, and nodes use
binary ordering so source order cannot change decisions. A separate read-only compatibility
projection maps legacy `missionNodes` to `battle` nodes (`id = missionId`) and reverses
`unlockRequiresMissionIds` into forward edges; this projection never activates campaign runtime or
rewrites project JSON.

`CampaignRunV1` remains version 1. Its nullable `nodeId` means the last successfully completed
campaign node; `null` exposes the entry nodes. Content-aware APIs validate opaque run references,
return available successors, and record one available battle victory. The reducer returns distinct
immutable `CampaignRunV1` and `PlayerProfileV3` documents and delegates mission rewards to the
existing profile reducer. It does not persist either document automatically.

Campaign authoring is one guarded transaction over `project.json`, `content/world-map.json`,
`content/balance.json`, and `content/mechanics.json`, with raw-byte revision checking, full
validation, backup, and rollback. Studio and MCP use this narrow transaction. Generated Canvas and
Phaser players use the engine codec for explicit run import/export; no run is written to profile
storage.

## Consequences

- Project schema remains v3; mechanics catalog remains v1; only the `roguelite` module advances to
  v4.
- Player profile stays v3. Campaign run, checkpoint, commands, journal/replay, and battle snapshot
  versions do not change.
- Existing synergies, artifacts, sockets, and wave draft remain available in a v4 profile.
- Absent legacy projects do not gain campaign UI, persistence, RNG, snapshot, or checkpoint state.
- Merchant/event effects and synchronization of battle-local loot/draft state into `CampaignRun`
  require later, separate TDD increments.
