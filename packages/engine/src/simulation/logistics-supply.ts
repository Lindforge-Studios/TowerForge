import {
  LOGISTICS_SUPPLY_LIMITS,
  type LogisticsAmmunitionDefinitionV2,
  type LogisticsProducerDefinitionV3,
  type LogisticsStorageDefinitionV3,
  type LogisticsSupplyDefinitionV3
} from "../content/logistics-mechanics.js";
import type { GridMap } from "./map.js";
import type {
  LogisticsSupplyEdgeSnapshotV3,
  TowerState,
  TowerType
} from "./types.js";
import { getLogisticsAmmunitionTowerInventory, isLiveLogisticsAmmunitionTower } from "./logistics-ammunition.js";

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export interface LogisticsSupplyTopologyCountsV3 {
  readonly liveSources: number;
  readonly directedTransferEdges: number;
}

export interface LogisticsSupplyTopologyV3 extends LogisticsSupplyTopologyCountsV3 {
  readonly edges: readonly LogisticsSupplyEdgeSnapshotV3[];
}

type SupplyTower = Pick<TowerState, "id" | "typeId" | "coord" | "hp">;
type SupplyMap = Pick<GridMap, "distance">;

export function getLogisticsProducerDefinitionV3(
  supply: LogisticsSupplyDefinitionV3,
  towerTypeId: string
): LogisticsProducerDefinitionV3 | undefined {
  return own(supply.producers, towerTypeId);
}

export function getLogisticsStorageDefinitionV3(
  supply: LogisticsSupplyDefinitionV3,
  towerTypeId: string
): LogisticsStorageDefinitionV3 | undefined {
  return own(supply.storages, towerTypeId);
}

export function isLogisticsSupplySourceTypeV3(
  supply: LogisticsSupplyDefinitionV3,
  towerTypeId: string
): boolean {
  return getLogisticsProducerDefinitionV3(supply, towerTypeId) !== undefined
    || getLogisticsStorageDefinitionV3(supply, towerTypeId) !== undefined;
}

function sourceAmmoTypeId(
  supply: LogisticsSupplyDefinitionV3,
  tower: SupplyTower
): { kind: "producer" | "storage"; ammoTypeId: string; radius: number } | undefined {
  const producer = getLogisticsProducerDefinitionV3(supply, tower.typeId);
  if (producer) {
    const recipe = own(supply.productionRecipes, producer.recipeId);
    if (!recipe) return undefined;
    return { kind: "producer", ammoTypeId: recipe.ammoTypeId, radius: producer.transferRadius };
  }
  const storage = getLogisticsStorageDefinitionV3(supply, tower.typeId);
  return storage
    ? { kind: "storage", ammoTypeId: storage.ammoTypeId, radius: storage.transferRadius }
    : undefined;
}

function footprintEdgeDistance(
  map: SupplyMap,
  towerTypes: Readonly<Record<string, TowerType>>,
  left: SupplyTower,
  right: SupplyTower
): number | undefined {
  const leftType = own(towerTypes, left.typeId);
  const rightType = own(towerTypes, right.typeId);
  if (!leftType || !rightType) return undefined;
  return Math.max(
    0,
    map.distance(left.coord, right.coord) - leftType.footprintRadius - rightType.footprintRadius
  );
}

function compareEdges(left: LogisticsSupplyEdgeSnapshotV3, right: LogisticsSupplyEdgeSnapshotV3): number {
  return compareBinary(left.sourceTowerId, right.sourceTowerId)
    || (left.sourceKind === right.sourceKind ? 0 : left.sourceKind === "producer" ? -1 : 1)
    || (left.destinationKind === right.destinationKind ? 0 : left.destinationKind === "consumer" ? -1 : 1)
    || left.distance - right.distance
    || compareBinary(left.destinationTowerId, right.destinationTowerId);
}

/**
 * Build and bound the immutable directed supply topology. Stock, progress, power, and disruption
 * deliberately do not participate, so callers may cache this projection until a spatial/live-set change.
 */
export function buildLogisticsSupplyTopologyV3(
  supply: LogisticsSupplyDefinitionV3,
  ammunition: LogisticsAmmunitionDefinitionV2,
  towers: readonly SupplyTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: SupplyMap
): LogisticsSupplyTopologyV3 {
  const live = towers.filter(isLiveLogisticsAmmunitionTower);
  const sources = live.filter((tower) => isLogisticsSupplySourceTypeV3(supply, tower.typeId));
  if (sources.length > LOGISTICS_SUPPLY_LIMITS.liveSources) {
    throw new Error(`Logistics supply source limit ${LOGISTICS_SUPPLY_LIMITS.liveSources} exceeded.`);
  }
  const liveInventories = live.filter((tower) => (
    getLogisticsAmmunitionTowerInventory(ammunition, tower.typeId) !== undefined
  ));
  if (liveInventories.length > LOGISTICS_SUPPLY_LIMITS.liveAmmunitionInventories) {
    throw new Error(
      `Logistics supply ammunition inventory limit ${LOGISTICS_SUPPLY_LIMITS.liveAmmunitionInventories} exceeded.`
    );
  }

  const edges: LogisticsSupplyEdgeSnapshotV3[] = [];
  for (const source of sources) {
    const sourceRole = sourceAmmoTypeId(supply, source);
    if (!sourceRole) continue;
    for (const destination of live) {
      const inventory = getLogisticsAmmunitionTowerInventory(ammunition, destination.typeId);
      const storage = getLogisticsStorageDefinitionV3(supply, destination.typeId);
      const destinationKind = inventory?.ammoTypeId === sourceRole.ammoTypeId
        ? "consumer" as const
        : sourceRole.kind === "producer" && storage?.ammoTypeId === sourceRole.ammoTypeId
          ? "storage" as const
          : undefined;
      if (!destinationKind) continue;
      // A tower may transfer between distinct compartments on itself. No compartment self-edge exists.
      if (source.id === destination.id) {
        if (destinationKind === "consumer") {
          // producer/storage compartment -> attack magazine is a valid self-edge
        } else {
          continue;
        }
      }
      const distance = footprintEdgeDistance(map, towerTypes, source, destination);
      if (distance === undefined || distance > sourceRole.radius) continue;
      edges.push(Object.freeze({
        sourceTowerId: source.id,
        sourceTowerTypeId: source.typeId,
        sourceKind: sourceRole.kind,
        destinationTowerId: destination.id,
        destinationTowerTypeId: destination.typeId,
        destinationKind,
        ammoTypeId: sourceRole.ammoTypeId,
        distance
      }));
      if (edges.length > LOGISTICS_SUPPLY_LIMITS.directedTransferEdges) {
        throw new Error(
          `Logistics supply directed edge limit ${LOGISTICS_SUPPLY_LIMITS.directedTransferEdges} exceeded.`
        );
      }
    }
  }
  edges.sort(compareEdges);
  return Object.freeze({
    liveSources: sources.length,
    directedTransferEdges: edges.length,
    edges: Object.freeze(edges)
  });
}

/** Validate a complete candidate graph without publishing or adopting any candidate state. */
export function preflightLogisticsSupplyTopologyV3(
  supply: LogisticsSupplyDefinitionV3,
  ammunition: LogisticsAmmunitionDefinitionV2,
  towers: readonly SupplyTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: SupplyMap
): LogisticsSupplyTopologyCountsV3 {
  const topology = buildLogisticsSupplyTopologyV3(supply, ammunition, towers, towerTypes, map);
  return Object.freeze({
    liveSources: topology.liveSources,
    directedTransferEdges: topology.directedTransferEdges
  });
}
