import type { GameContentRegistry } from "../content/registry.js";
import type { GameSnapshot } from "./types.js";
export declare const PERSONA_QA_PERSONA_IDS: readonly ["aggressive_rush", "greedy_economy", "turtle_shield"];
export type PersonaQaPersonaId = (typeof PERSONA_QA_PERSONA_IDS)[number];
export declare const PERSONA_QA_LIMITS: Readonly<{
    missionIds: 32;
    seeds: 64;
    personaIds: 3;
    totalRuns: 1024;
    totalTicks: 2000000;
    simSeconds: 3600;
    minimumTickStep: 0.05;
    maximumTickStep: 0.2;
    dimensionValueUtf8Bytes: 256;
    mapCells: 65536;
    buildPassesPerDecision: 80;
    upgradesPerTowerPerDecision: 4;
}>;
export interface PersonaQaRequestV1 {
    readonly schemaVersion: 1;
    readonly missionIds: readonly string[];
    readonly seeds: readonly string[];
    readonly personaIds: readonly PersonaQaPersonaId[];
    readonly simSeconds: number;
    readonly tickStep: number;
}
export interface PersonaQaRunV1 {
    readonly missionId: string;
    readonly seed: string;
    readonly personaId: PersonaQaPersonaId;
    readonly outcome: GameSnapshot["outcome"];
    readonly stateDigest: string;
    readonly coreHpRemaining: number;
    readonly towersBuilt: number;
    readonly leaks: number;
    readonly elapsed: number;
    readonly acceptedCommandCount: number;
}
export interface PersonaQaReportV1 {
    readonly schemaVersion: 1;
    readonly status: "completed";
    readonly missionIds: readonly string[];
    readonly seeds: readonly string[];
    readonly personaIds: readonly PersonaQaPersonaId[];
    readonly runs: readonly PersonaQaRunV1[];
}
/**
 * Run the fixed R10 player-persona matrix in the pure engine.
 *
 * The input is validated and detached before any simulation starts. Ordering of authored tower
 * records, mission build lists, and request dimensions cannot influence a report.
 */
export declare function runPersonaQaSuiteV1(content: GameContentRegistry, input: PersonaQaRequestV1): PersonaQaReportV1;
export interface PersonaQaReplayProofV1 {
    readonly run: PersonaQaRunV1;
    readonly journalEntryCount: number;
    readonly continuousStateDigest: string;
    readonly replayStateDigest: string;
    readonly snapshotEquivalent: boolean;
}
/**
 * Produce an audit proof for one fixed persona case without changing the compact batch report.
 * The exact policy command stream is recorded once and replayed by the canonical journal runtime.
 */
export declare function provePersonaQaReplayV1(content: GameContentRegistry, input: PersonaQaRequestV1): PersonaQaReplayProofV1;
