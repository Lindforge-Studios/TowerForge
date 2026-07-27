import { describe, expect, it } from "vitest";

type ExposureState = Readonly<Record<string, { stacks: number; remaining: number }>>;

interface PlannerCandidate {
  enemyId: string;
  enemyTypeId: string;
  coord: { q: number; r: number };
  topologyDistance: number;
  alive: boolean;
  terrainTags: readonly string[];
}

interface PlannerInput {
  profile: Readonly<Record<string, unknown>>;
  primary: {
    rootEnemyId: string;
    rootEnemyTypeId: string;
    originCoord: { q: number; r: number };
    damageType: string;
    afterModifiers: number;
    resolvedFinalAmount: number;
    depth: number;
    sourceKind: "tower" | "ability" | "tower_script" | "status" | "enemy" | "leak" | "reaction";
    tags: readonly string[];
    allowReactions: boolean;
    aliveAfterPrimary: boolean;
    exposures: ExposureState;
    statuses: Readonly<Record<string, unknown>>;
    terrainTags: readonly string[];
  };
  candidates: readonly PlannerCandidate[];
  budget: {
    secondaryPacketsRemaining: number;
    liveExposuresRemaining: number;
  };
}

interface PlannerOutput {
  consumptions: readonly Record<string, unknown>[];
  exposureApplications: readonly Record<string, unknown>[];
  triggers: readonly Record<string, unknown>[];
  secondaryPlans: readonly Record<string, unknown>[];
  diagnostics: readonly Record<string, unknown>[];
}

const reactionModulePath = "./reactions.js";

async function loadPlanner(): Promise<(input: PlannerInput) => PlannerOutput> {
  const module = await import(reactionModulePath) as unknown as {
    planReactions?: (input: PlannerInput) => PlannerOutput;
  };
  expect(module.planReactions, "simulation/reactions.ts must expose the internal pure planner")
    .toBeTypeOf("function");
  return module.planReactions!;
}

function profile(overrides: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    exposures: Object.freeze({
      definitions: Object.freeze({
        fire: Object.freeze({ label: "Fire", duration: 4, maxStacks: 1 }),
        ice: Object.freeze({ label: "Ice", duration: 4, maxStacks: 1 })
      }),
      applications: Object.freeze({
        damageTypes: Object.freeze({
          fire: Object.freeze([Object.freeze({ exposureId: "fire" })]),
          ice: Object.freeze([Object.freeze({ exposureId: "ice" })])
        })
      })
    }),
    reactions: Object.freeze({
      shatter: Object.freeze({
        label: "Shatter",
        trigger: Object.freeze({ damageTypes: Object.freeze(["ice"]) }),
        requirements: Object.freeze([
          Object.freeze({ kind: "exposure", exposureId: "fire", minStacks: 1, consume: "all" })
        ]),
        suppressTriggerExposureApplications: true,
        effects: Object.freeze({
          paired: Object.freeze({
            kind: "damage",
            amount: Object.freeze({ kind: "source_after_modifiers", multiplier: 2 }),
            damageType: "physical",
            target: Object.freeze({ kind: "primary" }),
            allowReactions: false
          })
        })
      })
    }),
    ...overrides
  });
}

function input(overrides: Partial<PlannerInput["primary"]> = {}, customProfile = profile()): PlannerInput {
  return {
    profile: customProfile,
    primary: {
      rootEnemyId: "enemy_1",
      rootEnemyTypeId: "grunt",
      originCoord: { q: 2, r: 1 },
      damageType: "ice",
      afterModifiers: 10,
      resolvedFinalAmount: 10,
      depth: 0,
      sourceKind: "ability",
      tags: [],
      allowReactions: false,
      aliveAfterPrimary: true,
      exposures: { fire: { stacks: 1, remaining: 3 } },
      statuses: {},
      terrainTags: ["path"],
      ...overrides
    },
    candidates: [],
    budget: { secondaryPacketsRemaining: 256, liveExposuresRemaining: 16_384 }
  };
}

