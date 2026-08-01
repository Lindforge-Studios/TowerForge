import type { GameContentRegistry } from "../content/registry.js";
import type { GameCommand } from "../simulation/command-internal.js";
import { type GameCommandJournal } from "../simulation/journal.js";
import { type DecodedReplayArchiveV1 } from "./replay-archive.js";
export interface ReplayBranchV1 {
    readonly schemaVersion: 1;
    readonly parentArchiveDigest: string;
    readonly forkSequence: number;
    readonly journalSuffix: GameCommandJournal;
    readonly branchDigest: string;
}
export interface ReplayBranchResultV1 {
    readonly branchDigest: string;
    readonly stateDigest: string;
    readonly entriesReplayed: number;
}
export type ReplayBranchDivergenceV1 = Readonly<{
    schemaVersion: 1;
    divergent: false;
}> | Readonly<{
    schemaVersion: 1;
    divergent: true;
    firstDivergentSequence: number;
    parentStateDigest: string;
    branchStateDigest: string;
}>;
export declare function createReplayBranchV1(options: {
    readonly content: GameContentRegistry;
    readonly archive: DecodedReplayArchiveV1;
    readonly forkSequence: number;
    readonly commands: readonly GameCommand[];
}): ReplayBranchV1;
export declare function replayReplayBranchV1(options: {
    readonly content: GameContentRegistry;
    readonly archive: DecodedReplayArchiveV1;
    readonly branch: unknown;
}): ReplayBranchResultV1;
export declare function diagnoseReplayBranchDivergenceV1(options: {
    readonly content: GameContentRegistry;
    readonly archive: DecodedReplayArchiveV1;
    readonly branch: unknown;
}): ReplayBranchDivergenceV1;
