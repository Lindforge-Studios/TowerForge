import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { NavigationFieldResult } from "./navigation-field.js";
import { NavigationFieldLookupCache } from "./navigation-movement.js";
import type { NavigationResolver } from "./navigation-runtime.js";
import type { PreparedDynamicTerraformingSafetySet } from "./terraforming-navigation-safety.js";
import type {
  EnemyNavigationStateV1,
  EnemyState,
  GridCoord,
  GridPathRoute
} from "./types.js";

export { collectDynamicTerraformingSpawnProvenance } from "./navigation-reachability.js";
export { DynamicTerraformingSafetyBudgetError } from "./terraforming-navigation-budget.js";
export {
  assertDynamicTerraformingSafetyBudget,
  prepareDynamicTerraformingSafetySet
} from "./terraforming-navigation-safety.js";

export interface DynamicTerraformingEnemyRebind {
  readonly enemyId: string;
  readonly navigation: EnemyNavigationStateV1;
  readonly pathProgress: number;
}

export interface DynamicTerraformingNavigationPlan {
  readonly baselineAvailable: boolean;
  readonly candidateAvailable: boolean;
  readonly candidateResolver: NavigationResolver;
  readonly candidateLookupCache: NavigationFieldLookupCache;
  readonly candidateEnemyFields: Map<string, NavigationFieldResult>;
  readonly enemyRebinds: readonly DynamicTerraformingEnemyRebind[];
}

export interface DynamicTerraformingNavigationRequest {
  readonly profile: DynamicFlowNavigationProfileV1;
  readonly routes: readonly GridPathRoute[];
  readonly enemies: readonly EnemyState[];
  readonly safetySet: PreparedDynamicTerraformingSafetySet;
  readonly baselineResolver: NavigationResolver;
  readonly candidateResolver: NavigationResolver;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function groupKey(movementProfileId: string, goal: GridCoord): string {
  return JSON.stringify([movementProfileId, goal.q, goal.r]);
}

function movementProfileIdForEnemy(
  profile: DynamicFlowNavigationProfileV1,
  enemy: EnemyState
): string {
  return profile.enemyMovementProfiles?.[enemy.typeId] ?? profile.defaultMovementProfileId;
}

/**
 * Pure orchestration over detached resolvers. It materializes each profile+numeric-goal field
 * once, classifies the complete baseline/candidate safety set, and preplans live enemy rebinds.
 */
export function planDynamicTerraformingNavigation(
  request: DynamicTerraformingNavigationRequest
): DynamicTerraformingNavigationPlan {
  const routes = [...request.routes].sort((left, right) => compareBinary(left.id, right.id));
  const routesById = new Map(routes.map((route) => [route.id, route]));

  const navigableEnemies = request.enemies
    .filter((enemy) => enemy.navigation !== undefined && enemy.routeId !== undefined)
    .sort((left, right) => compareBinary(left.id, right.id));
  const baselineLookupCache = new NavigationFieldLookupCache();
  const candidateLookupCache = new NavigationFieldLookupCache();
  const baselineFields = new Map<string, NavigationFieldResult>();
  const candidateFields = new Map<string, NavigationFieldResult>();
  let baselineAvailable = true;
  let candidateAvailable = true;

  for (const group of request.safetySet.groups) {
    const baselineField = request.baselineResolver.getField(group.movementProfileId, group.routeId);
    const candidateField = request.candidateResolver.getField(group.movementProfileId, group.routeId);
    baselineFields.set(group.key, baselineField);
    candidateFields.set(group.key, candidateField);
    const baselineLookup = baselineLookupCache.get(baselineField);
    const candidateLookup = candidateLookupCache.get(candidateField);
    for (const source of group.sources) {
      if (!baselineLookup.get(source.coord)) baselineAvailable = false;
      if (!candidateLookup.get(source.coord)) candidateAvailable = false;
    }
  }

  for (const obligation of request.safetySet.obligations ?? []) {
    const parentKey = groupKey(obligation.parent.movementProfileId, obligation.parent.goal);
    const childKey = groupKey(obligation.child.movementProfileId, obligation.child.goal);
    const baselineParent = baselineFields.get(parentKey);
    const baselineChild = baselineFields.get(childKey);
    const candidateParent = candidateFields.get(parentKey);
    const candidateChild = candidateFields.get(childKey);
    if (!baselineParent || !baselineChild || !candidateParent || !candidateChild) {
      throw new Error(`Dynamic spawn obligation "${obligation.key}" has no materialized field.`);
    }
    const baselineChildLookup = baselineLookupCache.get(baselineChild);
    const candidateChildLookup = candidateLookupCache.get(candidateChild);
    for (const cell of baselineParent.cells) {
      if (cell.coord.q === obligation.parent.goal.q && cell.coord.r === obligation.parent.goal.r) {
        continue;
      }
      if (!baselineChildLookup.get(cell.coord)) baselineAvailable = false;
    }
    for (const cell of candidateParent.cells) {
      if (cell.coord.q === obligation.parent.goal.q && cell.coord.r === obligation.parent.goal.r) {
        continue;
      }
      if (!candidateChildLookup.get(cell.coord)) candidateAvailable = false;
    }
  }

  const candidateEnemyFields = new Map<string, NavigationFieldResult>();
  const enemyRebinds: DynamicTerraformingEnemyRebind[] = [];
  if (candidateAvailable) {
    for (const enemy of navigableEnemies) {
      const navigation = enemy.navigation!;
      const route = routesById.get(enemy.routeId!)!;
      const movementProfileId = movementProfileIdForEnemy(request.profile, enemy);
      const goal = route.pathCenterline.at(-1)!;
      const field = candidateFields.get(groupKey(movementProfileId, goal));
      if (!field) throw new Error(`Dynamic enemy "${enemy.id}" has no candidate navigation field.`);
      candidateEnemyFields.set(enemy.id, field);
      // Dead enemies awaiting the normal reap phase need only a current field association. They
      // are not safety sources and their navigation identity must remain untouched.
      if (enemy.hp <= 0) continue;
      const lookup = candidateLookupCache.get(field);
      const cell = lookup.get(navigation.currentCoord);
      if (!cell) throw new Error(`Dynamic enemy "${enemy.id}" has no reachable candidate cell.`);
      const edgeRemainsCanonical = Boolean(
        navigation.nextCoord
        && cell.nextCoord
        && navigation.nextCoord.q === cell.nextCoord.q
        && navigation.nextCoord.r === cell.nextCoord.r
        && lookup.enteredCost(cell) !== undefined
      );
      const rebound: EnemyNavigationStateV1 = {
        schemaVersion: 1,
        movementProfileId,
        currentCoord: { ...navigation.currentCoord },
        ...(cell.nextCoord ? { nextCoord: { ...cell.nextCoord } } : {}),
        edgeProgress: edgeRemainsCanonical ? navigation.edgeProgress : 0,
        stepsEntered: navigation.stepsEntered
      };
      enemyRebinds.push({
        enemyId: enemy.id,
        navigation: rebound,
        pathProgress: rebound.stepsEntered + rebound.edgeProgress
      });
    }
  }

  return {
    baselineAvailable,
    candidateAvailable,
    candidateResolver: request.candidateResolver,
    candidateLookupCache,
    candidateEnemyFields,
    enemyRebinds
  };
}
