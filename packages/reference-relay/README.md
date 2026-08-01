# TowerForge Reference Relay

`@towerforge/reference-relay` is the optional R16.4 self-host adapter for existing R8 match
transports. It is not a hosted TowerForge service and is never included in ordinary single-player
or generated player bundles.

The package owns only bounded invite-code rooms and opaque FIFO frame forwarding. Every peer must
complete the existing engine-owned capability handshake before sending a frame. The relay does not
import the simulation, inspect commands, create accounts, authenticate users, match players, or
persist room state.

## Limits

- invite code: 128 UTF-8 bytes;
- peer ID: 128 UTF-8 bytes;
- peers per room: 4;
- frame: 1 MiB;
- queued frames per peer: 256;
- rooms per process: 128.

## Embedding

Import `createReferenceRelayV1` for an in-process adapter or
`createReferenceRelayServerV1` for an injected server/socket port. The server adapter accepts only
`127.0.0.1`, `::1`, or `localhost` and defaults to `127.0.0.1`. TowerForge deliberately does not
bundle a WebSocket server dependency or a production listener script; deployment, TLS, exposure,
authentication and process supervision belong to the self-host operator.

The connection protocol is:

1. send `{kind:"handshake", inviteCode, peerId, handshake}`;
2. wait until another compatible peer has joined the room;
3. exchange `{kind:"frame", frame}` envelopes;
4. close the injected socket to remove the peer; empty rooms are discarded.

Run the focused contract from the repository root:

```bash
npm --workspace @towerforge/reference-relay test
```

For architecture and operational boundaries see
[`docs/adr/0057-r16-ghost-replay-lab.md`](../../docs/adr/0057-r16-ghost-replay-lab.md) and
[`docs/runbook.md`](../../docs/runbook.md#r16-ghost-replay-lab).
