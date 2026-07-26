import { describe, expect, it } from "vitest";
import type { DynamicFlowNavigationProfileV1, MovementProfileV1 } from "../content/navigation-mechanics.js";
import type { GridCoord, GridPathRoute } from "./types.js";

type SpawnKind = "death_spawn" | "phase_spawn";

interface FieldRef {
  readonly movementProfileId: string;
  readonly goal: GridCoord;
}

interface ObligationObservation {
  readonly kind: SpawnKind;
  readonly parentEnemyTypeId: string;
  readonly childEnemyTypeId: string;
}

interface SpawnObligation {
  readonly key: string;
  readonly parent: FieldRef;
  readonly child: FieldRef;
  readonly observations: readonly ObligationObservation[];
}

interface SpawnGraphResult {
  readonly spawnProvenance: readonly Record<string, unknown>[];
  readonly spawnObligations: readonly SpawnObligation[];
}

interface PreparedResult {
  readonly groups: readonly {
    readonly key: string;
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly routeId: string;
    readonly sources: readonly {
      readonly kind: string;
      readonly movementProfileId: string;
      readonly routeId: string;
      readonly goal: GridCoord;
      readonly coord: GridCoord;
      readonly subjectId: string;
    }[];
  }[];
  readonly obligations: readonly SpawnObligation[];
  readonly sourceCount: number;
  readonly fieldCount: number;
  readonly obligationCount: number;
  readonly observationCount: number;
  readonly combinedFieldCells: number;
}

const MODULE_PATH = "./terraforming-navigation.js";
const BUDGET_MESSAGE = "Terraforming navigation solver budget exceeded.";

async function internalModule(): Promise<{
  readonly collect: (request: Record<string, unknown>) => SpawnGraphResult;
  readonly prepare: (request: Record<string, unknown>) => PreparedResult;
  readonly assertBudget: (request: Record<string, number>) => void;
}> {
  const module = await import(MODULE_PATH) as unknown as Record<string, unknown>;
  expect(module.collectDynamicTerraformingSpawnProvenance).toBeTypeOf("function");
  expect(module.prepareDynamicTerraformingSafetySet).toBeTypeOf("function");
  expect(module.assertDynamicTerraformingSafetyBudget).toBeTypeOf("function");
  return {
    collect: module.collectDynamicTerraformingSpawnProvenance as (request: Record<string, unknown>) => SpawnGraphResult,
    prepare: module.prepareDynamicTerraformingSafetySet as (request: Record<string, unknown>) => PreparedResult,
    assertBudget: module.assertDynamicTerraformingSafetyBudget as (request: Record<string, number>) => void
  };
}

const AIR: MovementProfileV1 = Object.freeze({
  label: "Parent air",
  terrainMode: "ignore_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000
});
const GROUND: MovementProfileV1 = Object.freeze({
  label: "Child ground",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000
});
const MAIN: GridPathRoute = {
  id: "main",
  pathCenterline: [{ q: 0, r: 0 }, { q: 4, r: 0 }]
};
const SIDE: GridPathRoute = {
  id: "side",
  pathCenterline: [{ q: 0, r: 1 }, { q: 4, r: 1 }]
};

function profile(assignments: Readonly<Record<string, string>>): DynamicFlowNavigationProfileV1 {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: "parent_air",
    movementProfiles: { parent_air: AIR, child_ground: GROUND },
    enemyMovementProfiles: assignments
  };
}

function graphRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: profile({ root: "parent_air", death_child: "child_ground", phase_child: "child_ground" }),
    routes: [MAIN, SIDE],
    waves: [{ groups: [{ enemyId: "root", routeId: "main" }] }],
    enemyTypes: {
      root: {
        spawnOnDeath: { enemyId: "death_child", count: 1 },
        phaseSpawns: [{ enemyId: "phase_child", count: 1, routeIds: ["side"] }]
      },
      death_child: {},
      phase_child: {}
    },
    scripts: {},
    mission: { id: "mission", mapId: "map", waveSetId: "waves", buildTowerIds: [], abilityIds: [] },
    initialReachableTerrainIds: ["floor"],
    terraformTransitionTerrainById: {},
    ...overrides
  };
}

function field(movementProfileId: string, goal: GridCoord): FieldRef {
  return { movementProfileId, goal: { ...goal } };
}

function obligation(
  parent: FieldRef,
  child: FieldRef,
  observations: readonly ObligationObservation[]
): SpawnObligation {
  return {
    key: JSON.stringify([
      parent.movementProfileId, parent.goal.q, parent.goal.r,
      child.movementProfileId, child.goal.q, child.goal.r
    ]),
    parent,
    child,
    observations
  };
}

