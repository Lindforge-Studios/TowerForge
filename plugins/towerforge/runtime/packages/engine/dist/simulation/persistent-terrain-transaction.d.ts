import { type TerraformTerrainTransitionV1 } from "../content/terraforming-mechanics.js";
import type { GridMap } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";
type PersistentTerrainSource = "script" | "ability";
export interface PersistentTerrainOverrideV1 extends GridCoord {
    readonly terrain: string;
    readonly source: PersistentTerrainSource;
    readonly expiresIn?: number;
}
export interface PersistentTerrainOperationV1 {
    readonly kind: "set_terrain" | "restore_terrain";
    readonly coord: GridCoord;
    readonly order: number;
    readonly transitionId?: string;
    readonly directTerrainId?: string;
    readonly terrainSource?: PersistentTerrainSource;
    readonly previousTerrainOverride?: PersistentTerrainOverrideV1 | null;
}
export interface PersistentTerrainNavigationProofV1 {
    readonly baselineAvailable: boolean;
    readonly candidateAvailable: boolean;
    readonly proof?: unknown;
}
export type PersistentTerrainNavigationPolicyV1 = {
    readonly mode: "authored_routes";
} | {
    readonly mode: "dynamic_flow";
    readonly prove: (candidateTerrainByCoord: ReadonlyMap<string, string>) => PersistentTerrainNavigationProofV1;
};
export interface PersistentTerrainTransactionRequestV1 {
    readonly map: GridMap;
    readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
    readonly transitions: Readonly<Record<string, TerraformTerrainTransitionV1>>;
    readonly runtimeOverrides: ReadonlyMap<string, PersistentTerrainOverrideV1>;
    readonly operations: readonly PersistentTerrainOperationV1[];
    readonly navigation: PersistentTerrainNavigationPolicyV1;
}
export interface PersistentTerrainTransactionAdoptionV1 {
    readonly writes: readonly {
        readonly coord: GridCoord;
        readonly terrain: string;
    }[];
    readonly runtimeOverrides: readonly PersistentTerrainOverrideV1[];
    readonly events: readonly {
        readonly order: number;
        readonly event: Readonly<Record<string, unknown>>;
    }[];
    readonly navigationProof?: unknown;
}
/** Opaque one-shot prepared transaction. It intentionally has no public data surface. */
export interface PreparedPersistentTerrainTransactionV1 {
    readonly __opaque?: never;
}
export declare class PersistentTerrainTransactionError extends Error {
    readonly reasonKey: string;
    readonly code: "invalid_action";
    constructor(reasonKey: string, message: string);
}
/** Prepare a complete mutation-free persistent terrain publication. */
export declare function preparePersistentTerrainTransaction(request: PersistentTerrainTransactionRequestV1): PreparedPersistentTerrainTransactionV1;
/** Publish one prepared value once. Repeated or foreign adoption is an intentional no-op. */
export declare function adoptPersistentTerrainTransaction(prepared: PreparedPersistentTerrainTransactionV1, publish: (adoption: PersistentTerrainTransactionAdoptionV1) => void): Readonly<{
    adopted: boolean;
}>;
export {};
