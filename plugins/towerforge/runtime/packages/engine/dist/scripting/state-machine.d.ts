import type { TowerScriptAction, TowerScriptEventName, TowerScriptMachineRuntimeStateV1, TowerScriptStateMachineV1 } from "./types.js";
export type { TowerScriptMachineRuntimeStateV1 } from "./types.js";
export interface TowerScriptMachineExpressionContextV1 {
    readonly event: Readonly<Record<string, unknown>>;
    readonly self: Readonly<Record<string, unknown>>;
    readonly state: Readonly<Record<string, unknown>>;
    readonly game: Readonly<Record<string, unknown>>;
    readonly machine?: Readonly<Record<string, unknown>>;
}
export interface TowerScriptMachineInitializationV1 {
    readonly state: TowerScriptMachineRuntimeStateV1;
    readonly entryActions: readonly TowerScriptAction[];
}
export interface TowerScriptStateTransitionPlanV1 {
    readonly schemaVersion: 1;
    readonly transitionId: string;
    readonly fromStatePath: string;
    readonly toStatePath: string;
    readonly exitActions: readonly TowerScriptAction[];
    readonly transitionActions: readonly TowerScriptAction[];
    readonly entryActions: readonly TowerScriptAction[];
    readonly state: TowerScriptMachineRuntimeStateV1;
}
/** Canonical absolute state paths used by checkpoint validation and authoring surfaces. */
export declare function collectTowerScriptStatePaths(machine: TowerScriptStateMachineV1): readonly string[];
/**
 * Verifies the authored provenance carried by a persisted transition event without re-evaluating
 * its condition. Runtime checkpoint validation separately proves that the referenced context is
 * bound to this machine and already holds the transition target as its active state.
 */
export declare function hasTowerScriptStateTransitionProvenance(machine: TowerScriptStateMachineV1, transitionId: string, fromStatePath: string, toStatePath: string): boolean;
export declare function initializeTowerScriptStateMachine(machine: TowerScriptStateMachineV1, enteredAt: number): TowerScriptMachineInitializationV1;
export declare function planTowerScriptStateTransition(machine: TowerScriptStateMachineV1, current: TowerScriptMachineRuntimeStateV1, eventName: TowerScriptEventName, context: TowerScriptMachineExpressionContextV1, enteredAt: number): TowerScriptStateTransitionPlanV1 | null;
