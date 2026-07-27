import { describe, expect, it, vi } from "vitest";
import {
  DamageResolver,
  type DamagePacket,
  type DamageResolutionContext
} from "./damage.js";
import type { ModifierSpec } from "./modifiers.js";

interface ArmorMatrixContextFixture {
  armorTypeId: string;
  defaultMultiplier?: number;
  multipliers: Readonly<Record<string, number>>;
}

type DamageResolutionContextV2Fixture = DamageResolutionContext & {
  readonly armorMatrix?: ArmorMatrixContextFixture;
};

function packet(overrides: Partial<DamagePacket> = {}): DamagePacket {
  return {
    amount: 100,
    source: { kind: "tower", towerId: "tower-1", towerTypeId: "cannon" },
    target: { kind: "enemy", enemyId: "enemy-1", enemyTypeId: "armored" },
    ...overrides
  };
}

function resolve(packetValue: DamagePacket, context: DamageResolutionContextV2Fixture = {}) {
  return DamageResolver.resolve(packetValue, context as DamageResolutionContext) as unknown as Record<string, unknown>;
}

describe("DamageResolver armor matrix order", () => {
  it("applies modifiers, armor matrix, entity resistance, then pierce_only compatibility", () => {
    const modifiers: readonly ModifierSpec[] = [{
      id: "upgrade-flat",
      target: "damage",
      stage: "tower_upgrade",
      operation: "flat",
      value: 20
    }];
    const result = resolve(
      packet({ damageType: "fire", modifiers }),
      {
        armorMatrix: {
          armorTypeId: "plated",
          defaultMultiplier: 0.75,
          multipliers: { physical: 0.8, fire: 0.5 }
        },
        resistances: { physical: 4, fire: 0.5 },
        legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 3 }
      }
    );

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
      armorTypeId: "plated",
      armorMultiplier: 0.5,
      afterArmor: 60,
      resistanceMultiplier: 0.5,
      afterResistance: 30,
      finalAmount: 3,
      blockedByArmor: false
    });
  });

  it("lets armor_piercing bypass only pierce_only, never the authored armor matrix", () => {
    const result = resolve(
      packet({ damageType: "fire", tags: ["armor_piercing"] }),
      {
        armorMatrix: { armorTypeId: "plated", multipliers: { fire: 0.5 } },
        legacyArmor: { kind: "pierce_only", bypassed: true, chipDamage: 0 }
      }
    );

    expect(result).toMatchObject({
      afterModifiers: 100,
      armorMultiplier: 0.5,
      afterArmor: 50,
      afterResistance: 50,
      finalAmount: 50,
      blockedByArmor: false
    });
  });

  it("uses physical by default, then explicit defaultMultiplier, then neutral 1 for a missing cell", () => {
    const physical = resolve(packet(), {
      armorMatrix: {
        armorTypeId: "plated",
        defaultMultiplier: 0.75,
        multipliers: { physical: 0.25 }
      }
    });
    expect(physical).toMatchObject({
      armorTypeId: "plated",
      armorMultiplier: 0.25,
      afterArmor: 25,
      finalAmount: 25
    });

    const authoredDefault = resolve(packet({ damageType: "ice" }), {
      armorMatrix: {
        armorTypeId: "plated",
        defaultMultiplier: 0.75,
        multipliers: { fire: 0.5 }
      }
    });
    expect(authoredDefault).toMatchObject({ armorMultiplier: 0.75, afterArmor: 75, finalAmount: 75 });

    const neutralDefault = resolve(packet({ damageType: "ice" }), {
      armorMatrix: { armorTypeId: "plated", multipliers: { fire: 0.5 } }
    });
    expect(neutralDefault).toMatchObject({ armorMultiplier: 1, afterArmor: 100, finalAmount: 100 });
  });

  it("treats an authored zero multiplier as immunity before resistance and pierce_only", () => {
    const result = resolve(packet({ damageType: "ice" }), {
      armorMatrix: { armorTypeId: "frost", defaultMultiplier: 1, multipliers: { ice: 0 } },
      resistances: { ice: 100 },
      legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 10 }
    });

    expect(result).toMatchObject({
      armorTypeId: "frost",
      armorMultiplier: 0,
      afterArmor: 0,
      resistanceMultiplier: 100,
      afterResistance: 0,
      finalAmount: 0,
      blockedByArmor: false
    });
  });

  it("keeps the legacy result byte-for-byte unchanged when no armor assignment is supplied", () => {
    const result = resolve(packet({ amount: 12 }));

    expect(result).toEqual({
      requestedAmount: 12,
      modifierTrace: [],
      afterModifiers: 12,
      resistanceMultiplier: 1,
      afterResistance: 12,
      finalAmount: 12,
      blockedByArmor: false
    });
    expect(result).not.toHaveProperty("armorTypeId");
    expect(result).not.toHaveProperty("armorMultiplier");
    expect(result).not.toHaveProperty("afterArmor");
  });

  it.each([
    ["empty armor id", { armorTypeId: "", multipliers: {} }],
    ["negative multiplier", { armorTypeId: "plated", multipliers: { fire: -0.1 } }],
    ["NaN multiplier", { armorTypeId: "plated", multipliers: { fire: Number.NaN } }],
    ["infinite default", { armorTypeId: "plated", defaultMultiplier: Number.POSITIVE_INFINITY, multipliers: {} }],
    ["above cap", { armorTypeId: "plated", defaultMultiplier: 1_000_001, multipliers: {} }]
  ] as const)("rejects malformed armor context: %s", (_label, armorMatrix) => {
    expect(() => resolve(packet({ damageType: "fire" }), {
      armorMatrix: armorMatrix as ArmorMatrixContextFixture
    })).toThrow(/armor|multiplier|finite|id|range|1000000/i);
  });

  it("rejects numeric overflow after the armor stage", () => {
    expect(() => resolve(packet({ amount: Number.MAX_VALUE }), {
      armorMatrix: { armorTypeId: "amplifier", multipliers: { physical: 2 } }
    })).toThrow(/finite|overflow|armor/i);
  });

  it("rejects more than 256 direct armor multipliers before interpreting the tail entry", () => {
    const tailGetter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_ARMOR_MATRIX_TAIL");
    });
    const multipliers: Record<string, number> = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`damage_${index}`, 1])
    );
    Object.defineProperty(multipliers, "damage_256", {
      enumerable: true,
      get: tailGetter
    });

    let caught: unknown;
    try {
      resolve(packet({ damageType: "damage_0" }), {
        armorMatrix: { armorTypeId: "oversized", multipliers }
      });
    } catch (error) {
      caught = error;
    }

    expect(tailGetter).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/limit|too many|exceed/i);
    expect(String(caught)).not.toContain("SYNTHETIC_SECRET");
  });

  it("is deterministic across matrix insertion order and never mutates packet or context", () => {
    const frozenPacket = Object.freeze(packet({
      amount: 40,
      damageType: "fire",
      tags: Object.freeze(["area"] as const),
      modifiers: Object.freeze([])
    }));
    const firstContext = Object.freeze({
      armorMatrix: Object.freeze({
        armorTypeId: "plated",
        defaultMultiplier: 0.9,
        multipliers: Object.freeze({ physical: 0.8, fire: 0.5, ice: 1.2 })
      }),
      resistances: Object.freeze({ physical: 1, fire: 0.25 })
    });
    const secondContext = Object.freeze({
      resistances: Object.freeze({ fire: 0.25, physical: 1 }),
      armorMatrix: Object.freeze({
        multipliers: Object.freeze({ ice: 1.2, fire: 0.5, physical: 0.8 }),
        defaultMultiplier: 0.9,
        armorTypeId: "plated"
      })
    });
    const packetBefore = JSON.stringify(frozenPacket);
    const firstBefore = JSON.stringify(firstContext);
    const secondBefore = JSON.stringify(secondContext);

    const first = resolve(frozenPacket, firstContext);
    const second = resolve(frozenPacket, secondContext);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ armorMultiplier: 0.5, afterArmor: 20, afterResistance: 5, finalAmount: 5 });
    expect(JSON.stringify(frozenPacket)).toBe(packetBefore);
    expect(JSON.stringify(firstContext)).toBe(firstBefore);
    expect(JSON.stringify(secondContext)).toBe(secondBefore);
  });

  it("fails closed on accessor-backed and inherited armor data without invoking accessors", () => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_DAMAGE_ARMOR_GETTER");
    });
    const accessorMatrix: Record<string, unknown> = {
      armorTypeId: "plated",
      multipliers: { fire: 0.5 }
    };
    Object.defineProperty(accessorMatrix, "defaultMultiplier", { enumerable: true, get: getter });

    let caught: unknown;
    try {
      resolve(packet({ damageType: "fire" }), {
        armorMatrix: accessorMatrix as unknown as ArmorMatrixContextFixture
      });
    } catch (error) {
      caught = error;
    }
    expect(getter).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain("SYNTHETIC_SECRET");

    const inheritedMatrix = Object.create({
      armorTypeId: "plated",
      multipliers: { fire: 0.5 }
    }) as ArmorMatrixContextFixture;
    expect(() => resolve(packet({ damageType: "fire" }), {
      armorMatrix: inheritedMatrix
    })).toThrow(/armor|plain object|own data/i);
  });

  it("validates resistance context as own data while allowing a safe null-prototype record", () => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_RESOLVER_RESISTANCE_GETTER");
    });
    const accessorResistances: Record<string, number> = {};
    Object.defineProperty(accessorResistances, "fire", { enumerable: true, get: getter });

    let accessorThrown: unknown;
    try {
      resolve(packet({ damageType: "fire" }), { resistances: accessorResistances });
    } catch (error) {
      accessorThrown = error;
    }
    expect(getter).not.toHaveBeenCalled();
    expect(accessorThrown).toBeInstanceOf(Error);
    expect(String(accessorThrown)).toMatch(/resistance|own data|data propert|inspect|unsafe/i);
    expect(String(accessorThrown)).not.toContain("SYNTHETIC_SECRET");

    const inheritedResistances = Object.create({ fire: 0.5 }) as Record<string, number>;
    expect(() => resolve(packet({ damageType: "fire" }), {
      resistances: inheritedResistances
    })).toThrow(/resistance|plain object|own data|prototype/i);

    const nullPrototypeResistances = Object.create(null) as Record<string, number>;
    nullPrototypeResistances.fire = 0.5;
    expect(resolve(packet({ damageType: "fire" }), {
      resistances: nullPrototypeResistances
    })).toMatchObject({
      resistanceMultiplier: 0.5,
      afterResistance: 50,
      finalAmount: 50
    });
  });
});
