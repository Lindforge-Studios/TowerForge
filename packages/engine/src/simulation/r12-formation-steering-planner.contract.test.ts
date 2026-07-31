import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import type { FormationSteeringDefinitionV1, FormationRoleV1, GridCoord, GridDefinition } from "../index.js";

interface FormationSteeringCandidateV1Contract {
  readonly coord: GridCoord;
  readonly remainingCostMilli: number;
}

interface FormationSteeringSelfV1Contract {
  readonly enemyId: string;
  readonly cohortId: string;
  readonly role: FormationRoleV1;
}

interface FormationSteeringNeighborV1Contract {
  readonly enemyId: string;
  readonly role: FormationRoleV1;
  readonly anchorCoord: GridCoord;
  readonly remainingCostMilli: number;
}

interface FormationSteeringRequestV1Contract {
  readonly schemaVersion: 1;
  readonly grid: GridDefinition;
  readonly currentCoord: GridCoord;
  readonly canonicalNextCoord: GridCoord;
  readonly candidates: readonly FormationSteeringCandidateV1Contract[];
  readonly self: FormationSteeringSelfV1Contract;
  readonly neighbors: readonly FormationSteeringNeighborV1Contract[];
  readonly steering: FormationSteeringDefinitionV1;
}

interface FormationSteeringResultV1Contract {
  readonly schemaVersion: 1;
  readonly nextCoord: GridCoord;
  readonly neighborIds: readonly string[];
  readonly score: number;
}

type FormationSteeringPlannerV1 = (
  request: FormationSteeringRequestV1Contract
) => FormationSteeringResultV1Contract;

