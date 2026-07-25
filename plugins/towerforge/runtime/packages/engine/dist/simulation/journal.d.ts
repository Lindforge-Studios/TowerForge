import type { GameContentRegistry } from "../content/registry.js";
import { type GameCommandV1 } from "./command-internal.js";
import { SIMULATION_ENGINE_VERSION, type GameCheckpointV1 } from "./checkpoint.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult } from "./types.js";
export declare const GAME_COMMAND_JOURNAL_SCHEMA_VERSION: 1;
export declare const GAME_COMMAND_JOURNAL_LIMITS: Readonly<{
    entries: 100000;
    totalBytes: number;
    resultBytes: number;
    reasonParams: 256;
}>;
export interface GameCommandJournalResultV1 {
    readonly ok: boolean;
    readonly reasonKey?: string;
    readonly reasonParams?: Readonly<Record<string, string | number>>;
}
export interface GameCommandJournalEntryV1 {
    readonly sequence: number;
    readonly command: GameCommandV1;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV1 {
    readonly schemaVersion: typeof GAME_COMMAND_JOURNAL_SCHEMA_VERSION;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV1[];
}
/**
 * Owns the command boundary around one simulation instance. Any mutation that
 * bypasses dispatch makes the journal ambiguous, so the session faults closed.
 */
export declare class JournaledGameSession {
    readonly game: Readonly<TowerDefenseGame>;
    private readonly mutableGame;
    private readonly initialCheckpoint;
    private readonly contentDigest;
    private readonly entries;
    private expectedStateDigest;
    private faulted;
    constructor(game: TowerDefenseGame);
    private assertHealthy;
    private fault;
    private assertExpectedState;
    private assertLiveCapacity;
    dispatch(input: unknown): ActionResult;
    exportJournal(): GameCommandJournalV1;
}
/**
 * Validate a journal as closed, bounded, detached data. Commands are decoded but
 * deliberately never executed; replay is a separate contract.
 */
export declare function decodeGameCommandJournal(options: {
    content: GameContentRegistry;
    journal: GameCommandJournalV1;
}): GameCommandJournalV1;
