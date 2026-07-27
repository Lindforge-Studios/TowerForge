import { type TOWER_SCRIPT_SCHEMA } from "./schema-descriptor.js";
import type { TowerScriptDefinition } from "./types.js";
export declare const TOWER_SCRIPT_GRAPH_SCHEMA_VERSION: 1;
export type TowerScriptGraphNodeKind = "script" | "binding" | "handler" | "condition" | "action" | "raw";
export interface TowerScriptGraphNodeV1 {
    readonly id: string;
    readonly kind: TowerScriptGraphNodeKind;
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
    readonly schemaVersion: typeof TOWER_SCRIPT_GRAPH_SCHEMA_VERSION;
    readonly scriptId: string;
    readonly nodes: readonly TowerScriptGraphNodeV1[];
    readonly edges: readonly TowerScriptGraphEdgeV1[];
}
type TowerScriptDescriptor = typeof TOWER_SCRIPT_SCHEMA | {
    readonly schemaVersion: number;
    readonly events: readonly string[];
    readonly scopes: readonly string[];
    readonly actions: Readonly<Record<string, unknown>>;
    readonly expression: {
        readonly operators: readonly string[];
    };
};
export declare function towerScriptAstToGraph(source: TowerScriptDefinition | Record<string, unknown>): TowerScriptGraphV1;
export declare function towerScriptGraphToAst(graph: TowerScriptGraphV1): TowerScriptDefinition;
export declare function createTowerScriptNodeCatalog(descriptor: TowerScriptDescriptor): {
    schemaVersion: 1;
    towerScriptSchemaVersion: number;
    events: {
        name: string;
    }[];
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
