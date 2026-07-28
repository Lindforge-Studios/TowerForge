import type { GameContentRegistry } from "./registry.js";
import type { WaveGroup } from "../simulation/types.js";
export declare const DIRECTOR_LIMITS: Readonly<{
    counterDefinitions: 256;
    conditionsPerCounter: 8;
    groupsPerCounter: 8;
    totalCounterGroups: 2048;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 256;
    addedGroupsPerDecision: 8;
    addedEnemiesPerDecision: 1024;
    threatCost: 1000000000;
    decisionHistory: 1024;
}>;
export declare const DIRECTOR_METRICS: readonly ["damage_share", "coverage_ratio", "movement_layer_share", "logistics_brownout_ratio"];
export type DirectorMetricV1 = (typeof DIRECTOR_METRICS)[number];
export type DirectorConditionOperatorV1 = "gte" | "lte";
export interface DirectorConditionV1 {
    readonly metric: DirectorMetricV1;
    readonly key?: string;
    readonly operator: DirectorConditionOperatorV1;
    readonly threshold: number;
}
export interface DirectorCounterV1 {
    readonly label: string;
    readonly priority: number;
    readonly conditions: readonly DirectorConditionV1[];
    readonly groups: readonly WaveGroup[];
    readonly threatCost: number;
}
export interface DirectorProfileV1 {
    readonly counterPool: Readonly<Record<string, DirectorCounterV1>>;
    readonly threatBudget: {
        readonly base: number;
        readonly perWave: number;
    };
    readonly fairness: {
        readonly minimumWaveIndex: number;
        readonly maxConsecutiveUses: number;
        readonly maxAddedGroups: number;
        readonly maxAddedEnemies: number;
    };
}
export interface ActiveDirectorMechanicsV1 extends DirectorProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export declare class DirectorProfileValidationError extends Error {
}
/** Parse the exact closed Director v1 profile into detached, deeply frozen own data. */
export declare function normalizeDirectorProfileV1(value: unknown): DirectorProfileV1;
export declare function resolveActiveDirectorMechanics(content: GameContentRegistry, missionId: string): ActiveDirectorMechanicsV1 | undefined;
