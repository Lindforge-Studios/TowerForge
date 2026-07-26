import { describe, expect, it } from "vitest";
import type { DynamicFlowNavigationProfileV1, MovementProfileV1 } from "../content/navigation-mechanics.js";
import type { GridCoord, GridPathRoute } from "./types.js";

type SafetySourceKind =
  | "route_source"
  | "route_goal"
  | "wave_spawn"
  | "death_spawn"
  | "phase_spawn"
  | "script_spawn"
  | "pending_death_spawn"
  | "live_current"
  | "live_next";

interface CanonicalSafetySource {
  readonly kind: SafetySourceKind;
  readonly movementProfileId: string;
  readonly routeId: string;
  readonly goal: GridCoord;
  readonly coord: GridCoord;
  readonly subjectId: string;
}

interface SafetyGroup {
  readonly key: string;
  readonly movementProfileId: string;
  readonly goal: GridCoord;
  readonly routeId: string;
  readonly sources: readonly CanonicalSafetySource[];
}

interface SafetyFieldRef {
  readonly movementProfileId: string;
  readonly goal: GridCoord;
}

interface SafetyObligation {
  readonly key: string;
  readonly parent: SafetyFieldRef;
  readonly child: SafetyFieldRef;
  readonly observations: readonly {
    readonly kind: "death_spawn" | "phase_spawn";
    readonly parentEnemyTypeId: string;
    readonly childEnemyTypeId: string;
  }[];
}

interface PreparedSafetySet {
  readonly groups: readonly SafetyGroup[];
  readonly obligations?: readonly SafetyObligation[];
  readonly sourceCount: number;
  readonly fieldCount: number;
  readonly obligationCount?: number;
  readonly observationCount?: number;
  readonly combinedFieldCells: number;
}

interface PreparedSafetyRequest {
  readonly profile: DynamicFlowNavigationProfileV1;
  readonly routes: readonly GridPathRoute[];
  readonly spawnProvenance: readonly CanonicalSafetySource[];
  readonly spawnObligations?: readonly SafetyObligation[];
  readonly enemies: readonly {
    readonly id: string;
    readonly typeId: string;
    readonly hp: number;
    readonly routeId?: string;
    readonly navigation?: {
      readonly currentCoord: GridCoord;
      readonly nextCoord?: GridCoord;
      readonly edgeProgress: number;
    };
  }[];
  readonly mapCellCount: number;
}

interface SafetyBudgetInput {
  readonly sourceCount: number;
  readonly fieldCount: number;
  readonly obligationCount?: number;
  readonly observationCount?: number;
  readonly mapCellCount: number;
}

type AssertBudget = (input: SafetyBudgetInput) => void;
type PrepareSafetySet = (input: PreparedSafetyRequest) => PreparedSafetySet;

const MODULE_PATH = "./terraforming-navigation.js";
const BUDGET_MESSAGE = "Terraforming navigation solver budget exceeded.";

async function seams(): Promise<{
  readonly assertBudget: AssertBudget;
  readonly prepare: PrepareSafetySet;
}> {
  const module = await import(MODULE_PATH) as unknown as {
    assertDynamicTerraformingSafetyBudget?: AssertBudget;
    prepareDynamicTerraformingSafetySet?: PrepareSafetySet;
  };
  expect(module.assertDynamicTerraformingSafetyBudget).toBeTypeOf("function");
  expect(module.prepareDynamicTerraformingSafetySet).toBeTypeOf("function");
  return {
    assertBudget: module.assertDynamicTerraformingSafetyBudget!,
    prepare: module.prepareDynamicTerraformingSafetySet!
  };
}

const BLOCKED: MovementProfileV1 = Object.freeze({
  label: "Blocked",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000
});
const IGNORED: MovementProfileV1 = Object.freeze({
  label: "Ignored",
  terrainMode: "respect_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000
});

function pathRoute(id: string, start: GridCoord, goal: GridCoord): GridPathRoute {
  return { id, pathCenterline: [{ ...start }, { ...goal }] };
}

