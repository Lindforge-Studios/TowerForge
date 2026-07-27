import type { GridTopology } from "./topology.js";
import type { GridCoord, TowerType } from "./types.js";
export declare const COMPACT_FOUR_FOOTPRINT_SIZE = 4;
/**
 * Resolves the authored tower footprint without coupling placement rules to a renderer.
 * `compact-4` is a two-by-two rhombus whose parity is derived from topology neighbors,
 * so it stays geometrically stable on odd-r hex maps and square maps alike.
 */
export declare function resolveTowerFootprintCoords(topology: GridTopology, center: GridCoord, type: Pick<TowerType, "footprintRadius" | "footprintShape">): GridCoord[];
export declare function expectedTowerFootprintSize(topology: GridTopology, type: Pick<TowerType, "footprintRadius" | "footprintShape">): number;
