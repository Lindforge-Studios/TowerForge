import { type LogisticsAmmunitionDefinitionV2, type LogisticsTowerInventoryDefinitionV2 } from "../content/logistics-mechanics.js";
import type { LogisticsAmmunitionInventorySnapshotV2, TowerState } from "./types.js";
export declare function isLiveLogisticsAmmunitionTower(tower: Pick<TowerState, "hp">): boolean;
export declare function isAmmunitionBoundTowerType(ammunition: LogisticsAmmunitionDefinitionV2, towerTypeId: string): boolean;
export declare function getLogisticsAmmunitionTowerInventory(ammunition: LogisticsAmmunitionDefinitionV2, towerTypeId: string): LogisticsTowerInventoryDefinitionV2 | undefined;
export declare function assertLogisticsAmmunitionPlacement(ammunition: LogisticsAmmunitionDefinitionV2, towers: readonly Pick<TowerState, "typeId" | "hp">[], candidateTypeId: string): void;
export declare function buildLogisticsAmmunitionSnapshotV2(ammunition: LogisticsAmmunitionDefinitionV2, towers: readonly TowerState[], amounts: ReadonlyMap<string, number>): Readonly<{
    readonly inventories: readonly LogisticsAmmunitionInventorySnapshotV2[];
}>;
