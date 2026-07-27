import { type LogisticsAmmunitionDefinitionV2, type LogisticsProducerDefinitionV3, type LogisticsStorageDefinitionV3, type LogisticsSupplyDefinitionV3 } from "../content/logistics-mechanics.js";
import type { GridMap } from "./map.js";
import type { LogisticsSupplyEdgeSnapshotV3, TowerState, TowerType } from "./types.js";
export interface LogisticsSupplyTopologyCountsV3 {
    readonly liveSources: number;
    readonly directedTransferEdges: number;
}
export interface LogisticsSupplyTopologyV3 extends LogisticsSupplyTopologyCountsV3 {
    readonly edges: readonly LogisticsSupplyEdgeSnapshotV3[];
}
type SupplyTower = Pick<TowerState, "id" | "typeId" | "coord" | "hp">;
type SupplyMap = Pick<GridMap, "distance">;
export declare function getLogisticsProducerDefinitionV3(supply: LogisticsSupplyDefinitionV3, towerTypeId: string): LogisticsProducerDefinitionV3 | undefined;
export declare function getLogisticsStorageDefinitionV3(supply: LogisticsSupplyDefinitionV3, towerTypeId: string): LogisticsStorageDefinitionV3 | undefined;
export declare function isLogisticsSupplySourceTypeV3(supply: LogisticsSupplyDefinitionV3, towerTypeId: string): boolean;
/**
 * Build and bound the immutable directed supply topology. Stock, progress, power, and disruption
 * deliberately do not participate, so callers may cache this projection until a spatial/live-set change.
 */
export declare function buildLogisticsSupplyTopologyV3(supply: LogisticsSupplyDefinitionV3, ammunition: LogisticsAmmunitionDefinitionV2, towers: readonly SupplyTower[], towerTypes: Readonly<Record<string, TowerType>>, map: SupplyMap): LogisticsSupplyTopologyV3;
/** Validate a complete candidate graph without publishing or adopting any candidate state. */
export declare function preflightLogisticsSupplyTopologyV3(supply: LogisticsSupplyDefinitionV3, ammunition: LogisticsAmmunitionDefinitionV2, towers: readonly SupplyTower[], towerTypes: Readonly<Record<string, TowerType>>, map: SupplyMap): LogisticsSupplyTopologyCountsV3;
export {};
