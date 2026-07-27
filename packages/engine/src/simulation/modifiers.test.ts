import { describe, expect, it } from "vitest";
import {
  MAX_MODIFIERS_PER_RESOLUTION,
  MODIFIER_OPERATION_ORDER,
  MODIFIER_STAGE_ORDER,
  MODIFIER_TARGETS,
  resolveModifiers,
  type ModifierSpec
} from "./modifiers.js";

function modifier(
  id: string,
  stage: ModifierSpec["stage"],
  operation: ModifierSpec["operation"],
  value: number
): ModifierSpec {
  return { id, target: "damage", stage, operation, value };
}

describe("ModifierSpec contract", () => {
  it("publishes the closed target allowlist and stable stage/operation order", () => {
    expect(MODIFIER_TARGETS).toEqual(["damage"]);
    expect(MODIFIER_STAGE_ORDER).toEqual(["tower_upgrade", "meta", "run", "spatial", "temporary"]);
    expect(MODIFIER_OPERATION_ORDER).toEqual(["flat", "additive_ratio", "multiplier"]);
    expect(MAX_MODIFIERS_PER_RESOLUTION).toBe(64);
  });

  it("resolves stage, operation, then binary id order with additive ratios anchored after flats", () => {
    const result = resolveModifiers(100, "damage", [
      modifier("temporary-flat", "temporary", "flat", -9.5),
      modifier("upgrade-ratio-b", "tower_upgrade", "additive_ratio", 0.2),
      modifier("run-ratio", "run", "additive_ratio", 0.1),
      modifier("upgrade-multiply", "tower_upgrade", "multiplier", 2),
      modifier("meta-flat", "meta", "flat", 4),
      modifier("upgrade-ratio-a", "tower_upgrade", "additive_ratio", 0.1),
      modifier("upgrade-flat", "tower_upgrade", "flat", 10),
      modifier("spatial-multiply", "spatial", "multiplier", 0.5)
    ]);

    expect(result).toEqual({
      baseValue: 100,
      target: "damage",
      value: 150,
      trace: [
        { id: "upgrade-flat", stage: "tower_upgrade", operation: "flat", operand: 10, before: 100, after: 110 },
        { id: "upgrade-ratio-a", stage: "tower_upgrade", operation: "additive_ratio", operand: 0.1, before: 110, after: 121 },
        { id: "upgrade-ratio-b", stage: "tower_upgrade", operation: "additive_ratio", operand: 0.2, before: 121, after: 143 },
        { id: "upgrade-multiply", stage: "tower_upgrade", operation: "multiplier", operand: 2, before: 143, after: 286 },
        { id: "meta-flat", stage: "meta", operation: "flat", operand: 4, before: 286, after: 290 },
        { id: "run-ratio", stage: "run", operation: "additive_ratio", operand: 0.1, before: 290, after: 319 },
        { id: "spatial-multiply", stage: "spatial", operation: "multiplier", operand: 0.5, before: 319, after: 159.5 },
        { id: "temporary-flat", stage: "temporary", operation: "flat", operand: -9.5, before: 159.5, after: 150 }
      ]
    });
  });

  it("is deterministic for shuffled input and does not mutate caller-owned data", () => {
    const input = Object.freeze([
      Object.freeze(modifier("zeta", "run", "flat", 2)),
      Object.freeze(modifier("alpha", "run", "flat", 1)),
      Object.freeze(modifier("middle", "meta", "multiplier", 3))
    ]);
    const shuffled = Object.freeze([input[1]!, input[2]!, input[0]!]);
    const inputBefore = JSON.stringify(input);
    const shuffledBefore = JSON.stringify(shuffled);

    const first = resolveModifiers(5, "damage", input);
    const second = resolveModifiers(5, "damage", shuffled);

    expect(first).toEqual(second);
    expect(first.trace.map((step) => step.id)).toEqual(["middle", "alpha", "zeta"]);
    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(shuffled)).toBe(shuffledBefore);
  });

  it("rejects duplicate ids, invalid runtime enum values, non-finite numbers, and budget overflow", () => {
    expect(() =>
      resolveModifiers(1, "damage", [
        modifier("same", "meta", "flat", 1),
        modifier("same", "run", "flat", 1)
      ])
    ).toThrow(/duplicate|same/i);

    expect(() => resolveModifiers(Number.NaN, "damage", [])).toThrow(/finite|base/i);
    expect(() => resolveModifiers(1, "damage", [modifier("bad", "meta", "flat", Number.POSITIVE_INFINITY)])).toThrow(
      /finite|bad/i
    );

    expect(() =>
      resolveModifiers(1, "damage", [
        { ...modifier("bad-target", "meta", "flat", 1), target: "range" as ModifierSpec["target"] }
      ])
    ).toThrow(/target|range/i);
    expect(() =>
      resolveModifiers(1, "damage", [
        { ...modifier("bad-stage", "meta", "flat", 1), stage: "future" as ModifierSpec["stage"] }
      ])
    ).toThrow(/stage|future/i);
    expect(() =>
      resolveModifiers(1, "damage", [
        { ...modifier("bad-operation", "meta", "flat", 1), operation: "divide" as ModifierSpec["operation"] }
      ])
    ).toThrow(/operation|divide/i);

    const overBudget = Array.from({ length: MAX_MODIFIERS_PER_RESOLUTION + 1 }, (_, index) =>
      modifier(`modifier-${index.toString().padStart(3, "0")}`, "temporary", "flat", 1)
    );
    expect(() => resolveModifiers(1, "damage", overBudget)).toThrow(/64|budget|modifier/i);
  });
});
