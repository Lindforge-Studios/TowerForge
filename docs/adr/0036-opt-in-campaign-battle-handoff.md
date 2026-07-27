# ADR 0036: Campaign battle handoff is an explicit marker-v2 protocol

- Status: Accepted
- Date: 2026-07-26
- Roadmap: R4.4C

## Context

R4.4A/B coordinate a portable `CampaignRunV1` above individual battles, but deliberately leave
the run deck and artifact inventory disconnected from `TowerDefenseGame`. Connecting them by
silently changing the existing campaign marker would alter already-authored campaigns and would
invite Canvas, Phaser, or Studio to merge snapshot presentation data themselves.

## Decision

The `roguelite` module remains schema v4 and `worldMap.campaign` remains schema v1/v2. The campaign
profile marker is independently versioned: `{schemaVersion:1}` preserves the R4.4A/B lifecycle,
while `{schemaVersion:2}` opts into battle handoff. Future marker versions fail closed and remain
read-only in authoring surfaces.

`prepareCampaignBattle(run, content, nodeId)` validates one detached run, node availability,
remaining-path collection capacity, and the complete per-tower modifier budget. It derives a
domain-separated battle seed and a launch digest bound to the exact validated campaign graph, then
creates a battle carrying the run deck and an
unsocketed artifact inventory. Carried cards enter the existing `run` modifier stage from the first
tick. Current-battle card and artifact IDs use the launch digest plus a monotonic sequence.

`settleCampaignBattleVictory` accepts only the matching victorious engine game. It validates the
launch binding, portable carryover, content references, successor reserve, player-profile result,
and canonical `CampaignRunV1` limits before atomically returning the new run, profile, completed
node, and successors. Defeat, abandon, reset, malformed data, stale launch, or any failed check
returns the original run/profile. Artifact sockets are battle-local and are removed at settlement.
Checkpoint restore repeats the same own-property, aggregate collection, generated-loot provenance,
reachable-loot, and shared modifier-budget checks used by preparation.

Settlement is a pure compare-and-swap operation, not a mutable receipt service. The caller must
atomically replace the exact input run and profile with both returned documents and clear its
pending launch before rendering another frame. Reusing stale pre-battle inputs is outside the API
contract. Generated Canvas and Phaser players enforce this with their pending binding and
`victoryRewarded` guard; neither renderer owns reward or merge logic.

The outer `GameCheckpointV1`, command v3, journal v3, replay, profile v3, and CampaignRun v1 domains
do not change. Active handoff alone adds nested `campaignBattle` v1, draft v2, and artifact v3
checkpoint forms. Marker-v1 battles retain their historic draft/artifact checkpoint bytes.

## Consequences

- Canvas and Phaser call prepare/settle and never derive seeds, IDs, deck history, or loot merges
  from snapshots.
- Studio, CLI, and MCP preserve unsupported future campaign markers byte-for-byte and reject both
  generic mechanics writes and dedicated campaign writes until a compatible runtime is used.
- Explicit run import/export remains the only persistence boundary; no campaign save slot is added.
- Studio Playtest remains a direct battle-local tool; multi-node campaign play stays in generated
  players until a separate Studio increment.
- Merchant card/artifact rewards, deck removal, socket persistence, defeat penalties, and a
  campaign-wide mutable RNG cursor remain out of scope.
