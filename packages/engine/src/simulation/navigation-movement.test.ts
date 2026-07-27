import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { MovementProfileV1 } from "../content/navigation-mechanics.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type {
  EnemyState,
  EnemyType,
  GameSnapshot,
  GridCoord,
  GridDefinition,
  GridPathRoute,
  TerrainTypeDefinition,
  TowerTargetMode
} from "./types.js";

type Activation = "absent" | "disabled" | "unselected" | "authored_routes" | "dynamic_flow";

interface EnemyNavigationStateV1Contract {
  readonly schemaVersion: 1;
  readonly movementProfileId: string;
  readonly currentCoord: GridCoord;
  readonly nextCoord?: GridCoord;
  readonly edgeProgress: number;
  readonly stepsEntered: number;
}

interface NavigationSnapshotV1Contract {
  readonly schemaVersion: 1;
  readonly mode: "dynamic_flow";
  readonly fields: readonly {
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly routeIds: readonly string[];
    readonly revision: string;
    readonly reachableTileCount: number;
    readonly reachableRouteIds: readonly string[];
    readonly unreachableRouteIds: readonly string[];
  }[];
  readonly stalledEnemyIds: readonly string[];
}

interface GroupFixture {
  readonly enemyId: string;
  readonly count?: number;
  readonly routeId?: string;
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly routes?: readonly GridPathRoute[];
  readonly mapSpawnCoord?: GridCoord;
  readonly mapCoreCoord?: GridCoord;
  readonly movementProfiles?: Readonly<Record<string, MovementProfileV1>>;
  readonly defaultMovementProfileId?: string;
  readonly enemyMovementProfiles?: Readonly<Record<string, string>>;
  readonly groups?: readonly GroupFixture[];
  readonly enemies?: Readonly<Record<string, EnemyType>>;
  readonly terrainTypes?: Readonly<Record<string, Partial<TerrainTypeDefinition>>>;
  readonly terrainOverrides?: readonly { q: number; r: number; terrain: string }[];
  readonly scripts?: Readonly<Record<string, TowerScriptDefinition>>;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

const GROUND: MovementProfileV1 = Object.freeze({
  label: "Ground",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000,
  terrainCosts: { mud: 2_000, void: null }
});

const IGNORED: MovementProfileV1 = Object.freeze({
  label: "Ignored occupancy",
  terrainMode: "respect_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000,
  terrainCosts: { mud: 2_000, void: null }
});

const AIR: MovementProfileV1 = Object.freeze({
  label: "Air",
  terrainMode: "ignore_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000
});

const TERRAIN_TYPES: Readonly<Record<string, Partial<TerrainTypeDefinition>>> = Object.freeze({
  floor: Object.freeze({ id: "floor", label: "Floor", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: [] }),
  mud: Object.freeze({ id: "mud", label: "Mud", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: [] }),
  void: Object.freeze({ id: "void", label: "Void", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: [] }),
  rock: Object.freeze({ id: "rock", label: "Rock", buildable: false, walkable: false, groundSpeedMultiplier: 0, tags: [] })
});

function enemy(id: string, options: Partial<EnemyType> = {}): EnemyType {
  return {
    id,
    label: id,
    maxHp: 20,
    speed: 1,
    reward: { coins: 3 },
    coinReward: 3,
    coreDamage: 2,
    color: 1,
    ...options
  };
}

function route(
  grid: GridDefinition,
  id: string,
  start: GridCoord,
  goal: GridCoord
): GridPathRoute {
  return { id, pathCenterline: createGridTopology(grid).line(start, goal) };
}

function content(options: FixtureOptions = {}): ReturnType<typeof createGameContentRegistry> {
  const activation = options.activation ?? "dynamic_flow";
  const grid = options.grid ?? SQUARE;
  const width = options.width ?? 5;
  const height = options.height ?? 3;
  const routes = options.routes ?? [route(grid, "main", { q: 0, r: 1 }, { q: width - 1, r: 1 })];
  const movementProfiles = options.movementProfiles ?? { ground: GROUND };
  const defaultMovementProfileId = options.defaultMovementProfileId ?? Object.keys(movementProfiles)[0]!;
  const enemies = options.enemies ?? { walker: enemy("walker") };
  const groups = options.groups ?? [{ enemyId: Object.keys(enemies)[0]!, routeId: routes[0]!.id }];
  const selected = activation !== "absent" && activation !== "unselected";
  const navigationProfile = activation === "authored_routes"
    ? { mode: "authored_routes" as const }
    : {
        mode: "dynamic_flow" as const,
        defaultMovementProfileId,
        movementProfiles,
        ...(options.enemyMovementProfiles === undefined
          ? {}
          : { enemyMovementProfiles: options.enemyMovementProfiles })
      };

  const input: GameContentInput = {
    balance: {
      defaultMissionId: "movement",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 30,
        startingCoins: 1_000,
        startingResources: { coins: 1_000 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: options.terrainTypes ?? TERRAIN_TYPES,
      abilities: {},
      enemies: { ...enemies },
      towers: {
        probe: {
          id: "probe",
          label: "Probe",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 99,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave",
          label: "Wave",
          groups: groups.map((group) => ({
            enemyId: group.enemyId,
            count: group.count ?? 1,
            spawnInterval: 0,
            startDelay: 0,
            ...(group.routeId === undefined ? {} : { routeId: group.routeId })
          }))
        }]
      },
      missions: {
        movement: {
          id: "movement",
          label: "Movement",
          description: "",
          startingCoreHp: 30,
          startingResources: { coins: 1_000 },
          prepTimeUnits: 0,
          mapId: "maze",
          waveSetId: "one",
          buildTowerIds: ["probe"],
          abilityIds: [],
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
        defaultTerrain: "floor",
        spawnCoord: { ...(options.mapSpawnCoord ?? routes[0]!.pathCenterline[0]!) },
        coreCoord: { ...(options.mapCoreCoord ?? routes[0]!.pathCenterline.at(-1)!) },
        pathCenterline: routes[0]!.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes.map((candidate) => ({
          id: candidate.id,
          pathCenterline: candidate.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: (options.terrainOverrides ?? []).map((entry) => ({ ...entry }))
      }
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          navigation: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: { maze: navigationProfile }
          }
        }
      }
    }),
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "movement", regionId: "region", x: 5, y: 5, difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({ missionId: "movement", content: content(options), seed: 41 });
}

function spawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.getSnapshot().enemies.length).toBeGreaterThan(0);
}

