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
/** Closed structural and runtime budgets for opt-in Logistics v2 local ammunition. */
export declare const LOGISTICS_AMMUNITION_LIMITS: Readonly<{
    types: 256;
    towerInventories: 4096;
    liveInventories: 4096;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 128;
    capacity: 1000000000;
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
export interface LogisticsAmmunitionTypeDefinitionV2 {
    readonly label: string;
}
export interface LogisticsTowerInventoryDefinitionV2 {
    readonly ammoTypeId: string;
    readonly capacity: number;
    readonly startingAmount: number;
    readonly consumptionPerActivation: number;
}
export interface LogisticsAmmunitionDefinitionV2 {
    readonly types: Readonly<Record<string, LogisticsAmmunitionTypeDefinitionV2>>;
    readonly towerInventories: Readonly<Record<string, LogisticsTowerInventoryDefinitionV2>>;
}
export interface LogisticsProfileV2 {
    readonly power: LogisticsPowerDefinitionV1 | null;
    readonly ammunition: LogisticsAmmunitionDefinitionV2 | null;
}
export interface ActiveLogisticsMechanicsV1 extends LogisticsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface ActiveLogisticsMechanicsV2 extends LogisticsProfileV2 {
    readonly schemaVersion: 2;
    readonly profileId: string;
}
export type ActiveLogisticsMechanics = ActiveLogisticsMechanicsV1 | ActiveLogisticsMechanicsV2;
export declare const LOGISTICS_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 2;
    moduleId: "logistics";
    supportedModuleSchemaVersions: readonly [1, 2];
    profile: Readonly<{
        requiredFields: readonly ["power", "ammunition"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    profileVersions: Readonly<{
        1: Readonly<{
            requiredFields: readonly ["power"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        2: Readonly<{
            requiredFields: readonly ["power", "ammunition"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
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
    ammunition: Readonly<{
        nullable: true;
        requiredFields: readonly ["types", "towerInventories"];
        optionalFields: readonly [];
        additionalProperties: false;
        type: Readonly<{
            requiredFields: readonly ["label"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        towerInventory: Readonly<{
            requiredFields: readonly ["ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        fireCapableAttackKinds: readonly ["single", "pulse", "sniper", "antiair", "splash", "pipeline"];
        limits: Readonly<{
            types: 256;
            towerInventories: 4096;
            liveInventories: 4096;
            idUtf8Bytes: 128;
            labelUtf8Bytes: 128;
            capacity: 1000000000;
        }>;
    }>;
    limits: Readonly<{
        power: Readonly<{
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
        ammunition: Readonly<{
            types: 256;
            towerInventories: 4096;
            liveInventories: 4096;
            idUtf8Bytes: 128;
            labelUtf8Bytes: 128;
            capacity: 1000000000;
        }>;
    }>;
    runtimeSnapshot: Readonly<{
        schemaVersion: 2;
        fields: readonly ["schemaVersion", "power", "ammunition"];
        powerFields: readonly ["components", "nodes", "consumers"];
        ammunitionFields: readonly ["inventories"];
    }>;
}>;
export declare class LogisticsProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Normalize one supported v1 profile without executing accessors or retaining authored references. */
export declare function normalizeLogisticsProfileV1(value: unknown): LogisticsProfileV1;
/** Normalize one supported v2 profile without executing accessors or retaining authored references. */
export declare function normalizeLogisticsProfileV2(value: unknown): LogisticsProfileV2;
/** Resolve only a selected, enabled, supported Logistics v1 profile. */
export declare function resolveActiveLogisticsMechanics(content: GameContentRegistry, missionId: string): ActiveLogisticsMechanics | undefined;
