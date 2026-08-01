import type { GameContentRegistry } from "../content/registry.js";
import { type GameCommandV1, type GameCommandV2, type GameCommandV3, type GameCommandV4, type GameCommandV5, type GameCommandV6, type GameCommandV7, type GameCommandV8 } from "./command-internal.js";
import { SIMULATION_ENGINE_VERSION, type GameCheckpointV1 } from "./checkpoint.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult } from "./types.js";
export declare const GAME_COMMAND_JOURNAL_SCHEMA_VERSION: 8;
export declare const GAME_COMMAND_JOURNAL_SUPPORTED_SCHEMA_VERSIONS: readonly [1, 2, 3, 4, 5, 6, 7, 8];
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
    readonly schemaVersion: 1;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV1[];
}
export interface GameCommandJournalEntryV2 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV2 {
    readonly schemaVersion: 2;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV2[];
}
export interface GameCommandJournalEntryV3 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV3 {
    readonly schemaVersion: 3;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV3[];
}
export interface GameCommandJournalEntryV4 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3 | GameCommandV4;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV4 {
    readonly schemaVersion: 4;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV4[];
}
export interface GameCommandJournalEntryV5 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3 | GameCommandV4 | GameCommandV5;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV5 {
    readonly schemaVersion: 5;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV5[];
}
export interface GameCommandJournalEntryV6 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3 | GameCommandV4 | GameCommandV5 | GameCommandV6;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV6 {
    readonly schemaVersion: 6;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV6[];
}
export interface GameCommandJournalEntryV7 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3 | GameCommandV4 | GameCommandV5 | GameCommandV6 | GameCommandV7;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV7 {
    readonly schemaVersion: 7;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV7[];
}
export interface GameCommandJournalEntryV8 {
    readonly sequence: number;
    readonly command: GameCommandV1 | GameCommandV2 | GameCommandV3 | GameCommandV4 | GameCommandV5 | GameCommandV6 | GameCommandV7 | GameCommandV8;
    readonly result: GameCommandJournalResultV1;
    readonly postStateDigest: string;
}
export interface GameCommandJournalV8 {
    readonly schemaVersion: 8;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly initialCheckpoint: GameCheckpointV1;
    readonly entries: readonly GameCommandJournalEntryV8[];
}
export type GameCommandJournal = GameCommandJournalV1 | GameCommandJournalV2 | GameCommandJournalV3 | GameCommandJournalV4 | GameCommandJournalV5 | GameCommandJournalV6 | GameCommandJournalV7 | GameCommandJournalV8;
export interface GameCommandJournalAcceptedTail {
    readonly entryCount: number;
    readonly entry?: GameCommandJournalEntryV8;
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
    private journalSchemaVersion;
    private journalEnvelopeBytes;
    private journalEnvelopeNodes;
    private journalEntryBytes;
    private journalEntryNodes;
    private expectedStateDigest;
    private faulted;
    constructor(game: TowerDefenseGame);
    private assertHealthy;
    private fault;
    private assertExpectedState;
    private assertLiveCapacity;
    private assertIncrementalCapacity;
    private refreshJournalEnvelope;
    dispatch(input: unknown): ActionResult;
    /**
     * O(1) view used by deterministic wrappers that already own this session.
     * It detaches only the latest accepted entry; complete journal cloning and
     * budget validation remain exclusive to explicit exportJournal() calls.
     */
    getAcceptedTail(): GameCommandJournalAcceptedTail;
    exportJournal(): GameCommandJournal;
}
/**
 * Validate a journal as closed, bounded, detached data. Commands are decoded but
 * deliberately never executed; replay is a separate contract.
 */
export declare function decodeGameCommandJournal(options: {
    content: GameContentRegistry;
    journal: GameCommandJournal;
}): GameCommandJournal;
