import { describe, expect, it } from "vitest";
import { DamageResolver, type DamagePacket, type DamageSourceRef, type DamageTargetRef } from "./damage.js";
import type { ModifierSpec } from "./modifiers.js";

const flatTen: ModifierSpec = {
  id: "upgrade-damage",
  target: "damage",
  stage: "tower_upgrade",
  operation: "flat",
  value: 10
};

// Compile-time public-contract fixtures: lingering effects can identify a tower type without a
// live tower instance, while packet tags remain a deliberately closed data-only vocabulary.
const towerTypeSourceWithoutInstance: DamageSourceRef = { kind: "tower", towerTypeId: "sprayer" };
const supportedDamageTags: NonNullable<DamagePacket["tags"]> = ["area", "over_time", "armor_piercing"];
// @ts-expect-error Damage tags are versioned engine vocabulary, not arbitrary author strings.
const unsupportedDamageTags: NonNullable<DamagePacket["tags"]> = ["future_tag"];
void unsupportedDamageTags;

function packet(overrides: Partial<DamagePacket> = {}): DamagePacket {
  return {
    amount: 100,
    source: { kind: "tower", towerId: "tower-1", towerTypeId: "cannon" },
    target: { kind: "enemy", enemyId: "enemy-1", enemyTypeId: "armored" },
    ...overrides
  };
}