const A_ALIAS = pathRoute("a_alias", { q: 1, r: 0 }, { q: 5, r: 0 });
const Z_ALIAS = pathRoute("z_alias", { q: 0, r: 0 }, { q: 5, r: 0 });
const SIDE = pathRoute("side", { q: 0, r: 2 }, { q: 5, r: 2 });

function profile(
  movementProfiles: Readonly<Record<string, MovementProfileV1>> = { z_used: BLOCKED },
  assignments: Readonly<Record<string, string>> = {}
): DynamicFlowNavigationProfileV1 {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: Object.keys(movementProfiles).sort(compareBinary)[0]!,
    movementProfiles,
    enemyMovementProfiles: assignments
  };
}

function emptyRequest(overrides: Partial<PreparedSafetyRequest> = {}): PreparedSafetyRequest {
  return {
    profile: profile(),
    routes: [Z_ALIAS],
    spawnProvenance: [],
    enemies: [],
    mapCellCount: 18,
    ...overrides
  };
}

function provenance(
  kind: Extract<SafetySourceKind, "wave_spawn" | "death_spawn" | "phase_spawn" | "script_spawn">,
  movementProfileId: string,
  route: GridPathRoute,
  subjectId: string
): CanonicalSafetySource {
  return {
    kind,
    movementProfileId,
    routeId: route.id,
    goal: { ...route.pathCenterline.at(-1)! },
    coord: { ...route.pathCenterline[0]! },
    subjectId
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

function expectExactError(action: () => void, message: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(message);
}

describe("R3.4b C2B2A canonical dynamic terraforming safety set and budgets", () => {
  it("does not reserve pending death sources for an enemy already at its route goal", async () => {
    const { prepare } = await seams();
    const parent: SafetyFieldRef = { movementProfileId: "z_parent", goal: { q: 5, r: 0 } };
    const child: SafetyFieldRef = { movementProfileId: "a_child", goal: { q: 5, r: 0 } };
    const relation = (
      target: SafetyFieldRef,
      childEnemyTypeId: string
    ): SafetyObligation => ({
      key: JSON.stringify([
        parent.movementProfileId, parent.goal.q, parent.goal.r,
        target.movementProfileId, target.goal.q, target.goal.r
      ]),
      parent,
      child: target,
      observations: [{
        kind: "death_spawn",
        parentEnemyTypeId: "root",
        childEnemyTypeId
      }]
    });
    const prepared = prepare(emptyRequest({
      profile: profile(
        { z_parent: BLOCKED, a_child: IGNORED },
        { root: "z_parent", child: "a_child" }
      ),
      spawnObligations: [relation(child, "child"), relation(parent, "root")],
      enemies: [{
        id: "dead_at_goal",
        typeId: "root",
        hp: 0,
        routeId: "z_alias",
        navigation: { currentCoord: { q: 5, r: 0 }, edgeProgress: 0 }
      }]
    }));

    expect(prepared.sourceCount).toBe(4);
    expect(prepared.groups.flatMap(({ sources }) => sources)
      .filter(({ kind }) => kind === "pending_death_spawn")).toEqual([]);
  });

  it("deduplicates non-self field obligations and reserves exact solver work and proof budgets", async () => {
    const { prepare, assertBudget } = await seams();
    const observation = {
      kind: "death_spawn" as const,
      parentEnemyTypeId: "air_parent",
      childEnemyTypeId: "ground_child"
    };
    const relation: SafetyObligation = {
      key: JSON.stringify(["z_used", 5, 0, "a_child", 5, 0]),
      parent: { movementProfileId: "z_used", goal: { q: 5, r: 0 } },
      child: { movementProfileId: "a_child", goal: { q: 5, r: 0 } },
      observations: [observation]
    };
    const selfRelation: SafetyObligation = {
      key: JSON.stringify(["z_used", 5, 0, "z_used", 5, 0]),
      parent: relation.parent,
      child: relation.parent,
      observations: [{ ...observation, kind: "phase_spawn" }]
    };
    const prepared = prepare(emptyRequest({
      profile: profile({ z_used: BLOCKED, a_child: IGNORED }),
      spawnObligations: [relation, { ...relation }, selfRelation],
      mapCellCount: 15
    }));

    expect(prepared.obligations).toEqual([relation]);
    expect(prepared.obligationCount).toBe(1);
    expect(prepared.observationCount).toBe(2);
    expect(prepared.combinedFieldCells).toBe(90);

    expect(assertBudget({
      sourceCount: 1, fieldCount: 1, obligationCount: 1, observationCount: 1,
      mapCellCount: 2_097_152
    })).toBeUndefined();
    expectBudgetError(() => assertBudget({
      sourceCount: 1, fieldCount: 1, obligationCount: 1, observationCount: 1,
      mapCellCount: 2_097_153
    }));
    expectBudgetError(() => assertBudget({
      sourceCount: 1, fieldCount: 1, obligationCount: 16_385, observationCount: 1,
      mapCellCount: 1
    }));
    expectBudgetError(() => assertBudget({
      sourceCount: 1, fieldCount: 1, obligationCount: 1, observationCount: 16_385,
      mapCellCount: 1
    }));
  });

  it("groups every profile by numeric goal, keeps unused ignored endpoints, and shares same-goal aliases", async () => {
    const { prepare } = await seams();
    const result = prepare(emptyRequest({
      profile: profile({ z_used: BLOCKED, a_ignored_unused: IGNORED }),
      routes: [Z_ALIAS, SIDE, A_ALIAS]
    }));

    expect(result).toEqual({
      groups: [
        expectedEndpointGroup("a_ignored_unused", { q: 5, r: 0 }, "a_alias", [A_ALIAS, Z_ALIAS]),
        expectedEndpointGroup("a_ignored_unused", { q: 5, r: 2 }, "side", [SIDE]),
        expectedEndpointGroup("z_used", { q: 5, r: 0 }, "a_alias", [A_ALIAS, Z_ALIAS]),
        expectedEndpointGroup("z_used", { q: 5, r: 2 }, "side", [SIDE])
      ],
      sourceCount: 12,
      fieldCount: 4,
      combinedFieldCells: 144
    });
    expect(Object.keys(result)).toEqual(["groups", "sourceCount", "fieldCount", "combinedFieldCells"]);
  });

  it("merges spawn provenance with live current and only in-progress next sources while excluding dead enemies", async () => {
    const { prepare } = await seams();
    const movementProfile = profile(
      { z_used: BLOCKED },
      { live_a: "z_used", live_b: "z_used", dead: "z_used" }
    );
    const result = prepare(emptyRequest({
      profile: movementProfile,
      spawnProvenance: [
        provenance("script_spawn", "z_used", Z_ALIAS, "script_z"),
        provenance("death_spawn", "z_used", Z_ALIAS, "death_child"),
        provenance("wave_spawn", "z_used", Z_ALIAS, "wave_root")
      ],
      enemies: [
        {
          id: "live_a", typeId: "live_a", hp: 10, routeId: "z_alias",
          navigation: { currentCoord: { q: 1, r: 0 }, nextCoord: { q: 2, r: 0 }, edgeProgress: 0.5 }
        },
        {
          id: "live_b", typeId: "live_b", hp: 10, routeId: "z_alias",
          navigation: { currentCoord: { q: 3, r: 0 }, nextCoord: { q: 4, r: 0 }, edgeProgress: 0 }
        },
        {
          id: "dead", typeId: "dead", hp: 0, routeId: "z_alias",
          navigation: { currentCoord: { q: 4, r: 0 }, nextCoord: { q: 5, r: 0 }, edgeProgress: 0.75 }
        }
      ]
    }));
    const sources = result.groups[0]!.sources;

    expect(sources.map(({ kind, coord, subjectId }) => ({ kind, coord, subjectId }))).toEqual([
      { kind: "route_source", coord: { q: 0, r: 0 }, subjectId: "" },
      { kind: "route_goal", coord: { q: 5, r: 0 }, subjectId: "" },
      { kind: "wave_spawn", coord: { q: 0, r: 0 }, subjectId: "wave_root" },
      { kind: "death_spawn", coord: { q: 0, r: 0 }, subjectId: "death_child" },
      { kind: "script_spawn", coord: { q: 0, r: 0 }, subjectId: "script_z" },
      { kind: "live_current", coord: { q: 1, r: 0 }, subjectId: "live_a" },
      { kind: "live_current", coord: { q: 3, r: 0 }, subjectId: "live_b" },
      { kind: "live_next", coord: { q: 2, r: 0 }, subjectId: "live_a" }
    ]);
    expect(result.sourceCount).toBe(8);
  });

  it("deduplicates repeated static records and remains exact under input permutations without merging live ids", async () => {
    const { prepare } = await seams();
    const wave = provenance("wave_spawn", "z_used", Z_ALIAS, "root");
    const enemies = [
      {
        id: "enemy_z", typeId: "root", hp: 10, routeId: "z_alias",
        navigation: { currentCoord: { q: 2, r: 0 }, edgeProgress: 0 }
      },
      {
        id: "enemy_a", typeId: "root", hp: 10, routeId: "z_alias",
        navigation: { currentCoord: { q: 2, r: 0 }, edgeProgress: 0 }
      }
    ];
    const baseline = prepare(emptyRequest({ spawnProvenance: [wave], enemies }));
    const permuted = prepare(emptyRequest({
      profile: profile(Object.fromEntries(Object.entries({ z_used: BLOCKED }).reverse())),
      routes: [{ ...Z_ALIAS, pathCenterline: [...Z_ALIAS.pathCenterline] }, Z_ALIAS],
      spawnProvenance: [{ ...wave, coord: { ...wave.coord }, goal: { ...wave.goal } }, wave],
      enemies: [...enemies].reverse()
    }));

    expect(permuted).toEqual(baseline);
    expect(baseline.sourceCount).toBe(5);
    expect(baseline.groups[0]!.sources.filter(({ kind }) => kind === "live_current").map(({ subjectId }) => subjectId))
      .toEqual(["enemy_a", "enemy_z"]);
  });

  it("accepts exactly 16,384 sources and rejects 16,385 with the typed solver-budget error", async () => {
    const { assertBudget } = await seams();

    expect(assertBudget({ sourceCount: 16_384, fieldCount: 1, mapCellCount: 1 })).toBeUndefined();
    expectBudgetError(() => assertBudget({ sourceCount: 16_385, fieldCount: 1, mapCellCount: 1 }));
  });

  it("rejects every zero solver dimension with the existing typed budget error", async () => {
    const { assertBudget } = await seams();

    for (const input of [
      { sourceCount: 0, fieldCount: 1, mapCellCount: 1 },
      { sourceCount: 1, fieldCount: 0, mapCellCount: 1 },
      { sourceCount: 1, fieldCount: 1, mapCellCount: 0 }
    ]) {
      expectBudgetError(() => assertBudget(input));
    }
  });

  it.each([
    ["empty routes", emptyRequest({ routes: [] })],
    ["empty movement profiles", emptyRequest({ profile: profile({}) })],
    ["zero map cells", emptyRequest({ mapCellCount: 0 })]
  ] as const)("rejects prepare input with %s using the typed solver-budget error", async (_label, input) => {
    const { prepare } = await seams();
    expectBudgetError(() => prepare(input));
  });

  it("accepts exactly 256 fields and rejects 257 with the typed solver-budget error", async () => {
    const { assertBudget } = await seams();

    expect(assertBudget({ sourceCount: 1, fieldCount: 256, mapCellCount: 1 })).toBeUndefined();
    expectBudgetError(() => assertBudget({ sourceCount: 1, fieldCount: 257, mapCellCount: 1 }));
  });

  it("accepts exactly 8,388,608 combined field cells and fails closed at the numerical next value and overflow", async () => {
    const { assertBudget } = await seams();

    expect(assertBudget({ sourceCount: 1, fieldCount: 1, mapCellCount: 4_194_304 })).toBeUndefined();
    expectBudgetError(() => assertBudget({ sourceCount: 1, fieldCount: 1, mapCellCount: 4_194_304.5 }));
    expectBudgetError(() => assertBudget({
      sourceCount: 1,
      fieldCount: 256,
      mapCellCount: Number.MAX_SAFE_INTEGER
    }));
  });

  it("prepares and rejects an over-budget group set without reading or requiring any resolver", async () => {
    const { prepare } = await seams();
    const movementProfiles = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
      `profile_${String(index).padStart(2, "0")}`,
      index % 2 === 0 ? BLOCKED : IGNORED
    ]));
    const routes = Array.from({ length: 16 }, (_, index) => pathRoute(
      `route_${String(index).padStart(2, "0")}`,
      { q: 0, r: index },
      { q: 10, r: index }
    ));
    let resolverReads = 0;
    const input = emptyRequest({
      profile: profile(movementProfiles),
      routes,
      mapCellCount: 176
    }) as PreparedSafetyRequest & { readonly baselineResolver?: unknown; readonly candidateResolver?: unknown };
    Object.defineProperties(input, {
      baselineResolver: { enumerable: false, get() { resolverReads += 1; throw new Error("NO_BASELINE_RESOLVER_READ"); } },
      candidateResolver: { enumerable: false, get() { resolverReads += 1; throw new Error("NO_CANDIDATE_RESOLVER_READ"); } }
    });

    expectBudgetError(() => prepare(input));
    expect(resolverReads).toBe(0);
  });

  it("rejects spawn provenance that references an unknown movement profile deterministically", async () => {
    const { prepare } = await seams();
    const missingProfile = provenance("wave_spawn", "missing", Z_ALIAS, "root");

    expectExactError(
      () => prepare(emptyRequest({ spawnProvenance: [missingProfile] })),
      "Dynamic terraforming safety references unknown movement profile \"missing\"."
    );
  });

  it.each([
    [
      "assignment",
      profile({ z_used: BLOCKED }, { root: "missing" })
    ],
    [
      "default",
      {
        ...profile({ z_used: BLOCKED }),
        defaultMovementProfileId: "missing"
      }
    ]
  ] as const)("rejects a live enemy whose %s resolves an unknown movement profile", async (_label, movementProfile) => {
    const { prepare } = await seams();
    const enemy = {
      id: "enemy_1",
      typeId: "root",
      hp: 10,
      routeId: "z_alias",
      navigation: { currentCoord: { q: 1, r: 0 }, edgeProgress: 0 }
    };

    expectExactError(
      () => prepare(emptyRequest({ profile: movementProfile, enemies: [enemy] })),
      "Dynamic terraforming safety references unknown movement profile \"missing\"."
    );
  });
});

