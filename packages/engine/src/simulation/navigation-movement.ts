import { coordKey } from "./hex.js";
import type { NavigationFieldCell, NavigationFieldResult } from "./navigation-field.js";
import type { EnemyNavigationStateV1, GridCoord } from "./types.js";

/** O(1) coordinate access over one immutable shared navigation field. */
export class NavigationFieldLookup {
  readonly field: NavigationFieldResult;
  private readonly cellsByCoord = new Map<string, NavigationFieldCell>();

  constructor(field: NavigationFieldResult) {
    this.field = field;
    for (const cell of field.cells) this.cellsByCoord.set(coordKey(cell.coord), cell);
  }

  get(coord: GridCoord): NavigationFieldCell | undefined {
    return this.cellsByCoord.get(coordKey(coord));
  }

  enteredCost(cell: NavigationFieldCell): number | undefined {
    if (!cell.nextCoord) return undefined;
    const next = this.get(cell.nextCoord);
    if (!next) return undefined;
    const cost = cell.distance - next.distance;
    return Number.isSafeInteger(cost) && cost > 0 ? cost : undefined;
  }

  remainingCost(state: EnemyNavigationStateV1): number {
    const cell = this.get(state.currentCoord);
    if (!cell) return Number.POSITIVE_INFINITY;
    if (!cell.nextCoord) return cell.distance === 0 ? 0 : Number.POSITIVE_INFINITY;
    const enteredCost = this.enteredCost(cell);
    const next = this.get(cell.nextCoord);
    if (enteredCost === undefined || !next) return Number.POSITIVE_INFINITY;
    return (1 - state.edgeProgress) * enteredCost + next.distance;
  }
}

/** Per-game cache: every immutable field is indexed at most once. */
export class NavigationFieldLookupCache {
  private readonly lookups = new WeakMap<NavigationFieldResult, NavigationFieldLookup>();

  get(field: NavigationFieldResult): NavigationFieldLookup {
    const existing = this.lookups.get(field);
    if (existing) return existing;
    const lookup = new NavigationFieldLookup(field);
    this.lookups.set(field, lookup);
    return lookup;
  }
}
