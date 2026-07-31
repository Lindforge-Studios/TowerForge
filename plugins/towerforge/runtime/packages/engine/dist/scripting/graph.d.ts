import { type TOWER_SCRIPT_SCHEMA } from "./schema-descriptor.js";
import type { TowerScriptDefinition } from "./types.js";
export declare const TOWER_SCRIPT_GRAPH_SCHEMA_VERSION: 2;
export type TowerScriptGraphNodeKindV1 = "script" | "binding" | "handler" | "condition" | "action" | "raw";
export type TowerScriptGraphNodeKind = TowerScriptGraphNodeKindV1 | "behavior_tree" | "behavior_selector" | "behavior_sequence" | "behavior_condition" | "behavior_action" | "state_machine" | "state" | "transition";
export interface TowerScriptGraphNodeV1 {
    readonly id: string;
    readonly kind: TowerScriptGraphNodeKindV1;
    readonly astPath: string;
    readonly raw: unknown;
}
export interface TowerScriptGraphEdgeV1 {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly order: number;
}
export interface TowerScriptGraphV1 {
    readonly schemaVersion: 1;
    readonly scriptId: string;
    readonly nodes: readonly TowerScriptGraphNodeV1[];
    readonly edges: readonly TowerScriptGraphEdgeV1[];
}
export interface TowerScriptGraphNodeV2 {
    readonly id: string;
    readonly kind: TowerScriptGraphNodeKind;
    readonly astPath: string;
    readonly raw: unknown;
}
export interface TowerScriptGraphEdgeV2 {
    readonly id: string;
    readonly kind: "containment" | "transition_target";
    readonly from: string;
    readonly to: string;
    readonly order: number;
}
export interface TowerScriptGraphV2 {
    readonly schemaVersion: typeof TOWER_SCRIPT_GRAPH_SCHEMA_VERSION;
    readonly scriptId: string;
    readonly nodes: readonly TowerScriptGraphNodeV2[];
    readonly edges: readonly TowerScriptGraphEdgeV2[];
}
export type TowerScriptGraph = TowerScriptGraphV1 | TowerScriptGraphV2;
type TowerScriptDescriptor = typeof TOWER_SCRIPT_SCHEMA | {
    readonly schemaVersion: number;
    readonly events: readonly string[];
    readonly scopes: readonly string[];
    readonly actions: Readonly<Record<string, unknown>>;
    readonly expression: {
        readonly operators: readonly string[];
    };
    readonly behaviorTrees?: unknown;
    readonly stateMachines?: unknown;
    readonly controllerRecipes?: unknown;
    readonly graph?: unknown;
    readonly debug?: unknown;
    readonly completion?: unknown;
};
export declare function towerScriptAstToGraph(source: TowerScriptDefinition | Record<string, unknown>): TowerScriptGraphV2;
export declare function towerScriptGraphToAst(graph: TowerScriptGraph): TowerScriptDefinition;
export declare function createTowerScriptNodeCatalog(descriptor: TowerScriptDescriptor): {
    schemaVersion: 2;
    towerScriptSchemaVersion: number;
    graph: unknown;
    debug: unknown;
    controllers: {
        handlers: {
            schemaVersion: number;
        };
        behaviorTrees: unknown;
        stateMachines: unknown;
    };
    controllerRecipes: unknown;
    nodeKinds: string[];
    events: any[];
    actions: {
        name: string;
        descriptor: unknown;
    }[];
    operators: {
        name: string;
    }[];
    scopes: {
        name: string;
    }[];
};
export {};
