import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMatchCapabilityHandshakeV1 } from "../../engine/src/multiplayer/index.js";
import {
  createReferenceRelayServerV1,
  createReferenceRelayV1,
  REFERENCE_RELAY_LIMITS,
  REFERENCE_RELAY_SERVER_DESCRIPTOR
} from "./index.mjs";

const handshake = (overrides = {}) => createMatchCapabilityHandshakeV1({
  matchId: "relay-match",
  contentDigest: "tf-content-v1:0123456789abcdef",
  mode: "local_coop",
  ...overrides
});

describe("R16.4 bounded reference relay contract (RED)", () => {
  it("requires the existing capability handshake, isolates rooms and forwards opaque detached FIFO frames", () => {
    expect(REFERENCE_RELAY_LIMITS).toEqual({ inviteCodeUtf8Bytes: 128, peerIdUtf8Bytes: 128, peersPerRoom: 4, frameBytes: 1_048_576, queuedFramesPerPeer: 256 });
    const relay = createReferenceRelayV1();
    const aliceInbox = [];
    const bobInbox = [];
    const alice = relay.join({ inviteCode: "ROOM-A", peerId: "alice", handshake: handshake(), deliver: (frame) => aliceInbox.push(frame) });
    expect(() => alice.send({ sequence: 0 })).toThrow(/handshake|peer|room/i);
    expect(() => relay.join({ inviteCode: "ROOM-A", peerId: "bad", handshake: handshake({ contentDigest: "tf-content-v1:ffffffffffffffff" }), deliver() {} }))
      .toThrow(/handshake|content|mismatch/i);
    const bob = relay.join({ inviteCode: "ROOM-A", peerId: "bob", handshake: handshake(), deliver: (frame) => bobInbox.push(frame) });
    const source = { futureOpaqueKind: "relay_does_not_parse", payload: { sequence: 1 } };
    alice.send(source);
    source.payload.sequence = 99;
    alice.send({ futureOpaqueKind: "relay_does_not_parse", payload: { sequence: 2 } });
    expect(bobInbox.map((frame) => frame.payload.sequence)).toEqual([1, 2]);
    expect(aliceInbox).toEqual([]);

    const other = [];
    relay.join({ inviteCode: "ROOM-B", peerId: "charlie", handshake: handshake(), deliver: (frame) => other.push(frame) });
    relay.join({ inviteCode: "ROOM-B", peerId: "dana", handshake: handshake(), deliver: (frame) => other.push(frame) });
    bob.send({ room: "A" });
    expect(other).toEqual([]);
  });

  it("enforces invite, peer, room, frame and backpressure queue limits", () => {
    const relay = createReferenceRelayV1();
    expect(() => relay.join({ inviteCode: "x".repeat(129), peerId: "a", handshake: handshake(), deliver() {} })).toThrow(/invite|128|byte/i);
    expect(() => relay.join({ inviteCode: "room", peerId: "x".repeat(129), handshake: handshake(), deliver() {} })).toThrow(/peer|128|byte/i);
    const peers = Array.from({ length: 4 }, (_, index) => relay.join({ inviteCode: "full", peerId: `p${index}`, handshake: handshake(), deliver() {} }));
    expect(() => relay.join({ inviteCode: "full", peerId: "p4", handshake: handshake(), deliver() {} })).toThrow(/room|peer|4|full/i);
    expect(() => peers[0].send({ payload: "x".repeat(REFERENCE_RELAY_LIMITS.frameBytes) })).toThrow(/frame|byte|large|limit/i);

    let ready = false;
    const received = [];
    const sender = relay.join({ inviteCode: "queue", peerId: "sender", handshake: handshake(), deliver() {} });
    const blocked = relay.join({ inviteCode: "queue", peerId: "blocked", handshake: handshake(), deliver(frame) {
      if (!ready) return false;
      received.push(frame);
      return true;
    } });
    for (let sequence = 0; sequence < REFERENCE_RELAY_LIMITS.queuedFramesPerPeer; sequence += 1) sender.send({ sequence });
    expect(() => sender.send({ sequence: REFERENCE_RELAY_LIMITS.queuedFramesPerPeer })).toThrow(/queue|backpressure|limit/i);
    ready = true;
    blocked.flush();
    expect(received.map((frame) => frame.sequence)).toEqual(Array.from({ length: 256 }, (_, index) => index));
  });

  it("cleans empty rooms, closes idempotently and exposes no simulation runtime", () => {
    const relay = createReferenceRelayV1();
    const left = relay.join({ inviteCode: "reuse", peerId: "left", handshake: handshake(), deliver() {} });
    const right = relay.join({ inviteCode: "reuse", peerId: "right", handshake: handshake(), deliver() {} });
    left.close();
    right.close();
    const replacement = relay.join({ inviteCode: "reuse", peerId: "replacement", handshake: handshake({ matchId: "new-match" }), deliver() {} });
    replacement.close();
    relay.close();
    expect(() => relay.close()).not.toThrow();
    expect(() => relay.join({ inviteCode: "closed", peerId: "peer", handshake: handshake(), deliver() {} })).toThrow(/closed/i);

    const source = ["relay.mjs", "server.mjs"].map((name) => fs.readFileSync(path.resolve("packages/reference-relay/src", name), "utf8")).join("\n");
    expect(source).not.toMatch(/TowerDefenseGame|GameContentRegistry|simulation\/|replayGameCommandJournal|dispatchGameCommand/);
  });

  it("adapts an injected server with a loopback-only descriptor and no real network in tests", () => {
    expect(REFERENCE_RELAY_SERVER_DESCRIPTOR).toEqual({ schemaVersion: 1, defaultHost: "127.0.0.1", accounts: false, matchmaking: false, gameplayLogic: false });
    const listeners = new Map();
    const injected = {
      on: vi.fn((name, listener) => listeners.set(name, listener)),
      off: vi.fn((name) => listeners.delete(name)),
      close: vi.fn()
    };
    const server = createReferenceRelayServerV1({ server: injected });
    expect(injected.on).toHaveBeenCalledWith("connection", expect.any(Function));
    expect(server.host).toBe("127.0.0.1");
    server.close();
    expect(injected.close).toHaveBeenCalledOnce();
  });
});
