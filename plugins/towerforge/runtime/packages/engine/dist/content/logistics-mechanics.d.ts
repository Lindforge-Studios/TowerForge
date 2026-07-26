import type { GameContentRegistry } from "./registry.js";
/** Closed structural and runtime budgets for the opt-in Logistics v1 power grid. */
export declare const LOGISTICS_POWER_LIMITS: Readonly<{
    entriesPerRole: 4096;
    entriesTotal: 4096;
    idUtf8Bytes: 128;
    output: 1000000000000;
    demand: 1000000000000;
    radius: 64;
    priority: 1000000;
    liveParticipants: 4096;
    liveNodes: 1024;
    undirectedEdges: 65536;
}>;
export interface LogisticsGeneratorDefinitionV1 {
    readonly output: number;
    readonly linkRadius: number;
    readonly coverageRadius: number;
}
export interface LogisticsRelayDefinitionV1 {
    readonly linkRadius: number;
    readonly coverageRadius: number;
}
export interface LogisticsConsumerDefinitionV1 {
    readonly demand: number;
    readonly priority: number;
}
export interface LogisticsPowerDefinitionV1 {
    readonly generators: Readonly<Record<string, LogisticsGeneratorDefinitionV1>>;
    readonly relays: Readonly<Record<string, LogisticsRelayDefinitionV1>>;
    readonly consumers: Readonly<Record<string, LogisticsConsumerDefinitionV1>>;
}
export interface LogisticsProfileV1 {
    readonly power: LogisticsPowerDefinitionV1 | null;
}
export interface ActiveLogisticsMechanicsV1 extends LogisticsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export declare const LOGISTICS_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "logistics";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly ["power"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    power: Readonly<{
        nullable: true;
        requiredFields: readonly ["generators", "relays", "consumers"];
        optionalFields: readonly [];
        additionalProperties: false;
        generator: Readonly<{
            requiredFields: readonly ["output", "linkRadius", "coverageRadius"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        relay: Readonly<{
            requiredFields: readonly ["linkRadius", "coverageRadius"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        consumer: Readonly<{
            requiredFields: readonly ["demand", "priority"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
    }>;
    limits: Readonly<{
        entriesPerRole: 4096;
        entriesTotal: 4096;
        idUtf8Bytes: 128;
        output: 1000000000000;
        demand: 1000000000000;
        radius: 64;
        priority: 1000000;
        liveParticipants: 4096;
        liveNodes: 1024;
        undirectedEdges: 65536;
    }>;
    runtimeSnapshot: Readonly<{
        schemaVersion: 1;
        fields: readonly ["schemaVersion", "power"];
        powerFields: readonly ["components", "nodes", "consumers"];
    }>;
}>;
export declare class LogisticsProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Normalize one supported v1 profile without executing accessors or retaining authored references. */
export declare function normalizeLogisticsProfileV1(value: unknown): LogisticsProfileV1;
/** Resolve only a selected, enabled, supported Logistics v1 profile. */
export declare function resolveActiveLogisticsMechanics(content: GameContentRegistry, missionId: string): ActiveLogisticsMechanicsV1 | undefined;
