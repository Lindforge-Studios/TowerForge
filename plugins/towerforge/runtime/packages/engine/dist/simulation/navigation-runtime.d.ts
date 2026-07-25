import { type DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import { type NavigationFieldResult } from "./navigation-field.js";
import type { GridCoord, GridDefinition, GridPathRoute, TerrainTypeDefinition } from "./types.js";
export interface NavigationResolverRequest {
    readonly grid: GridDefinition;
    readonly width: number;
    readonly height: number;
    readonly profile: DynamicFlowNavigationProfileV1;
    readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
    readonly terrainByCoord: Readonly<Record<string, string>>;
    readonly occupiedCoords: readonly GridCoord[];
    readonly routes: readonly GridPathRoute[];
}
export interface NavigationResolverStats {
    readonly fieldBuildCount: number;
    readonly fieldQueryCount: number;
    readonly generation: number;
}
/** Derived, non-authoritative shared flow-field cache for one active dynamic profile. */
export declare class NavigationResolver {
    private readonly grid;
    private readonly width;
    private readonly height;
    private readonly profile;
    private readonly terrainTypes;
    private terrainByCoord;
    private occupiedCoords;
    private routes;
    private readonly fields;
    private fieldBuildCount;
    private fieldQueryCount;
    private generation;
    private dirty;
    constructor(value: NavigationResolverRequest);
    getField(movementProfileId: string, routeId: string): NavigationFieldResult;
    /**
     * Checks the installed cache entry without counting a field query. Cache identity reflects
     * selective resolver invalidation, so retained fields stay current while dirty fields do not.
     */
    isFieldCurrent(field: NavigationFieldResult, movementProfileId: string, routeId: string): boolean;
    updateTerrainByCoord(value: Readonly<Record<string, string>>): boolean;
    updateOccupiedCoords(value: readonly GridCoord[]): boolean;
    updateRoutes(value: readonly GridPathRoute[]): boolean;
    getStats(): NavigationResolverStats;
    private incrementQueryCount;
    private prepareInvalidation;
    private invalidateFields;
}
