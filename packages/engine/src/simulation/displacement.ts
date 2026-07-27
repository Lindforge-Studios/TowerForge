import { PHYSICS_LIMITS } from "../content/physics-mechanics.js";
import type { DisplacementEffectV1, GridCoord } from "./types.js";
import type { GridTopology } from "./topology.js";

export type DisplacementMode = "push" | "pull";
export type DisplacementCandidateClassification = "open" | "blocked" | "fall_hazard";
export type DisplacementStopReason =
  | "completed"
  | "same_source_target"
  | "blocked"
  | "atomic_blocked"
  | "no_strict_neighbor"
  | "fall_hazard";

export interface DisplacementPlanRequest {
  readonly topology: GridTopology;
  readonly sourceCoord: GridCoord;
  readonly targetCoord: GridCoord;
  readonly effect: DisplacementEffectV1;
  readonly classifyCandidate: (
    coord: GridCoord,
    stepIndex: number
  ) => DisplacementCandidateClassification;
}

export interface DisplacementPlan {
  readonly from: GridCoord;
  readonly to: GridCoord;
  readonly requestedDistance: number;
  readonly movedDistance: number;
  readonly steps: readonly GridCoord[];
  readonly fell: boolean;
  readonly stopReason: DisplacementStopReason;
}

function sameCoord(left: GridCoord, right: GridCoord): boolean {
  return left.q === right.q && left.r === right.r;
}

function result(
  from: GridCoord,
  to: GridCoord,
  requestedDistance: number,
  steps: readonly GridCoord[],
  fell: boolean,
  stopReason: DisplacementStopReason
): DisplacementPlan {
  return Object.freeze({
    from: Object.freeze({ ...from }),
    to: Object.freeze({ ...to }),
    requestedDistance,
    movedDistance: steps.length,
    steps: Object.freeze(steps.map((coord) => Object.freeze({ ...coord }))),
    fell,
    stopReason
  });
}

/** Pure bounded tile-step planner. Geometry is selected before candidate classification. */
export function planTileDisplacement(request: DisplacementPlanRequest): DisplacementPlan {
  const distance = request.effect.distance;
  if (!Number.isSafeInteger(distance) || distance < 1 || distance > PHYSICS_LIMITS.displacementDistance) {
    throw new Error(`Displacement distance must be a bounded safe integer in 1..${PHYSICS_LIMITS.displacementDistance}.`);
  }
  const from = { ...request.targetCoord };
  if (sameCoord(request.sourceCoord, request.targetCoord)) {
    return result(from, from, distance, [], false, "same_source_target");
  }
  let current = { ...request.targetCoord };
  const steps: GridCoord[] = [];
  for (let stepIndex = 1; stepIndex <= distance; stepIndex += 1) {
    const currentDistance = request.topology.distance(current, request.sourceCoord);
    const candidate = request.topology.neighbors(current).find((neighbor) => {
      const candidateDistance = request.topology.distance(neighbor, request.sourceCoord);
      return request.effect.mode === "pull"
        ? candidateDistance < currentDistance
        : candidateDistance > currentDistance;
    });
    if (!candidate) {
      if (!request.effect.stopAtBlocker) return result(from, from, distance, [], false, "no_strict_neighbor");
      return result(from, current, distance, steps, false, "no_strict_neighbor");
    }
    const classification = request.classifyCandidate(candidate, stepIndex);
    if (classification === "fall_hazard") {
      steps.push({ ...candidate });
      return result(from, candidate, distance, steps, true, "fall_hazard");
    }
    if (classification === "blocked") {
      if (!request.effect.stopAtBlocker) return result(from, from, distance, [], false, "atomic_blocked");
      return result(from, current, distance, steps, false, "blocked");
    }
    steps.push({ ...candidate });
    current = { ...candidate };
  }
  return result(from, current, distance, steps, false, "completed");
}
