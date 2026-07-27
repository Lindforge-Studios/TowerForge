import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { NAVIGATION_LIMITS, type MovementProfileV1 } from "../content/navigation-mechanics.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { stableDigest } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type { GridCoord, GridDefinition, GridPathRoute } from "./types.js";

type Activation = "absent" | "disabled" | "unselected" | "authored_routes" | "dynamic_flow";

interface FixtureOptions {
  readonly activation?: Activation;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly routes?: readonly GridPathRoute[];
  readonly movementProfiles?: Readonly<Record<string, MovementProfileV1>>;
  readonly defaultMovementProfileId?: string;
  readonly enemyMovementProfiles?: Readonly<Record<string, string>>;
  readonly groups?: readonly {
    readonly enemyId: "a_enemy" | "z_enemy";
    readonly routeId?: string;
  }[];
  readonly scripts?: Readonly<Record<string, TowerScriptDefinition>>;
  readonly abilities?: GameContentInput["balance"]["abilities"];
  readonly abilityIds?: readonly string[];
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

const BLOCKED: MovementProfileV1 = Object.freeze({
  label: "Blocked by towers",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000
});

const IGNORED: MovementProfileV1 = Object.freeze({
  label: "Ignores towers",
  terrainMode: "respect_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000
});

function lineRoute(grid: GridDefinition, id: string, start: GridCoord, goal: GridCoord): GridPathRoute {
  return { id, pathCenterline: createGridTopology(grid).line(start, goal) };
}

function fixture(options: FixtureOptions = {}): ReturnType<typeof createGameContentRegistry> {
  const activation = options.activation ?? "dynamic_flow";
  const grid = options.grid ?? SQUARE;
  const width = options.width ?? 5;
  const height = options.height ?? 1;
  const routes = options.routes ?? [
    lineRoute(grid, "main", { q: 0, r: 0 }, { q: width - 1, r: 0 })
  ];
  const groups = options.groups ?? [{ enemyId: "a_enemy" as const, routeId: routes[0]!.id }];
  const movementProfiles = options.movementProfiles ?? { ground: BLOCKED };
  const defaultMovementProfileId = options.defaultMovementProfileId ?? Object.keys(movementProfiles)[0]!;
  const selected = activation !== "absent" && activation !== "unselected";
  const profile = activation === "authored_routes"
    ? { mode: "authored_routes" }
    : {
        mode: "dynamic_flow",
        defaultMovementProfileId,
        movementProfiles,
        ...(options.enemyMovementProfiles === undefined
          ? {}
          : { enemyMovementProfiles: options.enemyMovementProfiles })
      };

  const input: GameContentInput = {
    balance: {
      defaultMissionId: "navigation",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 2 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: options.abilities ?? {},
      enemies: {
        a_enemy: {
          id: "a_enemy", label: "A", maxHp: 10, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        z_enemy: {
          id: "z_enemy", label: "Z", maxHp: 10, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        }
      },
      towers: {
        pebble: {
          id: "pebble",
          label: "Pebble",
          cost: { coins: 3 },
          footprintRadius: 0,
          range: 2,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        bastion: {
          id: "bastion",
          label: "Bastion",
          cost: { coins: 5 },
          footprintRadius: 1,
          range: 2,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave",
          label: "Wave",
          groups: groups.map(({ enemyId, routeId }) => ({
            enemyId,
            count: 1,
            spawnInterval: 1,
            startDelay: 0,
            ...(routeId === undefined ? {} : { routeId })
          }))
        }]
      },
      missions: {
        navigation: {
          id: "navigation",
          label: "Navigation",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "maze",
          waveSetId: "one",
          buildTowerIds: ["pebble", "bastion"],
          abilityIds: [...(options.abilityIds ?? [])],
          ...(selected ? { mechanics: { profiles: { navigation: "maze" } } } : {})
        }
      }
    },
    maps: {
      maze: {
        id: "maze",
        width,
        height,
        grid,
        defaultTerrain: "buildable",
        spawnCoord: { ...routes[0]!.pathCenterline[0]! },
        coreCoord: { ...routes[0]!.pathCenterline.at(-1)! },
        pathCenterline: routes[0]!.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes.map((route) => ({
          id: route.id,
          pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: []
      }
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          navigation: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: { maze: profile }
          }
        }
      }
    }),
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "navigation",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({ missionId: "navigation", content: fixture(options), seed: 73 });
}

function mutationFingerprint(subject: TowerDefenseGame): unknown {
  const snapshot = subject.getSnapshot();
  const checkpoint = subject.createCheckpoint();
  // Snapshots retain a few legacy optional properties with `undefined` in memory; digest the
  // JSON wire representation that players and packages actually consume.
  const wireSnapshot: unknown = JSON.parse(JSON.stringify(snapshot));
  return {
    resources: snapshot.resources,
    towers: snapshot.towers,
    events: snapshot.lastEvents,
    snapshotDigest: stableDigest(wireSnapshot),
    stateDigest: subject.getStateDigest(),
    checkpointStateDigest: stableDigest(checkpoint.state)
  };
}

function expectBlocked(
  result: ReturnType<TowerDefenseGame["canPlaceTower"]>,
  reasonKey: "reason.lastPathBlocked" | "reason.navigationUnavailable",
  movementProfileId: string,
  routeId: string
): void {
  expect(result).toMatchObject({
    ok: false,
    reasonKey,
    reasonParams: { movementProfileId, routeId }
  });
  expect(result.reasonParams).toEqual({ movementProfileId, routeId });
}

describe("R2.3 opt-in dynamic navigation placement", () => {
  it("rejects the last route before any mutation and reports the binary-first profile/route pair", () => {
    const routes = [
      lineRoute(SQUARE, "z_route", { q: 0, r: 0 }, { q: 4, r: 0 }),
      lineRoute(SQUARE, "a_route", { q: 0, r: 0 }, { q: 4, r: 0 })
    ];
    const subject = game({
      routes,
      movementProfiles: { z_ground: BLOCKED, a_ground: BLOCKED },
      defaultMovementProfileId: "z_ground",
      enemyMovementProfiles: { z_enemy: "z_ground", a_enemy: "a_ground" },
      groups: [
        { enemyId: "z_enemy", routeId: "z_route" },
        { enemyId: "a_enemy", routeId: "a_route" }
      ]
    });
    const before = mutationFingerprint(subject);

    expectBlocked(subject.canPlaceTower("pebble", { q: 2, r: 0 }), "reason.lastPathBlocked", "a_ground", "a_route");
    expect(mutationFingerprint(subject)).toEqual(before);
    expectBlocked(subject.placeTower("pebble", { q: 2, r: 0 }), "reason.lastPathBlocked", "a_ground", "a_route");
    expect(mutationFingerprint(subject)).toEqual(before);
  });

  it("allows an alternative route, then includes committed occupancy in the next check", () => {
    const subject = game({
      width: 5,
      height: 3,
      routes: [lineRoute(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })]
    });

    expect(subject.placeTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
    expect(subject.placeTower("pebble", { q: 2, r: 1 })).toEqual({ ok: true });
    expect(subject.getSnapshot().tiles.filter((tile) => tile.occupiedBy).map(({ q, r }) => ({ q, r }))).toEqual([
      { q: 2, r: 0 },
      { q: 2, r: 1 }
    ]);
    expectBlocked(subject.canPlaceTower("pebble", { q: 2, r: 2 }), "reason.lastPathBlocked", "ground", "main");
  });

  it("releases the old footprint for move preflight and keeps a rejected move atomic", () => {
    const subject = game({
      width: 5,
      height: 2,
      routes: [lineRoute(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })]
    });

    expect(subject.placeTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
    const movingId = subject.getSnapshot().towers[0]!.id;
    expect(subject.canMoveTower(movingId, { q: 2, r: 1 })).toEqual({ ok: true });
    expect(subject.moveTower(movingId, { q: 2, r: 1 })).toEqual({ ok: true });
    expect(subject.moveTower(movingId, { q: 1, r: 1 })).toEqual({ ok: true });
    expect(subject.placeTower("pebble", { q: 3, r: 0 })).toEqual({ ok: true });

    const beforeRejectedMove = mutationFingerprint(subject);
    expectBlocked(subject.canMoveTower(movingId, { q: 3, r: 1 }), "reason.lastPathBlocked", "ground", "main");
    expect(mutationFingerprint(subject)).toEqual(beforeRejectedMove);
    expectBlocked(subject.moveTower(movingId, { q: 3, r: 1 }), "reason.lastPathBlocked", "ground", "main");
    expect(mutationFingerprint(subject)).toEqual(beforeRejectedMove);

    expect(subject.moveTower(movingId, { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.getSnapshot().towers.find((tower) => tower.id === movingId)?.coord).toEqual({ q: 0, r: 1 });
  });

  it("checks a radius-one hex footprint across multiple routes and different goals", () => {
    const routes = [
      lineRoute(HEX, "z_route", { q: 0, r: 2 }, { q: 4, r: 2 }),
      lineRoute(HEX, "a_route", { q: 0, r: 0 }, { q: 4, r: 0 })
    ];
    const subject = game({
      grid: HEX,
      width: 5,
      height: 3,
      routes,
      movementProfiles: { z_ground: BLOCKED, a_ground: BLOCKED },
      defaultMovementProfileId: "z_ground",
      enemyMovementProfiles: { z_enemy: "z_ground", a_enemy: "a_ground" },
      groups: [
        { enemyId: "z_enemy", routeId: "z_route" },
        { enemyId: "a_enemy", routeId: "a_route" }
      ]
    });

    expectBlocked(subject.canPlaceTower("bastion", { q: 2, r: 1 }), "reason.lastPathBlocked", "a_ground", "a_route");
  });

  it("does not let an ignored-occupancy movement profile veto placement", () => {
    const subject = game({
      movementProfiles: { ghost: IGNORED },
      defaultMovementProfileId: "ghost",
      enemyMovementProfiles: { a_enemy: "ghost" }
    });

    expect(subject.canPlaceTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
    expect(subject.placeTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
  });

  it("includes an ignored wave root's transitive phase/death descendants in the safety set", () => {
    const content = fixture({
      routes: [lineRoute(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })],
      movementProfiles: {
        root_ignored: IGNORED,
        z_blocked: BLOCKED,
        a_blocked: BLOCKED
      },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: {
        a_enemy: "root_ignored",
        z_enemy: "z_blocked",
        m_enemy: "a_blocked"
      },
      groups: [{ enemyId: "a_enemy", routeId: "main" }]
    });
    content.enemies.m_enemy = {
      ...content.enemies.z_enemy!,
      id: "m_enemy",
      label: "M"
    };
    content.enemies.a_enemy!.phaseSpawns = [{
      hpRatio: 0.5,
      enemyId: "z_enemy",
      count: 1,
      routeIds: ["main"]
    }];
    content.enemies.z_enemy!.spawnOnDeath = {
      enemyId: "m_enemy",
      count: 1,
      forwardPathSteps: 0
    };
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expectBlocked(
      subject.canPlaceTower("pebble", { q: 2, r: 0 }),
      "reason.lastPathBlocked",
      "a_blocked",
      "main"
    );
  });

  it("requires only the phase routes that count can actually select", () => {
    const routes = [
      lineRoute(SQUARE, "z_route", { q: 0, r: 0 }, { q: 4, r: 0 }),
      lineRoute(SQUARE, "a_route", { q: 0, r: 2 }, { q: 4, r: 2 })
    ];
    const content = fixture({
      height: 3,
      routes,
      movementProfiles: { root_ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: { a_enemy: "root_ignored", z_enemy: "child_blocked" },
      groups: [{ enemyId: "a_enemy", routeId: "z_route" }]
    });
    content.enemies.a_enemy!.phaseSpawns = [{
      hpRatio: 0.5,
      enemyId: "z_enemy",
      count: 1,
      routeIds: ["z_route", "a_route"]
    }];
    content.maps.maze!.terrainOverrides = [
      { q: 4, r: 1, terrain: "blocked" }
    ];
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expect(subject.canPlaceTower("pebble", { q: 3, r: 2 })).toEqual({ ok: true });
  });

  it("includes mission TowerScript explicit/default spawns and reports the binary-first pair", () => {
    const routes = [
      lineRoute(SQUARE, "z_route", { q: 0, r: 0 }, { q: 4, r: 0 }),
      lineRoute(SQUARE, "a_route", { q: 0, r: 0 }, { q: 4, r: 0 })
    ];
    const scripts: Record<string, TowerScriptDefinition> = {
      scripted_descendants: {
        schemaVersion: 5,
        id: "scripted_descendants",
        bindings: [{ scope: "mission", ids: ["navigation"] }],
        handlers: {
          signal: [{
            actions: [
              { action: "spawnEnemy", enemyTypeId: "z_enemy", routeId: "z_route" },
              { action: "spawnEnemy", enemyTypeId: "m_enemy" }
            ]
          }]
        }
      }
    };
    const content = fixture({
      routes,
      movementProfiles: {
        root_ignored: IGNORED,
        z_blocked: BLOCKED,
        a_blocked: BLOCKED
      },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: {
        a_enemy: "root_ignored",
        z_enemy: "z_blocked",
        m_enemy: "a_blocked"
      },
      groups: [{ enemyId: "a_enemy", routeId: "z_route" }],
      scripts
    });
    content.enemies.m_enemy = {
      ...content.enemies.z_enemy!,
      id: "m_enemy",
      label: "M"
    };
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expectBlocked(
      subject.canPlaceTower("pebble", { q: 2, r: 0 }),
      "reason.lastPathBlocked",
      "a_blocked",
      "a_route"
    );
  });

  it("does not include handlers whose binding scope cannot produce a context for that event", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      impossible_ability_signal: {
        schemaVersion: 5,
        id: "impossible_ability_signal",
        bindings: [{ scope: "ability", ids: ["pulse"] }],
        handlers: {
          signal: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "z_enemy" }] }]
        }
      }
    };
    const subject = game({
      movementProfiles: { root_ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: { a_enemy: "root_ignored", z_enemy: "child_blocked" },
      abilities: {
        pulse: { id: "pulse", label: "Pulse", cooldown: 1, duration: 0, radius: 1, damage: 1 }
      },
      abilityIds: ["pulse"],
      scripts
    });

    expect(subject.emitScriptSignal("pulse")).toEqual({ ok: true });
    expect(subject.getSnapshot().enemies).toHaveLength(0);
    expect(subject.canPlaceTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
  });

  it("does not treat an on-death child event as a context for its parent enemy binding", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      kill_parent: {
        schemaVersion: 5,
        id: "kill_parent",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 100 }] }]
        }
      },
      impossible_parent_context: {
        schemaVersion: 5,
        id: "impossible_parent_context",
        bindings: [{ scope: "enemy", ids: ["a_enemy"] }],
        handlers: {
          enemySpawnedOnDeath: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "m_enemy" }] }]
        }
      }
    };
    const content = fixture({
      movementProfiles: { ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "ignored",
      enemyMovementProfiles: { a_enemy: "ignored", z_enemy: "ignored", m_enemy: "child_blocked" },
      scripts
    });
    content.enemies.m_enemy = {
      ...content.enemies.z_enemy!,
      id: "m_enemy",
      label: "M"
    };
    content.enemies.a_enemy!.spawnOnDeath = {
      enemyId: "z_enemy",
      count: 1,
      forwardPathSteps: 0
    };
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.01);
    expect(subject.getSnapshot().enemies.map(({ typeId }) => typeId)).toContain("a_enemy");
    expect(subject.emitScriptSignal("kill")).toEqual({ ok: true });
    subject.tick(0.01);
    expect(subject.getSnapshot().enemies.map(({ typeId }) => typeId)).toContain("z_enemy");
    expect(subject.getSnapshot().enemies.map(({ typeId }) => typeId)).not.toContain("m_enemy");
    expect(subject.canPlaceTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
  });

  it("includes terrain-bound spawns reachable through a runtime terrain change", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      make_wet: {
        schemaVersion: 5,
        id: "make_wet",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{
            actions: [{ action: "setTileTerrain", target: { q: 1, r: 0 }, terrainId: "water" }]
          }]
        }
      },
      spawn_from_water: {
        schemaVersion: 5,
        id: "spawn_from_water",
        bindings: [{ scope: "terrain", ids: ["water"] }],
        handlers: {
          terrainChanged: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "z_enemy" }] }]
        }
      }
    };
    const subject = game({
      movementProfiles: { root_ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: { a_enemy: "root_ignored", z_enemy: "child_blocked" },
      scripts
    });

    expect(subject.emitScriptSignal("wet")).toEqual({ ok: true });
    expect(subject.getSnapshot().enemies.map(({ typeId }) => typeId)).toContain("z_enemy");
    expectBlocked(
      subject.canPlaceTower("pebble", { q: 2, r: 0 }),
      "reason.lastPathBlocked",
      "child_blocked",
      "main"
    );
  });

  it("includes terrain-bound spawns reachable through the active path-water ability", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      spawn_from_ability_water: {
        schemaVersion: 5,
        id: "spawn_from_ability_water",
        bindings: [{ scope: "terrain", ids: ["water"] }],
        handlers: {
          terrainChanged: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "z_enemy" }] }]
        }
      }
    };
    const content = fixture({
      movementProfiles: { root_ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: { a_enemy: "root_ignored", z_enemy: "child_blocked" },
      abilities: {
        path_water: { id: "path_water", label: "Water", cooldown: 1, duration: 1, radius: 1 }
      },
      abilityIds: ["path_water"],
      scripts
    });
    content.maps.maze!.terrainOverrides = [{ q: 1, r: 0, terrain: "path" }];
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expect(subject.useAbility("path_water", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(subject.getSnapshot().enemies.map(({ typeId }) => typeId)).toContain("z_enemy");
    expectBlocked(
      subject.canPlaceTower("pebble", { q: 2, r: 0 }),
      "reason.lastPathBlocked",
      "child_blocked",
      "main"
    );
  });

  it("does not seed ability water when path terrain exists only outside authored routes", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      unreachable_ability_water: {
        schemaVersion: 5,
        id: "unreachable_ability_water",
        bindings: [{ scope: "terrain", ids: ["water"] }],
        handlers: {
          terrainChanged: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "z_enemy" }] }]
        }
      }
    };
    const routes = [
      lineRoute(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })
    ];
    const content = fixture({
      height: 3,
      routes,
      movementProfiles: { root_ignored: IGNORED, child_blocked: BLOCKED },
      defaultMovementProfileId: "root_ignored",
      enemyMovementProfiles: { a_enemy: "root_ignored", z_enemy: "child_blocked" },
      abilities: {
        path_water: { id: "path_water", label: "Water", cooldown: 1, duration: 1, radius: 1 }
      },
      abilityIds: ["path_water"],
      scripts
    });
    content.maps.maze!.terrainOverrides = [{ q: 1, r: 2, terrain: "path" }];
    const subject = new TowerDefenseGame({ missionId: "navigation", content, seed: 73 });

    expect(subject.useAbility("path_water", { q: 1, r: 2 })).toMatchObject({
      ok: false,
      reasonKey: "reason.abilityPathOnly"
    });
    expect(subject.canPlaceTower("bastion", { q: 2, r: 1 })).toEqual({ ok: true });
  });

  it("reports dynamic placement budget exhaustion without capping the legacy scan", () => {
    // GridMap reserves spawn/core; add three so at least budget+1 buildable candidates remain.
    const width = NAVIGATION_LIMITS.placementAnalysisCoordinates + 3;
    const subject = game({ width, height: 1 });
    const preflight = vi.spyOn(
      subject as unknown as {
        canPreserveDynamicNavigation(
          footprint: readonly GridCoord[],
          ignoreTowerId?: string
        ): ReturnType<TowerDefenseGame["canPlaceTower"]>;
      },
      "canPreserveDynamicNavigation"
    ).mockReturnValue({ ok: false, reasonKey: "reason.lastPathBlocked" });

    const legacy = game({ activation: "absent", width, height: 1 });
    const legacyOccupancy = vi.spyOn(
      legacy as unknown as {
        canOccupyTowerFootprint(typeId: string, coord: GridCoord): ReturnType<TowerDefenseGame["canPlaceTower"]>;
      },
      "canOccupyTowerFootprint"
    ).mockReturnValue({ ok: false, reasonKey: "reason.noFit" });

    try {
      expect(subject.canPlaceTowerAnywhere("pebble")).toMatchObject({
        ok: false,
        reasonKey: "reason.navigationAnalysisBudgetExceeded",
        reasonParams: { limit: NAVIGATION_LIMITS.placementAnalysisCoordinates }
      });
      expect(preflight.mock.calls.length).toBe(NAVIGATION_LIMITS.placementAnalysisCoordinates);

      expect(legacy.canPlaceTowerAnywhere("pebble").ok).toBe(false);
      expect(legacyOccupancy.mock.calls.length).toBe(width);
    } finally {
      preflight.mockRestore();
      legacyOccupancy.mockRestore();
    }
  });

  it("reports an already unreachable baseline separately from candidate path blocking", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      close_detour: {
        schemaVersion: 5,
        id: "close_detour",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{
            actions: [{ action: "setTileTerrain", target: { q: 2, r: 1 }, terrainId: "blocked" }]
          }]
        }
      }
    };
    const subject = game({
      width: 5,
      height: 2,
      routes: [lineRoute(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })],
      scripts
    });
    expect(subject.placeTower("pebble", { q: 2, r: 0 })).toEqual({ ok: true });
    expect(subject.emitScriptSignal("close")).toEqual({ ok: true });
    expect(subject.getSnapshot().tiles.find(({ q, r }) => q === 2 && r === 1)?.terrain).toBe("blocked");

    expectBlocked(subject.canPlaceTower("pebble", { q: 1, r: 1 }), "reason.navigationUnavailable", "ground", "main");
  });

  it("keeps absent, disabled, unselected, and authored-routes games on the exact legacy path", () => {
    const activations: Activation[] = ["absent", "disabled", "unselected", "authored_routes"];
    const results = activations.map((activation) => {
      const subject = game({ activation });
      const placement = subject.placeTower("pebble", { q: 2, r: 0 });
      const snapshot = subject.getSnapshot();
      const checkpoint = subject.createCheckpoint();
      expect(placement).toEqual({ ok: true });
      expect(Object.prototype.hasOwnProperty.call(snapshot, "navigation")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(checkpoint, "navigation")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "navigation")).toBe(false);
      return { snapshot, checkpointState: checkpoint.state };
    });

    for (const candidate of results.slice(1)) {
      expect(candidate.snapshot).toEqual(results[0]!.snapshot);
      expect(candidate.checkpointState).toEqual(results[0]!.checkpointState);
    }
  });
});
