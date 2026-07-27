import { describe, expect, it } from "vitest";
import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { GridCoord, GridPathRoute } from "./types.js";

type SpawnSourceKind = "wave_spawn" | "death_spawn" | "phase_spawn" | "script_spawn";

interface SpawnProvenance {
  readonly kind: SpawnSourceKind;
  readonly movementProfileId: string;
  readonly routeId: string;
  readonly goal: GridCoord;
  readonly coord: GridCoord;
  readonly subjectId: string;
}

interface SpawnFieldRef {
  readonly movementProfileId: string;
  readonly goal: GridCoord;
}

interface SpawnObligation {
  readonly key: string;
  readonly parent: SpawnFieldRef;
  readonly child: SpawnFieldRef;
  readonly observations: readonly {
    readonly kind: Extract<SpawnSourceKind, "death_spawn" | "phase_spawn">;
    readonly parentEnemyTypeId: string;
    readonly childEnemyTypeId: string;
  }[];
}

interface SpawnGraphResult {
  readonly spawnProvenance: readonly SpawnProvenance[];
  readonly spawnObligations: readonly SpawnObligation[];
}

interface SpawnGraphRequest {
  readonly profile: DynamicFlowNavigationProfileV1;
  readonly routes: readonly GridPathRoute[];
  readonly waves: readonly {
    readonly groups: readonly { readonly enemyId: string; readonly routeId?: string }[];
  }[];
  readonly enemyTypes: Readonly<Record<string, {
    readonly spawnOnDeath?: { readonly enemyId: string; readonly count: number };
    readonly phaseSpawns?: readonly {
      readonly enemyId: string;
      readonly count: number;
      readonly routeIds?: readonly string[];
    }[];
  }>>;
  readonly scripts: Readonly<Record<string, {
    readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
    readonly id: string;
    readonly enabled?: boolean;
    readonly bindings: readonly {
      readonly scope: string;
      readonly ids?: readonly string[];
    }[];
    readonly handlers: Readonly<Record<string, readonly {
      readonly actions: readonly Record<string, unknown>[];
    }[]>>;
  }>>;
  readonly mission: {
    readonly id: string;
    readonly mapId: string;
    readonly waveSetId: string;
    readonly buildTowerIds: readonly string[];
    readonly abilityIds: readonly string[];
  };
  readonly initialReachableTerrainIds: readonly string[];
  readonly terraformTransitionTerrainById: Readonly<Record<string, string>>;
}

type SpawnCollector = (
  request: SpawnGraphRequest
) => readonly SpawnProvenance[] | SpawnGraphResult;

const MODULE_PATH = "./terraforming-navigation.js";

async function collect(request: SpawnGraphRequest): Promise<readonly SpawnProvenance[]> {
  const module = await import(MODULE_PATH) as unknown as {
    collectDynamicTerraformingSpawnProvenance?: SpawnCollector;
  };
  expect(
    module.collectDynamicTerraformingSpawnProvenance,
    "terraforming-navigation must expose its internal canonical spawn-provenance collector"
  ).toBeTypeOf("function");
  const result = module.collectDynamicTerraformingSpawnProvenance!(request);
  return Array.isArray(result)
    ? result
    : (result as SpawnGraphResult).spawnProvenance;
}

async function collectGraph(request: SpawnGraphRequest): Promise<SpawnGraphResult> {
  const module = await import(MODULE_PATH) as unknown as Record<string, unknown>;
  expect(module.collectDynamicTerraformingSpawnProvenance).toBeTypeOf("function");
  return (module.collectDynamicTerraformingSpawnProvenance as (
    input: SpawnGraphRequest
  ) => SpawnGraphResult)(request);
}

const BLOCKED = Object.freeze({
  label: "Blocked occupancy",
  terrainMode: "respect_walkable" as const,
  towerOccupancy: "blocked" as const,
  defaultTerrainCost: 1_000
});
const IGNORED = Object.freeze({
  label: "Ignored occupancy",
  terrainMode: "respect_walkable" as const,
  towerOccupancy: "ignored" as const,
  defaultTerrainCost: 1_000
});
const MAIN: GridPathRoute = {
  id: "main",
  pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }]
};
const SIDE: GridPathRoute = {
  id: "side",
  pathCenterline: [{ q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }]
};

