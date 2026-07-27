import { describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import type { GridCoord, GridTopology } from "../index.js";

type CandidateClassification = "open" | "blocked" | "fall_hazard";

interface DisplacementPlanRequest {
  readonly topology: GridTopology;
  readonly sourceCoord: GridCoord;
  readonly targetCoord: GridCoord;
  readonly effect: {
    readonly kind: "displacement";
    readonly mode: "push" | "pull";
    readonly distance: number;
    readonly stopAtBlocker: boolean;
  };
  readonly classifyCandidate: (coord: GridCoord, stepIndex: number) => CandidateClassification;
}

interface DisplacementPlan {
  readonly from: GridCoord;
  readonly to: GridCoord;
  readonly requestedDistance: number;
  readonly movedDistance: number;
  readonly steps: readonly GridCoord[];
  readonly fell: boolean;
  readonly stopReason:
    | "completed"
    | "same_source_target"
    | "blocked"
    | "atomic_blocked"
    | "no_strict_neighbor"
    | "fall_hazard";
}

function planner(): (request: DisplacementPlanRequest) => DisplacementPlan {
  const candidate = (Engine as unknown as {
    planTileDisplacement?: (request: DisplacementPlanRequest) => DisplacementPlan;
  }).planTileDisplacement;
  expect(candidate).toBeTypeOf("function");
  if (!candidate) throw new Error("R3.4a RED: planTileDisplacement is not implemented");
  return candidate;
}

function planOne(
  topology: GridTopology,
  sourceCoord: GridCoord,
  targetCoord: GridCoord,
  mode: "push" | "pull"
): DisplacementPlan {
  return planner()({
    topology,
    sourceCoord,
    targetCoord,
    effect: { kind: "displacement", mode, distance: 1, stopAtBlocker: true },
    classifyCandidate: () => "open"
  });
}

describe("R3.4a pure tile displacement planner", () => {
  it.each([
    [
      "square pull",
      { kind: "square", adjacency: "cardinal" } as const,
      { q: 0, r: 0 },
      { q: 1, r: 1 },
      "pull" as const,
      { q: 1, r: 0 }
    ],
    [
      "square push",
      { kind: "square", adjacency: "cardinal" } as const,
      { q: 0, r: 0 },
      { q: 1, r: 1 },
      "push" as const,
      { q: 2, r: 1 }
    ],
    [
      "even-row hex pull",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 2 },
      "pull" as const,
      { q: 1, r: 1 }
    ],
    [
      "even-row hex push",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 2 },
      "push" as const,
      { q: 3, r: 2 }
    ],
    [
      "odd-row hex pull",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 3 },
      "pull" as const,
      { q: 2, r: 2 }
    ],
    [
      "odd-row hex push",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 3 },
      "push" as const,
      { q: 3, r: 3 }
    ]
  ])("uses stable topology order for %s strict-distance ties", (_label, grid, source, target, mode, expected) => {
    const result = planOne(Engine.createGridTopology(grid), source, target, mode);
    expect(result).toEqual({
      from: target,
      to: expected,
      requestedDistance: 1,
      movedDistance: 1,
      steps: [expected],
      fell: false,
      stopReason: "completed"
    });
  });

  it.each([
    [
      "square",
      { kind: "square", adjacency: "cardinal" } as const,
      { q: 0, r: 0 },
      { q: 1, r: 1 },
      { q: 1, r: 0 }
    ],
    [
      "even-row hex",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 2 },
      { q: 1, r: 1 }
    ],
    [
      "odd-row hex",
      { kind: "hex", layout: "odd-r" } as const,
      { q: 0, r: 0 },
      { q: 2, r: 3 },
      { q: 2, r: 2 }
    ]
  ])("stops on the geometrically first blocked %s neighbor and never slides to a later strict tie", (
    _label,
    grid,
    sourceCoord,
    targetCoord,
    firstStrict
  ) => {
    const topology = Engine.createGridTopology(grid);
    const visited: GridCoord[] = [];
    const result = planner()({
      topology,
      sourceCoord,
      targetCoord,
      effect: { kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true },
      classifyCandidate(coord) {
        visited.push(coord);
        return coord.q === firstStrict.q && coord.r === firstStrict.r ? "blocked" : "open";
      }
    });

    expect(visited).toEqual([firstStrict]);
    expect(result).toMatchObject({
      from: targetCoord,
      to: targetCoord,
      movedDistance: 0,
      steps: [],
      fell: false,
      stopReason: "blocked"
    });
  });

  it("preserves partial movement with stopAtBlocker and rolls the whole ordinary plan back when atomic", () => {
    const topology = Engine.createGridTopology({ kind: "square", adjacency: "cardinal" });
    const request = (stopAtBlocker: boolean): DisplacementPlanRequest => ({
      topology,
      sourceCoord: { q: 0, r: 0 },
      targetCoord: { q: 1, r: 0 },
      effect: { kind: "displacement", mode: "push", distance: 3, stopAtBlocker },
      classifyCandidate: (_coord, stepIndex) => stepIndex === 2 ? "blocked" : "open"
    });

    expect(planner()(request(true))).toMatchObject({
      to: { q: 1, r: -1 },
      requestedDistance: 3,
      movedDistance: 1,
      steps: [{ q: 1, r: -1 }],
      fell: false,
      stopReason: "blocked"
    });
    expect(planner()(request(false))).toMatchObject({
      to: { q: 1, r: 0 },
      requestedDistance: 3,
      movedDistance: 0,
      steps: [],
      fell: false,
      stopReason: "atomic_blocked"
    });
  });

  it("commits a terminal hazard reached during atomic preflight and does not inspect later steps", () => {
    const topology = Engine.createGridTopology({ kind: "square", adjacency: "cardinal" });
    const classifyCandidate = vi.fn((_coord: GridCoord, stepIndex: number): CandidateClassification => (
      stepIndex === 2 ? "fall_hazard" : "open"
    ));
    const result = planner()({
      topology,
      sourceCoord: { q: 0, r: 0 },
      targetCoord: { q: 1, r: 0 },
      effect: { kind: "displacement", mode: "push", distance: 8, stopAtBlocker: false },
      classifyCandidate
    });

    expect(classifyCandidate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      to: { q: 1, r: -2 },
      requestedDistance: 8,
      movedDistance: 2,
      steps: [{ q: 1, r: -1 }, { q: 1, r: -2 }],
      fell: true,
      stopReason: "fall_hazard"
    });
  });

  it("returns a same-cell no-op without inspecting topology candidates", () => {
    const classifyCandidate = vi.fn((): CandidateClassification => "open");
    const coord = { q: 3, r: 4 };
    const result = planner()({
      topology: Engine.createGridTopology({ kind: "hex", layout: "odd-r" }),
      sourceCoord: coord,
      targetCoord: coord,
      effect: { kind: "displacement", mode: "pull", distance: 8, stopAtBlocker: true },
      classifyCandidate
    });

    expect(classifyCandidate).not.toHaveBeenCalled();
    expect(result).toEqual({
      from: coord,
      to: coord,
      requestedDistance: 8,
      movedDistance: 0,
      steps: [],
      fell: false,
      stopReason: "same_source_target"
    });
  });

  it.each([0, -1, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unbounded or non-positive distance %s before candidate inspection",
    (distance) => {
      const classifyCandidate = vi.fn((): CandidateClassification => "open");
      expect(() => planner()({
        topology: Engine.createGridTopology({ kind: "square", adjacency: "cardinal" }),
        sourceCoord: { q: 0, r: 0 },
        targetCoord: { q: 1, r: 0 },
        effect: { kind: "displacement", mode: "push", distance, stopAtBlocker: true },
        classifyCandidate
      })).toThrow(/distance|safe integer|1\.\.8|bounded/i);
      expect(classifyCandidate).not.toHaveBeenCalled();
    }
  );
});
