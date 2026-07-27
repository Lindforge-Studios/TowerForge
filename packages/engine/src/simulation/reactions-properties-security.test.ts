import { describe, expect, it } from "vitest";
import { normalizeReactionsProfileV1 } from "../content/reaction-mechanics.js";
import {
  planReactions,
  type ActiveReactionsMechanics,
  type ReactionPlannerInput
} from "./reactions.js";
import { createGridTopology } from "./topology.js";
import type { GridDefinition } from "./types.js";

const DAMAGE_TYPES = new Set(["physical", "fire", "ice", "lightning"]);

function effect(amount: number, target: Record<string, unknown> = { kind: "radius", radius: 4, maxTargets: 4 }) {
  return {
    kind: "damage",
    amount: { kind: "flat", value: amount },
    damageType: "physical",
    target
  };
}

function definition(label: string, effects: Record<string, unknown>, requirements?: unknown[]) {
  return {
    label,
    trigger: { damageTypes: ["ice"] },
    ...(requirements === undefined ? {} : { requirements }),
    effects
  };
}

function normalized(reactions: Record<string, unknown>, exposures: Record<string, unknown> = {}): ActiveReactionsMechanics {
  return normalizeReactionsProfileV1({
    exposures: {
      definitions: exposures,
      applications: { damageTypes: {} }
    },
    reactions
  }, DAMAGE_TYPES);
}

function plannerInput(
  profile: ActiveReactionsMechanics,
  candidates: ReactionPlannerInput["candidates"],
  overrides: Partial<ReactionPlannerInput["primary"]> = {}
): ReactionPlannerInput {
  return {
    profile,
    primary: {
      rootEnemyId: "enemy_origin",
      rootEnemyTypeId: "grunt",
      originCoord: { q: 2, r: 2 },
      damageType: "ice",
      afterModifiers: 10,
      resolvedFinalAmount: 10,
      depth: 0,
      sourceKind: "ability",
      tags: [],
      allowReactions: false,
      aliveAfterPrimary: true,
      exposures: {},
      statuses: {},
      terrainTags: ["path"],
      ...overrides
    },
    candidates,
    budget: { secondaryPacketsRemaining: 256, liveExposuresRemaining: 16_384 }
  };
}

function entriesInOrder<T>(entries: Array<readonly [string, T]>, offset: number): Record<string, T> {
  const ordered = entries.map((_entry, index) => entries[(index + offset) % entries.length]!);
  return Object.fromEntries(ordered);
}