describe("R1.5 pure reaction planner", () => {
  it("plans directional Shatter from captured prior state without mutating frozen input", async () => {
    const planReactions = await loadPlanner();
    const candidate = input();
    const before = structuredClone(candidate);
    const result = planReactions(candidate);

    expect(candidate).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toEqual({
      consumptions: [{
        kind: "exposure",
        reactionId: "shatter",
        enemyId: "enemy_1",
        exposureId: "fire",
        stacks: "all"
      }],
      exposureApplications: [],
      triggers: [{
        reactionId: "shatter",
        originEnemyId: "enemy_1",
        originEnemyTypeId: "grunt",
        originCoord: { q: 2, r: 1 },
        triggerDamageType: "ice",
        depth: 0,
        scheduledTargetIds: ["enemy_1"]
      }],
      secondaryPlans: [{
        reactionId: "shatter",
        effectId: "paired",
        targetEnemyId: "enemy_1",
        amount: 20,
        damageType: "physical",
        depth: 1,
        tags: ["reaction"],
        allowReactions: false
      }],
      diagnostics: []
    });
  });

  it("applies current-hit exposure only after planning and suppresses it only when a fired rule requests it", async () => {
    const planReactions = await loadPlanner();

    expect(planReactions(input({ damageType: "fire", exposures: {} }))).toMatchObject({
      consumptions: [],
      triggers: [],
      secondaryPlans: [],
      exposureApplications: [{
        enemyId: "enemy_1",
        exposureId: "fire",
        stacks: 1,
        duration: 4,
        maxStacks: 1,
        cause: "damage"
      }]
    });
    expect(planReactions(input({ aliveAfterPrimary: false }))).toMatchObject({
      exposureApplications: [],
      triggers: [expect.objectContaining({ reactionId: "shatter" })],
      secondaryPlans: []
    });
  });

  it("reserves consumable requirements and effects in binary ids and fan-out targets by distance then binary id", async () => {
    const planReactions = await loadPlanner();
    const competing = profile({
      reactions: {
        zeta: {
          label: "Late",
          trigger: { damageTypes: ["ice"] },
          requirements: [{ kind: "exposure", exposureId: "fire", consume: "all" }],
          effects: {
            z: {
              kind: "damage",
              amount: { kind: "flat", value: 1 },
              damageType: "physical",
              target: { kind: "radius", radius: 4, maxTargets: 3 }
            }
          }
        },
        alpha: {
          label: "First",
          trigger: { damageTypes: ["ice"] },
          requirements: [{ kind: "exposure", exposureId: "fire", consume: "all" }],
          effects: {
            z_effect: {
              kind: "damage",
              amount: { kind: "flat", value: 2 },
              damageType: "physical",
              target: { kind: "radius", radius: 4, maxTargets: 3 }
            },
            a_effect: {
              kind: "damage",
              amount: { kind: "flat", value: 3 },
              damageType: "physical",
              target: { kind: "radius", radius: 4, maxTargets: 3 }
            }
          }
        }
      }
    });
    const candidate = input({}, competing);
    candidate.candidates = [
      { enemyId: "enemy_z", enemyTypeId: "grunt", coord: { q: 3, r: 1 }, topologyDistance: 1, alive: true, terrainTags: [] },
      { enemyId: "enemy_b", enemyTypeId: "grunt", coord: { q: 4, r: 1 }, topologyDistance: 2, alive: true, terrainTags: [] },
      { enemyId: "enemy_a", enemyTypeId: "grunt", coord: { q: 4, r: 0 }, topologyDistance: 2, alive: true, terrainTags: [] },
      { enemyId: "enemy_dead", enemyTypeId: "grunt", coord: { q: 2, r: 2 }, topologyDistance: 1, alive: false, terrainTags: [] },
      { enemyId: "enemy_1", enemyTypeId: "grunt", coord: { q: 2, r: 1 }, topologyDistance: 0, alive: true, terrainTags: [] }
    ];

    const result = planReactions(candidate);
    expect(result.triggers.map((trigger) => trigger.reactionId)).toEqual(["alpha"]);
    expect(result.secondaryPlans.map((plan) => [plan.effectId, plan.targetEnemyId])).toEqual([
      ["a_effect", "enemy_z"],
      ["a_effect", "enemy_a"],
      ["a_effect", "enemy_b"],
      ["z_effect", "enemy_z"],
      ["z_effect", "enemy_a"],
      ["z_effect", "enemy_b"]
    ]);
  });

  it("rejects ineligible roots and admits a stable bounded prefix with one diagnostic per budget kind", async () => {
    const planReactions = await loadPlanner();
    for (const primary of [
      { sourceKind: "status" as const },
      { sourceKind: "enemy" as const },
      { sourceKind: "leak" as const },
      { sourceKind: "reaction" as const, allowReactions: false },
      { tags: ["over_time"] },
      { resolvedFinalAmount: 0 }
    ]) {
      expect(planReactions(input(primary))).toEqual({
        consumptions: [],
        exposureApplications: [],
        triggers: [],
        secondaryPlans: [],
        diagnostics: []
      });
    }

    const chained = input({ sourceKind: "reaction", allowReactions: true, depth: 4 });
    const depthResult = planReactions(chained);
    expect(depthResult.secondaryPlans).toEqual([]);
    expect(depthResult.diagnostics).toEqual([{
      rootEnemyId: "enemy_1",
      rootEnemyTypeId: "grunt",
      budget: "depth",
      limit: 4,
      dropped: 1
    }]);

    const packetLimited = input();
    packetLimited.budget.secondaryPacketsRemaining = 0;
    const packetResult = planReactions(packetLimited);
    expect(packetResult.secondaryPlans).toEqual([]);
    expect(packetResult.triggers).toEqual([
      expect.objectContaining({ reactionId: "shatter", scheduledTargetIds: [] })
    ]);
    expect(packetResult.diagnostics).toEqual([{
      rootEnemyId: "enemy_1",
      rootEnemyTypeId: "grunt",
      budget: "secondary_packets",
      limit: 256,
      dropped: 1
    }]);
  });
});