function planner(): FormationSteeringPlannerV1 {
  const select = (Engine as unknown as {
    selectFormationSteeringNextV1?: FormationSteeringPlannerV1;
  }).selectFormationSteeringNextV1;
  if (!select) throw new Error("Missing pure planner export.");
  return select;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

function coord(q: number, r: number): GridCoord {
  return { q, r };
}

function steering(
  overrides: Partial<FormationSteeringDefinitionV1> = {}
): FormationSteeringDefinitionV1 {
  return {
    neighborRadius: 2,
    cohesionWeight: 1,
    separationWeight: 1,
    roleWeight: 1,
    ...overrides
  };
}

function request(
  overrides: Partial<FormationSteeringRequestV1Contract> = {}
): FormationSteeringRequestV1Contract {
  return {
    schemaVersion: 1,
    grid: SQUARE,
    currentCoord: coord(5, 5),
    canonicalNextCoord: coord(5, 4),
    candidates: [
      { coord: coord(5, 4), remainingCostMilli: 1_000 },
      { coord: coord(6, 5), remainingCostMilli: 1_000 }
    ],
    self: { enemyId: "self", cohortId: "alpha", role: "body" },
    neighbors: [],
    steering: steering(),
    ...overrides
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => (
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map((tail) => [value, ...tail])
  ));
}

function denseArrayWithHostileTail<T>(
  length: number,
  valueAt: (index: number) => T,
  hostileIndex: number,
  onTailRead: () => void
): T[] {
  const values = Array.from({ length }, (_, index) => valueAt(index));
  Object.defineProperty(values, hostileIndex, {
    enumerable: true,
    configurable: true,
    get() {
      onTailRead();
      throw new Error("hostile tail must not be read");
    }
  });
  return values;
}

describe("R12.3 group 2 pure formation steering planner contract (RED)", () => {
  it("exports the planner from the ordinary engine surface", () => {
    expect(
      (Engine as unknown as Record<string, unknown>).selectFormationSteeringNextV1,
      "R12.3 must export the pure selectFormationSteeringNextV1 planner"
    ).toBeTypeOf("function");
  });

  it("returns the canonical square candidate with score zero when no neighbour applies", () => {
    expect(planner()(request({
      steering: steering({ cohesionWeight: 0, separationWeight: 0, roleWeight: 1_000 })
    }))).toEqual({
      schemaVersion: 1,
      nextCoord: { q: 5, r: 4 },
      neighborIds: [],
      score: 0
    });
  });

  it("uses the exact safe-integer cohesion, separation, and role penalty formula", () => {
    const result = planner()(request({
      currentCoord: coord(1, 1),
      canonicalNextCoord: coord(2, 1),
      candidates: [{ coord: coord(2, 1), remainingCostMilli: 1_000 }],
      self: { enemyId: "self", cohortId: "alpha", role: "body" },
      neighbors: [
        { enemyId: "support", role: "support", anchorCoord: coord(3, 1), remainingCostMilli: 500 },
        { enemyId: "vanguard", role: "vanguard", anchorCoord: coord(2, 2), remainingCostMilli: 2_000 }
      ],
      steering: steering({ cohesionWeight: 2, separationWeight: 3, roleWeight: 5 })
    }));

    // cohesion=(1+1)*2=4; separation=(1+1)*3=6;
    // role=(1000-500)*5 + (2000-1000)*5=7500.
    expect(result.score).toBe(7_510);
    expect(result.nextCoord).toEqual({ q: 2, r: 1 });
  });

  it("supports hex distance/scoring through the topology registry", () => {
    expect(planner()(request({
      grid: HEX,
      currentCoord: coord(2, 2),
      canonicalNextCoord: coord(1, 1),
      candidates: [
        { coord: coord(1, 1), remainingCostMilli: 800 },
        { coord: coord(2, 1), remainingCostMilli: 800 }
      ],
      neighbors: [
        { enemyId: "anchor", role: "body", anchorCoord: coord(3, 1), remainingCostMilli: 800 }
      ],
      steering: steering({ cohesionWeight: 10, separationWeight: 0, roleWeight: 0 })
    }))).toMatchObject({
      schemaVersion: 1,
      nextCoord: { q: 2, r: 1 },
      score: 10
    });
  });

  it("chooses only from the host-proven candidate set and never invents a topology neighbour", () => {
    const result = planner()(request({
      currentCoord: coord(5, 5),
      canonicalNextCoord: coord(5, 4),
      candidates: [
        { coord: coord(5, 4), remainingCostMilli: 900 },
        { coord: coord(6, 5), remainingCostMilli: 900 }
      ],
      neighbors: [
        { enemyId: "north", role: "body", anchorCoord: coord(5, 3), remainingCostMilli: 900 }
      ],
      steering: steering({ cohesionWeight: 0, separationWeight: 100, roleWeight: 0 })
    }));
    expect(result.nextCoord).toEqual({ q: 6, r: 5 });
    expect(result.nextCoord).not.toEqual({ q: 5, r: 6 });
  });

  it("uses canonical-first and then topology direction order for equal scores", () => {
    const canonicalTie = planner()(request({
      candidates: [
        { coord: coord(6, 5), remainingCostMilli: 1_000 },
        { coord: coord(5, 4), remainingCostMilli: 1_000 },
        { coord: coord(5, 6), remainingCostMilli: 1_000 }
      ],
      steering: steering({ cohesionWeight: 0, separationWeight: 0, roleWeight: 1 })
    }));
    expect(canonicalTie.nextCoord).toEqual({ q: 5, r: 4 });

    const directionTie = planner()(request({
      candidates: [
        { coord: coord(5, 6), remainingCostMilli: 1_000 },
        { coord: coord(5, 4), remainingCostMilli: 1_000 },
        { coord: coord(4, 5), remainingCostMilli: 1_000 },
        { coord: coord(6, 5), remainingCostMilli: 1_000 }
      ],
      neighbors: [
        { enemyId: "north", role: "body", anchorCoord: coord(5, 3), remainingCostMilli: 1_000 }
      ],
      steering: steering({ cohesionWeight: 0, separationWeight: 1, roleWeight: 0 })
    }));
    // N is penalized. E, S and W tie, so square topology order selects E.
    expect(directionTie.nextCoord).toEqual({ q: 6, r: 5 });
  });

  it("is invariant to candidate and neighbour input permutations", () => {
    const candidates = [
      { coord: coord(5, 4), remainingCostMilli: 1_000 },
      { coord: coord(6, 5), remainingCostMilli: 1_000 },
      { coord: coord(5, 6), remainingCostMilli: 1_000 }
    ];
    const neighbors: FormationSteeringNeighborV1Contract[] = [
      { enemyId: "zulu", role: "support", anchorCoord: coord(6, 4), remainingCostMilli: 700 },
      { enemyId: "alpha", role: "vanguard", anchorCoord: coord(4, 5), remainingCostMilli: 1_300 },
      { enemyId: "middle", role: "body", anchorCoord: coord(5, 7), remainingCostMilli: 1_000 }
    ];
    const outputs = permutations(candidates).flatMap((candidateOrder) => (
      permutations(neighbors).map((neighborOrder) => planner()(request({
        candidates: candidateOrder,
        neighbors: neighborOrder,
        steering: steering({ cohesionWeight: 7, separationWeight: 11, roleWeight: 13 })
      })))
    ));
    expect(new Set(outputs.map((output) => JSON.stringify(output))).size).toBe(1);
  });

  it("sorts at most sixteen neighbour ids by current distance and binary id", () => {
    const neighbors = [
      { enemyId: "middle", role: "body" as const, anchorCoord: coord(5, 7), remainingCostMilli: 1_000 },
      { enemyId: "zulu", role: "body" as const, anchorCoord: coord(6, 5), remainingCostMilli: 1_000 },
      { enemyId: "alpha", role: "body" as const, anchorCoord: coord(5, 4), remainingCostMilli: 1_000 }
    ];
    expect(planner()(request({ neighbors })).neighborIds).toEqual(["alpha", "zulu", "middle"]);
  });

  it("returns detached, deeply frozen own data", () => {
    const mutableCandidate = { coord: coord(5, 4), remainingCostMilli: 1_000 };
    const mutableNeighbor = {
      enemyId: "neighbor",
      role: "body" as const,
      anchorCoord: coord(5, 3),
      remainingCostMilli: 1_000
    };
    const result = planner()(request({
      candidates: [mutableCandidate],
      neighbors: [mutableNeighbor]
    }));
    mutableCandidate.coord.q = 99;
    mutableNeighbor.enemyId = "changed";

    expect(result).toEqual({
      schemaVersion: 1,
      nextCoord: { q: 5, r: 4 },
      neighborIds: ["neighbor"],
      score: 2
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nextCoord)).toBe(true);
    expect(Object.isFrozen(result.neighborIds)).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["schemaVersion", "nextCoord", "neighborIds", "score"]);
  });

  const malformedCases: readonly [string, () => unknown, RegExp][] = [
    ["future schema", () => request({ schemaVersion: 2 as 1 }), /schemaVersion|version|1/i],
    ["unknown request field", () => ({ ...request(), extra: true }), /closed|unknown|extra/i],
    ["unknown square grid field", () => request({ grid: { kind: "square", adjacency: "cardinal", extra: true } as GridDefinition }), /grid|closed|unknown|extra/i],
    ["unsupported hex layout", () => request({ grid: { kind: "hex", layout: "even-r" } as unknown as GridDefinition }), /grid|layout|odd-r/i],
    ["fractional coord", () => request({ currentCoord: coord(0.5, 5) }), /coord|integer|safe/i],
    ["coord extra field", () => request({ currentCoord: { q: 5, r: 5, z: 0 } as GridCoord }), /coord|closed|unknown|z/i],
    ["empty candidates", () => request({ candidates: [] }), /candidate|1|empty|budget/i],
    ["duplicate candidates", () => request({ candidates: [
      { coord: coord(5, 4), remainingCostMilli: 1_000 },
      { coord: coord(5, 4), remainingCostMilli: 1_000 }
    ] }), /candidate|duplicate|unique/i],
    ["canonical omitted", () => request({ candidates: [
      { coord: coord(6, 5), remainingCostMilli: 1_000 }
    ] }), /canonical|candidate|exactly once/i],
    ["nonadjacent candidate", () => request({ candidates: [
      { coord: coord(5, 4), remainingCostMilli: 1_000 },
      { coord: coord(7, 5), remainingCostMilli: 1_000 }
    ] }), /candidate|adjacent|topology/i],
    ["negative cost", () => request({ candidates: [
      { coord: coord(5, 4), remainingCostMilli: -1 }
    ] }), /remainingCostMilli|cost|safe|non-negative/i],
    ["fractional cost", () => request({ candidates: [
      { coord: coord(5, 4), remainingCostMilli: 0.5 }
    ] }), /remainingCostMilli|cost|safe|integer/i],
    ["unknown candidate field", () => request({ candidates: [
      { coord: coord(5, 4), remainingCostMilli: 1_000, extra: true } as FormationSteeringCandidateV1Contract
    ] }), /candidate|closed|unknown|extra/i],
    ["unknown self field", () => request({ self: {
      enemyId: "self", cohortId: "alpha", role: "body", extra: true
    } as FormationSteeringSelfV1Contract }), /self|closed|unknown|extra/i],
    ["invalid self role", () => request({ self: {
      enemyId: "self", cohortId: "alpha", role: "leader" as FormationRoleV1
    } }), /self|role|vanguard|body|support/i],
    ["self in neighbours", () => request({ neighbors: [
      { enemyId: "self", role: "body", anchorCoord: coord(5, 4), remainingCostMilli: 1_000 }
    ] }), /neighbor|self|enemyId/i],
    ["duplicate neighbour ids", () => request({ neighbors: [
      { enemyId: "same", role: "body", anchorCoord: coord(5, 4), remainingCostMilli: 1_000 },
      { enemyId: "same", role: "support", anchorCoord: coord(6, 5), remainingCostMilli: 1_000 }
    ] }), /neighbor|duplicate|unique|enemyId/i],
    ["unknown neighbour field", () => request({ neighbors: [
      { enemyId: "n", role: "body", anchorCoord: coord(5, 4), remainingCostMilli: 1_000, extra: true } as FormationSteeringNeighborV1Contract
    ] }), /neighbor|closed|unknown|extra/i],
    ["invalid steering radius", () => request({ steering: steering({ neighborRadius: 3 as 2 }) }), /steering|neighborRadius|1|2/i],
    ["all steering weights zero", () => request({ steering: steering({ cohesionWeight: 0, separationWeight: 0, roleWeight: 0 }) }), /steering|weight|positive|zero/i]
  ];

  for (const [name, value, pattern] of malformedCases) {
    it(`rejects malformed closed own-data input: ${name}`, () => {
      expect(() => planner()(value() as FormationSteeringRequestV1Contract)).toThrow(pattern);
    });
  }

  it("rejects accessors without invoking them", () => {
    let reads = 0;
    const hostile = request() as FormationSteeringRequestV1Contract & Record<string, unknown>;
    Object.defineProperty(hostile, "grid", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return SQUARE;
      }
    });
    expect(() => planner()(hostile)).toThrow(/own data|accessor|grid|inspect/i);
    expect(reads).toBe(0);
  });

  it("rejects proxies, sparse arrays, and cyclic own data", () => {
    const proxied = new Proxy(request(), {
      ownKeys() {
        throw new Error("hostile proxy");
      }
    });
    expect(() => planner()(proxied)).toThrow(/inspect|proxy|request|safe/i);

    const sparse = new Array<FormationSteeringCandidateV1Contract>(2);
    sparse[0] = { coord: coord(5, 4), remainingCostMilli: 1_000 };
    expect(() => planner()(request({ candidates: sparse }))).toThrow(/candidate|dense|sparse/i);

    const cyclic = request() as FormationSteeringRequestV1Contract & { loop?: unknown };
    cyclic.loop = cyclic;
    expect(() => planner()(cyclic)).toThrow(/closed|unknown|loop|cyclic/i);
  });

  it("rejects candidate and neighbour budgets before reading hostile tail values", () => {
    let candidateTailReads = 0;
    const candidates = denseArrayWithHostileTail(
      9,
      (index) => ({ coord: coord(5 + (index % 2), 4 + index), remainingCostMilli: 1_000 }),
      8,
      () => { candidateTailReads += 1; }
    );
    expect(() => planner()(request({ candidates }))).toThrow(/candidate|8|budget|limit|maximum/i);
    expect(candidateTailReads).toBe(0);

    let neighborTailReads = 0;
    const neighbors = denseArrayWithHostileTail(
      17,
      (index) => ({
        enemyId: `n${index}`,
        role: "body" as const,
        anchorCoord: coord(5 + index, 5),
        remainingCostMilli: 1_000
      }),
      16,
      () => { neighborTailReads += 1; }
    );
    expect(() => planner()(request({ neighbors }))).toThrow(/neighbor|16|budget|limit|maximum/i);
    expect(neighborTailReads).toBe(0);
  });

  it("rejects safe-integer scoring overflow instead of rounding", () => {
    expect(() => planner()(request({
      candidates: [{ coord: coord(5, 4), remainingCostMilli: Number.MAX_SAFE_INTEGER }],
      neighbors: [{
        enemyId: "support",
        role: "support",
        anchorCoord: coord(5, 4),
        remainingCostMilli: 0
      }],
      self: { enemyId: "self", cohortId: "alpha", role: "vanguard" },
      steering: steering({ cohesionWeight: 0, separationWeight: 0, roleWeight: 1_000 })
    }))).toThrow(/score|overflow|safe integer/i);
  });
});
