import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

const ammunition = {
  inventories: [{
    towerId: "tower_3", towerTypeId: "cannon_tower", ammoTypeId: "shell",
    amount: 8, capacity: 30, consumptionPerActivation: 1, hasRequiredAmmo: true
  }]
};

function producer(overrides = {}) {
  return {
    towerId: "tower_1", towerTypeId: "shell_factory", recipeId: "forge_shell", ammoTypeId: "shell",
    amount: 16, capacity: 120, productionProgress: 0.4, productionInterval: 1,
    transferProgress: 0.1, transferInterval: 0.4,
    powered: true, operational: true, ...overrides
  };
}

function storage(overrides = {}) {
  return {
    towerId: "tower_2", towerTypeId: "shell_depot", ammoTypeId: "shell",
    amount: 12, capacity: 240, transferProgress: 0.2, transferInterval: 0.4,
    powered: true, operational: true, ...overrides
  };
}

function edge(overrides = {}) {
  return {
    sourceTowerId: "tower_1", sourceKind: "producer", destinationTowerId: "tower_3",
    destinationKind: "consumer", ammoTypeId: "shell", distance: 2, ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    logistics: {
      schemaVersion: 3, power: null, ammunition,
      supply: { producers: [producer()], storages: [storage()], edges: [edge()] },
      ...overrides
    }
  };
}

function deeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) deeplyFrozen(child, seen);
}

describe("R5.8B shared strict Logistics v3 supply presentation RED", () => {
  it("keeps exact v1 and v2 projections byte-compatible while accepting v3 supply:null", () => {
    const v1 = { logistics: { schemaVersion: 1, power: { components: [], nodes: [], consumers: [] } } };
    const projectedV1 = Renderer.projectLogisticsPresentation(v1);
    expect(JSON.stringify(projectedV1)).toBe(
      '{"active":true,"power":{"components":[],"nodes":[],"consumers":[]}}'
    );
    const v2 = { logistics: { schemaVersion: 2, power: null, ammunition } };
    const projectedV2 = Renderer.projectLogisticsPresentation(v2);
    expect(projectedV2).toEqual({ active: true, power: null, ammunition });
    expect(projectedV2).not.toHaveProperty("supply");
    expect(Renderer.projectLogisticsPresentation({
      logistics: { schemaVersion: 3, power: null, ammunition, supply: null }
    })).toEqual({ active: true, power: null, ammunition, supply: null });
  });

  it("detaches and deeply freezes authoritative v3 stock, progress, power state, and directed edges", () => {
    const source = snapshot();
    const projected = Renderer.projectLogisticsPresentation(source);
    expect(projected).toEqual({
      active: true, power: null, ammunition,
      supply: { producers: [producer()], storages: [storage()], edges: [edge()] }
    });
    deeplyFrozen(projected);
    source.logistics.supply.producers[0].amount = 99;
    source.logistics.supply.storages.splice(0);
    source.logistics.supply.edges[0].distance = 63;
    expect(projected.supply.producers[0].amount).toBe(16);
    expect(projected.supply.storages).toHaveLength(1);
    expect(projected.supply.edges[0].distance).toBe(2);
  });

  it("does not derive topology, ordering, operational state, refill, or progress", () => {
    const source = Renderer.projectLogisticsPresentation.toString();
    expect(source).not.toMatch(
      /(?:build|compute|derive|resolve)(?:Supply|Transfer|Edge|Topology)|topology\.distance|pathfind|routeStock/i
    );
    expect(source).not.toMatch(
      /operational\s*=|powered\s*&&|productionProgress\s*\+=|transferProgress\s*\+=|inventory\.amount\s*\+=/
    );
    const projected = Renderer.projectLogisticsPresentation(snapshot({
      supply: {
        producers: [producer({ powered: false, operational: false })],
        storages: [storage({ operational: false })], edges: [edge()]
      }
    }));
    expect(projected.supply.producers[0]).toMatchObject({ powered: false, operational: false });
    expect(projected.supply.storages[0]).toMatchObject({ powered: true, operational: false });
  });

  it("fails hostile, sparse, extra-field, unsorted, duplicate, invalid-progress, and noncanonical-edge inputs closed", () => {
    const inactive = Renderer.projectLogisticsPresentation({});
    const sparse = [];
    sparse.length = 1;
    const hostile = Object.create({ producers: [], storages: [], edges: [] });
    const accessor = {};
    Object.defineProperty(accessor, "producers", {
      enumerable: true, get() { throw new Error("must not execute snapshot accessors"); }
    });
    for (const candidate of [
      snapshot({ supply: hostile }),
      snapshot({ supply: accessor }),
      snapshot({ supply: { producers: sparse, storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer({ extra: true })], storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer({ towerId: "tower_2" }), producer()], storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer(), producer()], storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer({ productionProgress: 1.01 })], storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer({ powered: false, operational: true })], storages: [], edges: [] } }),
      snapshot({ supply: { producers: [producer()], storages: [storage({ transferProgress: -0.01 })], edges: [] } }),
      snapshot({ supply: { producers: [producer()], storages: [storage()], edges: [edge({ distance: 65 })] } }),
      snapshot({ supply: { producers: [producer()], storages: [storage()], edges: [edge(), edge()] } }),
      snapshot({
        supply: {
          producers: [producer()], storages: [storage()],
          edges: [edge({
            sourceTowerId: "tower_2", sourceKind: "storage",
            destinationTowerId: "tower_2", destinationKind: "storage", distance: 0
          })]
        }
      }),
      snapshot({
        supply: {
          producers: [producer()], storages: [storage()],
          edges: [edge({ destinationTowerId: "tower_1", destinationKind: "producer", distance: 0 })]
        }
      }),
      snapshot({
        supply: {
          producers: [producer()], storages: [storage()],
          edges: [
            edge({ destinationTowerId: "tower_4", destinationKind: "storage", distance: 3 }),
            edge({ destinationTowerId: "tower_3", destinationKind: "consumer", distance: 2 })
          ]
        }
      })
    ]) expect(Renderer.projectLogisticsPresentation(candidate)).toBe(inactive);
  });

  it("enforces v3 source/edge budgets and keeps absent/all-null/future v4 on one inactive legacy singleton", () => {
    const inactive = Renderer.projectLogisticsPresentation({});
    const producers = Array.from({ length: 1_025 }, (_, index) => producer({
      towerId: `tower_${String(index).padStart(4, "0")}`
    }));
    expect(Renderer.projectLogisticsPresentation(snapshot({
      supply: { producers, storages: [], edges: [] }
    }))).toBe(inactive);
    for (const source of [
      { logistics: { schemaVersion: 3, power: null, ammunition: null, supply: null } },
      { logistics: { schemaVersion: 3, power: null, ammunition: null } },
      { logistics: { schemaVersion: 3, power: null, ammunition, supply: { producers: [], storages: [], edges: [], extra: true } } },
      { logistics: { schemaVersion: 4, power: null, ammunition, supply: { opaque: true } } }
    ]) expect(Renderer.projectLogisticsPresentation(source)).toBe(inactive);
  });
});
