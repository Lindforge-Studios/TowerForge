import type { NavigationFieldCell, NavigationFieldResult } from "./navigation-field.js";
import type { EnemyNavigationStateV1, GridCoord } from "./types.js";
/** O(1) coordinate access over one immutable shared navigation field. */
export declare class NavigationFieldLookup {
    readonly field: NavigationFieldResult;
    private readonly cellsByCoord;
    constructor(field: NavigationFieldResult);
    get(coord: GridCoord): NavigationFieldCell | undefined;
    enteredCost(cell: NavigationFieldCell): number | undefined;
    remainingCost(state: EnemyNavigationStateV1): number;
}
/** Per-game cache: every immutable field is indexed at most once. */
export declare class NavigationFieldLookupCache {
    private readonly lookups;
    get(field: NavigationFieldResult): NavigationFieldLookup;
}
