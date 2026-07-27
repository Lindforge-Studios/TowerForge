import type { GameContentRegistry } from "../content/registry.js";
import { type GameCommandJournalResultV1, type GameCommandJournal } from "./journal.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
export type GameCommandReplayDivergenceKind = "result" | "postStateDigest";
type GameCommandReplayDivergenceDetails = {
    readonly kind: "result";
    readonly sequence: number;
    readonly expected: GameCommandJournalResultV1;
    readonly actual: GameCommandJournalResultV1;
} | {
    readonly kind: "postStateDigest";
    readonly sequence: number;
    readonly expected: string;
    readonly actual: string;
};
export declare class GameCommandReplayDivergenceError extends Error {
    readonly code: "GAME_COMMAND_REPLAY_DIVERGENCE";
    readonly kind: GameCommandReplayDivergenceKind;
    readonly sequence: number;
    readonly expected: GameCommandJournalResultV1 | string;
    readonly actual: GameCommandJournalResultV1 | string;
    constructor(details: GameCommandReplayDivergenceDetails);
}
export declare class GameCommandReplayExecutionError extends Error {
    readonly code: "GAME_COMMAND_REPLAY_EXECUTION_FAILED";
    readonly sequence: number;
    readonly cause: unknown;
    constructor(sequence: number, cause: unknown);
}
export interface GameCommandReplayResult {
    readonly game: TowerDefenseGame;
    readonly entriesReplayed: number;
    readonly stateDigest: string;
}
/**
 * Validate a complete journal before creating a map, then replay each already
 * canonical command exactly once while checking result before post-state digest.
 */
export declare function replayGameCommandJournal(options: {
    content: GameContentRegistry;
    journal: GameCommandJournal;
}): GameCommandReplayResult;
export {};
