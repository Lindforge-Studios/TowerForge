import { describe, expect, it, vi } from "vitest";
import {
  DamageResolver,
  type DamagePacket,
  type DamageResolutionContext
} from "./damage.js";
import type { ModifierSpec } from "./modifiers.js";

interface ActiveMarkDamageContextFixture {
  readonly markId: string;
  readonly stacks: number;
  readonly multiplier: number;
  readonly consumePolicy: "retain" | "consume_one" | "consume_all";
  readonly damageTypes?: readonly string[];
}

type DamageResolutionContextV3Fixture = DamageResolutionContext & {
  readonly marks?: readonly ActiveMarkDamageContextFixture[];
};

function packet(overrides: Partial<DamagePacket> = {}): DamagePacket {
  return {
    amount: 100,
    source: { kind: "tower", towerId: "tower-1", towerTypeId: "cannon" },
    target: { kind: "enemy", enemyId: "enemy-1", enemyTypeId: "armored" },
    ...overrides
  };
}

function resolve(packetValue: DamagePacket, context: DamageResolutionContextV3Fixture = {}) {
  return DamageResolver.resolve(packetValue, context as DamageResolutionContext) as unknown as Record<string, unknown>;
}

describe("DamageResolver mark and vulnerability stage", () => {
  it("applies matching marks in binary id order after modifiers and before armor/resistance/legacy armor", () => {
    const modifiers: readonly ModifierSpec[] = [{
      id: "upgrade-flat",
      target: "damage",
      stage: "tower_upgrade",
      operation: "flat",
      value: 20
    }];

    const result = resolve(packet({ damageType: "fire", modifiers }), {
      marks: [
        {
          markId: "vulnerable",
          stacks: 2,
          multiplier: 1.5,
          consumePolicy: "retain",
          damageTypes: ["physical", "fire"]
        },
        {
          markId: "ice_only",
          stacks: 4,
          multiplier: 2,
          consumePolicy: "consume_all",
          damageTypes: ["ice"]
        },
        {
          markId: "brittle",
          stacks: 1,
          multiplier: 1.25,
          consumePolicy: "consume_one"
        }
      ],
      armorMatrix: {
        armorTypeId: "plated",
        multipliers: { fire: 0.5 }
      },
      resistances: { fire: 0.2 },
      legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 10 }
    });

    expect(result).toEqual({
      requestedAmount: 100,
      modifierTrace: [{
        id: "upgrade-flat",
        stage: "tower_upgrade",
        operation: "flat",
        operand: 20,
        before: 100,
        after: 120
      }],
      afterModifiers: 120,
      markTrace: [
        {
          markId: "brittle",
          stacks: 1,
          multiplier: 1.25,
          effectiveMultiplier: 1.25,
          before: 120,
          after: 150,
          consumePolicy: "consume_one"
        },
        {
          markId: "vulnerable",
          stacks: 2,
          multiplier: 1.5,
          effectiveMultiplier: 2,
          before: 150,
          after: 300,
          consumePolicy: "retain"
        }
      ],
      afterMarks: 300,
      armorTypeId: "plated",
      armorMultiplier: 0.5,
      afterArmor: 150,
      resistanceMultiplier: 0.2,
      afterResistance: 30,
      finalAmount: 10,
      blockedByArmor: false
    });
  });

  it("uses physical for filtering by default and omits mark fields when no mark matches", () => {
    const physical = resolve(packet(), {
      marks: [{
        markId: "impact",
        stacks: 2,
        multiplier: 1.5,
        consumePolicy: "consume_all",
        damageTypes: ["physical"]
      }]
    });
    expect(physical).toMatchObject({
      afterModifiers: 100,
      afterMarks: 200,
      afterResistance: 200,
      finalAmount: 200
    });

    const unmatched = resolve(packet({ damageType: "ice" }), {
      marks: [{
        markId: "fire_only",
        stacks: 2,
        multiplier: 1.5,
        consumePolicy: "retain",
        damageTypes: ["fire"]
      }]
    });
    expect(unmatched).toEqual({
      requestedAmount: 100,
      modifierTrace: [],
      afterModifiers: 100,
      resistanceMultiplier: 1,
      afterResistance: 100,
      finalAmount: 100,
      blockedByArmor: false
    });
    expect(unmatched).not.toHaveProperty("markTrace");
    expect(unmatched).not.toHaveProperty("afterMarks");
  });

  it("normalizes mark insertion order without mutating frozen packets or contexts", () => {
    const frozenPacket = Object.freeze(packet({ damageType: "fire", modifiers: Object.freeze([]) }));
    const alpha = Object.freeze({
      markId: "alpha",
      stacks: 3,
      multiplier: 1.1,
      consumePolicy: "retain" as const
    });
    const omega = Object.freeze({
      markId: "omega",
      stacks: 2,
      multiplier: 1.3,
      consumePolicy: "consume_one" as const,
      damageTypes: Object.freeze(["fire"])
    });
    const firstContext = Object.freeze({ marks: Object.freeze([omega, alpha]) });
    const secondContext = Object.freeze({ marks: Object.freeze([alpha, omega]) });
    const before = [
      JSON.stringify(frozenPacket),
      JSON.stringify(firstContext),
      JSON.stringify(secondContext)
    ];

    const first = resolve(frozenPacket, firstContext);
    const second = resolve(frozenPacket, secondContext);

    expect(first).toEqual(second);
    expect((first.markTrace as readonly { markId: string }[]).map((step) => step.markId)).toEqual(["alpha", "omega"]);
    expect([
      JSON.stringify(frozenPacket),
      JSON.stringify(firstContext),
      JSON.stringify(secondContext)
    ]).toEqual(before);
  });

  it.each([
    ["empty id", [{ markId: "", stacks: 1, multiplier: 2, consumePolicy: "retain" }]],
    ["fractional stacks", [{ markId: "a", stacks: 1.5, multiplier: 2, consumePolicy: "retain" }]],
    ["zero stacks", [{ markId: "a", stacks: 0, multiplier: 2, consumePolicy: "retain" }]],
    ["too many stacks", [{ markId: "a", stacks: 257, multiplier: 2, consumePolicy: "retain" }]],
    ["neutral multiplier", [{ markId: "a", stacks: 1, multiplier: 1, consumePolicy: "retain" }]],
    ["infinite multiplier", [{ markId: "a", stacks: 1, multiplier: Number.POSITIVE_INFINITY, consumePolicy: "retain" }]],
    ["too large multiplier", [{ markId: "a", stacks: 1, multiplier: 1_000_001, consumePolicy: "retain" }]],
    ["unknown policy", [{ markId: "a", stacks: 1, multiplier: 2, consumePolicy: "future" }]],
    ["empty filter id", [{ markId: "a", stacks: 1, multiplier: 2, consumePolicy: "retain", damageTypes: [""] }]],
    ["empty filter", [{ markId: "a", stacks: 1, multiplier: 2, consumePolicy: "retain", damageTypes: [] }]],
    ["duplicate filter", [{ markId: "a", stacks: 1, multiplier: 2, consumePolicy: "retain", damageTypes: ["fire", "fire"] }]],
    ["too many filters", [{
      markId: "a",
      stacks: 1,
      multiplier: 2,
      consumePolicy: "retain",
      damageTypes: Array.from({ length: 257 }, (_, index) => `damage_${index}`)
    }]]
  ] as const)("rejects malformed active mark context: %s", (_label, marks) => {
    expect(() => resolve(packet(), {
      marks: marks as unknown as readonly ActiveMarkDamageContextFixture[]
    })).toThrow(/mark|stack|multiplier|policy|damage|filter|limit|256|1000000/i);
  });

  it("rejects duplicate mark ids and numeric overflow at the mark stage", () => {
    const duplicate = {
      markId: "same",
      stacks: 1,
      multiplier: 2,
      consumePolicy: "retain" as const
    };
    expect(() => resolve(packet(), { marks: [duplicate, { ...duplicate }] })).toThrow(/duplicate|mark/i);
    expect(() => resolve(packet({ amount: Number.MAX_VALUE }), {
      marks: [{ markId: "overflow", stacks: 2, multiplier: 2, consumePolicy: "retain" }]
    })).toThrow(/finite|overflow|mark/i);
  });

  it("fails closed on oversized and accessor-backed mark data without invoking tail getters", () => {
    const tailGetter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_MARK_TAIL");
    });
    const marks = Array.from({ length: 256 }, (_, index) => ({
      markId: `mark_${index}`,
      stacks: 1,
      multiplier: 1.1,
      consumePolicy: "retain" as const
    }));
    Object.defineProperty(marks, 256, { enumerable: true, get: tailGetter });
    Object.defineProperty(marks, "length", { value: 257 });

    let caught: unknown;
    try {
      resolve(packet(), { marks });
    } catch (error) {
      caught = error;
    }
    expect(tailGetter).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/mark|limit|256|too many|exceed/i);
    expect(String(caught)).not.toContain("SYNTHETIC_SECRET");

    const definitionGetter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_MARK_DEFINITION");
    });
    const accessorMark: Record<string, unknown> = {
      markId: "unsafe",
      stacks: 1,
      consumePolicy: "retain"
    };
    Object.defineProperty(accessorMark, "multiplier", { enumerable: true, get: definitionGetter });
    expect(() => resolve(packet(), {
      marks: [accessorMark as unknown as ActiveMarkDamageContextFixture]
    })).toThrow(/mark|own data|data propert|inspect|unsafe/i);
    expect(definitionGetter).not.toHaveBeenCalled();
  });
});
