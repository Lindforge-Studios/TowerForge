import { ARC_CLEARANCE_LIMITS } from "../content/ballistics-mechanics.js";
export function projectileAltitudeAtProgress(sourceElevation, targetElevation, trajectory, maxAltitude, progress) {
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const baseline = sourceElevation + (targetElevation - sourceElevation) * boundedProgress;
    return trajectory === "arc"
        ? baseline + 4 * maxAltitude * boundedProgress * (1 - boundedProgress)
        : baseline;
}
/**
 * Captures one launch-time clearance trace over the topology-owned line. Runtime terrain changes
 * cannot rewrite an already launched projectile's collision provenance.
 */
export function traceProjectileClearanceV1(map, terrainTypes, clearance, request, remainingCellInspections) {
    if (map.distance(request.sourceCoord, request.targetCoord) > ARC_CLEARANCE_LIMITS.maximumRayDistance) {
        return Object.freeze({ ok: false, cellInspections: 0, reason: "ray_budget_exceeded" });
    }
    const line = map.line(request.sourceCoord, request.targetCoord);
    const steps = line.length - 1;
    if (steps <= 1)
        return Object.freeze({ ok: true, cellInspections: 0 });
    let inspections = 0;
    for (let index = 1; index < line.length - 1; index += 1) {
        if (inspections >= remainingCellInspections) {
            return Object.freeze({
                ok: false,
                cellInspections: inspections,
                reason: "operation_budget_exceeded"
            });
        }
        inspections += 1;
        const coord = line[index];
        const tile = map.getTile(coord);
        const blockerElevation = map.elevationAt(coord);
        if (!tile || blockerElevation === undefined) {
            return Object.freeze({
                ok: false,
                cellInspections: inspections,
                reason: "operation_budget_exceeded"
            });
        }
        const terrain = terrainTypes[tile.terrain];
        let blockerTag;
        let blockerHeight = Number.NEGATIVE_INFINITY;
        for (const tag of terrain?.tags ?? []) {
            if (!Object.prototype.hasOwnProperty.call(clearance.terrainBlockerHeights, tag))
                continue;
            const height = clearance.terrainBlockerHeights[tag];
            if (height > blockerHeight || (height === blockerHeight && (blockerTag === undefined || tag < blockerTag))) {
                blockerTag = tag;
                blockerHeight = height;
            }
        }
        if (blockerTag === undefined)
            continue;
        const progress = index / steps;
        const projectileAltitude = projectileAltitudeAtProgress(request.sourceElevation, request.targetElevation, request.trajectory, request.maxAltitude, progress);
        if (projectileAltitude > blockerElevation + blockerHeight)
            continue;
        return Object.freeze({
            ok: true,
            cellInspections: inspections,
            collision: Object.freeze({
                blockerCoord: Object.freeze({ q: coord.q, r: coord.r }),
                terrainId: tile.terrain,
                blockerTag,
                blockerElevation,
                elapsedUnits: request.travelTimeUnits * progress
            })
        });
    }
    return Object.freeze({ ok: true, cellInspections: inspections });
}