function profile(assignments: Readonly<Record<string, string>> = {}): DynamicFlowNavigationProfileV1 {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: "blocked",
    movementProfiles: { blocked: BLOCKED, ignored: IGNORED },
    enemyMovementProfiles: assignments
  };
}

function request(overrides: Partial<SpawnGraphRequest> = {}): SpawnGraphRequest {
  return {
    profile: profile(),
    routes: [MAIN, SIDE],
    waves: [],
    enemyTypes: {},
    scripts: {},
    mission: {
      id: "mission",
      mapId: "map",
      waveSetId: "waves",
      buildTowerIds: [],
      abilityIds: []
    },
    initialReachableTerrainIds: ["floor"],
    terraformTransitionTerrainById: {},
    ...overrides
  };
}

function source(
  kind: SpawnSourceKind,
  movementProfileId: string,
  routeId: "main" | "side",
  subjectId: string
): SpawnProvenance {
  const selected = routeId === "main" ? MAIN : SIDE;
  return {
    kind,
    movementProfileId,
    routeId,
    goal: { ...selected.pathCenterline.at(-1)! },
    coord: { ...selected.pathCenterline[0]! },
    subjectId
  };
}

function script(
  id: string,
  bindings: SpawnGraphRequest["scripts"][string]["bindings"],
  actions: readonly Record<string, unknown>[],
  options: {
    readonly enabled?: boolean;
    readonly event?: string;
    readonly schemaVersion?: 1 | 2 | 3 | 4 | 5 | 6;
  } = {}
): SpawnGraphRequest["scripts"][string] {
  return {
    schemaVersion: options.schemaVersion ?? 6,
    id,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    bindings,
    handlers: { [options.event ?? "signal"]: [{ actions }] }
  };
}

function spawnEnemy(enemyTypeId: string, routeId?: string): Record<string, unknown> {
  return {
    action: "spawnEnemy",
    enemyTypeId,
    ...(routeId === undefined ? {} : { routeId })
  };
}

