import type { GameSnapshot } from "../simulation/types.js";
import { type DecodedReplayArchiveV1 } from "./replay-archive.js";
export declare const GHOST_REPLAY_LIMITS: Readonly<{
    maximumCachedFrames: 256;
}>;
export interface GhostReplayFrameV1 {
    readonly schemaVersion: 1;
    readonly ghost: true;
    /** Number of journal entries replayed into this frame, in the inclusive range 0..N. */
    readonly sequence: number;
    readonly stateDigest: string;
    readonly snapshot: GameSnapshot;
}
export interface GhostReplaySessionV1 {
    seek(sequence: number): GhostReplayFrameV1;
    advance(): GhostReplayFrameV1;
    final(): GhostReplayFrameV1;
}
export declare function createGhostReplaySessionV1(options: {
    readonly archive: DecodedReplayArchiveV1;
}): GhostReplaySessionV1;