function expectBudgetError(action: () => void): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    name: "DynamicTerraformingSafetyBudgetError",
    code: "budget_exceeded",
    reasonKey: "terraform.solver_budget_exceeded",
    message: BUDGET_MESSAGE
  });
}

describe("R3.4b C2 remediation canonical spawn field obligations", () => {
  it("emits inherited death and explicit phase obligations with parent and child enemy type provenance", async () => {
    const { collect } = await internalModule();
    const result = collect(graphRequest());
    const parent = field("parent_air", { q: 4, r: 0 });

    expect(result.spawnObligations).toEqual([
      obligation(parent, field("child_ground", { q: 4, r: 0 }), [{
        kind: "death_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "death_child"
      }]),
      obligation(parent, field("child_ground", { q: 4, r: 1 }), [{
        kind: "phase_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "phase_child"
      }])
    ]);
    expect(result.spawnProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "death_spawn", routeId: "main", subjectId: "death_child" }),
      expect.objectContaining({ kind: "phase_spawn", routeId: "side", subjectId: "phase_child" })
    ]));
  });

  it("bounds spawn cycles and returns identical canonical obligations for permuted inputs", async () => {
    const { collect } = await internalModule();
    const base = graphRequest({
      profile: profile({ root: "parent_air", death_child: "child_ground" }),
      enemyTypes: {
        root: { spawnOnDeath: { enemyId: "death_child", count: 1 } },
        death_child: { spawnOnDeath: { enemyId: "root", count: 1 } }
      }
    });
    const permuted = {
      ...base,
      routes: [SIDE, MAIN],
      enemyTypes: Object.fromEntries(Object.entries(base.enemyTypes as Record<string, unknown>).reverse()),
      profile: {
        ...(base.profile as DynamicFlowNavigationProfileV1),
        movementProfiles: { child_ground: GROUND, parent_air: AIR },
        enemyMovementProfiles: { death_child: "child_ground", root: "parent_air" }
      }
    };

    const canonical = collect(base).spawnObligations;
    expect(collect(permuted).spawnObligations).toEqual(canonical);
    expect(canonical).toHaveLength(2);
    expect(canonical.map(({ parent, child }) => [parent.movementProfileId, child.movementProfileId]))
      .toEqual([["child_ground", "parent_air"], ["parent_air", "child_ground"]]);
  });

  it("deduplicates proof pairs, elides self relations, adds pending death sources, and reserves exact proof work", async () => {
    const { prepare, assertBudget } = await internalModule();
    const parent = field("parent_air", { q: 4, r: 0 });
    const child = field("child_ground", { q: 4, r: 0 });
    const deathRelation = obligation(parent, child, [{
      kind: "death_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "death_child"
    }]);
    const selfRelation = obligation(parent, parent, [{
      kind: "phase_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "root"
    }]);
    const prepared = prepare({
      profile: profile({ root: "parent_air", death_child: "child_ground" }),
      routes: [MAIN],
      spawnProvenance: [],
      spawnObligations: [deathRelation, { ...deathRelation }, selfRelation],
      enemies: [{
        id: "dead_1",
        typeId: "root",
        hp: 0,
        routeId: "main",
        navigation: { currentCoord: { q: 2, r: 0 }, nextCoord: { q: 3, r: 0 }, edgeProgress: 0 }
      }],
      mapCellCount: 15
    });

    expect(prepared.obligations).toEqual([deathRelation]);
    expect(prepared.obligationCount).toBe(1);
    expect(prepared.observationCount).toBe(2);
    expect(prepared.combinedFieldCells).toBe(90);
    expect(prepared.groups.find(({ movementProfileId }) => movementProfileId === "child_ground")?.sources)
      .toContainEqual(expect.objectContaining({
        kind: "pending_death_spawn",
        movementProfileId: "child_ground",
        routeId: "main",
        coord: { q: 2, r: 0 },
        subjectId: "dead_1"
      }));

    expect(assertBudget({
      sourceCount: 1,
      fieldCount: 1,
      obligationCount: 1,
      observationCount: 1,
      mapCellCount: 2_097_152
    })).toBeUndefined();
    expectBudgetError(() => assertBudget({
      sourceCount: 1,
      fieldCount: 1,
      obligationCount: 1,
      observationCount: 1,
      mapCellCount: 2_097_153
    }));
    expectBudgetError(() => assertBudget({
      sourceCount: 1,
      fieldCount: 1,
      obligationCount: 16_385,
      observationCount: 16_385,
      mapCellCount: 1
    }));
  });
});