describe("R1.5 reaction ordering properties", () => {
  it("is byte-stable under reaction, effect, and candidate insertion permutations", () => {
    const reactionEntries = [
      ["zeta", definition("Zeta", entriesInOrder([["z", effect(6)], ["a", effect(5)]], 0))],
      ["alpha", definition("Alpha", entriesInOrder([["z", effect(2)], ["a", effect(1)]], 0))],
      ["middle", definition("Middle", entriesInOrder([["z", effect(4)], ["a", effect(3)]], 0))]
    ] as Array<readonly [string, unknown]>;
    const candidates = [
      { enemyId: "enemy_z", enemyTypeId: "grunt", coord: { q: 3, r: 2 }, topologyDistance: 1, alive: true, terrainTags: [] },
      { enemyId: "enemy_b", enemyTypeId: "grunt", coord: { q: 4, r: 2 }, topologyDistance: 2, alive: true, terrainTags: [] },
      { enemyId: "enemy_a", enemyTypeId: "grunt", coord: { q: 2, r: 4 }, topologyDistance: 2, alive: true, terrainTags: [] },
      { enemyId: "enemy_origin", enemyTypeId: "grunt", coord: { q: 2, r: 2 }, topologyDistance: 0, alive: true, terrainTags: [] }
    ] as const;
    let baseline: string | undefined;

    for (let reactionOffset = 0; reactionOffset < reactionEntries.length; reactionOffset += 1) {
      for (let effectOffset = 0; effectOffset < 2; effectOffset += 1) {
        const permutedEntries = reactionEntries.map(([id, raw]) => {
          const value = raw as { label: string; trigger: unknown; effects: Record<string, unknown> };
          return [id, { ...value, effects: entriesInOrder(Object.entries(value.effects), effectOffset) }] as const;
        });
        const profile = normalized(entriesInOrder(permutedEntries, reactionOffset));
        for (let candidateOffset = 0; candidateOffset < candidates.length; candidateOffset += 1) {
          const orderedCandidates = candidates.map((_candidate, index) => candidates[(index + candidateOffset) % candidates.length]!);
          const input = plannerInput(profile, orderedCandidates);
          const before = structuredClone(input);
          const output = JSON.stringify(planReactions(input));
          baseline ??= output;
          expect(output).toBe(baseline);
          expect(input).toEqual(before);
        }
      }
    }
  });

  it("always reserves a consumable for the binary-first matching reaction", () => {
    const exposure = { ember: { label: "Ember", duration: 5, maxStacks: 2 } };
    const entries = [
      ["zeta", definition("Zeta", { hit: effect(9, { kind: "primary" }) }, [
        { kind: "exposure", exposureId: "ember", consume: "one" }
      ])],
      ["alpha", definition("Alpha", { hit: effect(1, { kind: "primary" }) }, [
        { kind: "exposure", exposureId: "ember", consume: "one" }
      ])]
    ] as Array<readonly [string, unknown]>;

    for (const order of [entries, [...entries].reverse()]) {
      const result = planReactions(plannerInput(normalized(Object.fromEntries(order), exposure), [], {
        exposures: { ember: { stacks: 1, remaining: 5 } }
      }));
      expect(result.triggers.map((trigger) => trigger.reactionId)).toEqual(["alpha"]);
      expect(result.consumptions).toEqual([expect.objectContaining({ reactionId: "alpha", exposureId: "ember" })]);
    }
  });

  it.each([
    ["hex", { kind: "hex", layout: "odd-r" } as const],
    ["square", { kind: "square", adjacency: "cardinal" } as const]
  ])("matches canonical %s radius membership, uniqueness, and distance/id sorting", (_label, grid: GridDefinition) => {
    const topology = createGridTopology(grid);
    const origin = { q: 2, r: 2 };
    const coords = [
      { id: "enemy_d", coord: { q: 4, r: 2 } },
      { id: "enemy_c", coord: { q: 3, r: 3 } },
      { id: "enemy_b", coord: { q: 3, r: 2 } },
      { id: "enemy_a", coord: { q: 2, r: 4 } }
    ];
    const candidates = coords.map((candidate) => ({
      enemyId: candidate.id,
      enemyTypeId: "grunt",
      coord: candidate.coord,
      topologyDistance: topology.distance(origin, candidate.coord),
      alive: true,
      terrainTags: []
    }));
    candidates.push({
      enemyId: "enemy_origin", enemyTypeId: "grunt", coord: origin,
      topologyDistance: 0, alive: true, terrainTags: []
    });
    const profile = normalized({
      radius: definition("Radius", {
        hit: effect(1, { kind: "radius", radius: 2, maxTargets: 3 })
      })
    });
    const expected = candidates
      .filter((candidate) => candidate.enemyId !== "enemy_origin" && candidate.topologyDistance <= 2)
      .sort((left, right) => left.topologyDistance - right.topologyDistance || (left.enemyId < right.enemyId ? -1 : 1))
      .slice(0, 3)
      .map((candidate) => candidate.enemyId);
    const result = planReactions(plannerInput(profile, [...candidates].reverse()));

    expect(result.secondaryPlans.map((plan) => plan.targetEnemyId)).toEqual(expected);
    expect(new Set(result.secondaryPlans.map((plan) => plan.targetEnemyId)).size).toBe(result.secondaryPlans.length);
    expect(result.secondaryPlans.every((plan) => plan.targetEnemyId !== "enemy_origin")).toBe(true);
  });

  it("does not retain mutable state between repeated planning calls", () => {
    const profile = normalized({
      simple: definition("Simple", { hit: effect(1, { kind: "primary" }) })
    });
    const first = planReactions(plannerInput(profile, []));
    const second = planReactions(plannerInput(profile, [], { afterModifiers: 20 }));

    expect(first).not.toBe(second);
    expect(first.secondaryPlans[0]?.amount).toBe(1);
    expect(second.secondaryPlans[0]?.amount).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.secondaryPlans)).toBe(true);
  });
});

