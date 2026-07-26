# ADR 0031: Rogue-lite artifact loot is opt-in deterministic run inventory

- Status: Accepted
- Date: 2026-07-26

## Context

R4 needs authored artifact definitions, typed tower slots, and seeded boss drops before it can add
socket mutations or persistent campaign integration. Reusing the simulation RNG, writing drops
directly into `CampaignRunV1`, or applying the authored modifiers immediately would couple several
independent roadmap slices and could perturb legacy or roguelite-v1 simulations.

## Decision

Extend only the `roguelite` mechanics module to schema v2. A v2 profile retains exact v1
`synergies` and adds exact `artifacts` data: bounded definitions, typed slots keyed by authored tower
type, and weighted boss loot tables keyed by authored enemy type. Artifact modifiers use the closed
damage-modifier vocabulary but are inert in this slice; socket/unsocket and modifier application
remain a later command-bearing increment.

An active selected v2 profile starts with an empty battle-local inventory. Each killed enemy with a
loot table consumes a dedicated domain-separated `SeededRng` stream. Stable binary ordering and
integer weighted selection make results independent from source object order. Events are emitted in
the fixed order `enemyKilled` → zero or more `artifactDropped` → `enemySpawnedOnDeath`. Instance IDs
are monotonic within the battle, and rewards/death settlement still occur exactly once.

Only active v2 checkpoints contain the artifact RNG initial/current state, next instance sequence,
and inventory. Restore rejects missing, duplicate, unknown, incoherent, inactive, or malformed
artifact state before mutation. The optional v2 snapshot exposes a read-only inventory whose
`socket` is always `null`; renderers and generated players project this snapshot and the current drop
events without loot or socket gameplay logic.

Mechanics Hub edits the three artifact records inside its isolated Rogue-lite card. MCP and CLI use
the same descriptor, the detached `basic_boss_artifact_loot` recipe, and the existing revision-
guarded three-file preview/apply transaction. The recipe requires explicit authored tower and boss
enemy IDs and never writes, enables, or selects the module.

## Consequences

- Missing, disabled, unselected, and roguelite-v1 content consumes no artifact RNG, checkpoint
  section, snapshot section, inventory panel, or loot event.
- `CampaignRunV1`, player-profile v3, project v3, mechanics catalog v1, command/replay, TowerScript,
  and multiplayer version domains do not change.
- Inventory persistence outside the battle, sockets, item modifiers, boss classification, and
  socket commands require later independent TDD increments.
- Structurally invalid inactive data remains an error; broken inactive cross-references remain
  warnings under the shared capability policy.

## Verification

Acceptance requires RED-before-GREEN content/runtime and all-surface contracts, order-independent
seeded drops, checkpoint/replay digest equivalence, inactive/v1 compatibility, guarded authoring and
rollback, Studio save/reload/disable/re-enable, Canvas/Phaser hex/square packaging, and independent
code and constructor-integration sign-offs.
