import { describe, expect, it, vi } from "vitest";

describe("R8.4 local transport and handshake contract (RED)", () => {
  it("negotiates exact protocol/content/mode capabilities and fails closed on mismatch", async () => {
    const api = await import("./index.js");
    const local = api.createMatchCapabilityHandshakeV1({
      matchId: "match_1", contentDigest: "tf-content-v1:0123456789abcdef", mode: "local_coop"
    });
    expect(api.negotiateMatchCapabilityHandshakeV1(local, structuredClone(local))).toEqual({ ok: true, protocolVersion: 1 });
    expect(api.negotiateMatchCapabilityHandshakeV1(local, { ...local, protocolVersion: 2 }))
      .toMatchObject({ ok: false, code: "protocol_mismatch" });
    expect(api.negotiateMatchCapabilityHandshakeV1(local, { ...local, contentDigest: "tf-content-v1:ffffffffffffffff" }))
      .toMatchObject({ ok: false, code: "content_mismatch" });

    const sparse = { ...local, capabilities: new Array(3) };
    expect(() => api.negotiateMatchCapabilityHandshakeV1(local, sparse)).not.toThrow();
    expect(api.negotiateMatchCapabilityHandshakeV1(local, sparse))
      .toEqual({ ok: false, code: "handshake_invalid" });
    const accessor = [...local.capabilities];
    Object.defineProperty(accessor, "0", { enumerable: true, get() { throw new Error("must not run"); } });
    expect(() => api.negotiateMatchCapabilityHandshakeV1(local, { ...local, capabilities: accessor })).not.toThrow();
    expect(api.negotiateMatchCapabilityHandshakeV1(local, { ...local, capabilities: accessor }))
      .toEqual({ ok: false, code: "handshake_invalid" });
    const hostileHandshake = new Proxy({}, {
      getPrototypeOf() { throw new Error("must fail closed"); }
    });
    const hostileCapabilities = new Proxy([...local.capabilities], {
      ownKeys() { throw new Error("must fail closed"); }
    });
    expect(() => api.negotiateMatchCapabilityHandshakeV1(local, hostileHandshake)).not.toThrow();
    expect(api.negotiateMatchCapabilityHandshakeV1(local, hostileHandshake))
      .toEqual({ ok: false, code: "handshake_invalid" });
    expect(() => api.negotiateMatchCapabilityHandshakeV1(local, { ...local, capabilities: hostileCapabilities })).not.toThrow();
    expect(api.negotiateMatchCapabilityHandshakeV1(local, { ...local, capabilities: hostileCapabilities }))
      .toEqual({ ok: false, code: "handshake_invalid" });
    expect(() => api.createMatchCapabilityHandshakeV1({
      matchId: "界".repeat(128), contentDigest: local.contentDigest, mode: "local_coop"
    })).toThrow(/identity|id/i);
  });

  it("delivers detached frames FIFO through an in-memory local transport pair", async () => {
    const api = await import("./index.js");
    const [left, right] = api.createInMemoryMatchTransportPairV1();
    const received: any[] = [];
    right.subscribe((frame: unknown) => received.push(frame));
    const first: any = { schemaVersion: 1, kind: "command", payload: { sequence: 0 } };
    left.send(first);
    first.payload.sequence = 99;
    left.send({ schemaVersion: 1, kind: "command", payload: { sequence: 1 } });
    expect(received.map((frame) => frame.payload.sequence)).toEqual([0, 1]);
  });

  it("adapts an injected WebSocket-like port without importing or constructing a network runtime", async () => {
    const api = await import("./index.js");
    expect(api.WEBSOCKET_MATCH_TRANSPORT_CONTRACT).toMatchObject({ schemaVersion: 1, wireEncoding: "canonical_json" });
    const listeners = new Map<string, (event: any) => void>();
    const port = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
      removeEventListener: vi.fn()
    };
    const adapter = api.createWebSocketMatchTransportAdapterV1(port);
    const received = vi.fn();
    adapter.subscribe(received);
    adapter.send({ schemaVersion: 1, kind: "handshake", payload: { protocolVersion: 1 } });
    expect(port.send).toHaveBeenCalledOnce();
    listeners.get("message")?.({ data: port.send.mock.calls[0]![0] });
    expect(received).toHaveBeenCalledWith({ schemaVersion: 1, kind: "handshake", payload: { protocolVersion: 1 } });

    const oversized = "x".repeat(api.MATCH_TRANSPORT_LIMITS.maximumFrameBytes + 1);
    expect(() => adapter.send({ payload: oversized })).toThrow(/frame|byte|large|limit/i);
    listeners.get("message")?.({ data: oversized });
    expect(received).toHaveBeenCalledTimes(1);
  });
});
