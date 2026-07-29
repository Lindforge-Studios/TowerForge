import type { TowerScriptBehaviorNodeV1, TowerScriptBehaviorTreeV1, TowerScriptJson } from "./types.js";
export type { TowerScriptBehaviorNodeV1, TowerScriptBehaviorTreeV1 } from "./types.js";
export interface TowerScriptTargetCandidateV1 {
    readonly id: string;
    readonly typeId: string;
    readonly tags: readonly string[];
    readonly hp: number;
    readonly maxHp: number;
    readonly hpRatio: number;
    readonly distance: number;
    readonly routeProgress: number;
    readonly hasPierceOnlyArmor: boolean;
    readonly shieldCurrent?: number;
    readonly shieldCapacity?: number;
    readonly statuses?: Readonly<Record<string, TowerScriptJson>>;
    readonly marks?: Readonly<Record<string, TowerScriptJson>>;
    readonly exposures?: Readonly<Record<string, TowerScriptJson>>;
}
export interface TowerScriptBehaviorTreeContextV1 {
    readonly tower: Readonly<Record<string, TowerScriptJson | undefined>>;
    readonly game: Readonly<Record<string, TowerScriptJson | undefined>>;
    readonly state: Readonly<Record<string, TowerScriptJson>>;
    readonly candidates: readonly TowerScriptTargetCandidateV1[];
}
export interface TowerScriptBehaviorTreeResultV1 {
    readonly schemaVersion: 1;
    readonly status: "success" | "failure";
    readonly selectedTargetIds: readonly string[];
    readonly visitedNodeIds: readonly string[];
    readonly trace: readonly TowerScriptBehaviorNodeTraceV1[];
    readonly diagnostic?: Readonly<{
        code: "budget_exceeded" | "invalid_expression" | "invalid_tree";
        message: string;
    }>;
}
export interface TowerScriptBehaviorNodeTraceV1 {
    readonly nodeId: string;
    readonly nodeKind: TowerScriptBehaviorNodeV1["type"];
    readonly status: "success" | "failure";
    readonly selectedTargetIds?: readonly string[];
}
/**
 * Pure deterministic TowerScript v7 target decision evaluator. It owns no game state and never
 * calls a renderer or host callback. A caller applies the returned ids only to its prevalidated
 * acquisition candidates and falls back to the tower's ordinary target mode on failure.
 */
export declare function evaluateTowerScriptBehaviorTree(tree: TowerScriptBehaviorTreeV1, context: TowerScriptBehaviorTreeContextV1): TowerScriptBehaviorTreeResultV1;
