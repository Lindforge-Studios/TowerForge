# ADR 0032: Artifact socketing is a between-wave deterministic command

- Status: Accepted
- Date: 2026-07-26

## Context

R4.2A/B introduced opt-in `roguelite` v2 artifact definitions, typed tower slots, seeded boss loot,
and battle-local inventory. Artifact modifiers were deliberately inert. Socketing must now affect
only the chosen live tower without turning artifacts into mandatory legacy state or allowing Studio,
renderers, or agents to invent gameplay rules.

## Decision

`GameCommandV1` and journal v1 remain exact. `GameCommandV2` adds closed `socketArtifact` and
`unsocketArtifact` commands with `artifactInstanceId`, `towerId`, and `slotId`; the journal upgrades
to v2 on the first structurally valid v2 command, including a gameplay rejection. Decode and replay
accept both journal versions.

Manual mutation is allowed only at a real `between` boundary after one cleared wave and before the
final wave. Inventory owns every assignment. A slot accepts one compatible instance and an instance
has at most one slot. Selling or destroying a tower emits `artifactUnsocketed` before the terminal
tower event and keeps the item in inventory; move and upgrade retain the assignment.

Artifact damage modifiers enter the shared resolver at stage `run` only for immediate damage from
the exact live tower instance. DoT, reaction, ability, enemy, core, and TowerScript damage do not
inherit them. Stable modifier IDs include the artifact instance and authored modifier index. A
preflight uses the authored worst-case synergy count plus all candidate tower artifact modifiers and
the explicit shared reserve; overflow rejects atomically rather than truncating.

The outer `GameCheckpointV1` stays unchanged. Its optional artifact state accepts nested v1 and v2.
Historic v1 bytes are preserved until the first successful socket mutation; nested v2 adds exact
nullable socket references. Restore validates ownership, live tower and slot references,
compatibility, uniqueness, and modifier budget before state mutation.

Active roguelite v2 now emits `snapshot.roguelite` schema v3 with authoritative inventory sockets,
live tower slots, and management availability. Renderer, Studio, generated Canvas/Phaser players,
and MCP consume this section; they never derive assignments or phase rules. Native buttons provide
mouse, touch, and keyboard access. Missing, disabled, unselected, and roguelite-v1 content stays on
the legacy path.

## Consequences

- Loot remains battle-local; `CampaignRunV1` persistence is still a later independent increment.
- Project mechanics schema remains roguelite v2; snapshot, command/journal, and nested checkpoint
  versions evolve independently.
- No TowerScript socket actions/events are added in this slice.
- Draft, campaign nodes, merchant rules, and profile migration remain separate TDD increments.
