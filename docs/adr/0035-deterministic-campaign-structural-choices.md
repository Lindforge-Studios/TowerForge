# ADR 0035: Campaign structural choices transact declared run resources

- Status: Accepted
- Date: 2026-07-26
- Roadmap: R4.4B

## Context

R4.4A introduced an opt-in campaign DAG and a separate `CampaignRunV1`, but deliberately left
`merchant` and `event` nodes presentation-only. Giving those nodes useful behavior must not move
campaign coordination into `TowerDefenseGame`, persistent profile state, battle checkpoints, or
renderer-side arithmetic. It must also preserve the authored graph v1 path exactly and avoid
combining structural effects with the separate problem of transferring battle-local draft cards and
artifact instances between missions.

## Decision

R4.4B adds `worldMap.campaign` schema v2. The profile capability marker remains
`campaign: { schemaVersion: 1 }` in the existing opt-in `roguelite` v4 module. A v2 graph adds a
closed `runResources` catalog and requires each `merchant` or `event` node to declare one or more
closed choices:

```ts
interface WorldCampaignStructuralChoiceV2 {
  readonly id: string;
  readonly label: string;
  readonly costs: Readonly<Record<string, number>>;
  readonly grants: Readonly<Record<string, number>>;
}
```

Resource IDs in effects reference the graph catalog. Authored amounts are safe integers from zero
through 1,000,000,000 and every choice contains at least one non-zero cost or grant. Definitions,
choices, effect keys, nodes, entry IDs, and successors normalize in binary order. Closed-shape,
UTF-8, byte, node, edge, choice, resource, and aggregate budgets are enforced before activation.
Broken semantic references in an inactive graph are warnings; active graphs fail validation.

The pure engine owns the transaction through `resolveCampaignStructuralChoice`. It captures and
validates an untrusted run once, requires the structural node to be currently available, checks all
costs against the pre-effect balance, rejects underflow or safe-integer overflow, applies
`balance - costs + grants`, removes zero balances, and advances `nodeId` only after the complete
candidate succeeds. Replaying the same node is unavailable and cannot grant twice. The reducer uses
no RNG and returns a new immutable `CampaignRunV1`; it does not receive or mutate a player profile.

Studio and MCP continue to use the dedicated four-file campaign preview/apply transaction with the
same revision, validation, backup, rollback, and parent-identity guards. Canvas and Phaser render a
shared detached projection and invoke the engine reducer for a selected choice. They do not compute
prices, merge resource bags, persist the run automatically, or create a battle simulation for a
structural node.

## Version domains

- Project remains v3; mechanics catalog remains v1; `roguelite` remains v4.
- Campaign graph accepts authored v1 and v2; future v3 fails closed and remains read-only in
  authoring surfaces.
- `CampaignRunV1`, `PlayerProfileV3`, `GameCheckpointV1`, commands, journals, replays, battle
  snapshots, TowerScript, and multiplayer protocols do not change.
- Graph v1 keeps presentation-only `merchant`/`event` behavior and returns
  `node_type_not_implemented`.
- Absent, disabled, and unselected projects do not expose structural choice UI or runtime state.

## Consequences

- Structural resource effects are deterministic data, not mandatory mechanics or host scripts.
- A merchant resolves one selected choice and leaves immediately; repeat purchases, shop history,
  refreshes, randomized offers, profile currencies, and card/artifact rewards need later contracts.
- Battle-local draft/artifact hydration and settlement remain the separate R4.4C TDD increment,
  including instance-ID provenance, RNG continuity, and socket reset policy.
