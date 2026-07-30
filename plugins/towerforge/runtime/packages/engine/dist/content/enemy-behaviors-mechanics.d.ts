import type { GameContentRegistry } from "./registry.js";
import { type ShieldDefinition } from "./mechanics.js";
export declare const ENEMY_BEHAVIORS_LIMITS: Readonly<{
    bossesPerProfile: 256;
    componentsPerRoot: 32;
    towerBindingsPerProfile: 256;
    cohortsPerProfile: 64;
    membersPerCohort: 256;
    formationAssignmentsPerProfile: 4096;
    neighborRadius: 2;
    steeringWeight: 1000;
    tagsPerComponent: 32;
    priorityTagsPerBinding: 32;
    idOrTagUtf8Bytes: 128;
    labelUtf8Bytes: 256;
    maxHp: 1000000000000;
    hitRegionOffset: 4;
    hitRegionRadius: 8;
}>;
export declare const BOSS_COMPONENT_ABILITY_IDS: readonly ["towerAttack", "towerDisrupt", "healAura"];
export type BossComponentAbilityIdV1 = (typeof BOSS_COMPONENT_ABILITY_IDS)[number];
export interface BossComponentHitRegionV1 {
    readonly kind: "circle";
    readonly offsetX: number;
    readonly offsetY: number;
    readonly radius: number;
}
export interface BossComponentDefinitionV1 {
    readonly maxHp: number;
    readonly hitRegion: BossComponentHitRegionV1;
    readonly label?: string;
    readonly tags?: readonly string[];
    readonly shield?: ShieldDefinition;
    readonly armorTypeId?: string;
    readonly disablesAbilities?: readonly BossComponentAbilityIdV1[];
}
export interface BossComponentsDefinitionV1 {
    readonly components: Readonly<Record<string, BossComponentDefinitionV1>>;
}
export interface BossComponentTowerTargetingV1 {
    readonly priorityTags: readonly string[];
}
export declare const FORMATION_ROLES: readonly ["vanguard", "body", "support"];
export type FormationRoleV1 = (typeof FORMATION_ROLES)[number];
export interface FormationSteeringDefinitionV1 {
    readonly neighborRadius: 1 | 2;
    readonly cohesionWeight: number;
    readonly separationWeight: number;
    readonly roleWeight: number;
}
export interface FormationCohortDefinitionV1 {
    readonly members: Readonly<Record<string, FormationRoleV1>>;
    readonly steering: FormationSteeringDefinitionV1;
}
export interface EnemyFormationsDefinitionV1 {
    readonly cohorts: Readonly<Record<string, FormationCohortDefinitionV1>>;
}
export interface EnemyBehaviorsProfileV1 {
    readonly bosses?: Readonly<Record<string, BossComponentsDefinitionV1>>;
    readonly targeting?: {
        readonly towers: Readonly<Record<string, BossComponentTowerTargetingV1>>;
    };
    readonly formations?: EnemyFormationsDefinitionV1;
}
export interface ActiveEnemyBehaviorsV1 extends EnemyBehaviorsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export declare class EnemyBehaviorsProfileValidationError extends Error {
}
/** Closed hostile-data-safe parser that returns detached, binary-ordered, deeply frozen own data. */
export declare function normalizeEnemyBehaviorsProfileV1(value: unknown): EnemyBehaviorsProfileV1;
export declare function resolveActiveEnemyBehaviorsV1(content: GameContentRegistry, missionId: string): ActiveEnemyBehaviorsV1 | undefined;