describe("R3.4b C2B1 canonical dynamic terraforming spawn provenance", () => {
  it("accepts the exact provenance cap and fails before reading a later script once the cap is exceeded", async () => {
    const bulkScripts = (count: number): Record<string, SpawnGraphRequest["scripts"][string]> => (
      Object.fromEntries(Array.from({ length: count }, (_, index) => {
        const id = `a_script_${String(index).padStart(5, "0")}`;
        return [id, script(id, [{ scope: "global" }], [spawnEnemy("child", "main")])];
      }))
    );
    const base = request({
      profile: profile({ root: "blocked", child: "ignored" }),
      waves: [{ groups: [{ enemyId: "root", routeId: "main" }] }],
      enemyTypes: { root: {}, child: {} }
    });

    const accepted = await collectGraph({ ...base, scripts: bulkScripts(16_383) });
    expect(accepted.spawnProvenance).toHaveLength(16_384);
    expect(accepted.spawnObligations).toEqual([]);

    let sentinelReads = 0;
    const overBudgetScripts = bulkScripts(16_384);
    Object.defineProperty(overBudgetScripts, "zz_sentinel", {
      enumerable: true,
      get(): never {
        sentinelReads += 1;
        throw new Error("PROVENANCE_SENTINEL_READ");
      }
    });
    await expect(collectGraph({ ...base, scripts: overBudgetScripts })).rejects.toMatchObject({
      name: "DynamicTerraformingSafetyBudgetError",
      code: "budget_exceeded",
      reasonKey: "terraform.solver_budget_exceeded",
      message: "Terraforming navigation solver budget exceeded."
    });
    expect(sentinelReads).toBe(0);
  });

  it("caps authored spawn-relation causes even when every row canonicalizes to one observation", async () => {
    type PhaseSpawn = NonNullable<
      SpawnGraphRequest["enemyTypes"][string]["phaseSpawns"]
    >[number];
    const phaseRows = (count: number): PhaseSpawn[] => Array.from({ length: count }, () => ({
      enemyId: "child",
      count: 1,
      routeIds: ["main"]
    }));
    const withPhaseRows = (rows: readonly PhaseSpawn[]): SpawnGraphRequest => request({
      profile: profile({ root: "blocked", child: "ignored" }),
      waves: [{ groups: [{ enemyId: "root", routeId: "main" }] }],
      enemyTypes: {
        root: { phaseSpawns: rows },
        child: {}
      }
    });

    const accepted = await collectGraph(withPhaseRows(phaseRows(16_384)));
    expect(accepted.spawnProvenance).toHaveLength(2);
    expect(accepted.spawnObligations).toHaveLength(1);
    expect(accepted.spawnObligations[0]!.observations).toHaveLength(1);

    let sentinelReads = 0;
    const overBoundaryRows = phaseRows(16_384);
    Object.defineProperty(overBoundaryRows, 16_384, {
      enumerable: true,
      get(): never {
        sentinelReads += 1;
        throw new Error("PHASE_SENTINEL_READ");
      }
    });
    await expect(collectGraph(withPhaseRows(overBoundaryRows))).rejects.toMatchObject({
      name: "DynamicTerraformingSafetyBudgetError",
      code: "budget_exceeded",
      reasonKey: "terraform.solver_budget_exceeded",
      message: "Terraforming navigation solver budget exceeded."
    });
    expect(sentinelReads).toBe(0);
  });

  it("returns canonical type-aware field obligations for inherited death, explicit phase, and a bounded cycle", async () => {
    const base = request({
      profile: profile({ root: "blocked", death_child: "ignored", phase_child: "ignored" }),
      waves: [{ groups: [{ enemyId: "root", routeId: "main" }] }],
      enemyTypes: {
        root: {
          spawnOnDeath: { enemyId: "death_child", count: 1 },
          phaseSpawns: [{ enemyId: "phase_child", count: 1, routeIds: ["side"] }]
        },
        death_child: { spawnOnDeath: { enemyId: "root", count: 1 } },
        phase_child: {}
      }
    });
    const permuted: SpawnGraphRequest = {
      ...base,
      routes: [...base.routes].reverse(),
      profile: {
        ...base.profile,
        movementProfiles: Object.fromEntries(Object.entries(base.profile.movementProfiles).reverse()),
        enemyMovementProfiles: Object.fromEntries(Object.entries(base.profile.enemyMovementProfiles ?? {}).reverse())
      },
      enemyTypes: Object.fromEntries(Object.entries(base.enemyTypes).reverse())
    };

    const canonical = (await collectGraph(base)).spawnObligations;
    expect((await collectGraph(permuted)).spawnObligations).toEqual(canonical);
    expect(canonical).toHaveLength(3);
    expect(canonical).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parent: { movementProfileId: "blocked", goal: { q: 4, r: 0 } },
        child: { movementProfileId: "ignored", goal: { q: 4, r: 0 } },
        observations: [{
          kind: "death_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "death_child"
        }]
      }),
      expect.objectContaining({
        parent: { movementProfileId: "blocked", goal: { q: 4, r: 0 } },
        child: { movementProfileId: "ignored", goal: { q: 4, r: 1 } },
        observations: [{
          kind: "phase_spawn", parentEnemyTypeId: "root", childEnemyTypeId: "phase_child"
        }]
      }),
      expect.objectContaining({
        parent: { movementProfileId: "ignored", goal: { q: 4, r: 0 } },
        child: { movementProfileId: "blocked", goal: { q: 4, r: 0 } },
        observations: [{
          kind: "death_spawn", parentEnemyTypeId: "death_child", childEnemyTypeId: "root"
        }]
      })
    ]));
  });

  it("retains deduplicated wave provenance for an ignored-occupancy movement profile", async () => {
    const result = await collect(request({
      profile: profile({ root: "ignored" }),
      waves: [{ groups: [
        { enemyId: "root", routeId: "main" },
        { enemyId: "root", routeId: "main" }
      ] }],
      enemyTypes: { root: {} }
    }));

    expect(result).toEqual([source("wave_spawn", "ignored", "main", "root")]);
  });

  it("emits transitive death and inherited plus explicit phase provenance", async () => {
    const result = await collect(request({
      profile: profile({
        root: "blocked",
        death_child: "ignored",
        death_grandchild: "ignored",
        phase_inherited: "blocked",
        phase_explicit: "ignored"
      }),
      waves: [{ groups: [{ enemyId: "root", routeId: "main" }] }],
      enemyTypes: {
        root: {
          spawnOnDeath: { enemyId: "death_child", count: 1 },
          phaseSpawns: [
            { enemyId: "phase_inherited", count: 1 },
            { enemyId: "phase_explicit", count: 2, routeIds: ["side", "main"] }
          ]
        },
        death_child: { spawnOnDeath: { enemyId: "death_grandchild", count: 1 } },
        death_grandchild: {},
        phase_inherited: {},
        phase_explicit: {}
      }
    }));

    expect(result.filter((entry) => entry.kind !== "wave_spawn")).toEqual([
      source("phase_spawn", "blocked", "main", "phase_inherited"),
      source("death_spawn", "ignored", "main", "death_child"),
      source("death_spawn", "ignored", "main", "death_grandchild"),
      source("phase_spawn", "ignored", "main", "phase_explicit"),
      source("phase_spawn", "ignored", "side", "phase_explicit")
    ]);
  });

  it("includes every enabled mission-reachable TowerScript spawn scope with script provenance", async () => {
    const childTypes = {
      global_child: {}, mission_child: {}, map_child: {}, wave_child: {}
    };
    const result = await collect(request({
      profile: profile(Object.fromEntries(Object.keys(childTypes).map((id) => [id, "ignored"]))),
      enemyTypes: childTypes,
      scripts: {
        z_global: script("z_global", [{ scope: "global" }], [spawnEnemy("global_child", "side")]),
        a_mission: script("a_mission", [{ scope: "mission", ids: ["mission"] }], [spawnEnemy("mission_child", "main")]),
        b_map: script("b_map", [{ scope: "map", ids: ["map"] }], [spawnEnemy("map_child", "main")]),
        c_wave: script("c_wave", [{ scope: "wave", ids: ["waves"] }], [spawnEnemy("wave_child", "main")])
      }
    }));

    expect(result).toEqual([
      source("script_spawn", "ignored", "main", "a_mission"),
      source("script_spawn", "ignored", "main", "b_map"),
      source("script_spawn", "ignored", "main", "c_wave"),
      source("script_spawn", "ignored", "side", "z_global")
    ]);
  });

  it("includes a reachable TowerScript v5 spawn while retaining disabled and unreachable parity", async () => {
    const result = await collect(request({
      profile: profile({ child: "ignored" }),
      enemyTypes: { child: {} },
      scripts: {
        reachable_v5: script(
          "reachable_v5",
          [{ scope: "global" }],
          [spawnEnemy("child", "side")],
          { schemaVersion: 5 }
        ),
        disabled_v5: script(
          "disabled_v5",
          [{ scope: "global" }],
          [spawnEnemy("child", "main")],
          { enabled: false, schemaVersion: 5 }
        ),
        unreachable_v5: script(
          "unreachable_v5",
          [{ scope: "terrain", ids: ["lava"] }],
          [spawnEnemy("child", "main")],
          { event: "terrainChanged", schemaVersion: 5 }
        )
      }
    }));

    expect(result).toEqual([
      source("script_spawn", "ignored", "side", "reachable_v5")
    ]);
  });

  it("rejects an empty route set with one exact deterministic error", async () => {
    let caught: unknown;
    try {
      await collect(request({ routes: [] }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "Dynamic terraforming reachability requires at least one route."
    );
  });

  it("excludes disabled scripts and handlers whose mission or terrain binding is unreachable", async () => {
    const result = await collect(request({
      profile: profile({ child: "ignored" }),
      enemyTypes: { child: {} },
      scripts: {
        disabled: script("disabled", [{ scope: "global" }], [spawnEnemy("child")], { enabled: false }),
        wrong_mission: script("wrong_mission", [{ scope: "mission", ids: ["elsewhere"] }], [spawnEnemy("child")]),
        unreachable_terrain: script(
          "unreachable_terrain",
          [{ scope: "terrain", ids: ["lava"] }],
          [spawnEnemy("child")],
          { event: "terrainChanged" }
        )
      }
    }));

    expect(result).toEqual([]);
  });

  it("expands terrain reachability through setTileTerrain only from an already reachable handler", async () => {
    const scripts = {
      a_floor_to_water: script(
        "a_floor_to_water",
        [{ scope: "terrain", ids: ["floor"] }],
        [{ action: "setTileTerrain", target: { q: 1, r: 0 }, terrainId: "water" }],
        { event: "terrainChanged" }
      ),
      b_water_spawn: script(
        "b_water_spawn",
        [{ scope: "terrain", ids: ["water"] }],
        [spawnEnemy("child", "side")],
        { event: "terrainChanged" }
      ),
      c_lava_to_secret: script(
        "c_lava_to_secret",
        [{ scope: "terrain", ids: ["lava"] }],
        [{ action: "setTileTerrain", target: { q: 1, r: 0 }, terrainId: "secret" }],
        { event: "terrainChanged" }
      ),
      d_secret_spawn: script(
        "d_secret_spawn",
        [{ scope: "terrain", ids: ["secret"] }],
        [spawnEnemy("child")],
        { event: "terrainChanged" }
      )
    };
    const base = request({
      profile: profile({ child: "ignored" }),
      enemyTypes: { child: {} },
      scripts
    });

    expect(await collect(base)).toEqual([
      source("script_spawn", "ignored", "side", "b_water_spawn")
    ]);
    expect(await collect({ ...base, initialReachableTerrainIds: ["stone"] })).toEqual([]);
  });

  it("expands terrain reachability through an active terraform transition only from a reachable handler", async () => {
    const scripts = {
      a_reachable_flood: script(
        "a_reachable_flood",
        [{ scope: "global" }],
        [terraformTiles("flood")]
      ),
      b_water_spawn: script(
        "b_water_spawn",
        [{ scope: "terrain", ids: ["water"] }],
        [spawnEnemy("child", "side")],
        { event: "terrainChanged" }
      )
    };
    const base = request({
      profile: profile({ child: "ignored" }),
      enemyTypes: { child: {} },
      scripts,
      terraformTransitionTerrainById: { flood: "water" }
    });

    expect(await collect(base)).toEqual([
      source("script_spawn", "ignored", "side", "b_water_spawn")
    ]);
    expect(await collect({
      ...base,
      scripts: {
        ...scripts,
        a_reachable_flood: script(
          "a_reachable_flood",
          [{ scope: "terrain", ids: ["lava"] }],
          [terraformTiles("flood")],
          { event: "terrainChanged" }
        )
      }
    })).toEqual([]);
  });

  it("is canonical under route, wave, phase, script, and object-key permutations", async () => {
    const baseline = request({
      profile: profile({ root: "ignored", child: "blocked", scripted: "ignored" }),
      waves: [{ groups: [{ enemyId: "root", routeId: "side" }, { enemyId: "child", routeId: "main" }] }],
      enemyTypes: {
        root: { phaseSpawns: [{ enemyId: "child", count: 2, routeIds: ["side", "main"] }] },
        child: {},
        scripted: {}
      },
      scripts: {
        z_script: script("z_script", [{ scope: "global" }], [spawnEnemy("scripted", "side")]),
        a_script: script("a_script", [{ scope: "global" }], [spawnEnemy("scripted", "main")])
      }
    });
    const permuted: SpawnGraphRequest = {
      ...baseline,
      routes: [...baseline.routes].reverse(),
      waves: baseline.waves.map((wave) => ({ groups: [...wave.groups].reverse() })).reverse(),
      profile: {
        ...baseline.profile,
        movementProfiles: Object.fromEntries(Object.entries(baseline.profile.movementProfiles).reverse()),
        enemyMovementProfiles: Object.fromEntries(Object.entries(baseline.profile.enemyMovementProfiles ?? {}).reverse())
      },
      enemyTypes: Object.fromEntries(Object.entries(baseline.enemyTypes).reverse().map(([id, definition]) => [
        id,
        definition.phaseSpawns === undefined
          ? definition
          : { ...definition, phaseSpawns: [...definition.phaseSpawns].reverse() }
      ])),
      scripts: Object.fromEntries(Object.entries(baseline.scripts).reverse())
    };

    const canonical = await collect(baseline);
    expect(await collect(permuted)).toEqual(canonical);
    expect(canonical).toEqual([...canonical].sort(compareProvenance));
  });
});

function terraformTiles(transitionId: string): Record<string, unknown> {
  return {
    action: "terraformTiles",
    operations: [{ kind: "set_terrain", target: { q: 1, r: 0 }, transitionId }]
  };
}

const KIND_RANK: Readonly<Record<SpawnSourceKind, number>> = Object.freeze({
  wave_spawn: 0,
  death_spawn: 1,
  phase_spawn: 2,
  script_spawn: 3
});

function compareProvenance(left: SpawnProvenance, right: SpawnProvenance): number {
  return compareBinary(left.movementProfileId, right.movementProfileId)
    || left.goal.r - right.goal.r
    || left.goal.q - right.goal.q
    || compareBinary(left.routeId, right.routeId)
    || KIND_RANK[left.kind] - KIND_RANK[right.kind]
    || left.coord.r - right.coord.r
    || left.coord.q - right.coord.q
    || compareBinary(left.subjectId, right.subjectId);
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
