# ADR 0049: Opt-in Multiplayer Protocol and Local Transport

- Status: Accepted
- Date: 2026-07-28
- Milestone: R8

## Context

TowerForge already has deterministic commands, checkpoints, journals, replay, seeded RNG, and
stable state digests. Multiplayer must reuse them without adding player identity, ordering, wall
clock time, or network concerns to `GameCommand` and without increasing single-player bundles.

## Decision

R8 introduces an independently versioned, pure `MatchSession` domain under a separate engine
multiplayer entrypoint:

- `MatchCommandEnvelopeV1` carries match/player identity, per-player sequence, one authoritative
  match-wide `matchSequence`, target tick, and one
  existing validated `GameCommand`. The session owns fixed tick advancement; clients cannot submit
  tick commands.
- Co-op uses one simulation instance with independently authored `shared | partitioned`
  resources/routes and shared or owner-only tower control. Partitioned resource commands execute
  against the envelope author's deterministic wallet; fixed-tick resource deltas are applied to
  every wallet. Sorted authored routes are assigned round-robin to sorted players and exposed as
  authoritative match metadata rather than recomputed by renderers.
- Send-vs-Build uses two linked instances. Ordinary `GameCommand` actions are confined to the issuing
  player's lane and cannot own the fixed tick. `sendEnemy` is a protocol command, not a `GameCommand`;
  the session atomically validates and debits authored send cost before enqueueing the opponent
  spawn and applying authored income. An optional authored `routeId` selects an existing route in
  every mission using the profile. Rejection mutates neither side.
- Module schema v2 is a monotonic superset: it may retain local-co-op profiles beside asymmetric
  profiles. Upgrading the module never rewrites, deletes, or implicitly changes a saved v1 profile.
- Offline challenges are seed plus checksummed command replay.
- In-memory transport is the reference implementation. The separate multiplayer entrypoint also
  exposes a versioned WebSocket adapter over an injected WebSocket-like port; it imports or creates
  no network runtime and contains no simulation rules.
- Handshake validates protocol, engine/content identity, mechanics capabilities, and mode before a
  command is accepted. The match-wide sequence fixes cross-player arrival order; duplicate or
  out-of-order per-player and match-wide envelopes fail before mutation. Reconnect verifies a
  current checkpoint against the bounded accepted journal, and desync diagnostics report the first
  divergent tick and checksums without attempting an implicit repair.

Hosted lobby, identity accounts, authentication, matchmaking, NAT traversal, and a hosted relay are
deployment concerns and are not part of R8.

## Packaging and compatibility

The multiplayer runtime is exposed from its own entrypoint/package and imported only by builds with
an active `multiplayer` profile. The root engine and ordinary generated player do not import network
adapters. Missing, disabled, unsupported, or unselected multiplayer content retains the
single-player snapshot/checkpoint gameplay-state shape and player path; the ordinary content digest
continues to bind any authored mechanics catalog.

## Version domains

Project schema, mechanics catalog, simulation engine, `GameCommand`, checkpoint, journal/replay,
match protocol, transport adapter, and reconnect envelope evolve independently. A change in any one
domain does not imply rewriting the others.
