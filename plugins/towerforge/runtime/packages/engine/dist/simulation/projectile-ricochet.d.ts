import type { GridMap } from "./map.js";
import type { GridCoord } from "./types.js";
export interface ProjectileRicochetRayRequestV1 {
    readonly kind: "terrain" | "armor";
    readonly incomingFromCoord: GridCoord;
    readonly collisionCoord: GridCoord;
    readonly rangeCells: number;
}
export type ProjectileRicochetRayResultV1 = {
    readonly ok: true;
    readonly nextSourceCoord: GridCoord;
    readonly ray: readonly GridCoord[];
    readonly cellInspections: number;
} | {
    readonly ok: false;
    readonly reason: "operation_budget_exceeded";
    readonly cellInspections: number;
};
/** Plan one deterministic topology-owned backscatter ray without inspecting gameplay entities. */
export declare function traceProjectileRicochetRayV1(map: GridMap, value: ProjectileRicochetRayRequestV1, remainingCellInspections?: number): ProjectileRicochetRayResultV1;
