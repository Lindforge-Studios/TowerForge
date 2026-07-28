import { SIMULATION_ENGINE_VERSION } from "../simulation/checkpoint.js";
export type MatchProtocolModeV1 = "local_coop" | "asymmetric_send_vs_build";
export declare const MATCH_PROTOCOL_CAPABILITIES_V1: readonly ["checksums", "reconnect", "replay"];
export declare const MATCH_TRANSPORT_LIMITS: Readonly<{
    capabilities: 16;
    maximumFrameBytes: 1048576;
}>;
export interface MatchCapabilityHandshakeV1 {
    readonly schemaVersion: 1;
    readonly protocolVersion: 1;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly matchId: string;
    readonly contentDigest: string;
    readonly mode: MatchProtocolModeV1;
    readonly capabilities: readonly (typeof MATCH_PROTOCOL_CAPABILITIES_V1)[number][];
}
export declare function createMatchCapabilityHandshakeV1(options: {
    readonly matchId: string;
    readonly contentDigest: string;
    readonly mode: MatchProtocolModeV1;
}): MatchCapabilityHandshakeV1;
export type MatchHandshakeNegotiationV1 = Readonly<{
    ok: true;
    protocolVersion: 1;
}> | Readonly<{
    ok: false;
    code: "handshake_invalid" | "protocol_mismatch" | "engine_mismatch" | "match_mismatch" | "content_mismatch" | "mode_mismatch" | "capability_mismatch";
}>;
export declare function negotiateMatchCapabilityHandshakeV1(localValue: unknown, remoteValue: unknown): MatchHandshakeNegotiationV1;
export type MatchTransportListenerV1 = (frame: unknown) => void;
export interface MatchTransportV1 {
    readonly schemaVersion: 1;
    send(frame: unknown): void;
    subscribe(listener: MatchTransportListenerV1): () => void;
    close(): void;
}
export declare function createInMemoryMatchTransportPairV1(): readonly [MatchTransportV1, MatchTransportV1];
export declare const WEBSOCKET_MATCH_TRANSPORT_CONTRACT: Readonly<{
    schemaVersion: 1;
    wireEncoding: "canonical_json";
}>;
export interface WebSocketLikePortV1 {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "message" | "close" | "error", listener: (event: {
        readonly data?: unknown;
    }) => void): void;
    removeEventListener(type: "message" | "close" | "error", listener: (event: {
        readonly data?: unknown;
    }) => void): void;
}
/** Adapter over an injected port. This module never imports or constructs a network runtime. */
export declare function createWebSocketMatchTransportAdapterV1(port: WebSocketLikePortV1): MatchTransportV1;
