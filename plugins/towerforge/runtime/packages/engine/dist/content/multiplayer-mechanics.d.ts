import type { GameContentRegistry } from "./registry.js";
export declare const MULTIPLAYER_LIMITS: Readonly<{
    players: 64;
    idUtf8Bytes: 128;
    minimumFixedTickUnits: 0.000001;
    maximumFixedTickUnits: 1000000;
    journalEntries: 100000;
    sendDefinitions: 1024;
    resourcesPerSend: 64;
    maximumResourceAmount: 1000000000000;
}>;
export type MultiplayerModeV1 = "local_coop";
export type MultiplayerTowerControlV1 = "owner_only" | "shared";
export interface MultiplayerOwnershipV1 {
    readonly towerControl: MultiplayerTowerControlV1;
    readonly resources: "shared" | "partitioned";
    readonly routes: "shared" | "partitioned";
}
export interface MultiplayerProfileV1 {
    readonly mode: MultiplayerModeV1;
    readonly fixedTickUnits: number;
    readonly maxPlayers: number;
    readonly ownership: MultiplayerOwnershipV1;
}
export interface ActiveMultiplayerMechanicsV1 extends MultiplayerProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface MultiplayerSendDefinitionV2 {
    readonly enemyTypeId: string;
    readonly cost: Readonly<Record<string, number>>;
    readonly income: Readonly<Record<string, number>>;
    readonly spawnDelayUnits: number;
    readonly routeId?: string;
}
export interface MultiplayerProfileV2 {
    readonly mode: "asymmetric_send_vs_build";
    readonly fixedTickUnits: number;
    readonly maxPlayers: 2;
    readonly ownership: {
        readonly towerControl: MultiplayerTowerControlV1;
        readonly resources: "partitioned";
        readonly routes: "partitioned";
    };
    readonly sendPool: Readonly<Record<string, MultiplayerSendDefinitionV2>>;
}
export type ActiveMultiplayerMechanicsV2 = Readonly<{
    readonly schemaVersion: 2;
    readonly profileId: string;
} & (MultiplayerProfileV1 | MultiplayerProfileV2)>;
export type ActiveMultiplayerMechanics = ActiveMultiplayerMechanicsV1 | ActiveMultiplayerMechanicsV2;
export declare const MULTIPLAYER_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "multiplayer";
    supportedModuleSchemaVersions: readonly [1, 2];
    profilesByModuleVersion: Readonly<{
        1: Readonly<{
            modes: readonly ["local_coop"];
            requiredFields: readonly ["mode", "fixedTickUnits", "maxPlayers", "ownership"];
        }>;
        2: Readonly<{
            modes: readonly ["local_coop", "asymmetric_send_vs_build"];
            requiredFieldsByMode: Readonly<{
                local_coop: readonly ["mode", "fixedTickUnits", "maxPlayers", "ownership"];
                asymmetric_send_vs_build: readonly ["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"];
            }>;
            sendDefinition: Readonly<{
                requiredFields: readonly ["enemyTypeId", "cost", "income", "spawnDelayUnits"];
                optionalFields: readonly ["routeId"];
                additionalProperties: false;
            }>;
        }>;
    }>;
    profile: Readonly<{
        requiredFields: readonly ["mode", "fixedTickUnits", "maxPlayers", "ownership"];
        optionalFields: readonly [];
        additionalProperties: false;
        modes: readonly ["local_coop"];
    }>;
    ownership: Readonly<{
        requiredFields: readonly ["towerControl", "resources", "routes"];
        optionalFields: readonly [];
        additionalProperties: false;
        towerControl: readonly ["owner_only", "shared"];
        resources: readonly ["shared", "partitioned"];
        routes: readonly ["shared", "partitioned"];
    }>;
    limits: Readonly<{
        players: 64;
        idUtf8Bytes: 128;
        minimumFixedTickUnits: 0.000001;
        maximumFixedTickUnits: 1000000;
        journalEntries: 100000;
        sendDefinitions: 1024;
        resourcesPerSend: 64;
        maximumResourceAmount: 1000000000000;
    }>;
}>;
export declare class MultiplayerProfileValidationError extends Error {
    readonly fieldPath: string;
    readonly structural: boolean;
    constructor(fieldPath: string, message: string, structural?: boolean);
}
/** Descriptor-safe normalization of the complete local co-op v1 profile. */
export declare function normalizeMultiplayerProfileV1(value: unknown): MultiplayerProfileV1;
/** Descriptor-safe normalization of the complete asymmetric send-vs-build v2 profile. */
export declare function normalizeMultiplayerProfileV2(value: unknown): MultiplayerProfileV1 | MultiplayerProfileV2;
/** Resolve only a selected, enabled, supported multiplayer profile. */
export declare function resolveActiveMultiplayerMechanics(content: GameContentRegistry, missionId: string): ActiveMultiplayerMechanics | undefined;
