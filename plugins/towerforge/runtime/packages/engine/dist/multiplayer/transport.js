import { SIMULATION_ENGINE_VERSION } from "../simulation/checkpoint.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
import { MATCH_PROTOCOL_VERSION } from "./match-session.js";
export const MATCH_PROTOCOL_CAPABILITIES_V1 = Object.freeze([
    "checksums",
    "reconnect",
    "replay"
]);
export const MATCH_TRANSPORT_LIMITS = Object.freeze({
    capabilities: 16,
    maximumFrameBytes: 1_048_576
});
function validId(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim() && utf8ByteLength(value) <= 128;
}
function utf8ByteLength(value) {
    return new TextEncoder().encode(value).length;
}
function cloneTransportFrame(value) {
    return JSON.parse(canonicalStringify(value, { maxBytes: MATCH_TRANSPORT_LIMITS.maximumFrameBytes }));
}
export function createMatchCapabilityHandshakeV1(options) {
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
function readHandshake(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    let prototype;
    let descriptors;
    try {
        if (Array.isArray(value))
            return undefined;
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return undefined;
    }
    if (prototype !== Object.prototype && prototype !== null)
        return undefined;
    const keys = ["schemaVersion", "protocolVersion", "engineVersion", "matchId", "contentDigest", "mode", "capabilities"];
    if (Object.getOwnPropertySymbols(descriptors).length > 0
        || Object.keys(descriptors).length !== keys.length || keys.some((key) => !descriptors[key]))
        return undefined;
    const result = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !("value" in descriptor))
            return undefined;
        result[key] = descriptor.value;
    }
    return result;
}
function readCapabilities(value) {
    let isArray;
    let prototype;
    let length;
    let descriptors;
    try {
        isArray = Array.isArray(value);
        if (!isArray)
            return undefined;
        prototype = Object.getPrototypeOf(value);
        length = value.length;
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return undefined;
    }
    if (prototype !== Array.prototype || length > MATCH_TRANSPORT_LIMITS.capabilities)
        return undefined;
    if (Object.getOwnPropertySymbols(descriptors).length > 0
        || Object.keys(descriptors).length !== length + 1)
        return undefined;
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
            || typeof descriptor.value !== "string")
            return undefined;
        result.push(descriptor.value);
    }
    return Object.freeze(result);
}
export function negotiateMatchCapabilityHandshakeV1(localValue, remoteValue) {
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
    if (local.matchId !== remote.matchId)
        return Object.freeze({ ok: false, code: "match_mismatch" });
    if (local.contentDigest !== remote.contentDigest)
        return Object.freeze({ ok: false, code: "content_mismatch" });
    if (local.mode !== remote.mode)
        return Object.freeze({ ok: false, code: "mode_mismatch" });
    if (canonicalStringify(localCapabilities) !== canonicalStringify(remoteCapabilities)
        || canonicalStringify(localCapabilities) !== canonicalStringify(MATCH_PROTOCOL_CAPABILITIES_V1)) {
        return Object.freeze({ ok: false, code: "capability_mismatch" });
    }
    return Object.freeze({ ok: true, protocolVersion: MATCH_PROTOCOL_VERSION });
}
class InMemoryEndpointV1 {
    schemaVersion = 1;
    peer;
    listeners = new Set();
    queue = [];
    draining = false;
    closed = false;
    send(frame) {
        if (this.closed || !this.peer || this.peer.closed)
            throw new Error("Match transport is closed.");
        this.peer.enqueue(cloneTransportFrame(frame));
    }
    enqueue(frame) {
        this.queue.push(frame);
        if (this.draining)
            return;
        this.draining = true;
        try {
            while (this.queue.length > 0) {
                const next = this.queue.shift();
                for (const listener of [...this.listeners])
                    listener(cloneTransportFrame(next));
            }
        }
        finally {
            this.draining = false;
        }
    }
    subscribe(listener) {
        if (this.closed)
            throw new Error("Match transport is closed.");
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    close() {
        this.closed = true;
        this.queue.length = 0;
        this.listeners.clear();
    }
}
export function createInMemoryMatchTransportPairV1() {
    const left = new InMemoryEndpointV1();
    const right = new InMemoryEndpointV1();
    left.peer = right;
    right.peer = left;
    return Object.freeze([left, right]);
}
export const WEBSOCKET_MATCH_TRANSPORT_CONTRACT = Object.freeze({
    schemaVersion: 1,
    wireEncoding: "canonical_json"
});
/** Adapter over an injected port. This module never imports or constructs a network runtime. */
export function createWebSocketMatchTransportAdapterV1(port) {
    if (!port || typeof port.send !== "function" || typeof port.close !== "function"
        || typeof port.addEventListener !== "function" || typeof port.removeEventListener !== "function") {
        throw new Error("A WebSocket-like port must be injected.");
    }
    const listeners = new Set();
    let closed = false;
    const onMessage = (event) => {
        if (closed || typeof event.data !== "string"
            || utf8ByteLength(event.data) > MATCH_TRANSPORT_LIMITS.maximumFrameBytes)
            return;
        let parsed;
        try {
            parsed = JSON.parse(event.data);
            parsed = cloneTransportFrame(parsed);
        }
        catch {
            return;
        }
        for (const listener of [...listeners])
            listener(cloneTransportFrame(parsed));
    };
    port.addEventListener("message", onMessage);
    return Object.freeze({
        schemaVersion: 1,
        send(frame) {
            if (closed || port.readyState !== 1)
                throw new Error("WebSocket-like match port is not open.");
            port.send(canonicalStringify(frame, { maxBytes: MATCH_TRANSPORT_LIMITS.maximumFrameBytes }));
        },
        subscribe(listener) {
            if (closed)
                throw new Error("Match transport is closed.");
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close() {
            if (closed)
                return;
            closed = true;
            listeners.clear();
            port.removeEventListener("message", onMessage);
            port.close(1000, "TowerForge match transport closed");
        }
    });
}
