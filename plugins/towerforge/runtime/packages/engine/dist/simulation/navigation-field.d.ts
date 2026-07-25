import { type MovementProfileV1 } from "../content/navigation-mechanics.js";
import type { GridCoord, GridDefinition, TerrainTypeDefinition } from "./types.js";
export interface NavigationFieldBudget {
    readonly maxCells?: number;
    readonly maxRelaxations?: number;
}
export interface NavigationFieldRequest {
    readonly grid: GridDefinition;
    readonly width: number;
    readonly height: number;
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly profile: MovementProfileV1;
    readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
    readonly terrainByCoord: Readonly<Record<string, string>>;
    readonly occupiedCoords: readonly GridCoord[];
    readonly budget?: NavigationFieldBudget;
}
export interface NavigationFieldCell {
    readonly coord: GridCoord;
    readonly distance: number;
    readonly nextCoord?: GridCoord;
}
export interface NavigationFieldStats {
    readonly relaxations: number;
}
export interface NavigationFieldResult {
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly cells: readonly NavigationFieldCell[];
    readonly stats: NavigationFieldStats;
}
/** Closed runtime-input budgets for one pure field build. */
export declare const NAVIGATION_FIELD_INPUT_LIMITS: Readonly<{
    terrainDefinitions: 256;
    terrainTagsPerDefinition: 64;
    terrainTagsAcrossDefinitions: 8192;
    terrainTagUtf8Bytes: 128;
    terrainLabelLength: 128;
}>;
/**
 * Builds one canonical reverse-Dijkstra field. The function is pure: inputs are safely detached,
 * no cache or RNG is consulted, and every returned gameplay value is deeply frozen.
 */
export declare function buildNavigationField(request: NavigationFieldRequest): NavigationFieldResult;
