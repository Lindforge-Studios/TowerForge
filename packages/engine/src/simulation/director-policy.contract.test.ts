import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import type { WaveDefinition } from "./types.js";

type MetricKind =
  | "damage_share"
  | "coverage_ratio"
  | "movement_layer_share"
  | "logistics_brownout_ratio";

interface DirectorConditionContract {
  readonly metric: MetricKind;
  readonly key?: string;
  readonly operator: "gte" | "lte";
  readonly threshold: number;
}

interface DirectorCounterContract {
  readonly label: string;
  readonly priority: number;
  readonly conditions: readonly DirectorConditionContract[];
  readonly groups: WaveDefinition["groups"];
  readonly threatCost: number;
}

interface DirectorProfileContract {
  readonly counterPool: Readonly<Record<string, DirectorCounterContract>>;
  readonly threatBudget: { readonly base: number; readonly perWave: number };
  readonly fairness: {
    readonly minimumWaveIndex: number;
    readonly maxConsecutiveUses: number;
    readonly maxAddedGroups: number;
    readonly maxAddedEnemies: number;
  };
}

interface DirectorPolicyRequestContract {
  readonly nextWaveIndex: number;
  readonly nextWave: WaveDefinition;
  readonly analysis: {
    readonly damageShares: Readonly<Record<string, number>>;
    readonly coverageRatios: Readonly<Record<string, number>>;
    readonly movementLayerShares: Readonly<Record<string, number>>;
    readonly logisticsBrownoutRatio: number;
  };
  readonly recentCounterIds: readonly string[];
}

interface DirectorWavePlanContract {
  readonly schemaVersion: 1;
  readonly nextWaveIndex: number;
  readonly authoredWaveId: string;
  readonly decision: {
    readonly counterId: string;
    readonly threatCost: number;
    readonly reason: DirectorConditionContract & { readonly observed: number };
    readonly addedGroups: WaveDefinition["groups"];
  };
  readonly wave: WaveDefinition;
}

function planner(): (
  profile: DirectorProfileContract,
  request: DirectorPolicyRequestContract
) => DirectorWavePlanContract | undefined {
  const plan = (Engine as unknown as {
    planDirectorWaveV1?: (
      profile: DirectorProfileContract,
      request: DirectorPolicyRequestContract
    ) => DirectorWavePlanContract | undefined;
  }).planDirectorWaveV1;
  expect(plan, "R7.1 must export the pure Director policy").toBeTypeOf("function");
  return plan!;
}

function counter(
  id: string,
  options: {
    readonly priority?: number;
    readonly threshold?: number;
    readonly threatCost?: number;
    readonly count?: number;
    readonly groups?: number;
    readonly metric?: MetricKind;
    readonly key?: string;
  } = {}
): DirectorCounterContract {
  const groupCount = options.groups ?? 1;
  const metric = options.metric ?? "damage_share";
  return {
    label: id,
    priority: options.priority ?? 10,
    conditions: [{
      metric,
      ...(metric === "logistics_brownout_ratio" ? {} : { key: options.key ?? "fire" }),
      operator: "gte",
      threshold: options.threshold ?? 0.6
    }],
    groups: Array.from({ length: groupCount }, (_, index) => ({
      enemyId: `${id}_enemy_${index}`,
      count: options.count ?? 2,
      spawnInterval: 0.5,
      startDelay: index,
      routeId: "main"
    })),
    threatCost: options.threatCost ?? 5
  };
}

function profile(
  counterPool: Readonly<Record<string, DirectorCounterContract>>,
  overrides: Partial<DirectorProfileContract> = {}
): DirectorProfileContract {
  return {
    counterPool,
    threatBudget: { base: 10, perWave: 5 },
    fairness: {
      minimumWaveIndex: 1,
      maxConsecutiveUses: 2,
      maxAddedGroups: 2,
      maxAddedEnemies: 8
    },
    ...overrides
  };
}

function request(overrides: Partial<DirectorPolicyRequestContract> = {}): DirectorPolicyRequestContract {
  return {
    nextWaveIndex: 2,
    nextWave: {
      id: "authored_wave",
      label: "Authored wave",
      groups: [{ enemyId: "grunt", count: 3, spawnInterval: 1, startDelay: 0, routeId: "main" }]
    },
    analysis: {
      damageShares: { fire: 0.8, ice: 0.2 },
      coverageRatios: { ground: 0.4, flying: 0.1 },
      movementLayerShares: { ground: 0.9, flying: 0.1 },
      logisticsBrownoutRatio: 0.5
    },
    recentCounterIds: [],
    ...overrides
  };
}

function reverseRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).reverse());
}

describe("R7.1 pure deterministic AI Wave Director policy (RED)", () => {
  it("selects from the authored pool independently of object insertion order and never mutates the next wave", () => {
    const pool = {
      zeta: counter("zeta"),
      Alpha: counter("Alpha"),
      alpha: counter("alpha")
    };
    const subject = request();
    const before = structuredClone(subject);
    const forward = planner()(profile(pool), subject);
    const reverse = planner()(profile(reverseRecord(pool)), structuredClone(subject));

    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      schemaVersion: 1,
      nextWaveIndex: 2,
      authoredWaveId: "authored_wave",
      decision: {
        counterId: "Alpha",
        threatCost: 5,
        reason: {
          metric: "damage_share", key: "fire", operator: "gte", threshold: 0.6, observed: 0.8
        }
      }
    });
    expect(forward!.wave.groups).toEqual([
      ...subject.nextWave.groups,
      ...forward!.decision.addedGroups
    ]);
    expect(subject).toEqual(before);
    expect(subject.nextWave.groups).toHaveLength(1);
  });

  it("orders eligible counters by priority, then condition severity, then binary counter id", () => {
    const highPriority = planner()(profile({
      severe: counter("severe", { priority: 10, threshold: 0.2 }),
      priority: counter("priority", { priority: 20, threshold: 0.79 })
    }), request());
    expect(highPriority?.decision.counterId).toBe("priority");

    const highSeverity = planner()(profile({
      mild: counter("mild", { threshold: 0.75 }),
      severe: counter("severe", { threshold: 0.2 })
    }), request());
    expect(highSeverity?.decision.counterId).toBe("severe");

    const binary = planner()(profile({
      zeta: counter("zeta"),
      Alpha: counter("Alpha")
    }), request());
    expect(binary?.decision.counterId).toBe("Alpha");
  });

  it("filters candidates before ranking when threat, group, or enemy-count budgets are exceeded", () => {
    const strict = profile({
      too_expensive: counter("too_expensive", { priority: 100, threatCost: 6 }),
      too_many_groups: counter("too_many_groups", { priority: 90, threatCost: 5, groups: 2 }),
      too_many_enemies: counter("too_many_enemies", { priority: 80, threatCost: 5, count: 4 }),
      allowed: counter("allowed", { priority: 1, threatCost: 5, count: 3 })
    }, {
      threatBudget: { base: 5, perWave: 0 },
      fairness: {
        minimumWaveIndex: 1,
        maxConsecutiveUses: 2,
        maxAddedGroups: 1,
        maxAddedEnemies: 3
      }
    });
    const result = planner()(strict, request());
    expect(result?.decision.counterId).toBe("allowed");
    expect(result?.decision.threatCost).toBeLessThanOrEqual(5);
    expect(result?.decision.addedGroups).toHaveLength(1);
    expect(result?.decision.addedGroups.reduce((sum, group) => sum + group.count, 0)).toBeLessThanOrEqual(3);

    expect(planner()(profile({ only: counter("only", { threatCost: 6 }) }, {
      threatBudget: { base: 5, perWave: 0 }
    }), request())).toBeUndefined();
  });

  it("enforces the minimum wave and consecutive-use fairness caps with a deterministic fallback", () => {
    const subject = profile({
      repeat: counter("repeat", { priority: 100 }),
      fallback: counter("fallback", { priority: 1 })
    });
    expect(planner()(subject, request({ nextWaveIndex: 0 }))).toBeUndefined();
    expect(planner()(subject, request({ recentCounterIds: ["repeat", "repeat"] }))?.decision.counterId)
      .toBe("fallback");
    expect(planner()(profile({ repeat: counter("repeat") }), request({
      recentCounterIds: ["repeat", "repeat"]
    }))).toBeUndefined();
  });

  it("reads every closed analysis axis without deriving or inventing a counter outside the authored pool", () => {
    const axes: readonly [MetricKind, string | undefined][] = [
      ["damage_share", "fire"],
      ["coverage_ratio", "ground"],
      ["movement_layer_share", "flying"],
      ["logistics_brownout_ratio", undefined]
    ];
    for (const [metric, key] of axes) {
      const id = `counter_${metric}`;
      const selected = planner()(profile({
        [id]: counter(id, { metric, key, threshold: 0.05 })
      }), request());
      expect(selected?.decision.counterId).toBe(id);
      expect(selected?.decision.reason.metric).toBe(metric);
    }

    expect(planner()(profile({}), request())).toBeUndefined();
  });
});
