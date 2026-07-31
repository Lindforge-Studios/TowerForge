import { type BallisticsTrajectoryV1 } from "../content/ballistics-mechanics.js";
import { type DamagePacket, type DamageResolution, type DamageResolutionContext } from "./damage.js";
import type { GridMap } from "./map.js";
import { type ProjectileClearanceCollisionV1 } from "./projectile-clearance.js";
import type { GridCoord } from "./types.js";
export declare const DESTRUCTIBLE_COLLISION_LIMITS: Readonly<{
    maximumRayDistance: 256;
    cellInspectionsPerTick: 1048576;
}>;
export interface DestructibleCollisionBodyV1 {
    readonly objectId: string;
    readonly definitionId: string;
    readonly coord: GridCoord;
    readonly blockerHeight: number;
}
export interface DestructibleCollisionIndexV1 {
    readonly schemaVersion: 1;
}
export interface ProjectileDestructibleCollisionRequestV1 {
    readonly sourceCoord: GridCoord;
    readonly targetCoord: GridCoord;
    readonly sourceElevation: number;
    readonly targetElevation: number;
    readonly trajectory: BallisticsTrajectoryV1;
    readonly travelTimeUnits: number;
    readonly maxAltitude?: number;
    readonly terrainCollision?: ProjectileClearanceCollisionV1;
}
export interface ProjectileMapObjectCollisionV1 {
    readonly kind: "map_object";
    readonly objectId: string;
    readonly definitionId: string;
    readonly collisionCoord: GridCoord;
    readonly blockerElevation: number;
    readonly blockerHeight: number;
    readonly elapsedUnits: number;
}
export interface ProjectileTerrainTerminalCollisionV1 extends ProjectileClearanceCollisionV1 {
    readonly kind: "terrain";
}
export type ProjectileDestructibleCollisionTraceV1 = {
    readonly ok: true;
    readonly cellInspections: number;
    readonly collision?: ProjectileMapObjectCollisionV1 | ProjectileTerrainTerminalCollisionV1;
} | {
    readonly ok: false;
    readonly cellInspections: number;
    readonly reason: "ray_budget_exceeded" | "operation_budget_exceeded";
};
export interface DestructibleMapObjectStateV1 {
    readonly objectId: string;
    readonly definitionId: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly armorTypeId?: string;
}
export interface DestructibleObjectDamagePlanV1 {
    readonly outcome: "no_effect" | "nonlethal" | "requires_atomic_destruction";
    readonly objectId: string;
    readonly definitionId: string;
    readonly previousHp: number;
    readonly nextHp: number;
    readonly damagePacket: DamagePacket;
    readonly resolution: DamageResolution;
}
/** Build a detached O(1) lookup for launch-time fixed projectile collision. */
export declare function createDestructibleCollisionIndexV1(map: GridMap, value: readonly DestructibleCollisionBodyV1[]): DestructibleCollisionIndexV1;
/** Trace source-exclusive/target-inclusive fixed collision against map objects and prior terrain provenance. */
export declare function traceProjectileDestructibleCollisionV1(map: GridMap, index: DestructibleCollisionIndexV1, value: ProjectileDestructibleCollisionRequestV1, remainingCellInspections?: number): ProjectileDestructibleCollisionTraceV1;
/** Plan map-object damage without mutating HP, collision state, terrain, or the source packet. */
export declare function planDestructibleObjectDamageV1(value: DamagePacket, objectValue: DestructibleMapObjectStateV1, contextValue?: DamageResolutionContext): DestructibleObjectDamagePlanV1;
