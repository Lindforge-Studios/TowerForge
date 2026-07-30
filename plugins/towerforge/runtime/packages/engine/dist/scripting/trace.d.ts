import type { TowerScriptAction, TowerScriptDiagnostic, TowerScriptEventName, TowerScriptJson } from "./types.js";
export declare const TOWER_SCRIPT_TRACE_SCHEMA_VERSION: 2;
export type TowerScriptTracePhase = "event" | "binding" | "handler" | "condition" | "behavior" | "transition" | "action" | "state_diff" | "diagnostic";
export type TowerScriptStateChangeV1 = Readonly<{
    op: "add" | "remove" | "replace";
    path: string;
    before?: TowerScriptJson;
    after?: TowerScriptJson;
}>;
interface TowerScriptTraceEntryBaseV1 {
    readonly schemaVersion: typeof TOWER_SCRIPT_TRACE_SCHEMA_VERSION;
    readonly sequence: number;
    readonly parentSequence?: number;
    readonly phase: TowerScriptTracePhase;
    readonly eventName?: TowerScriptEventName;
    readonly scriptId?: string;
    readonly bindingIndex?: number;
    readonly contextId?: string;
    readonly handlerId?: string;
    readonly handlerIndex?: number;
    readonly actionIndex?: number;
    /** Absolute action occurrence before this entry, stable across bounded eviction. */
    readonly actionsBefore?: number;
    /** Absolute action occurrence of an action entry, stable across bounded eviction. */
    readonly actionOrdinal?: number;
    /** Absolute occurrence within this phase, stable across bounded eviction. */
    readonly phaseOrdinal: number;
}
export type TowerScriptTraceEntryV2 = Readonly<TowerScriptTraceEntryBaseV1 & {
    readonly event?: Readonly<Record<string, TowerScriptJson>>;
    readonly scope?: string;
    readonly result?: boolean;
    readonly controllerId?: string;
    readonly nodeId?: string;
    readonly nodeKind?: string;
    readonly status?: "success" | "failure";
    readonly selectedTargetIds?: readonly string[];
    readonly machineId?: string;
    readonly transitionId?: string;
    readonly fromStatePath?: string;
    readonly toStatePath?: string;
    readonly actionPhase?: "entry" | "exit" | "transition";
    readonly action?: TowerScriptAction;
    readonly changes?: readonly TowerScriptStateChangeV1[];
    readonly diagnostic?: TowerScriptDiagnostic;
}>;
/** Compatibility type name retained for consumers compiled against R6. */
export type TowerScriptTraceEntryV1 = TowerScriptTraceEntryV2;
export interface TowerScriptTraceSnapshotV2 {
    readonly schemaVersion: typeof TOWER_SCRIPT_TRACE_SCHEMA_VERSION;
    readonly maxEntries: number;
    readonly maxBytes: number;
    readonly retainedBytes: number;
    readonly droppedEntries: number;
    readonly totalEntries: number;
    readonly totalActions: number;
    readonly phaseTotals: Readonly<Record<TowerScriptTracePhase, number>>;
    readonly entries: readonly TowerScriptTraceEntryV2[];
}
/** Compatibility type name retained for consumers compiled against R6. */
export type TowerScriptTraceSnapshotV1 = TowerScriptTraceSnapshotV2;
export interface TowerScriptTraceCollector {
    readonly maxEntries: number;
    readonly maxBytes: number;
    record(entry: Omit<TowerScriptTraceEntryV2, "schemaVersion" | "sequence" | "actionsBefore" | "actionOrdinal" | "phaseOrdinal">): TowerScriptTraceEntryV2;
    clear(): void;
    getSnapshot(): TowerScriptTraceSnapshotV1;
    /** Internal debugger control-flow check; ordinary collectors always return false. */
    shouldPauseAfterAction(sequence: number): boolean;
    /** Internal debugger control-flow check for pre-event/pre-handler boundaries. */
    shouldPauseBeforeEntry(sequence: number): boolean;
    /** Internal debugger control-flow check for post-phase boundaries. */
    shouldPauseAfterEntry(sequence: number): boolean;
}
export declare function createTowerScriptTraceCollector(options: {
    readonly maxEntries: number;
    readonly maxBytes?: number;
    /** Zero-based action occurrence inside one replayed command. */
    readonly pauseAfterAction?: number;
    /** Zero-based occurrence of any trace phase inside one replayed command. */
    readonly pauseAfter?: Readonly<{
        phase: TowerScriptTracePhase;
        occurrence: number;
    }>;
    /** Zero-based phase occurrence inside one replayed command. */
    readonly pauseBefore?: Readonly<{
        phase: "event" | "handler";
        occurrence: number;
    }>;
}): TowerScriptTraceCollector;
/** Debugger-only control flow. The runtime must never convert it to a gameplay diagnostic. */
export declare class TowerScriptTracePauseError extends Error {
    readonly code: "TOWER_SCRIPT_TRACE_PAUSE";
    readonly traceSequence: number;
    /** @deprecated Use traceSequence. */
    readonly actionSequence: number;
    constructor(traceSequence: number);
}
export declare function diffTowerScriptState(before: Readonly<Record<string, TowerScriptJson>>, after: Readonly<Record<string, TowerScriptJson>>): readonly TowerScriptStateChangeV1[];
export {};
