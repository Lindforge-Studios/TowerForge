import type { GameContentRegistry } from "../content/registry.js";
import { SIMULATION_ENGINE_VERSION } from "../simulation/checkpoint.js";
import { type GameCommandJournal } from "../simulation/journal.js";
export declare const REPLAY_ARCHIVE_SCHEMA_VERSION: 1;
export declare const REPLAY_ARCHIVE_MAGIC: readonly [84, 70, 82, 80];
export declare const REPLAY_ARCHIVE_HEADER_BYTES: 20;
export declare const REPLAY_ARCHIVE_LIMITS: Readonly<{
    maximumBytes: number;
    maximumPayloadBytes: number;
}>;
export interface ReplayArchiveEnvelopeV1 {
    readonly schemaVersion: 1;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly payloadKind: "game_command_journal";
    readonly contentDigest: string;
    readonly capabilityDigest: string;
    readonly missionId: string;
    readonly journal: GameCommandJournal;
}
export interface DecodedReplayArchiveV1 extends ReplayArchiveEnvelopeV1 {
    readonly archiveDigest: string;
}
/** Package-internal decoded-archive brand and content lookup for Ghost/What-If runtimes. */
export declare function replayArchiveContentV1(archive: unknown): GameContentRegistry | undefined;
/** Package-internal domain-separated digest primitive shared by Replay Lab codecs. */
export declare function replayLabDomainDigestV1(prefix: string, domain: string, canonicalPayload: string): string;
export declare function computeReplayCapabilityDigestV1(options: {
    readonly content: GameContentRegistry;
    readonly missionId: string;
}): string;
export declare function encodeReplayArchiveV1(options: {
    readonly content: GameContentRegistry;
    readonly journal: GameCommandJournal;
}): Uint8Array;
export declare function decodeReplayArchiveV1(options: {
    readonly content: GameContentRegistry;
    readonly bytes: Uint8Array;
}): DecodedReplayArchiveV1;
