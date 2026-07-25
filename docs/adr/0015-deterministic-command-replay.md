# ADR 0015: Deterministic command replay is an explicit engine consumer

- Status: Accepted
- Date: 2026-07-24

## Context

A validated command journal records the initial checkpoint, each canonical command, its normalized gameplay result, and the following state digest. Validation alone deliberately does not run gameplay. Deterministic replay therefore needs a separate boundary that can prove an uninterrupted simulation and a journal-restored simulation reached the same state, while failing safely and precisely when the journal or engine behavior diverges.

## Decision

The pure engine owns `replayGameCommandJournal` in `packages/engine/src/simulation/replay.ts`. The replay pipeline is ordered and fail-closed:

1. `decodeGameCommandJournal` validates and detaches the complete journal, its embedded checkpoint, all entries, and every command before a map is created. The decoder remains validation-only and executes nothing.
2. `TowerDefenseGame.fromCheckpoint` creates one fresh game from the validated initial checkpoint.
3. Each already parsed command passes through the shared non-public executor exactly once. Replay does not parse transport input again and does not route through a second runtime.
4. The normalized durable result is compared first. Only after it matches is the current state digest calculated and compared with the recorded post-state digest.
5. Replay stops at the first mismatch. `GameCommandReplayDivergenceError` identifies the zero-based sequence and whether the result or digest differed; `GameCommandReplayExecutionError` identifies an engine failure and preserves its cause.

The replay result contains an independent `TowerDefenseGame`, the number of entries replayed, and its final state digest. The API is synchronous, browser-safe, and free of Node, DOM, filesystem, renderer, Studio, MCP, and network dependencies.

## Consequences

- Continuous and replayed runs must produce the same snapshot and state digest on hex and square grids, including journals that contain valid gameplay rejections.
- Malformed, future-version, incompatible-content, over-budget, or accessor-bearing journals fail before map creation or command execution.
- Result comparison precedes digest comparison, so diagnostics are stable and report the earliest causal boundary.
- Replay does not add metadata to snapshots or checkpoints and is not persisted in `.tdproj`, player profiles, Studio state, generated players, or multiplayer envelopes.
- Project, mechanics, command, checkpoint, journal, replay behavior, profile, and multiplayer version domains evolve independently. A project-schema migration never rewrites a journal or changes replay semantics implicitly.
- Studio/MCP/player replay surfaces, transport ownership, network ordering, and step-debugger cursors require separate opt-in contracts; they are not part of R0C.6.
