import { SIMULATION_ENGINE_VERSION } from "../simulation/checkpoint.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
import { MATCH_PROTOCOL_VERSION } from "./match-session.js";

export type MatchProtocolModeV1 = "local_coop" | "asymmetric_send_vs_build";

export const MATCH_PROTOCOL_CAPABILITIES_V1 = Object.freeze([
  "checksums",
  "reconnect",
  "replay"
] as const);

export const MATCH_TRANSPORT_LIMITS = Object.freeze({
  capabilities: 16,
  maximumFrameBytes: 1_048_576
});

export interface MatchCapabilityHandshakeV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
  readonly matchId: string;
  readonly contentDigest: string;
  readonly mode: MatchProtocolModeV1;
  readonly capabilities: readonly (typeof MATCH_PROTOCOL_CAPABILITIES_V1)[number][];
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() && utf8ByteLength(value) <= 128;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function cloneTransportFrame<T>(value: T): T {
  return JSON.parse(canonicalStringify(value, { maxBytes: MATCH_TRANSPORT_LIMITS.maximumFrameBytes })) as T;
}

export function createMatchCapabilityHandshakeV1(options: {
  readonly matchId: string;
  readonly contentDigest: string;
  readonly mode: MatchProtocolModeV1;
}): MatchCapabilityHandshakeV1 {
  if (!validId(options.matchId) || !/^tf-content-v1:[0-9a-f]{16}$/.test(options.contentDigest)
    || (options.mode !== "local_coop" && options.mode !== "asymmetric_send_vs_build")) {
    throw new Error("Invalid match capability handshake identity.");
  }
  return Object.freeze({
    schemaVersion: 1,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    engineVersion: SIMULATION_ENGINE_VERSION,
    matchId: options.matchId,
    contentDigest: options.contentDigest,
    mode: options.mode,
    capabilities: MATCH_PROTOCOL_CAPABILITIES_V1
  });
}

export type MatchHandshakeNegotiationV1 =
  | Readonly<{ ok: true; protocolVersion: 1 }>
  | Readonly<{ ok: false; code: "handshake_invalid" | "protocol_mismatch" | "engine_mismatch" | "match_mismatch" | "content_mismatch" | "mode_mismatch" | "capability_mismatch" }>;

function readHandshake(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    if (Array.isArray(value)) return undefined;
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = ["schemaVersion", "protocolVersion", "engineVersion", "matchId", "contentDigest", "mode", "capabilities"];
  if (Object.getOwnPropertySymbols(descriptors).length > 0
    || Object.keys(descriptors).length !== keys.length || keys.some((key) => !descriptors[key])) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function readCapabilities(value: unknown): readonly string[] | undefined {
  let isArray: boolean;
  let prototype: object | null;
  let length: number;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    isArray = Array.isArray(value);
    if (!isArray) return undefined;
    prototype = Object.getPrototypeOf(value);
    length = (value as unknown[]).length;
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return undefined;
  }
  if (prototype !== Array.prototype || length > MATCH_TRANSPORT_LIMITS.capabilities) return undefined;
  if (Object.getOwnPropertySymbols(descriptors).length > 0
    || Object.keys(descriptors).length !== length + 1) return undefined;
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
      || typeof descriptor.value !== "string") return undefined;
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

export function negotiateMatchCapabilityHandshakeV1(
  localValue: unknown,
  remoteValue: unknown
): MatchHandshakeNegotiationV1 {
  const local = readHandshake(localValue);
  const remote = readHandshake(remoteValue);
  const localCapabilities = local ? readCapabilities(local.capabilities) : undefined;
  const remoteCapabilities = remote ? readCapabilities(remote.capabilities) : undefined;
  if (!local || !remote || local.schemaVersion !== 1 || remote.schemaVersion !== 1
    || !validId(local.matchId) || !validId(remote.matchId)
    || typeof local.contentDigest !== "string" || typeof remote.contentDigest !== "string"
    || !/^tf-content-v1:[0-9a-f]{16}$/.test(local.contentDigest)
    || !/^tf-content-v1:[0-9a-f]{16}$/.test(remote.contentDigest)
    || (local.mode !== "local_coop" && local.mode !== "asymmetric_send_vs_build")
    || (remote.mode !== "local_coop" && remote.mode !== "asymmetric_send_vs_build")
    || !localCapabilities || !remoteCapabilities) {
    return Object.freeze({ ok: false, code: "handshake_invalid" });
  }
  if (local.protocolVersion !== MATCH_PROTOCOL_VERSION || remote.protocolVersion !== MATCH_PROTOCOL_VERSION) {
    return Object.freeze({ ok: false, code: "protocol_mismatch" });
  }
  if (local.engineVersion !== SIMULATION_ENGINE_VERSION || remote.engineVersion !== SIMULATION_ENGINE_VERSION) {
    return Object.freeze({ ok: false, code: "engine_mismatch" });
  }
  if (local.matchId !== remote.matchId) return Object.freeze({ ok: false, code: "match_mismatch" });
  if (local.contentDigest !== remote.contentDigest) return Object.freeze({ ok: false, code: "content_mismatch" });
  if (local.mode !== remote.mode) return Object.freeze({ ok: false, code: "mode_mismatch" });
  if (canonicalStringify(localCapabilities) !== canonicalStringify(remoteCapabilities)
    || canonicalStringify(localCapabilities) !== canonicalStringify(MATCH_PROTOCOL_CAPABILITIES_V1)) {
    return Object.freeze({ ok: false, code: "capability_mismatch" });
  }
  return Object.freeze({ ok: true, protocolVersion: MATCH_PROTOCOL_VERSION });
}

