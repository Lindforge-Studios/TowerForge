import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { GridMap, type GridMapDefinition } from "./map.js";

interface Request {
  readonly kind: "terrain" | "armor";
  readonly incomingFromCoord: { readonly q: number; readonly r: number };
  readonly collisionCoord: { readonly q: number; readonly r: number };
  readonly rangeCells: number;
}

type Result =
  | {
      readonly ok: true;
      readonly nextSourceCoord: { readonly q: number; readonly r: number };
      readonly ray: readonly { readonly q: number; readonly r: number }[];
      readonly cellInspections: number;
    }
  | { readonly ok: false; readonly reason: string; readonly cellInspections: number };

function map(grid: GridMapDefinition["grid"]): GridMap {
  return GridMap.fromDefinition({
    id: "reflection", width: 9, height: 7, grid,
    defaultTerrain: "buildable", spawnCoord: { q: 0, r: 3 }, coreCoord: { q: 8, r: 3 },
    pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 3 })),
    pathRoutes: [], terrainOverrides: []
  });
}

function tracer(): (map: GridMap, request: Request, remainingCellInspections?: number) => Result {
  const trace = (Engine as unknown as {
    traceProjectileRicochetRayV1?: (map: GridMap, request: Request, remainingCellInspections?: number) => Result;
  }).traceProjectileRicochetRayV1;
  expect(trace, "R13.3 must export the pure topology-owned reflected-ray planner").toBeTypeOf("function");
  return trace!;
}

describe("R13.3 pure topology ricochet planning (RED)", () => {
  it("backscatters on square topology and distinguishes terrain last-safe from armor collision source", () => {
    const subject = map({ kind: "square", adjacency: "cardinal" });
    const base = {
      incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 3
    } as const;
    expect(tracer()(subject, { ...base, kind: "terrain" })).toEqual({
      ok: true,
      nextSourceCoord: { q: 4, r: 3 },
      ray: [{ q: 3, r: 3 }, { q: 2, r: 3 }, { q: 1, r: 3 }],
      cellInspections: 3
    });
    expect(tracer()(subject, { ...base, kind: "armor" })).toEqual({
      ok: true,
      nextSourceCoord: { q: 5, r: 3 },
      ray: [{ q: 4, r: 3 }, { q: 3, r: 3 }, { q: 2, r: 3 }],
      cellInspections: 3
    });
  });

  it("uses odd-r hex opposite directions across row parity without inventing normals", () => {
    const subject = map({ kind: "hex", layout: "odd-r" });
    expect(tracer()(subject, {
      kind: "armor",
      incomingFromCoord: { q: 3, r: 2 },
      collisionCoord: { q: 3, r: 3 },
      rangeCells: 3
    })).toEqual({
      ok: true,
      nextSourceCoord: { q: 3, r: 3 },
      ray: [{ q: 3, r: 2 }, { q: 2, r: 1 }, { q: 2, r: 0 }],
      cellInspections: 3
    });
    expect(tracer()(subject, {
      kind: "terrain",
      incomingFromCoord: { q: 3, r: 2 },
      collisionCoord: { q: 3, r: 3 },
      rangeCells: 2
    })).toMatchObject({
      ok: true,
      nextSourceCoord: { q: 3, r: 2 },
      ray: [{ q: 2, r: 1 }, { q: 2, r: 0 }]
    });
  });

  it("stops deterministically at the map edge and returns detached frozen rows", () => {
    const subject = map({ kind: "square", adjacency: "cardinal" });
    const result = tracer()(subject, {
      kind: "armor",
      incomingFromCoord: { q: 1, r: 3 }, collisionCoord: { q: 0, r: 3 }, rangeCells: 256
    });
    expect(result).toEqual({
      ok: true, nextSourceCoord: { q: 0, r: 3 }, ray: [{ q: 1, r: 3 }, { q: 2, r: 3 },
        { q: 3, r: 3 }, { q: 4, r: 3 }, { q: 5, r: 3 }, { q: 6, r: 3 }, { q: 7, r: 3 }, { q: 8, r: 3 }],
      cellInspections: 8
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.nextSourceCoord)).toBe(true);
      expect(Object.isFrozen(result.ray)).toBe(true);
      expect(result.ray.every(Object.isFrozen)).toBe(true);
    }
  });

  it("fails closed on non-adjacent/diagonal square input and exhausted inspection budget", () => {
    const subject = map({ kind: "square", adjacency: "cardinal" });
    for (const request of [
      {
        kind: "armor" as const,
        incomingFromCoord: { q: 3, r: 2 }, collisionCoord: { q: 4, r: 3 }, rangeCells: 3
      },
      {
        kind: "terrain" as const,
        incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 257
      }
    ]) expect(() => tracer()(subject, request)).toThrow(/ricochet|adjacent|direction|range|256|invalid/i);

    expect(tracer()(subject, {
      kind: "armor", incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 3
    }, 0)).toEqual({ ok: false, reason: "operation_budget_exceeded", cellInspections: 0 });
  });

  it("rejects accessor/proxy/symbol/custom-prototype requests without executing hostile code", () => {
    const subject = map({ kind: "square", adjacency: "cardinal" });
    let calls = 0;
    const accessor = {
      kind: "armor", incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 3
    } as any;
    Object.defineProperty(accessor, "rangeCells", {
      enumerable: true, get: () => { calls += 1; return 3; }
    });
    expect(() => tracer()(subject, accessor)).toThrow(/accessor|own data|inspect|range/i);
    expect(calls).toBe(0);
    expect(() => tracer()(subject, new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }) as Request))
      .toThrow(/inspect|safe|plain/i);
    expect(() => tracer()(subject, Object.assign({
      kind: "armor", incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 3
    }, { [Symbol("hidden")]: true }) as Request)).toThrow(/symbol|field/i);
    expect(() => tracer()(subject, Object.create({
      kind: "armor", incomingFromCoord: { q: 4, r: 3 }, collisionCoord: { q: 5, r: 3 }, rangeCells: 3
    }) as Request)).toThrow(/prototype|plain|own data/i);
  });
});
