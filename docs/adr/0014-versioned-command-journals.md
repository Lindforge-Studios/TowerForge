# ADR 0014: Versioned command journals are validation-only records

- Status: Accepted
- Date: 2026-07-24

## Context

Deterministic replay and step debugging require more than a checkpoint: they need the exact ordered commands, the observed gameplay result of each command, and a state digest after every boundary. Transport input cannot be stored directly because accessors, mutable objects, future fields, or malformed payloads would make a journal ambiguous. Journal import must also be safe to inspect without accidentally running gameplay.

## Decision

The pure engine owns `GameCommandJournalV1` in `packages/engine/src/simulation/journal.ts`. A journal contains its own schema and engine headers, the simulation-content digest, a detached `GameCheckpointV1`, and zero-based entries with:

- one detached, versioned `GameCommandV1`;
- a normalized result containing `ok`, optional `reasonKey`, and bounded typed parameters, but no human-readable `reason`;
- the post-command state digest.

`JournaledGameSession` and the legacy dispatcher share one internal strict parser and one parsed-command executor. Invalid syntax is returned as the existing invalid-command result and is not recorded. A syntactically valid command is recorded exactly once even when gameplay rejects it. Out-of-band state mutation or an engine exception faults the session; entry and byte capacity are reserved before execution so the game cannot mutate without journal space.

`decodeGameCommandJournal` validates and detaches closed, bounded data plus the embedded checkpoint. It does not create a map and never executes entries. Replay execution, result comparison, and divergence diagnostics belong to a later independently tested contract.

## Consequences

- Existing `dispatchGameCommand`, headless simulation, checkpoints, snapshots, player builds, and projects do not acquire journal state.
- Replay can later compare every normalized result and state digest without depending on localized messages.
- Journal, checkpoint, command, profile, and multiplayer schemas remain independent version domains.
- Any new command or durable result field must update the shared parser, journal codec, budgets, and replay compatibility tests together.