function navigationOf(enemyState: EnemyState): EnemyNavigationStateV1Contract {
  expect(Object.prototype.hasOwnProperty.call(enemyState, "navigation"), "active dynamic enemy navigation state")
    .toBe(true);
  return (enemyState as EnemyState & { navigation: EnemyNavigationStateV1Contract }).navigation;
}

function snapshotNavigation(snapshot: GameSnapshot): NavigationSnapshotV1Contract {
  expect(Object.prototype.hasOwnProperty.call(snapshot, "navigation"), "active dynamic navigation snapshot")
    .toBe(true);
  return (snapshot as GameSnapshot & { navigation: NavigationSnapshotV1Contract }).navigation;
}

function enteredEvents(subject: TowerDefenseGame) {
  return subject.getSnapshot().lastEvents.filter((event) => event.type === "enemyEnteredTile");
}

function tickMany(subject: TowerDefenseGame, count: number, delta = 0.2): void {
  for (let index = 0; index < count; index += 1) subject.tick(delta);
}

describe("R2.4a live dynamic movement", () => {
  it("spawns square and hex enemies with explicit/default route/profile state, including direct-flying override", () => {
    for (const grid of [SQUARE, HEX]) {
      const routes = [
        route(grid, "z_route", { q: 0, r: 2 }, { q: 4, r: 1 }),
        route(grid, "a_route", { q: 0, r: 0 }, { q: 4, r: 1 })
      ];
      const subject = game({
        grid,
        routes,
        movementProfiles: { ground: GROUND, burrow: IGNORED, air: AIR },
        defaultMovementProfileId: "ground",
        enemyMovementProfiles: { explicit: "burrow", flyer: "air" },
        enemies: {
          defaulted: enemy("defaulted"),
          explicit: enemy("explicit"),
          flyer: enemy("flyer", { movementKind: "direct_flying", targetClass: "flying" })
        },
        groups: [
          { enemyId: "defaulted" },
          { enemyId: "explicit", routeId: "z_route" },
          { enemyId: "flyer", routeId: "z_route" }
        ]
      });
      spawn(subject);
      const byType = new Map(subject.getSnapshot().enemies.map((item) => [item.typeId, item]));

      for (const [typeId, routeId, profileId] of [
        ["defaulted", "a_route", "ground"],
        ["explicit", "z_route", "burrow"],
        ["flyer", "z_route", "air"]
      ] as const) {
        const state = byType.get(typeId)!;
        const navigation = navigationOf(state);
        expect(state.routeId).toBe(routeId);
        expect(navigation).toMatchObject({
          schemaVersion: 1,
          movementProfileId: profileId,
          currentCoord: routes.find((candidate) => candidate.id === routeId)!.pathCenterline[0],
          edgeProgress: 0,
          stepsEntered: 0
        });
        expect(navigation.nextCoord).toBeDefined();
        expect(state.pathProgress).toBe(0);
      }
    }
  });

  it("uses the canonical equal-cost next link on both topologies regardless of input order", () => {
    for (const grid of [SQUARE, HEX]) {
      const routes = [
        route(grid, "main", { q: 0, r: 1 }, { q: 2, r: 1 }),
        route(grid, "alias", { q: 0, r: 1 }, { q: 2, r: 1 })
      ];
      const build = (reverse: boolean) => game({
        grid,
        width: 3,
        height: 3,
        routes: reverse ? [...routes].reverse() : routes,
        movementProfiles: reverse ? { spare: AIR, ground: GROUND } : { ground: GROUND, spare: AIR },
        defaultMovementProfileId: "ground",
        enemyMovementProfiles: { walker: "ground" },
        terrainTypes: reverse ? Object.fromEntries(Object.entries(TERRAIN_TYPES).reverse()) : TERRAIN_TYPES,
        terrainOverrides: [{ q: 1, r: 1, terrain: "rock" }],
        groups: [{ enemyId: "walker", routeId: "main" }]
      });
      const baseline = build(false);
      const permuted = build(true);
      spawn(baseline);
      spawn(permuted);
      const left = navigationOf(baseline.getSnapshot().enemies[0]!);
      const right = navigationOf(permuted.getSnapshot().enemies[0]!);
      const expected = grid.kind === "square" ? { q: 0, r: 0 } : { q: 1, r: 0 };

      expect(left.nextCoord).toEqual(expected);
      expect(right).toEqual(left);
    }
  });

  it("uses entered-tile cost for time, mirrors pathProgress, crosses multiple edges, and emits boundaries only once", () => {
    const slow = game({
      width: 6,
      height: 1,
      routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 5, r: 0 })],
      terrainOverrides: [{ q: 1, r: 0, terrain: "mud" }]
    });
    spawn(slow);
    tickMany(slow, 4);
    let state = slow.getSnapshot().enemies[0]!;
    let navigation = navigationOf(state);
    expect(navigation.edgeProgress).toBeCloseTo(0.4, 8);
    expect(slow.enemyCoord(state)).toEqual({ q: 0, r: 0 });
    slow.tick(0.2);
    state = slow.getSnapshot().enemies[0]!;
    navigation = navigationOf(state);
    expect(navigation.edgeProgress).toBeCloseTo(0.5, 8);
    expect(state.pathProgress).toBeCloseTo(0.5, 8);
    expect(slow.enemyCoord(state)).toEqual({ q: 1, r: 0 });
    expect(enteredEvents(slow)).toEqual([]);

    const boundaryEvents = [];
    for (let index = 0; index < 5; index += 1) {
      slow.tick(0.2);
      boundaryEvents.push(...enteredEvents(slow));
    }
    state = slow.getSnapshot().enemies[0]!;
    navigation = navigationOf(state);
    expect(navigation).toMatchObject({ currentCoord: { q: 1, r: 0 }, stepsEntered: 1, edgeProgress: 0 });
    expect(state.pathProgress).toBe(1);
    expect(boundaryEvents).toEqual([
      expect.objectContaining({ enemyId: state.id, coord: { q: 1, r: 0 }, pathOrder: 1 })
    ]);

    const fast = game({
      width: 8,
      height: 1,
      routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 7, r: 0 })],
      enemies: { walker: enemy("walker", { speed: 30 }) }
    });
    spawn(fast);
    fast.tick(10);
    const fastState = fast.getSnapshot().enemies[0]!;
    const fastNavigation = navigationOf(fastState);
    expect(fastNavigation.stepsEntered).toBeGreaterThan(1);
    expect(fastState.pathProgress).toBeCloseTo(fastNavigation.stepsEntered + fastNavigation.edgeProgress, 8);
    expect(enteredEvents(fast).map((event) => event.pathOrder)).toEqual(
      Array.from({ length: fastNavigation.stepsEntered }, (_, index) => index + 1)
    );
  });

  it("rebinds dirty occupancy, protects a live current cell, and stalls/resumes after terrain dirties", () => {
    const occupancy = game({
      enemies: { walker: enemy("walker", { speed: 2 }) }
    });
    spawn(occupancy);
    occupancy.tick(0.1);
    const before = navigationOf(occupancy.getSnapshot().enemies[0]!);
    expect(before.nextCoord).toEqual({ q: 1, r: 1 });
    expect(before.edgeProgress).toBeGreaterThan(0);
    expect(occupancy.placeTower("probe", { q: 1, r: 1 })).toEqual({ ok: true });
    occupancy.tick(0);
    const rebound = navigationOf(occupancy.getSnapshot().enemies[0]!);
    expect(rebound).toMatchObject({ currentCoord: { q: 0, r: 1 }, nextCoord: { q: 0, r: 0 }, edgeProgress: 0 });
    tickMany(occupancy, 3);
    const live = occupancy.getSnapshot().enemies[0]!;
    const liveNavigation = navigationOf(live);
    expect(liveNavigation.stepsEntered).toBeGreaterThan(0);
    expect(occupancy.canPlaceTower("probe", liveNavigation.currentCoord)).toMatchObject({
      ok: false,
      reasonKey: "reason.lastPathBlocked",
      reasonParams: { movementProfileId: "ground", routeId: "main" }
    });

    const scripts: Record<string, TowerScriptDefinition> = {
      choke: {
        schemaVersion: 5,
        id: "choke",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [
            {
              when: { $op: "eq", args: [{ $get: "event.signal" }, "close"] },
              actions: [{ action: "setTileTerrain", target: { q: 1, r: 0 }, terrainId: "void" }]
            },
            {
              when: { $op: "eq", args: [{ $get: "event.signal" }, "open"] },
              actions: [{ action: "restoreTileTerrain", target: { q: 1, r: 0 } }]
            }
          ]
        }
      }
    };
    const terrain = game({
      width: 5,
      height: 1,
      routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })],
      scripts
    });
    spawn(terrain);
    expect(terrain.emitScriptSignal("close")).toEqual({ ok: true });
    terrain.tick(0);
    const stalled = terrain.getSnapshot();
    expect(navigationOf(stalled.enemies[0]!).nextCoord).toBeUndefined();
    expect(snapshotNavigation(stalled).stalledEnemyIds).toEqual(["enemy_1"]);
    expect(stalled.enemies[0]!.pathProgress).toBe(0);
    expect(stalled.lastEvents.some((event) => event.type === "enemyLeaked")).toBe(false);

    expect(terrain.emitScriptSignal("open")).toEqual({ ok: true });
    terrain.tick(0);
    const resumed = terrain.getSnapshot();
    expect(navigationOf(resumed.enemies[0]!).nextCoord).toEqual({ q: 1, r: 0 });
    expect(snapshotNavigation(resumed).stalledEnemyIds).toEqual([]);
    terrain.tick(0.2);
    expect(terrain.getSnapshot().enemies[0]!.pathProgress).toBeGreaterThan(0);
  });

  it("advances TowerScript pathProgress from the selected route start over cached flow links", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      spawn: {
        schemaVersion: 5,
        id: "spawn",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{
            actions: [{
              action: "spawnEnemy",
              enemyTypeId: "scripted",
              routeId: "main",
              count: 1,
              pathProgress: 2
            }]
          }]
        }
      }
    };
    const subject = game({
      routes: [route(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })],
      enemies: { scripted: enemy("scripted") },
      groups: [{ enemyId: "scripted", count: 0, routeId: "main" }],
      terrainOverrides: [{ q: 1, r: 1, terrain: "rock" }],
      scripts
    });
    expect(subject.placeTower("probe", { q: 0, r: 0 })).toEqual({ ok: true });

    expect(subject.emitScriptSignal("spawn")).toEqual({ ok: true });
    const spawned = subject.getSnapshot().enemies[0]!;
    expect(navigationOf(spawned)).toMatchObject({
      currentCoord: { q: 1, r: 2 },
      stepsEntered: 2,
      edgeProgress: 0
    });
    expect(spawned.pathProgress).toBe(2);
  });

  it("inherits a live parent's current flow cell when phase spawning after a dirty prefix rebuild", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      phase: {
        schemaVersion: 5,
        id: "phase",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 12 }] }]
        }
      }
    };
    const subject = game({
      routes: [route(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })],
      enemies: {
        carrier: enemy("carrier", {
          phaseSpawns: [{ hpRatio: 0.5, enemyId: "child", count: 1, progressOffset: 0 }]
        }),
        child: enemy("child")
      },
      groups: [{ enemyId: "carrier", routeId: "main" }],
      terrainOverrides: [{ q: 1, r: 1, terrain: "rock" }],
      scripts
    });
    spawn(subject);
    tickMany(subject, 10);
    expect(navigationOf(subject.getSnapshot().enemies[0]!).currentCoord).toEqual({ q: 1, r: 0 });
    expect(subject.placeTower("probe", { q: 0, r: 0 })).toEqual({ ok: true });
    subject.tick(0);
    const parentBeforePhase = subject.getSnapshot().enemies.find((item) => item.typeId === "carrier")!;
    expect(navigationOf(parentBeforePhase).currentCoord).toEqual({ q: 1, r: 0 });

    expect(subject.emitScriptSignal("phase")).toEqual({ ok: true });
    subject.tick(0);
    const child = subject.getSnapshot().enemies.find((item) => item.typeId === "child")!;
    expect(navigationOf(child).currentCoord).toEqual(navigationOf(parentBeforePhase).currentCoord);
    expect(child.pathProgress).toBe(parentBeforePhase.pathProgress);
  });

  it("inherits a killed parent's current flow cell before applying death-spawn cached-link offsets", () => {
    const scripts: Record<string, TowerScriptDefinition> = {
      kill: {
        schemaVersion: 5,
        id: "kill",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 100 }] }]
        }
      }
    };
    const subject = game({
      routes: [route(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })],
      enemies: {
        carrier: enemy("carrier", {
          spawnOnDeath: { enemyId: "child", count: 1, forwardPathSteps: 0 }
        }),
        child: enemy("child")
      },
      groups: [{ enemyId: "carrier", routeId: "main" }],
      terrainOverrides: [{ q: 1, r: 1, terrain: "rock" }],
      scripts
    });
    spawn(subject);
    tickMany(subject, 10);
    expect(subject.placeTower("probe", { q: 0, r: 0 })).toEqual({ ok: true });
    subject.tick(0);
    const parentBeforeDeath = subject.getSnapshot().enemies.find((item) => item.typeId === "carrier")!;
    expect(navigationOf(parentBeforeDeath).currentCoord).toEqual({ q: 1, r: 0 });

    expect(subject.emitScriptSignal("kill")).toEqual({ ok: true });
    subject.tick(0);
    const child = subject.getSnapshot().enemies.find((item) => item.typeId === "child")!;
    expect(navigationOf(child).currentCoord).toEqual(navigationOf(parentBeforeDeath).currentCoord);
    expect(child.pathProgress).toBe(parentBeforeDeath.pathProgress);
  });
});

