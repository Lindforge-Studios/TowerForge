import type { LogisticsPowerDefinitionV1 } from "../content/logistics-mechanics.js";
import type { GridMap } from "./map.js";
import type { LogisticsSnapshotV1, TowerState, TowerType } from "./types.js";
export interface LogisticsPowerTopologyCountsV1 {
    readonly participants: number;
    readonly nodes: number;
    readonly undirectedEdges: number;
}
type PowerTower = Pick<TowerState, "id" | "typeId" | "coord" | "hp">;
type PowerDistance = Pick<GridMap, "distance">;
/** A destructible tower at zero HP is retained only for checkpoint fidelity, never as live power topology. */
export declare function isLiveLogisticsPowerTower(tower: Pick<TowerState, "hp">): boolean;
/** Count and bound a complete candidate topology before links or coverage are materialized. */
export declare function preflightLogisticsPowerTopologyV1(power: LogisticsPowerDefinitionV1, towers: readonly PowerTower[], towerTypes: Readonly<Record<string, TowerType>>, map: PowerDistance): LogisticsPowerTopologyCountsV1;
/** Bound one placement using an already valid live topology in O(live nodes). */
export declare function preflightLogisticsPowerPlacementV1(power: LogisticsPowerDefinitionV1, towers: readonly PowerTower[], towerTypes: Readonly<Record<string, TowerType>>, map: PowerDistance, current: LogisticsPowerTopologyCountsV1, candidate: PowerTower): LogisticsPowerTopologyCountsV1;
/** Derive bounded counters after removing one participant, without rebuilding the graph. */
export declare function preflightLogisticsPowerRemovalV1(power: LogisticsPowerDefinitionV1, towers: readonly PowerTower[], towerTypes: Readonly<Record<string, TowerType>>, map: PowerDistance, current: LogisticsPowerTopologyCountsV1, towerId: string): LogisticsPowerTopologyCountsV1;
/** Bound one node movement using an already valid live topology in O(live nodes). */
export declare function preflightLogisticsPowerMoveV1(power: LogisticsPowerDefinitionV1, towers: readonly PowerTower[], towerTypes: Readonly<Record<string, TowerType>>, map: PowerDistance, current: LogisticsPowerTopologyCountsV1, towerId: string, candidateCoord: TowerState["coord"]): LogisticsPowerTopologyCountsV1;
/** Build the authoritative deterministic power graph from live towers. */
export declare function buildLogisticsPowerSnapshotV1(power: LogisticsPowerDefinitionV1, towers: readonly TowerState[], towerTypes: Readonly<Record<string, TowerType>>, map: GridMap): LogisticsSnapshotV1;
/** Return a detached frozen projection so snapshot consumers cannot mutate the derived cache. */
export declare function cloneLogisticsPowerSnapshotV1(snapshot: LogisticsSnapshotV1): LogisticsSnapshotV1;
export {};
