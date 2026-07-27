import { coordKey } from "./hex.js";
/** O(1) coordinate access over one immutable shared navigation field. */
export class NavigationFieldLookup {
    field;
    cellsByCoord = new Map();
    constructor(field) {
        this.field = field;
        for (const cell of field.cells)
            this.cellsByCoord.set(coordKey(cell.coord), cell);
    }
    get(coord) {
        return this.cellsByCoord.get(coordKey(coord));
    }
    enteredCost(cell) {
        if (!cell.nextCoord)
            return undefined;
        const next = this.get(cell.nextCoord);
        if (!next)
            return undefined;
        const cost = cell.distance - next.distance;
        return Number.isSafeInteger(cost) && cost > 0 ? cost : undefined;
    }
    remainingCost(state) {
        const cell = this.get(state.currentCoord);
        if (!cell)
            return Number.POSITIVE_INFINITY;
        if (!cell.nextCoord)
            return cell.distance === 0 ? 0 : Number.POSITIVE_INFINITY;
        const enteredCost = this.enteredCost(cell);
        const next = this.get(cell.nextCoord);
        if (enteredCost === undefined || !next)
            return Number.POSITIVE_INFINITY;
        return (1 - state.edgeProgress) * enteredCost + next.distance;
    }
}
/** Per-game cache: every immutable field is indexed at most once. */
export class NavigationFieldLookupCache {
    lookups = new WeakMap();
    get(field) {
        const existing = this.lookups.get(field);
        if (existing)
            return existing;
        const lookup = new NavigationFieldLookup(field);
        this.lookups.set(field, lookup);
        return lookup;
    }
}