describe("R2.4a navigation snapshot, targeting, outcomes, and legacy isolation", () => {
  it("handles a dynamic leak and a pre-endpoint death exactly once", () => {
    const leak = game({
      width: 4,
      height: 1,
      routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 3, r: 0 })],
      enemies: { walker: enemy("walker", { speed: 30, coreDamage: 4 }) }
    });
    spawn(leak);
    const coreBefore = leak.coreHp;
    leak.tick(10);
    expect(leak.getSnapshot().lastEvents.filter((event) => event.type === "enemyLeaked")).toHaveLength(1);
    expect(leak.coreHp).toBe(coreBefore - 4);
    leak.tick(10);
    expect(leak.getSnapshot().lastEvents.filter((event) => event.type === "enemyLeaked")).toHaveLength(0);
    expect(leak.coreHp).toBe(coreBefore - 4);

    const scripts: Record<string, TowerScriptDefinition> = {
      kill: {
        schemaVersion: 5,
        id: "kill",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 100 }] }]
        }
      }
    };
    const killed = game({ scripts });
    spawn(killed);
    const coinsBefore = killed.coins;
    expect(killed.emitScriptSignal("kill")).toEqual({ ok: true });
    killed.tick(0);
    expect(killed.getSnapshot().lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(1);
    expect(killed.getSnapshot().lastEvents.some((event) => event.type === "enemyLeaked")).toBe(false);
    expect(killed.coins).toBe(coinsBefore + 3);
    killed.tick(0);
    expect(killed.getSnapshot().lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(0);
    expect(killed.coins).toBe(coinsBefore + 3);
  });

  it("orders tower targets by remaining cost, Infinity, HP/pierce primaries, then binary enemy id", () => {
    const routes = [
      route(SQUARE, "far", { q: 0, r: 1 }, { q: 4, r: 1 }),
      route(SQUARE, "near", { q: 3, r: 1 }, { q: 4, r: 1 }),
      route(SQUARE, "stalled", { q: 0, r: 2 }, { q: 4, r: 2 })
    ];
    const targetGame = (mode: TowerTargetMode): string | undefined => {
      const subject = game({
        routes,
        movementProfiles: { ghost: IGNORED },
        defaultMovementProfileId: "ghost",
        enemies: {
          high_far: enemy("high_far", { maxHp: 40 }),
          high_near: enemy("high_near", { maxHp: 40 }),
          low_near: enemy("low_near", { maxHp: 5 }),
          armored_far: enemy("armored_far", { armor: { kind: "pierce_only" } }),
          armored_near: enemy("armored_near", { armor: { kind: "pierce_only" } }),
          normal_near: enemy("normal_near"),
          stalled_enemy: enemy("stalled_enemy"),
          filler_far_a: enemy("filler_far_a"),
          filler_far_b: enemy("filler_far_b"),
          binary_near: enemy("binary_near")
        },
        groups: [
          { enemyId: "high_far", routeId: "far" },
          { enemyId: "high_near", routeId: "near" },
          { enemyId: "low_near", routeId: "near" },
          { enemyId: "armored_far", routeId: "far" },
          { enemyId: "armored_near", routeId: "near" },
          { enemyId: "normal_near", routeId: "near" },
          { enemyId: "stalled_enemy", routeId: "stalled" },
          { enemyId: "filler_far_a", routeId: "far" },
          { enemyId: "filler_far_b", routeId: "far" },
          { enemyId: "binary_near", routeId: "near" }
        ],
        terrainOverrides: [
          { q: 0, r: 2, terrain: "void" },
          { q: 1, r: 2, terrain: "void" }
        ]
      });
      spawn(subject);
      expect(subject.placeTower("probe", { q: 2, r: 0 })).toEqual({ ok: true });
      const towerId = subject.getSnapshot().towers[0]!.id;
      expect(subject.setTowerTargetMode(towerId, mode)).toEqual({ ok: true });
      subject.tick(0);
      return subject.getSnapshot().lastEvents.find((event) => event.type === "towerFired")?.enemyId;
    };

    expect(targetGame("first")).toBe("enemy_10");
    expect(targetGame("last")).toBe("enemy_7");
    expect(targetGame("strongest")).toBe("enemy_2");
    expect(targetGame("largest_hp")).toBe("enemy_2");
    expect(targetGame("weakest")).toBe("enemy_3");
    expect(targetGame("fastest_ahead")).toBe("enemy_5");
  });

  it("emits canonical grouped active snapshot fields with stable revisions and stalled ids", () => {
    const routes = [
      route(SQUARE, "z_route", { q: 0, r: 1 }, { q: 4, r: 1 }),
      route(SQUARE, "a_route", { q: 0, r: 0 }, { q: 4, r: 1 })
    ];
    const make = (reverse: boolean) => game({
      routes: reverse ? [...routes].reverse() : routes,
      mapSpawnCoord: { q: 0, r: 1 },
      mapCoreCoord: { q: 4, r: 1 },
      groups: reverse
        ? [{ enemyId: "walker", routeId: "a_route" }, { enemyId: "walker", routeId: "z_route" }]
        : [{ enemyId: "walker", routeId: "z_route" }, { enemyId: "walker", routeId: "a_route" }],
      terrainOverrides: [{ q: 0, r: 0, terrain: "void" }]
    });
    const baseline = make(false);
    const permuted = make(true);
    spawn(baseline);
    spawn(permuted);
    const baselineNavigation = snapshotNavigation(baseline.getSnapshot());
    const permutedNavigation = snapshotNavigation(permuted.getSnapshot());

    expect(baselineNavigation).toEqual({
      schemaVersion: 1,
      mode: "dynamic_flow",
      fields: [{
        movementProfileId: "ground",
        goal: { q: 4, r: 1 },
        routeIds: ["a_route", "z_route"],
        revision: expect.stringMatching(/^tf-state-v1:[0-9a-f]{16}$/),
        reachableTileCount: expect.any(Number),
        reachableRouteIds: ["z_route"],
        unreachableRouteIds: ["a_route"]
      }],
      stalledEnemyIds: ["enemy_2"]
    });
    expect(permutedNavigation.fields).toEqual(baselineNavigation.fields);
    expect(permutedNavigation.stalledEnemyIds).toEqual(["enemy_1"]);

    const revisionGame = game();
    spawn(revisionGame);
    const revision = snapshotNavigation(revisionGame.getSnapshot()).fields[0]!.revision;
    expect(snapshotNavigation(revisionGame.getSnapshot()).fields[0]!.revision).toBe(revision);
    revisionGame.tick(0);
    expect(snapshotNavigation(revisionGame.getSnapshot()).fields[0]!.revision).toBe(revision);
    expect(revisionGame.placeTower("probe", { q: 2, r: 0 })).toEqual({ ok: true });
    const occupiedRevision = snapshotNavigation(revisionGame.getSnapshot()).fields[0]!.revision;
    expect(occupiedRevision).not.toBe(revision);
    expect(revisionGame.sellTower(revisionGame.getSnapshot().towers[0]!.id)).toEqual({ ok: true });
    expect(snapshotNavigation(revisionGame.getSnapshot()).fields[0]!.revision).toBe(revision);
  });

  it("preserves the exact no-navigation-key legacy matrix after live spawning and movement", () => {
    for (const grid of [SQUARE, HEX]) {
      const snapshots = (["absent", "disabled", "unselected", "authored_routes"] as const).map((activation) => {
        const subject = game({
          activation,
          grid,
          routes: [route(grid, "main", { q: 0, r: 1 }, { q: 4, r: 1 })],
          enemies: {
            walker: enemy("walker"),
            flyer: enemy("flyer", { movementKind: "direct_flying", targetClass: "flying" })
          },
          groups: [{ enemyId: "walker" }, { enemyId: "flyer" }]
        });
        spawn(subject);
        subject.tick(0.2);
        const snapshot = subject.getSnapshot();
        expect(Object.prototype.hasOwnProperty.call(snapshot, "navigation")).toBe(false);
        expect(snapshot.enemies.every((item) => !Object.prototype.hasOwnProperty.call(item, "navigation"))).toBe(true);
        return JSON.stringify(snapshot);
      });
      for (const candidate of snapshots.slice(1)) expect(candidate).toBe(snapshots[0]);
    }
  });
});
