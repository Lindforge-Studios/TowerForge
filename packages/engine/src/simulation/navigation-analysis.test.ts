import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { NAVIGATION_LIMITS } from "../content/navigation-mechanics.js";
import { JournaledGameSession } from "./journal.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type { GridCoord, GridDefinition } from "./types.js";

type Activation = "absent" | "disabled" | "unselected" | "authored_routes" | "dynamic_flow";

interface NavigationAnalysisRequestContract {
  readonly movementProfileIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly towerTypeId?: string;
  readonly coordinates?: readonly GridCoord[];
}

interface NavigationAnalysisResultContract {
  readonly schemaVersion: 1;
  readonly mode: "dynamic_flow";
  readonly profileId: string;
  readonly fields: readonly {
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly routeIds: readonly string[];
    readonly revision: string;
    readonly reachableTileCount: number;
    readonly reachableRouteIds: readonly string[];
    readonly unreachableRouteIds: readonly string[];
  }[];
  readonly placementRows: readonly {
    readonly coord: GridCoord;
    readonly ok: boolean;
    readonly reasonKey?: string;
    readonly blockingPair?: { readonly movementProfileId: string; readonly routeId: string };
  }[];
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly enemyCount?: number;
  readonly includeUnusedAnalysisAxes?: boolean;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

function input(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "dynamic_flow";
  const grid = options.grid ?? SQUARE;
  const width = options.width ?? 5;
  const height = options.height ?? 1;
  const start = { q: 0, r: Math.min(1, height - 1) };
  const goal = { q: width - 1, r: start.r };
  const path = createGridTopology(grid).line(start, goal);
  const pathRoutes = options.includeUnusedAnalysisAxes
    ? [
        { id: "main", pathCenterline: path },
        { id: "unused_route", pathCenterline: path }
      ]
    : [{ id: "main", pathCenterline: path }];
  const selected = activation !== "absent" && activation !== "unselected";
  return {
    balance: {
      defaultMissionId: "analysis",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 100, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0
        }
      },
      towers: {
        pebble: {
          id: "pebble", label: "Pebble", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave", label: "Wave",
          groups: [{
            enemyId: "walker",
            count: options.enemyCount ?? 1,
            spawnInterval: 0,
            startDelay: 0,
            routeId: "main"
          }]
        }]
      },
      missions: {
        analysis: {
          id: "analysis", label: "Analysis", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "maze", waveSetId: "one", buildTowerIds: ["pebble"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { navigation: "maze" } } } : {})
        }
      }
    },
    maps: {
      maze: {
        id: "maze", width, height, grid, defaultTerrain: "buildable",
        spawnCoord: start, coreCoord: goal,
        pathCenterline: path,
        pathRoutes,
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "analysis", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          navigation: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: {
              maze: activation === "authored_routes"
                ? { mode: "authored_routes" as const }
                : {
                    mode: "dynamic_flow" as const,
                    defaultMovementProfileId: "ground",
                    movementProfiles: {
                      ground: {
                        label: "Ground",
                        terrainMode: "respect_walkable" as const,
                        towerOccupancy: "blocked" as const,
                        defaultTerrainCost: 1_000
                      },
                      ...(options.includeUnusedAnalysisAxes ? {
                        unused: {
                          label: "Unused",
                          terrainMode: "respect_walkable" as const,
                          towerOccupancy: "blocked" as const,
                          defaultTerrainCost: 1_000
                        }
                      } : {})
                    },
                    enemyMovementProfiles: { walker: "ground" }
                  }
            }
          }
        }
      }
    })
  };
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "analysis",
    content: createGameContentRegistry(input(options)),
    seed: "navigation-analysis"
  });
}

function analysisMethod(subject: TowerDefenseGame): (
  request: NavigationAnalysisRequestContract
) => NavigationAnalysisResultContract | undefined {
  const method = (subject as unknown as {
    analyzeNavigation?: (
      value: NavigationAnalysisRequestContract
    ) => NavigationAnalysisResultContract | undefined;
  }).analyzeNavigation;
  expect(method, "R2.5 must expose TowerDefenseGame.analyzeNavigation").toBeTypeOf("function");
  return method!.bind(subject);
}

function analyzeActive(
  subject: TowerDefenseGame,
  request: NavigationAnalysisRequestContract
): NavigationAnalysisResultContract {
  const result = analysisMethod(subject)(request);
  expect(result, "dynamic_flow navigation analysis must be active").toBeDefined();
  return result!;
}

