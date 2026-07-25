# ADR 0013: Deterministic engine checkpoints

- Status: Accepted
- Date: 2026-07-23

## Context

Replay, step debugging, offline challenges, reconnect, and long rogue-lite runs need a portable simulation boundary. `GameSnapshot` is renderer-facing and intentionally omits counters, pending spawns, raw cooldowns, TowerScript timers and budgets, RNG state, and other data required to continue deterministically. Treating it as a save format would create states that look correct until the next tick and then diverge.

Project schema, profile schema, checkpoint schema, engine compatibility, and the later multiplayer protocol also evolve independently. A project migration must not silently rewrite an engine checkpoint.

## Decision

The pure TypeScript engine owns a versioned `GameCheckpointV1` contract in `packages/engine/src/simulation/checkpoint.ts`. The envelope contains:

- checkpoint and engine version headers;
- a simulation-content fingerprint;
- mission, difficulty, and normalized meta-upgrade identity;
- initial and current versioned seeded-RNG state;
- the complete authoritative mutable game state;
- a stable digest over the compatibility envelope.

`TowerDefenseGame.createCheckpoint()` emits detached strict JSON. `TowerDefenseGame.fromCheckpoint()` validates version, content, identity, RNG, every closed state shape, semantic cross-reference, topology footprint, ID counter, queue ordering, entity bound, and TowerScript budget before publishing a new instance. Incompatible headers and content are rejected before `mapFactory` runs. Restore skips `gameStarted`, applies authoritative state, and rebuilds derived terrain, occupancy, and temporary-water cues.

`GameSnapshot` is not accepted as restore input. A checkpoint contains neither a command journal nor multiplayer metadata. Those protocols reference checkpoints but own their own schemas and version negotiation.

## Consequences

- Continuous and prefix/checkpoint/suffix simulations have an exact digest contract across hex and square grids.
- Checkpoints are deterministic compatibility data, not cryptographic authentication; untrusted input still requires the full codec validation.
- Adding mutable engine state requires updating the checkpoint inventory, validator, digest fixtures, and restore logic in the same TDD slice.
- Renderer, Studio, player, project loader, and ordinary starter projects remain unchanged until a surface explicitly opts into checkpoint persistence or replay.
