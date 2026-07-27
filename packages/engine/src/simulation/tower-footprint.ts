import { coordKey } from "./hex.js";
import type { GridTopology } from "./topology.js";
import type { GridCoord, TowerType } from "./types.js";

export const COMPACT_FOUR_FOOTPRINT_SIZE = 4;

/**
 * Resolves the authored tower footprint without coupling placement rules to a renderer.
 * `compact-4` is a two-by-two rhombus whose parity is derived from topology neighbors,
 * so it stays geometrically stable on odd-r hex maps and square maps alike.
 */
export function resolveTowerFootprintCoords(
  topology: GridTopology,
  center: GridCoord,
  type: Pick<TowerType, "footprintRadius" | "footprintShape">
): GridCoord[] {
  if (type.footprintShape !== "compact-4") {
    return topology.tilesWithin(center, type.footprintRadius);
  }

  const neighbors = topology.neighbors(center);
  const east = neighbors[topology.grid.kind === "square" ? 1 : 3];
  const lower = neighbors[topology.grid.kind === "square" ? 2 : 5];
  const lowerEast = east === undefined
    ? undefined
    : topology.neighbors(east)[topology.grid.kind === "square" ? 2 : 5];
  const seen = new Set<string>();

  return [center, east, lower, lowerEast].filter((coord): coord is GridCoord => {
    if (coord === undefined) return false;
    const key = coordKey(coord);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function expectedTowerFootprintSize(
  topology: GridTopology,
  type: Pick<TowerType, "footprintRadius" | "footprintShape">
): number {
  return type.footprintShape === "compact-4"
    ? COMPACT_FOUR_FOOTPRINT_SIZE
    : topology.footprintSize(type.footprintRadius);
}
