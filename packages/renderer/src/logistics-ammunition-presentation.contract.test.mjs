import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

const v1Power = Object.freeze({ components: Object.freeze([]), nodes: Object.freeze([]), consumers: Object.freeze([]) });

function inventory(overrides = {}) {
  return {
    towerId: "tower_1",
    towerTypeId: "cannon_tower",
    ammoTypeId: "shell",
    amount: 12,
    capacity: 30,
    consumptionPerActivation: 1,
    hasRequiredAmmo: true,
    ...overrides
  };
}

function v2Snapshot(overrides = {}) {
  return {
    logistics: {
      schemaVersion: 2,
      power: null,
      ammunition: { inventories: [inventory()] },
      ...overrides
    }
  };
}

function expectDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("R5.8A shared Logistics v2 ammunition presentation RED", () => {
  it("keeps the exact Logistics v1 projection byte-compatible", () => {
    const snapshot = { logistics: { schemaVersion: 1, power: v1Power } };
    const projected = Renderer.projectLogisticsPresentation(snapshot);
    expect(projected).toEqual({ active: true, power: v1Power });
    expect(JSON.stringify(projected)).toBe(
      '{"active":true,"power":{"components":[],"nodes":[],"consumers":[]}}'
    );
    expect(projected).not.toHaveProperty("ammunition");
  });

  it("detaches and freezes exact binary-sorted v2 ammunition rows", () => {
    const source = v2Snapshot({
      ammunition: {
        inventories: [
          inventory({ towerId: "tower_1", amount: 0, hasRequiredAmmo: false }),
          inventory({ towerId: "tower_2", amount: 2, consumptionPerActivation: 2 })
        ]
      }
    });
    const projected = Renderer.projectLogisticsPresentation(source);
    expect(projected).toEqual({
      active: true,
      power: null,
      ammunition: { inventories: source.logistics.ammunition.inventories }
    });
    expectDeeplyFrozen(projected);
    source.logistics.ammunition.inventories[0].amount = 30;
    source.logistics.ammunition.inventories.splice(1);
    expect(projected.ammunition.inventories).toHaveLength(2);
    expect(projected.ammunition.inventories[0]).toMatchObject({ amount: 0, hasRequiredAmmo: false });
  });

  it("keeps v2 power and ammunition independent without deriving combined operational state", () => {
    const projected = Renderer.projectLogisticsPresentation(v2Snapshot({
      power: v1Power,
      ammunition: { inventories: [inventory({ amount: 0, hasRequiredAmmo: false })] }
    }));
    expect(projected).toEqual({
      active: true,
      power: v1Power,
      ammunition: { inventories: [inventory({ amount: 0, hasRequiredAmmo: false })] }
    });
    expect(projected.ammunition.inventories[0]).not.toHaveProperty("powered");
    expect(Renderer.projectLogisticsPresentation.toString()).not.toMatch(
      /(?:operational|canFire)\s*=|amount\s*>=\s*.*consumption|powered\s*&&/
    );
  });

  it("fails hostile, sparse, extra-field, unsorted, duplicate, and inconsistent v2 rows closed", () => {
    const sparse = [];
    sparse.length = 1;
    const hostile = Object.create({ inventories: [] });
    const accessor = {};
    Object.defineProperty(accessor, "inventories", {
      enumerable: true,
      get() { throw new Error("must not execute snapshot accessors"); }
    });
    const candidates = [
      v2Snapshot({ ammunition: hostile }),
      v2Snapshot({ ammunition: accessor }),
      v2Snapshot({ ammunition: { inventories: sparse } }),
      v2Snapshot({ ammunition: { inventories: [inventory({ extra: true })] } }),
      v2Snapshot({ ammunition: { inventories: [inventory({ towerId: "tower_2" }), inventory({ towerId: "tower_1" })] } }),
      v2Snapshot({ ammunition: { inventories: [inventory(), inventory()] } }),
      v2Snapshot({ ammunition: { inventories: [inventory({ amount: 0, hasRequiredAmmo: true })] } }),
      v2Snapshot({ ammunition: { inventories: [inventory({ amount: 1.5 })] } })
    ];
    for (const candidate of candidates) {
      expect(Renderer.projectLogisticsPresentation(candidate)).toBe(
        Renderer.projectLogisticsPresentation({})
      );
    }
  });

  it("accepts exact v2 bounds and rejects over-budget IDs, rows, and integer amounts", () => {
    const rows = Array.from({ length: 4_096 }, (_, index) => inventory({
      towerId: `tower_${String(index).padStart(4, "0")}`,
      ammoTypeId: "a".repeat(128),
      amount: 1_000_000_000,
      capacity: 1_000_000_000,
      consumptionPerActivation: 1_000_000_000
    }));
    expect(Renderer.projectLogisticsPresentation(v2Snapshot({ ammunition: { inventories: rows } })))
      .toHaveProperty("active", true);
    for (const invalid of [
      [...rows, inventory({ towerId: "tower_over" })],
      [inventory({ ammoTypeId: "é".repeat(65) })],
      [inventory({ capacity: 1_000_000_001 })],
      [inventory({ amount: 1_000_000_001, capacity: 1_000_000_000 })],
      [inventory({ consumptionPerActivation: 0 })],
      [inventory({ capacity: Number.MAX_SAFE_INTEGER + 1 })]
    ]) {
      expect(Renderer.projectLogisticsPresentation(v2Snapshot({ ammunition: { inventories: invalid } })))
        .toBe(Renderer.projectLogisticsPresentation({}));
    }
  });

  it("returns the frozen legacy inactive singleton for absent, both-null, invalid, and future inputs", () => {
    const inactive = Renderer.projectLogisticsPresentation({});
    expect(inactive).toEqual({ active: false, power: null });
    expectDeeplyFrozen(inactive);
    for (const source of [
      { logistics: { schemaVersion: 2, power: null, ammunition: null } },
      { logistics: { schemaVersion: 2, power: null } },
      { logistics: { schemaVersion: 2, power: null, ammunition: { inventories: [] }, extra: true } },
      { logistics: { schemaVersion: 4, power: null, ammunition: null, supply: null, future: true } }
    ]) expect(Renderer.projectLogisticsPresentation(source)).toBe(inactive);
  });
});