describe("DamageResolver contract", () => {
  it("accepts type-only tower sources and the closed damage-tag vocabulary", () => {
    expect(
      DamageResolver.resolve(packet({
        source: towerTypeSourceWithoutInstance,
        tags: supportedDamageTags
      })).finalAmount
    ).toBe(100);
  });

  it("defaults to physical damage with neutral resistance and produces a serializable trace", () => {
    const result = DamageResolver.resolve(packet({ amount: 12 }));

    expect(result).toEqual({
      requestedAmount: 12,
      modifierTrace: [],
      afterModifiers: 12,
      resistanceMultiplier: 1,
      afterResistance: 12,
      finalAmount: 12,
      blockedByArmor: false
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("applies modifiers, typed resistance, then the legacy pierce-only chip adapter", () => {
    const result = DamageResolver.resolve(
      packet({ damageType: "fire", modifiers: [flatTen] }),
      {
        resistances: { fire: 0.5, physical: 2 },
        legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 3 }
      }
    );

    expect(result.requestedAmount).toBe(100);
    expect(result.modifierTrace).toEqual([
      {
        id: "upgrade-damage",
        stage: "tower_upgrade",
        operation: "flat",
        operand: 10,
        before: 100,
        after: 110
      }
    ]);
    expect(result.afterModifiers).toBe(110);
    expect(result.resistanceMultiplier).toBe(0.5);
    expect(result.afterResistance).toBe(55);
    expect(result.finalAmount).toBe(3);
    expect(result.blockedByArmor).toBe(false);
  });

  it("marks a positive hit as armor-blocked only when the chip adapter reduces it to zero", () => {
    const blocked = DamageResolver.resolve(packet({ amount: 9 }), {
      legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 0 }
    });
    expect(blocked.afterResistance).toBe(9);
    expect(blocked.finalAmount).toBe(0);
    expect(blocked.blockedByArmor).toBe(true);

    const bypassed = DamageResolver.resolve(packet({ amount: 9, tags: ["armor_piercing"] }), {
      legacyArmor: { kind: "pierce_only", bypassed: true, chipDamage: 0 }
    });
    expect(bypassed.finalAmount).toBe(9);
    expect(bypassed.blockedByArmor).toBe(false);

    const alreadyZero = DamageResolver.resolve(packet({ amount: 9, damageType: "ice" }), {
      resistances: { ice: 0 },
      legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 0 }
    });
    expect(alreadyZero.afterResistance).toBe(0);
    expect(alreadyZero.finalAmount).toBe(0);
    expect(alreadyZero.blockedByArmor).toBe(false);
  });

  it("clamps negative damage and resistance to zero without mutating packet or context", () => {
    const input = Object.freeze(
      packet({
        amount: -5,
        damageType: "void",
        tags: Object.freeze(["over_time"] as const),
        modifiers: Object.freeze([])
      })
    );
    const context = Object.freeze({ resistances: Object.freeze({ void: -2 }) });
    const packetBefore = JSON.stringify(input);
    const contextBefore = JSON.stringify(context);

    const result = DamageResolver.resolve(input, context);

    expect(result.requestedAmount).toBe(-5);
    expect(result.afterModifiers).toBe(-5);
    expect(result.resistanceMultiplier).toBe(0);
    expect(result.afterResistance).toBe(0);
    expect(result.finalAmount).toBe(0);
    expect(result.blockedByArmor).toBe(false);
    expect(JSON.stringify(input)).toBe(packetBefore);
    expect(JSON.stringify(context)).toBe(contextBefore);
  });

  it("accepts every source and enemy/tower/core target ref through the same stateless resolver", () => {
    const sources: DamageSourceRef[] = [
      { kind: "tower", towerTypeId: "cannon", towerId: "tower-1" },
      { kind: "ability", abilityId: "strike" },
      { kind: "tower_script", scriptId: "hazard-rules" },
      { kind: "status", statusId: "poison" },
      { kind: "enemy", enemyId: "enemy-1", enemyTypeId: "boss" },
      { kind: "leak", enemyId: "enemy-1", enemyTypeId: "runner" }
    ];
    const targets: DamageTargetRef[] = [
      { kind: "enemy", enemyId: "enemy-2", enemyTypeId: "grunt" },
      { kind: "tower", towerId: "tower-2", towerTypeId: "wall" },
      { kind: "core" }
    ];

    for (const source of sources) {
      for (const target of targets) {
        expect(DamageResolver.resolve(packet({ amount: 7, source, target })).finalAmount).toBe(7);
      }
    }
  });

  it("rejects malformed or future source and target discriminators at runtime", () => {
    const invalidSources: unknown[] = [
      null,
      {},
      { kind: "future", id: "x" },
      { kind: "tower", towerTypeId: "" },
      { kind: "tower", towerTypeId: "cannon", towerId: " " },
      { kind: "ability", abilityId: "" },
      { kind: "tower_script", scriptId: "" },
      { kind: "status", statusId: "" },
      { kind: "enemy", enemyId: "enemy-1" },
      { kind: "leak", enemyId: "", enemyTypeId: "runner" }
    ];
    const invalidTargets: unknown[] = [
      null,
      {},
      { kind: "future" },
      { kind: "enemy", enemyId: "enemy-1" },
      { kind: "tower", towerId: "", towerTypeId: "wall" }
    ];

    for (const source of invalidSources) {
      expect(() => DamageResolver.resolve(packet({ source: source as DamageSourceRef }))).toThrow(/source|kind|id/i);
    }
    for (const target of invalidTargets) {
      expect(() => DamageResolver.resolve(packet({ target: target as DamageTargetRef }))).toThrow(/target|kind|id/i);
    }
    expect(() =>
      DamageResolver.resolve(packet({ modifiers: null as unknown as readonly ModifierSpec[] }))
    ).toThrow(/modifier|array/i);
  });

  it("rejects non-finite damage inputs and non-finite resistance values", () => {
    expect(() => DamageResolver.resolve(packet({ amount: Number.NaN }))).toThrow(/finite|amount/i);
    expect(() =>
      DamageResolver.resolve(packet({ damageType: "fire" }), { resistances: { fire: Number.POSITIVE_INFINITY } })
    ).toThrow(/finite|resistance|fire/i);
    expect(() =>
      DamageResolver.resolve(packet(), {
        legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: Number.NaN }
      })
    ).toThrow(/finite|chip/i);
    expect(() =>
      DamageResolver.resolve(packet({ amount: Number.MAX_VALUE }), { resistances: { physical: 2 } })
    ).toThrow(/finite|overflow|resistance/i);
  });
});
