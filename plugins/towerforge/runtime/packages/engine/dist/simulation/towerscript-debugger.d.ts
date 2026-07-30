import type { GameContentRegistry } from "../content/registry.js";
import { type TowerScriptTraceEntryV1, type TowerScriptTraceSnapshotV1 } from "../scripting/trace.js";
import { type GameCheckpointV1 } from "./checkpoint.js";
import { type GameCommandJournal } from "./journal.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult, GameSnapshot } from "./types.js";
export declare const TOWER_SCRIPT_DEBUG_SCHEMA_VERSION: 2;
export type TowerScriptDebugStepMode = "tick" | "event" | "handler" | "action" | "behavior" | "transition";
export interface TowerScriptDebugCursorV1 {
    readonly schemaVersion: typeof TOWER_SCRIPT_DEBUG_SCHEMA_VERSION;
    readonly mode: TowerScriptDebugStepMode;
    /** Mode-local cursor, intentionally independent from the bounded trace sequence. */
    readonly sequence: number;
    readonly traceSequence: number;
}
export interface TowerScriptDebugStepResultV1 {
    readonly schemaVersion: typeof TOWER_SCRIPT_DEBUG_SCHEMA_VERSION;
    readonly mode: TowerScriptDebugStepMode;
    readonly cursor: TowerScriptDebugCursorV1;
    readonly traceEntry: TowerScriptTraceEntryV1;
    readonly snapshot: GameSnapshot;
    readonly stateDigest: string;
    /** Partial replay frames are inspection-only and never replace the live game. */
    readonly live: false;
}
export type TowerScriptDebugCursorV2 = TowerScriptDebugCursorV1;
export type TowerScriptDebugStepResultV2 = TowerScriptDebugStepResultV1;
export interface TowerScriptDebugCheckpointRingSummaryV1 {
    readonly capacity: number;
    readonly size: number;
    readonly oldestTick: number;
    readonly newestTick: number;
}
export interface TowerScriptDebugSessionOptions {
    readonly content: GameContentRegistry;
    readonly initial: TowerDefenseGame | GameCheckpointV1;
    readonly checkpointRingCapacity: number;
    readonly trace?: {
        readonly maxEntries: number;
    };
}
/**
 * Authoring-only deterministic wrapper. The live game always advances through
 * the existing JournaledGameSession; inspection frames are replayed separately.
 */
export declare class TowerScriptDebugSession {
    private readonly content;
    private readonly initialCheckpoint;
    private readonly checkpointRingCapacity;
    private readonly traceMaxEntries;
    private mutableGame;
    private journalSession;
    private traceCollector;
    private journalEntryCount;
    private commandRecords;
    private replayCheckpointPruneCursor;
    private checkpointRing;
    private currentTick;
    private readonly stepPositions;
    constructor(options: TowerScriptDebugSessionOptions);
    get game(): TowerDefenseGame;
    dispatch(input: unknown): ActionResult;
    getTrace(): TowerScriptTraceSnapshotV1 | null;
    exportJournal(): GameCommandJournal;
    getCheckpointRing(): TowerScriptDebugCheckpointRingSummaryV1;
    step(mode: TowerScriptDebugStepMode): TowerScriptDebugStepResultV1 | null;
    resume(): Readonly<{
        ok: true;
        stateDigest: string;
    }>;
    rewindTicks(ticks: number): Readonly<Record<string, unknown>>;
    private resetRuntime;
    private pushCheckpoint;
    private resetStepPositions;
    private pruneReplayCheckpoints;
    private stepCandidates;
    private previewAction;
    private previewFrame;
    private recordForEntry;
    private checkpointFrame;
    private previewAfterAction;
    private previewBeforePhase;
    private previewAfterPhase;
}