function expectedEndpointGroup(
  movementProfileId: string,
  goal: GridCoord,
  routeId: string,
  routes: readonly GridPathRoute[]
): SafetyGroup {
  const sources = routes.flatMap((candidate): CanonicalSafetySource[] => [
    {
      kind: "route_source",
      movementProfileId,
      routeId: candidate.id,
      goal: { ...goal },
      coord: { ...candidate.pathCenterline[0]! },
      subjectId: ""
    },
    {
      kind: "route_goal",
      movementProfileId,
      routeId: candidate.id,
      goal: { ...goal },
      coord: { ...candidate.pathCenterline.at(-1)! },
      subjectId: ""
    }
  ]).sort(compareSources);
  return {
    key: JSON.stringify([movementProfileId, goal.q, goal.r]),
    movementProfileId,
    goal: { ...goal },
    routeId,
    sources
  };
}

const SOURCE_RANK: Readonly<Record<SafetySourceKind, number>> = Object.freeze({
  route_source: 0,
  route_goal: 1,
  wave_spawn: 2,
  death_spawn: 3,
  phase_spawn: 4,
  script_spawn: 5,
  pending_death_spawn: 6,
  live_current: 7,
  live_next: 8
});

function compareSources(left: CanonicalSafetySource, right: CanonicalSafetySource): number {
  return compareBinary(left.routeId, right.routeId)
    || SOURCE_RANK[left.kind] - SOURCE_RANK[right.kind]
    || left.coord.r - right.coord.r
    || left.coord.q - right.coord.q
    || compareBinary(left.subjectId, right.subjectId);
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
