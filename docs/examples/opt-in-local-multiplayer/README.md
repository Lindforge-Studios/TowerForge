# Opt-in local multiplayer

This R8 fixture activates one `multiplayer` v1 local co-op profile. It adds no hosted service,
account, authentication, lobby, matchmaking, or public relay.

1. Persist the normal mechanics migration and set `project.json.schemaVersion` to `3` in the same
   guarded transaction.
2. Copy `mechanics.json` to `content/mechanics.json` and merge `mission-selection.json` into only
   the missions that should expose local co-op.
3. Preview and apply the mechanics change with the current project revision, then run
   `npm run validate`.
4. Create the session from the separate `@towerforge/engine/multiplayer` entrypoint. Supply the
   exact profile ID, mission ID, fixed tick, match ID, seed, and two to four distinct player IDs.
5. Exchange and negotiate `MatchCapabilityHandshakeV1` before accepting command envelopes, and
   use the in-memory transport or an injected WebSocket-like port adapter for local/self-hosted
   delivery.

`MatchSession` owns one simulation and its fixed tick. Exact envelopes carry match/player identity,
per-player sequence, the authoritative match-wide `matchSequence`, the current apply tick, and an
existing validated `GameCommand`. The sender retries until both sequence domains are accepted, so
opposite peer arrival order cannot change the simulation. Duplicate,
out-of-order, foreign-player, wrong-match, wrong-tick, client-owned tick, and unauthorized
owner-only tower commands are rejected before mutation. Snapshots and journals carry stable
`tf-match-v1` checksums; replay stops on the first mismatch. Offline challenges bind seed, journal,
expected checksum, and their own challenge checksum. Reconnect verifies the authoritative game
checkpoint against the accepted journal, while desync diagnostics report the first divergent tick
and both available checksums without silently repairing either peer.

The bundled fixture keeps resources and routes shared. To partition either independently, change
the corresponding ownership value to `partitioned`; route partitioning requires at least one
authored `pathRoutes` entry per player. Player wallets and stable sorted-route ownership then come
from the match snapshot and participate in checksum/replay—Studio and players must not derive them.

The in-memory transport delivers detached frames FIFO. The versioned WebSocket adapter serializes
canonical JSON over a caller-injected WebSocket-like port; the engine constructs no socket and
imports no network runtime. Handshake checks protocol, engine, match, content digest, mode, and the
exact capability list before commands are accepted.

Asymmetric Send-vs-Build is a separate explicit `multiplayer` schema v2 profile with exactly two
partitioned lanes and an authored `sendPool`. `sendEnemy` atomically checks and debits the authored
cost, applies authored income, and queues the authored enemy on the opponent lane; rejection changes
neither lane. Ordinary build/upgrade/ability `GameCommand` actions affect only the issuing player's
lane; only the match session advances the fixed tick. A send may optionally name an authored route that exists in every mission selecting
the profile. Upgrading the module to v2 preserves existing local-co-op profiles beside asymmetric
profiles; those local profiles do not silently gain the new mode.

Generated Canvas, Phaser, PWA, and single-file players include the separate multiplayer runtime
only while an enabled, supported profile is selected by at least one mission. Removing the mission
selection, disabling the module, or removing the catalog omits `engine/multiplayer` and the player
hook, preserving the ordinary single-player bundle.

See [ADR 0049](../../adr/0049-opt-in-multiplayer-protocol.md).