describe("R1.5 reaction hostile-input safety", () => {
  it("rejects accessors without invoking them or leaking their thrown payload", () => {
    let getterCalls = 0;
    const reactions = Object.defineProperty({}, "hostile", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_REACTION_ACCESSOR_PAYLOAD");
      }
    });
    let caught: unknown;
    try {
      normalized(reactions);
    } catch (error) {
      caught = error;
    }

    expect(getterCalls).toBe(0);
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain("SECRET_REACTION_ACCESSOR_PAYLOAD");
  });

  it.each([
    ["exotic prototype", () => Object.assign(Object.create({ inherited: true }), { reactions: {} })],
    ["symbol field", () => {
      const value = { reactions: {} } as Record<PropertyKey, unknown>;
      value[Symbol("hidden")] = true;
      return value;
    }],
    ["sparse application array", () => ({
      exposures: {
        definitions: { ember: { label: "Ember", duration: 1, maxStacks: 1 } },
        applications: { damageTypes: { physical: new Array(1) } }
      },
      reactions: {}
    })],
    ["non-finite damage", () => ({
      reactions: {
        invalid: definition("Invalid", {
          hit: { ...effect(1), amount: { kind: "flat", value: Number.POSITIVE_INFINITY } }
        })
      }
    })],
    ["cyclic profile", () => {
      const value: Record<string, unknown> = { reactions: {} };
      value.exposures = value;
      return value;
    }]
  ] as const)("rejects %s as non-JSON or unsafe structure", (_label, makeValue) => {
    expect(() => normalizeReactionsProfileV1(makeValue(), DAMAGE_TYPES)).toThrow();
  });

  it.each([
    ["a symbol field", (values: unknown[]) => { (values as unknown as Record<PropertyKey, unknown>)[Symbol("hidden")] = true; }],
    ["a non-index own field", (values: unknown[]) => { (values as unknown as Record<string, unknown>).extra = true; }]
  ] as const)("[verifier] rejects %s on authored arrays", (_label, mutate) => {
    const damageTypes: unknown[] = ["ice"];
    mutate(damageTypes);
    expect(() => normalizeReactionsProfileV1({
      reactions: {
        hostile_array: {
          label: "Hostile array",
          trigger: { damageTypes },
          effects: { hit: effect(1) }
        }
      }
    }, DAMAGE_TYPES)).toThrow(/array|symbol|field|json|unsupported/i);
  });

  it("[verifier] enforces the damage-type application binding budget even for empty bindings", () => {
    const damageTypes = new Set(Array.from({ length: 257 }, (_, index) => `type_${index}`));
    const bindings = Object.fromEntries([...damageTypes].map((damageTypeId) => [damageTypeId, []]));

    expect(() => normalizeReactionsProfileV1({
      exposures: {
        definitions: {},
        applications: { damageTypes: bindings }
      },
      reactions: {}
    }, damageTypes)).toThrow(/binding|budget|256|limit/i);
  });

  it.each([
    ["multibyte terrain tag", () => ({
      reactions: {
        long_tag: definition("Long tag", { hit: effect(1) }, [
          { kind: "terrain_tag", tag: "🔥".repeat(33) }
        ])
      }
    })],
    ["multibyte exposure id", () => ({
      exposures: {
        definitions: { ["🔥".repeat(33)]: { label: "Long id", duration: 1, maxStacks: 1 } }
      },
      reactions: {}
    })],
    ["reaction label over 128 characters", () => ({
      reactions: {
        long_label: definition("x".repeat(129), { hit: effect(1) })
      }
    })]
  ] as const)("enforces the authored UTF-8/label budget for %s", (_label, makeValue) => {
    expect(() => normalizeReactionsProfileV1(makeValue(), DAMAGE_TYPES)).toThrow(/byte|128|long|range|limit/i);
  });

  it.each([
    ["reaction id", () => ({
      reactions: {
        ["r".repeat(129)]: definition("Long reaction id", { hit: effect(1) })
      }
    })],
    ["effect id", () => ({
      reactions: {
        valid_reaction: definition("Long effect id", { ["e".repeat(129)]: effect(1) })
      }
    })]
  ] as const)("[verifier] enforces the 128-byte authored budget for %s", (_label, makeValue) => {
    expect(() => normalizeReactionsProfileV1(makeValue(), DAMAGE_TYPES)).toThrow(/byte|128|long|limit/i);
  });

  it("handles __proto__ as detached data without mutating Object.prototype", () => {
    const reactions = {} as Record<string, unknown>;
    Object.defineProperty(reactions, "__proto__", {
      enumerable: true,
      value: definition("Prototype-safe", { hit: effect(1, { kind: "primary" }) })
    });
    const profile = normalized(reactions);

    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(Object.prototype.hasOwnProperty.call(profile.reactions, "__proto__")).toBe(true);
    expect(planReactions(plannerInput(profile, [])).triggers).toContainEqual(
      expect.objectContaining({ reactionId: "__proto__" })
    );
  });
});
