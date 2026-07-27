import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { NavigationFieldResult } from "./navigation-field.js";
import { NavigationFieldLookupCache } from "./navigation-movement.js";
import type { NavigationResolver } from "./navigation-runtime.js";
import type { PreparedDynamicTerraformingSafetySet } from "./terraforming-navigation-safety.js";
import type { EnemyNavigationStateV1, EnemyState, GridPathRoute } from "./types.js";
export { collectDynamicTerraformingSpawnProvenance } from "./navigation-reachability.js";
export { DynamicTerraformingSafetyBudgetError } from "./terraforming-navigation-budget.js";
export { assertDynamicTerraformingSafetyBudget, prepareDynamicTerraformingSafetySet } from "./terraforming-navigation-safety.js";
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
/**
 * Pure orchestration over detached resolvers. It materializes each profile+numeric-goal field
 * once, classifies the complete baseline/candidate safety set, and preplans live enemy rebinds.
 */
export declare function planDynamicTerraformingNavigation(request: DynamicTerraformingNavigationRequest): DynamicTerraformingNavigationPlan;
