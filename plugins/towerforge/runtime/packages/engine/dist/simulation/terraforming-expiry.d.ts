import type { RuntimeTerrainOverride, TerraformingSnapshotV1 } from "./types.js";
export type TerraformExpiryLayer = "terrain" | "elevation";
export interface TerrainExpiryTargetV1 {
    readonly layer: "terrain";
    readonly q: number;
    readonly r: number;
    readonly order: number;
    readonly appliedTerrain: string;
    readonly previousOverride: Pick<RuntimeTerrainOverride, "terrain" | "source"> | null;
}
export interface ElevationExpiryTargetV1 {
    readonly layer: "elevation";
    readonly q: number;
    readonly r: number;
    readonly order: number;
    readonly appliedElevation: number;
    readonly previousElevationOverride: number | null;
}
export type TerraformExpiryTargetV1 = TerrainExpiryTargetV1 | ElevationExpiryTargetV1;
export interface TerraformExpiryGroupV1 {
    readonly sequence: number;
    readonly remaining: number;
    readonly targets: readonly TerraformExpiryTargetV1[];
}
export declare function terraformExpiryTargetKey(target: Pick<TerraformExpiryTargetV1, "layer" | "q" | "r">): string;
/** Pure countdown: callers decide whether due groups can be committed atomically. */
export declare function advanceTerraformExpiryGroups(groups: readonly TerraformExpiryGroupV1[], delta: number): readonly TerraformExpiryGroupV1[];
export declare function countTerraformExpiryOwnership(groups: readonly TerraformExpiryGroupV1[]): {
    readonly terrain: number;
    readonly elevation: number;
    readonly combined: number;
};
export declare function buildTerraformingSnapshot(groups: readonly TerraformExpiryGroupV1[]): TerraformingSnapshotV1;
