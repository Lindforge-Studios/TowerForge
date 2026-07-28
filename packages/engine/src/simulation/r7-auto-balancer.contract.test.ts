import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";

type AutoBalanceRequest = {
  readonly baselineScore: number;
  readonly candidates: readonly {
    readonly id: string;
    readonly patch: Readonly<Record<string, unknown>>;
  }[];
  readonly seeds: readonly string[];
  readonly strategyIds: readonly string[];
  readonly evaluate: (run: {
    readonly candidateId: string;
    readonly seed: string;
    readonly strategyId: string;
  }) => number;
  readonly isCancelled?: () => boolean;
};

type AutoBalanceResult = {
  readonly schemaVersion: 1;
  readonly status: "completed" | "cancelled";
  readonly evaluatedRuns: number;
  readonly proposals: readonly {
    readonly id: string;
    readonly rank: number;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly evidence: {
      readonly runCount: number;
      readonly baselineScore: number;
      readonly candidateScore: number;
      readonly improvement: number;
      readonly seeds: readonly string[];
      readonly strategyIds: readonly string[];
    };
  }[];
};

function runAutoBalancerBatch(request: AutoBalanceRequest): AutoBalanceResult {
  const run = (Engine as unknown as {
    runAutoBalancerBatch?: (input: AutoBalanceRequest) => AutoBalanceResult;
  }).runAutoBalancerBatch;
  expect(run, "R7 auto-balancer must export a pure evidence-only batch contract")
    .toBeTypeOf("function");
  return run!(request);
}

function request(overrides: Partial<AutoBalanceRequest> = {}): AutoBalanceRequest {
  return {
    baselineScore: 100,
    candidates: [
      { id: "tower_damage_minus_10", patch: { towers: { cannon: { damage: 90 } } } },
      { id: "tower_damage_minus_20", patch: { towers: { cannon: { damage: 80 } } } }
    ],
    seeds: ["seed-b", "seed-a"],
    strategyIds: ["rush", "economy"],
    evaluate: ({ candidateId, seed, strategyId }) => {
      const candidate = candidateId.endsWith("20") ? 70 : 80;
      const seedAdjustment = seed === "seed-a" ? -2 : 2;
      const strategyAdjustment = strategyId === "economy" ? -1 : 1;
      return candidate + seedAdjustment + strategyAdjustment;
    },
    ...overrides
  };
}

describe("R7 evidence-only auto-balancer batch", () => {
  it("ranks detached patch proposals by complete seed/strategy evidence without applying them", () => {
    const input = request();
    const before = JSON.stringify({
      baselineScore: input.baselineScore,
      candidates: input.candidates,
      seeds: input.seeds,
      strategyIds: input.strategyIds
    });

    const result = runAutoBalancerBatch(input);

    expect(result).toEqual({
      schemaVersion: 1,
      status: "completed",
      evaluatedRuns: 8,
      proposals: [
        {
          id: "tower_damage_minus_20",
          rank: 1,
          patch: { towers: { cannon: { damage: 80 } } },
          evidence: {
            runCount: 4,
            baselineScore: 100,
            candidateScore: 70,
            improvement: 30,
            seeds: ["seed-a", "seed-b"],
            strategyIds: ["economy", "rush"]
          }
        },
        {
          id: "tower_damage_minus_10",
          rank: 2,
          patch: { towers: { cannon: { damage: 90 } } },
          evidence: {
            runCount: 4,
            baselineScore: 100,
            candidateScore: 80,
            improvement: 20,
            seeds: ["seed-a", "seed-b"],
            strategyIds: ["economy", "rush"]
          }
        }
      ]
    });
    expect(JSON.stringify({
      baselineScore: input.baselineScore,
      candidates: input.candidates,
      seeds: input.seeds,
      strategyIds: input.strategyIds
    })).toBe(before);
    expect(Object.prototype.hasOwnProperty.call(result, "written")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "applied")).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposals)).toBe(true);
  });

  it("cancels between runs and withholds rankings based on incomplete evidence", () => {
    let calls = 0;
    const result = runAutoBalancerBatch(request({
      evaluate: () => {
        calls += 1;
        return 75;
      },
      isCancelled: () => calls >= 2
    }));

    expect(result).toEqual({
      schemaVersion: 1,
      status: "cancelled",
      evaluatedRuns: 2,
      proposals: []
    });
    expect(calls).toBe(2);
  });

  it("rejects ambiguous, duplicate, oversized, or excessive public batch dimensions before evaluation", () => {
    const evaluate = () => { throw new Error("must not evaluate invalid input"); };
    expect(() => runAutoBalancerBatch(request({
      candidates: [
        { id: "duplicate", patch: { towers: {} } },
        { id: "duplicate", patch: { towers: {} } }
      ], evaluate
    }))).toThrow(/duplicate.*candidate/i);
    expect(() => runAutoBalancerBatch(request({ seeds: ["same", "same"], evaluate })))
      .toThrow(/seeds.*unique|duplicate.*seed/i);
    expect(() => runAutoBalancerBatch(request({ candidates: [{ id: "bad\0id", patch: { towers: {} } }], evaluate })))
      .toThrow(/candidate.*id/i);
    const symbol = Symbol("hidden");
    const symbolPatch = { towers: {} } as Record<PropertyKey, unknown>;
    symbolPatch[symbol] = { hidden: true };
    expect(() => runAutoBalancerBatch(request({
      candidates: [{ id: "symbol_patch", patch: symbolPatch as Readonly<Record<string, unknown>> }], evaluate
    }))).toThrow(/symbol/i);
    const symbolCandidate = { id: "symbol_candidate", patch: { towers: {} } } as Record<PropertyKey, unknown>;
    symbolCandidate[symbol] = true;
    expect(() => runAutoBalancerBatch(request({
      candidates: [symbolCandidate as unknown as AutoBalanceRequest["candidates"][number]], evaluate
    }))).toThrow(/symbol/i);
    expect(() => runAutoBalancerBatch(request({ seeds: ["界".repeat(100)], evaluate })))
      .toThrow(/seed.*bound|seed.*byte/i);
    expect(() => runAutoBalancerBatch(request({
      candidates: Array.from({ length: 17 }, (_, index) => ({ id: `c_${index}`, patch: { value: index } })),
      seeds: Array.from({ length: 16 }, (_, index) => `s_${index}`),
      strategyIds: Array.from({ length: 16 }, (_, index) => `p_${index}`),
      evaluate
    }))).toThrow(/matrix|runs|4096/i);
  });
});
