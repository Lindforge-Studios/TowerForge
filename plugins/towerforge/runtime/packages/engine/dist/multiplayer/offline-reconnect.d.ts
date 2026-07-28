import type { GameContentRegistry } from "../content/registry.js";
import { type GameCheckpointV1 } from "../simulation/checkpoint.js";
import type { GameSeed } from "../simulation/rng.js";
import { type MatchChecksumTimelineV1, type MatchCommandJournalV1, MatchSession } from "./match-session.js";
export interface OfflineChallengeV1 {
    readonly schemaVersion: 1;
    readonly challengeId: string;
    readonly seed: GameSeed;
    readonly journal: MatchCommandJournalV1;
    readonly expectedChecksum: string;
    readonly checksum: string;
}
export interface MatchReconnectBundleV1 {
    readonly schemaVersion: 1;
    readonly protocolVersion: 1;
    readonly checkpoint: GameCheckpointV1;
    readonly acceptedJournal: MatchCommandJournalV1;
    readonly checksum: string;
}
/** Bind a replayable local match to the published challenge seed and final checksum. */
export declare function createOfflineChallengeV1(options: {
    readonly challengeId: string;
    readonly seed: GameSeed;
    readonly session: MatchSession;
}): OfflineChallengeV1;
export declare function replayOfflineChallengeV1(options: {
    readonly content: GameContentRegistry;
    readonly challenge: OfflineChallengeV1;
}): Readonly<{
    verified: true;
    checksum: string;
    session: MatchSession;
}>;
/** Export the authoritative engine checkpoint plus the accepted protocol journal. */
export declare function createMatchReconnectBundleV1(session: MatchSession): MatchReconnectBundleV1;
/** Restore via deterministic journal replay and verify its current checkpoint before continuing. */
export declare function restoreMatchReconnectBundleV1(options: {
    readonly content: GameContentRegistry;
    readonly bundle: MatchReconnectBundleV1;
}): MatchSession;
export interface MatchDesyncDiagnosticV1 {
    readonly schemaVersion: 1;
    readonly divergent: boolean;
    readonly firstDivergentTick?: number;
    readonly localChecksum?: string;
    readonly remoteChecksum?: string;
}
/** Return the earliest unequal or missing fixed-tick checksum frame. */
export declare function diagnoseMatchDesyncV1(local: MatchChecksumTimelineV1, remote: MatchChecksumTimelineV1): MatchDesyncDiagnosticV1;
