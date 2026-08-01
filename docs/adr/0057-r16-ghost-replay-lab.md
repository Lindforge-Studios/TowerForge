# ADR 0057: Ghost Replay Lab and Reference Relay

- Status: Accepted
- Date: 2026-08-01
- Milestone: R16

## Context

TowerForge already owns deterministic `GameCheckpointV1`, command journals v1–v8, exact replay,
state/content digests and the R8 fixed-tick multiplayer handshake/transport boundary. Inspection,
portable replay exchange and What-If analysis must reuse those contracts. A second simulator,
renderer-owned replay, project-persisted debugger state, or mandatory network runtime would create
new sources of truth and would change legacy player bundles.

R16 also needs a reference self-host transport for small co-op rooms. That adapter must remain
separate from gameplay and from hosted accounts, authentication, lobby discovery and matchmaking.

## Decision

R16 is not a mechanics module and does not use `content/mechanics.json`. It is an explicit,
read-only Studio workflow backed by the separate browser-safe `@towerforge/engine/replay-lab`
entrypoint. The root engine does not re-export Replay Lab, and ordinary player builds do not copy
its runtime or ghost presentation projector.

### ReplayArchiveV1

`ReplayArchiveV1` is a binary container over the existing canonical `GameCommandJournal` v1–v8.
Its fixed v1 header is 20 bytes: ASCII `TFRP`, version byte `1`, zero flags, big-endian header length,
big-endian uint32 payload length and an eight-byte domain-separated checksum. The complete archive
is capped at 72 MiB. The payload is canonical UTF-8 JSON with the closed fields `schemaVersion`,
`engineVersion`, `payloadKind`, `contentDigest`, `capabilityDigest`, `missionId` and `journal`.

Decode owns a byte copy and validates type/backing buffer, total and declared lengths, magic,
version, flags, header, checksum, UTF-8, canonical JSON, closed envelope fields, engine/content/
mission/capability identity and only then delegates to `decodeGameCommandJournal`. Malformed,
truncated, trailing, oversized, future or incompatible archives fail before simulation
construction. Decode validates but does not execute journal commands. Checksum, capability,
archive and branch identities use independent domain prefixes; they are deterministic integrity
identifiers, not cryptographic signatures.

### Detached Ghost replay

Only an archive decoded by the current engine can create `GhostReplaySessionV1`; copied or forged
objects do not carry that engine-owned identity. The session exposes only `seek`, `advance` and
`final`, never a mutable game, command dispatcher or tick method. Each frame has the exact closed
envelope `{schemaVersion:1, ghost:true, sequence, stateDigest, snapshot}`. The snapshot is detached
from the replay runtime and deeply frozen.

Replay uses the existing validated command execution and result/state-digest checks. At most 256
frames are cached; evicted frames are reconstructed deterministically. Ghost state never occupies
map cells, enters targeting, sends commands, changes the active playtest, or becomes checkpoint,
profile, campaign or project data. `packages/renderer` supplies only a bounded pure overlay
projection and does not replay or infer gameplay.

### Immutable What-If branches

`ReplayBranchV1` records the exact parent archive digest, a fork sequence in `0..N`, a complete
`GameCommandJournal` suffix rooted at the validated fork checkpoint, and a domain-separated branch
digest. New commands are dispatched through `JournaledGameSession`; invalid commands cannot be
claimed as suffix entries. Replay validates the closed branch, parent provenance, suffix journal,
fork checkpoint and branch digest before executing the suffix.

First-divergence diagnostics compare the parent and branch from the first post-fork sequence,
including command identity and authoritative state digests. Creating, replaying or diagnosing a
branch never changes the parent archive bytes or journal.

### Studio and agent surfaces

Studio provides a dedicated Replay Lab tab with explicit file import, timeline seek, Ghost toggle,
What-If fork and divergence output. It has no project write path. It validates the archive against
the currently loaded project and keeps the ordinary playtest independent.

MCP adds only compute-only `inspect_replay_archive`, `verify_replay_archive` and
`analyze_replay_branch`. The workflow is `describe -> inspect -> verify -> branch analysis`.
These tools write no project files and never open a socket. No broad replay writer or relay launch
tool is added.

### Reference relay

`@towerforge/reference-relay` is a separate, optional self-host package over the R8 capability
handshake. Invite codes and peer IDs are limited to 128 UTF-8 bytes; a room accepts at most four
peers; a frame is capped at 1 MiB; and each recipient queue retains at most 256 frames. Frames are
detached and forwarded FIFO but remain opaque to the relay. A compatible capability handshake is
mandatory before frame exchange.

The server adapter accepts an injected server/socket port and defaults to loopback
`127.0.0.1`. It contains no simulation or project loader, does not create sockets on import, and is
not started by Studio or MCP. Accounts, authentication, persistence, matchmaking, NAT traversal,
TowerForge Cloud and a production WebSocket deployment remain outside R16.

## Version boundaries and compatibility

- Replay archive, Ghost frame, branch and reference relay use independent schema v1 contracts.
- Project v3, `GameCheckpointV1`, `towerforge-sim-v2`, `GameCommand`/journal v8,
  `PlayerProfileV3`, CampaignRunV2, TowerScript, mechanics and multiplayer protocol versions do not
  change.
- No project file, mission selection or starter fixture activates R16.
- The Studio runtime may load Replay Lab explicitly; normal PWA, single-file, web, mobile and
  desktop player carriers omit Replay Lab, Ghost projection and the reference relay.
- Unknown or future archive/branch forms fail closed and are not downgraded.

## TDD and acceptance

R16.1–R16.4 were developed as separate RED/GREEN slices: binary archive, detached Ghost, immutable
branch, then reference relay and constructor surfaces. Focused contracts cover binary header and
corruption, hostile values, v1–v8 journals, cache eviction, source isolation, branch provenance,
first divergence, renderer projection, read-only Studio/MCP discovery, relay handshake/rooms/
backpressure and legacy package absence.

The frozen candidate passed the complete required gates and independent Code Verifier and
Constructor Integration Verifier sign-offs after two verifier-led RED/GREEN repair waves. The ADR
is therefore Accepted; any later source change requires a new verification freeze.

## Excluded

- A second replay simulator, homed project replay state or renderer-owned command execution.
- Automatic archive import, project writes, active-game mutation or background replay.
- Replay Lab code in an untouched starter/player carrier.
- Hosted auth, accounts, lobby/gallery, matchmaking, cloud persistence or mandatory relay.
- Network listener creation by MCP/agents and deployment credentials in project data.