function resolverStats(subject: TowerDefenseGame): unknown {
  return (subject as unknown as { navigationResolver?: { getStats(): unknown } }).navigationResolver?.getStats();
}

describe("R2.5 pure bounded navigation analysis", () => {
  it("publishes a versioned engine descriptor without transport or renderer concerns", () => {
    expect((Engine as unknown as { NAVIGATION_ANALYSIS_SCHEMA?: unknown }).NAVIGATION_ANALYSIS_SCHEMA).toEqual({
      schemaVersion: 1,
      request: {
        explicitCoordinateSubset: true,
        maxCoordinates: NAVIGATION_LIMITS.placementAnalysisCoordinates
      },
      result: { placementOrder: "r,q", blockingPairOrder: "binary" }
    });
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("returns canonical %s fields and placement parity in r,q order", (_label, grid) => {
    const subject = game({ grid });
    const request = {
      movementProfileIds: ["ground"],
      routeIds: ["main"],
      towerTypeId: "pebble",
      coordinates: [{ q: 3, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]
    } satisfies NavigationAnalysisRequestContract;
    const before = structuredClone(request);
    const result = analyzeActive(subject, request);

    expect(result).toMatchObject({
      schemaVersion: 1,
      mode: "dynamic_flow",
      profileId: "maze",
      fields: subject.getSnapshot().navigation?.fields,
      placementRows: [
        { coord: { q: 1, r: 0 }, ok: false },
        { coord: { q: 2, r: 0 }, ok: false },
        { coord: { q: 3, r: 0 }, ok: false }
      ]
    });
    for (const row of result.placementRows) {
      const action = subject.canPlaceTower("pebble", row.coord);
      expect(row.ok).toBe(action.ok);
      expect(row.reasonKey).toBe(action.reasonKey);
      expect(row.blockingPair).toEqual({ movementProfileId: "ground", routeId: "main" });
    }
    expect(request).toEqual(before);
  });

  it("defaults to the exact active snapshot field set rather than the profile/route Cartesian product", () => {
    const subject = game({ includeUnusedAnalysisAxes: true });
    const snapshotFields = subject.getSnapshot().navigation?.fields;
    expect(snapshotFields).toEqual([
      expect.objectContaining({ movementProfileId: "ground", routeIds: ["main"] })
    ]);

    const result = analyzeActive(subject, {});
    expect(result.fields).toEqual(snapshotFields);
    expect(result.fields).toHaveLength(1);
  });

  it("uses explicit filters only to narrow the active snapshot field set", () => {
    const subject = game({ includeUnusedAnalysisAxes: true });
    const snapshotFields = subject.getSnapshot().navigation?.fields ?? [];

    expect.soft(analyzeActive(subject, { movementProfileIds: ["ground"] }).fields)
      .toEqual(snapshotFields);
    expect.soft(analyzeActive(subject, { routeIds: ["main"] }).fields)
      .toEqual(snapshotFields);
    expect.soft(analyzeActive(subject, { movementProfileIds: ["unused"] }).fields)
      .toEqual([]);
    expect.soft(analyzeActive(subject, { routeIds: ["unused_route"] }).fields)
      .toEqual([]);
  });

  it("keeps all active blocking pairs in placement safety when field filters exclude them", () => {
    const subject = game({ includeUnusedAnalysisAxes: true });
    const result = analyzeActive(subject, {
      movementProfileIds: ["unused"],
      routeIds: ["unused_route"],
      towerTypeId: "pebble",
      coordinates: [{ q: 2, r: 0 }]
    });

    expect(result.fields).toEqual([]);
    expect(result.placementRows).toEqual([{
      coord: { q: 2, r: 0 },
      ok: false,
      reasonKey: "reason.lastPathBlocked",
      blockingPair: { movementProfileId: "ground", routeId: "main" }
    }]);
    expect(subject.canPlaceTower("pebble", { q: 2, r: 0 })).toMatchObject({
      ok: false,
      reasonKey: "reason.lastPathBlocked",
      reasonParams: { movementProfileId: "ground", routeId: "main" }
    });
  });

  it("exposes analyzeNavigation as a public game query before validating request errors", () => {
    analysisMethod(game());
  });

  it.each([
    "absent",
    "disabled",
    "unselected",
    "authored_routes"
  ] as const)("does no analysis or allocation for %s capability", (activation) => {
    expect(analysisMethod(game({ activation }))({ coordinates: [] })).toBeUndefined();
  });

  it.each([
    ["unknown tower", { towerTypeId: "missing", coordinates: [{ q: 0, r: 0 }] }, /unknown.*tower|tower.*unknown/i],
    ["unknown profile", { movementProfileIds: ["missing"] }, /unknown.*profile|profile.*unknown/i],
    ["unknown route", { routeIds: ["missing"] }, /unknown.*route|route.*unknown/i],
    ["duplicate profile", { movementProfileIds: ["ground", "ground"] }, /duplicate.*profile|profile.*duplicate/i],
    ["duplicate route", { routeIds: ["main", "main"] }, /duplicate.*route|route.*duplicate/i],
    ["duplicate coordinate", { towerTypeId: "pebble", coordinates: [{ q: 0, r: 0 }, { q: 0, r: 0 }] }, /duplicate.*coordinate|coordinate.*duplicate/i],
    ["fractional coordinate", { towerTypeId: "pebble", coordinates: [{ q: 0.5, r: 0 }] }, /coordinate.*integer|integer.*coordinate/i],
    ["out-of-map coordinate", { towerTypeId: "pebble", coordinates: [{ q: 99, r: 0 }] }, /coordinate.*(?:outside|map)|(?:outside|map).*coordinate/i],
    ["coordinates without tower", { coordinates: [{ q: 0, r: 0 }] }, /coordinates.*require.*tower|tower.*required/i],
    ["tower without coordinates", { towerTypeId: "pebble" }, /tower.*require.*coordinates|coordinates.*required/i],
    ["coordinate budget", {
      towerTypeId: "pebble",
      coordinates: Array.from(
        { length: NAVIGATION_LIMITS.placementAnalysisCoordinates + 1 },
        (_, index) => ({ q: index, r: 0 })
      )
    }, /coordinate.*(?:budget|limit)|4096/i]
  ])("rejects the whole query for %s without partial output", (_label, request, errorPattern) => {
    const subject = game();
    const before = subject.getStateDigest();
    const invoke = analysisMethod(subject);
    expect(() => invoke(request)).toThrow(errorPattern);
    expect(subject.getStateDigest()).toBe(before);
  });

  it("rejects the whole query when placement relaxations exceed the request budget", () => {
    const width = 65;
    const height = 65;
    const coordinates = Array.from(
      { length: NAVIGATION_LIMITS.placementAnalysisCoordinates },
      (_, index) => ({ q: index % width, r: Math.floor(index / width) })
    );
    const subject = game({ width, height });
    const invoke = analysisMethod(subject);
    expect(() => invoke({ towerTypeId: "pebble", coordinates })).toThrow(/relaxation|budget|limit/i);
  }, 30_000);

  it("does not mutate RNG, events, snapshots, digest, journal, enemies, or resolver process stats", () => {
    const subject = game({ height: 3, enemyCount: 100 });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    subject.tick(0.2);
    const session = new JournaledGameSession(subject);
    const snapshotBefore = subject.getSnapshot();
    const checkpointBefore = subject.createCheckpoint();
    const digestBefore = subject.getStateDigest();
    const journalBefore = session.exportJournal();
    const statsBefore = resolverStats(subject);
    const request = { towerTypeId: "pebble", coordinates: [{ q: 2, r: 0 }, { q: 2, r: 2 }] };

    const result = analyzeActive(subject, request);
    expect(result.fields).toHaveLength(1);
    expect(result).not.toHaveProperty("enemyAnalyses");
    expect(resolverStats(subject)).toEqual(statsBefore);
    expect(subject.getSnapshot()).toEqual(snapshotBefore);
    expect(subject.createCheckpoint()).toEqual(checkpointBefore);
    expect(subject.getStateDigest()).toBe(digestBefore);
    expect(session.exportJournal()).toEqual(journalBefore);
  });

  it("is invariant to filter and coordinate input order", () => {
    const first = analyzeActive(game({ grid: HEX, height: 3 }), {
      movementProfileIds: ["ground"],
      routeIds: ["main"],
      towerTypeId: "pebble",
      coordinates: [{ q: 2, r: 2 }, { q: 2, r: 0 }, { q: 1, r: 1 }]
    });
    const second = analyzeActive(game({ grid: HEX, height: 3 }), {
      routeIds: ["main"],
      movementProfileIds: ["ground"],
      towerTypeId: "pebble",
      coordinates: [{ q: 1, r: 1 }, { q: 2, r: 0 }, { q: 2, r: 2 }]
    });
    expect(second).toEqual(first);
  });
});