export type MatchTransportListenerV1 = (frame: unknown) => void;

export interface MatchTransportV1 {
  readonly schemaVersion: 1;
  send(frame: unknown): void;
  subscribe(listener: MatchTransportListenerV1): () => void;
  close(): void;
}

class InMemoryEndpointV1 implements MatchTransportV1 {
  readonly schemaVersion = 1 as const;
  peer?: InMemoryEndpointV1;
  private readonly listeners = new Set<MatchTransportListenerV1>();
  private readonly queue: unknown[] = [];
  private draining = false;
  private closed = false;

  send(frame: unknown): void {
    if (this.closed || !this.peer || this.peer.closed) throw new Error("Match transport is closed.");
    this.peer.enqueue(cloneTransportFrame(frame));
  }

  private enqueue(frame: unknown): void {
    this.queue.push(frame);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        for (const listener of [...this.listeners]) listener(cloneTransportFrame(next));
      }
    } finally {
      this.draining = false;
    }
  }

  subscribe(listener: MatchTransportListenerV1): () => void {
    if (this.closed) throw new Error("Match transport is closed.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.listeners.clear();
  }
}

export function createInMemoryMatchTransportPairV1(): readonly [MatchTransportV1, MatchTransportV1] {
  const left = new InMemoryEndpointV1();
  const right = new InMemoryEndpointV1();
  left.peer = right;
  right.peer = left;
  return Object.freeze([left, right] as const);
}

export const WEBSOCKET_MATCH_TRANSPORT_CONTRACT = Object.freeze({
  schemaVersion: 1,
  wireEncoding: "canonical_json" as const
});

export interface WebSocketLikePortV1 {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message" | "close" | "error", listener: (event: { readonly data?: unknown }) => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: (event: { readonly data?: unknown }) => void): void;
}

/** Adapter over an injected port. This module never imports or constructs a network runtime. */
export function createWebSocketMatchTransportAdapterV1(port: WebSocketLikePortV1): MatchTransportV1 {
  if (!port || typeof port.send !== "function" || typeof port.close !== "function"
    || typeof port.addEventListener !== "function" || typeof port.removeEventListener !== "function") {
    throw new Error("A WebSocket-like port must be injected.");
  }
  const listeners = new Set<MatchTransportListenerV1>();
  let closed = false;
  const onMessage = (event: { readonly data?: unknown }) => {
    if (closed || typeof event.data !== "string"
      || utf8ByteLength(event.data) > MATCH_TRANSPORT_LIMITS.maximumFrameBytes) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
      parsed = cloneTransportFrame(parsed);
    } catch {
      return;
    }
    for (const listener of [...listeners]) listener(cloneTransportFrame(parsed));
  };
  port.addEventListener("message", onMessage);
  return Object.freeze({
    schemaVersion: 1 as const,
    send(frame: unknown) {
      if (closed || port.readyState !== 1) throw new Error("WebSocket-like match port is not open.");
      port.send(canonicalStringify(frame, { maxBytes: MATCH_TRANSPORT_LIMITS.maximumFrameBytes }));
    },
    subscribe(listener: MatchTransportListenerV1) {
      if (closed) throw new Error("Match transport is closed.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      port.removeEventListener("message", onMessage);
      port.close(1000, "TowerForge match transport closed");
    }
  });
}
