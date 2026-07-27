import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { MovementProfileV1 } from "../content/navigation-mechanics.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type { EnemyState, GameSnapshot, GridCoord, GridDefinition, GridPathRoute } from "./types.js";

type ScriptAction = Record<string, unknown>;

interface FixtureOptions {
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly routes?: readonly GridPathRoute[];
  readonly terrainOverrides?: readonly { q: number; r: number; terrain: string }[];
  readonly enemySpeed?: number;
  readonly includeStaticSpawn?: boolean;
  readonly spawnObligation?: {
    readonly kind: "phase" | "death";
    readonly parentMovementProfile: MovementProfileV1;
    readonly childMovementProfile: MovementProfileV1;
    readonly phaseRouteIds?: readonly string[];
  };
}

interface NavigationStats {
  readonly fieldBuildCount: number;
  readonly fieldQueryCount: number;
  readonly generation: number;
}

interface RuntimeInternals {
  navigationResolver: {
    getStats(): NavigationStats;
    isFieldCurrent(field: unknown, movementProfileId: string, routeId: string): boolean;
  };
  navigationFieldLookupCache: unknown;
  navigationEnemyFields: Map<string, unknown>;
  runtimeTerrainOverrides: Map<string, unknown>;
  createNavigationResolver(
    occupiedCoords?: readonly GridCoord[],
    terrainByCoord?: Readonly<Record<string, string>>
  ): unknown;
  stabilizeDynamicEnemyNavigation(): void;
  syncTemporaryWaterTiles(): void;
  runScriptEvent(eventName: string, event: Record<string, unknown>): void;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });
const GROUND: MovementProfileV1 = Object.freeze({
  label: "Ground",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000
});
const AIR: MovementProfileV1 = Object.freeze({
  label: "Air",
  terrainMode: "ignore_walkable",
  towerOccupancy: "ignored",
  defaultTerrainCost: 1_000
});

function route(
  grid: GridDefinition,
  id: string,
  start: GridCoord,
  goal: GridCoord
): GridPathRoute {
  return { id, pathCenterline: createGridTopology(grid).line(start, goal) };
}

function terraformTiles(operations: readonly Record<string, unknown>[]): ScriptAction {
  return { action: "terraformTiles", operations };
}

function setTerrain(transitionId: string, target: unknown): Record<string, unknown> {
  return { kind: "set_terrain", target, transitionId };
}

const PAYLOAD_TARGET = Object.freeze({
  q: Object.freeze({ $get: "event.payload.q" }),
  r: Object.freeze({ $get: "event.payload.r" })
});

function runtimeContent(options: FixtureOptions = {}) {
  const grid = options.grid ?? SQUARE;
  const width = options.width ?? 5;
  const height = options.height ?? 3;
  const routes = options.routes ?? [route(grid, "main", { q: 0, r: 1 }, { q: width - 1, r: 1 })];
  const handlers = [
    {
      when: { $op: "eq", args: [{ $get: "event.signal" }, "safe"] },
      actions: [terraformTiles([
        setTerrain("flood", { q: 1, r: 0 }),
        setTerrain("flood", { q: 3, r: 0 })
      ])]
    },
    {
      when: { $op: "eq", args: [{ $get: "event.signal" }, "block"] },
      actions: [terraformTiles([setTerrain("block", PAYLOAD_TARGET)])]
    },
    {
      when: { $op: "eq", args: [{ $get: "event.signal" }, "repair"] },
      actions: [terraformTiles([setTerrain("repair", { q: 2, r: 0 })])]
    }
  ];
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "dynamic_terraform",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["mutable", "dry"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["wet"]
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["blocked"]
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: options.enemySpeed ?? 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        scripted: {
          id: "scripted", label: "Scripted", maxHp: 20, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        },
        ...(options.spawnObligation ? {
          parent: {
            id: "parent", label: "Parent", maxHp: 20, speed: options.enemySpeed ?? 1,
            reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 3,
            ...(options.spawnObligation.kind === "phase"
              ? {
                  phaseSpawns: [{
                    hpRatio: 0.5,
                    enemyId: "child",
                    count: 1,
                    progressOffset: 0,
                    ...(options.spawnObligation.phaseRouteIds
                      ? { routeIds: [...options.spawnObligation.phaseRouteIds] }
                      : {})
                  }]
                }
              : { spawnOnDeath: { enemyId: "child", count: 1, forwardPathSteps: 0 } })
          },
          child: {
            id: "child", label: "Child", maxHp: 20, speed: 1,
            reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 4
          }
        } : {})
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{
            enemyId: options.spawnObligation ? "parent" : "walker", count: 1, spawnInterval: 0,
            startDelay: 0, routeId: routes[0]!.id
          }]
        }]
      },
      missions: {
        dynamic_terraform: {
          id: "dynamic_terraform", label: "Dynamic terraforming", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: [], abilityIds: [],
          mechanics: { profiles: { navigation: "flow", terraforming: "mutable" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width, height, grid, defaultTerrain: "floor",
        spawnCoord: { ...routes[0]!.pathCenterline[0]! },
        coreCoord: { ...routes[0]!.pathCenterline.at(-1)! },
        pathCenterline: routes[0]!.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes.map((candidate) => ({
          id: candidate.id,
          pathCenterline: candidate.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: [...(options.terrainOverrides ?? [])]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            flow: {
              mode: "dynamic_flow",
              defaultMovementProfileId: options.spawnObligation ? "parent" : "ground",
              movementProfiles: options.spawnObligation
                ? {
                    parent: options.spawnObligation.parentMovementProfile,
                    child: options.spawnObligation.childMovementProfile
                  }
                : { ground: GROUND },
              ...(options.spawnObligation
                ? { enemyMovementProfiles: { parent: "parent", child: "child" } }
                : {})
            }
          }
        },
        terraforming: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            mutable: {
              terrainTransitions: {
                flood: { fromTerrainTags: ["mutable", "dry"], toTerrainId: "water" },
                block: { fromTerrainTags: ["mutable", "dry"], toTerrainId: "wall" },
                repair: { fromTerrainTags: ["blocked"], toTerrainId: "water" }
              }
            }
          }
        }
      }
    },
    scripts: {
      dynamic_terraform: {
        schemaVersion: 6,
        id: "dynamic_terraform",
        bindings: [{ scope: "global" }],
        handlers: { signal: handlers }
      },
      ...(options.includeStaticSpawn ? {
        static_spawn: {
          schemaVersion: 6,
          id: "static_spawn",
          bindings: [{ scope: "global" }],
          handlers: {
            towerPlaced: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "scripted", routeId: routes[0]!.id }] }]
          }
        }
      } : {})
    } as never,
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "dynamic_terraform", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "dynamic_terraform",
    content: runtimeContent(options),
    seed: "terraform-dynamic-c2a"
  });
}

function internals(subject: TowerDefenseGame): RuntimeInternals {
  return subject as unknown as RuntimeInternals;
}

function terrainAt(subject: TowerDefenseGame, coord: GridCoord): string | undefined {
  return subject.map.getTile(coord)?.terrain;
}

function gameplayProjection(snapshot: GameSnapshot) {
  return {
    tiles: snapshot.tiles,
    terrainOverrides: snapshot.terrainOverrides,
    temporaryWaterTiles: snapshot.temporaryWaterTiles,
    enemies: snapshot.enemies,
    navigation: snapshot.navigation
  };
}

function expectOneReason(
  before: GameSnapshot,
  after: GameSnapshot,
  reasonKey: "terraform.last_path_blocked"
): void {
  expect(after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length)).toEqual([
    expect.objectContaining({
      scriptId: "dynamic_terraform",
      event: "signal",
      code: "invalid_action",
      reasonKey
    })
  ]);
  expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "terrainChanged"))
    .toEqual([]);
}

function spawnOne(subject: TowerDefenseGame): EnemyState {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies).toHaveLength(1);
  return subject.enemies[0]!;
}

function installBoundaryEnemies(subject: TowerDefenseGame, count: number): {
  readonly enemies: EnemyState[];
  readonly sharedField: unknown;
} {
  const spawned = spawnOne(subject);
  const internal = internals(subject);
  const navigation = spawned.navigation;
  const sharedField = internal.navigationEnemyFields.get(spawned.id);
  expect(navigation?.nextCoord).toBeDefined();
  expect(sharedField).toBeDefined();
  const enemies = Array.from({ length: count }, (_, index): EnemyState => {
    const edgeProgress = index === 0 ? 0 : 0.5;
    return {
      ...spawned,
      id: `enemy_${String(index).padStart(5, "0")}`,
      pathProgress: navigation!.stepsEntered + edgeProgress,
      navigation: {
        ...navigation!,
        currentCoord: { ...navigation!.currentCoord },
        nextCoord: { ...navigation!.nextCoord! },
        edgeProgress
      },
      ...(spawned.phaseSpawnsTriggered === undefined
        ? {}
        : { phaseSpawnsTriggered: [...spawned.phaseSpawnsTriggered] })
    };
  });
  subject.enemies = enemies;
  internal.navigationEnemyFields.clear();
  for (const enemy of enemies) internal.navigationEnemyFields.set(enemy.id, sharedField);
  return { enemies, sharedField };
}

function anchorEnemyAt(enemy: EnemyState, currentCoord: GridCoord, nextCoord: GridCoord): void {
  expect(enemy.navigation).toBeDefined();
  enemy.navigation = {
    ...enemy.navigation!,
    currentCoord: { ...currentCoord },
    nextCoord: { ...nextCoord },
    edgeProgress: 0,
    stepsEntered: 2
  };
  enemy.pathProgress = 2;
}

describe("R3.4b C2A dynamic-flow terraforming safety and adoption", () => {
  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("atomically adopts a safe persistent two-tile batch on %s", (_label, grid) => {
    const subject = game({ grid });
    const internal = internals(subject);
    const oldResolver = internal.navigationResolver;
    const oldLookupCache = internal.navigationFieldLookupCache;
    const oldEnemyFields = internal.navigationEnemyFields;
    const oldOverrides = internal.runtimeTerrainOverrides;
    const observedAtDispatch: Array<{
      readonly terrains: readonly [string | undefined, string | undefined];
      readonly adopted: boolean;
    }> = [];
    const originalRunScriptEvent = internal.runScriptEvent.bind(subject);
    const dispatchSpy = vi.spyOn(internal, "runScriptEvent").mockImplementation((eventName, event) => {
      if (eventName === "terrainChanged") {
        observedAtDispatch.push({
          terrains: [terrainAt(subject, { q: 1, r: 0 }), terrainAt(subject, { q: 3, r: 0 })],
          adopted: internal.navigationResolver !== oldResolver
            && internal.navigationFieldLookupCache !== oldLookupCache
            && internal.navigationEnemyFields !== oldEnemyFields
        });
      }
      originalRunScriptEvent(eventName, event);
    });

    try {
      expect(subject.emitScriptSignal("safe")).toEqual({ ok: true });
    } finally {
      dispatchSpy.mockRestore();
    }
    const adoptedStats = internal.navigationResolver.getStats();
    internal.stabilizeDynamicEnemyNavigation();

    expect(internal.navigationResolver.getStats()).toEqual(adoptedStats);
    expect(adoptedStats).toEqual({ fieldBuildCount: 1, fieldQueryCount: 1, generation: 0 });
    expect(internal.navigationResolver).not.toBe(oldResolver);
    expect(internal.navigationFieldLookupCache).not.toBe(oldLookupCache);
    expect(internal.navigationEnemyFields).not.toBe(oldEnemyFields);
    expect(internal.runtimeTerrainOverrides).not.toBe(oldOverrides);
    expect(subject.getSnapshot().terrainOverrides).toEqual([
      { q: 1, r: 0, terrain: "water", source: "script" },
      { q: 3, r: 0, terrain: "water", source: "script" }
    ]);
    expect(observedAtDispatch).toEqual([
      { terrains: ["water", "water"], adopted: true },
      { terrains: ["water", "water"], adopted: true }
    ]);
  });

  it("adopts the exact 16,384-source boundary with 8,191 live enemies sharing one candidate field", () => {
    const subject = game();
    const internal = internals(subject);
    const { enemies } = installBoundaryEnemies(subject, 8_191);
    const sourceCount = 2 + 1 + enemies.length + (enemies.length - 1);
    expect(sourceCount).toBe(16_384);

    expect(subject.emitScriptSignal("safe")).toEqual({ ok: true });
    const adoptedStats = internal.navigationResolver.getStats();
    const adoptedFields = enemies.map((enemy) => internal.navigationEnemyFields.get(enemy.id));
    internal.stabilizeDynamicEnemyNavigation();

    expect(adoptedStats).toEqual({ fieldBuildCount: 1, fieldQueryCount: 1, generation: 0 });
    expect(internal.navigationResolver.getStats()).toEqual(adoptedStats);
    expect(internal.navigationEnemyFields.size).toBe(8_191);
    expect(new Set(adoptedFields).size).toBe(1);
    expect(adoptedFields[0]).toBeDefined();
    expect(enemies.every((enemy, index) => (
      adoptedFields[index] !== undefined
      && internal.navigationResolver.isFieldCurrent(
        adoptedFields[index],
        enemy.navigation!.movementProfileId,
        enemy.routeId!
      )
    ))).toBe(true);
    expect(subject.getSnapshot().terrainOverrides).toEqual([
      { q: 1, r: 0, terrain: "water", source: "script" },
      { q: 3, r: 0, terrain: "water", source: "script" }
    ]);
  });

  it("rejects the 16,385th static script source before creating resolvers or touching live identities", () => {
    const subject = game({ includeStaticSpawn: true });
    const internal = internals(subject);
    const { enemies } = installBoundaryEnemies(subject, 8_191);
    const sourceCount = 2 + 1 + enemies.length + (enemies.length - 1) + 1;
    expect(sourceCount).toBe(16_385);
    const before = subject.getSnapshot();
    const beforeStats = internal.navigationResolver.getStats();
    const identities = {
      map: subject.map,
      resolver: internal.navigationResolver,
      lookupCache: internal.navigationFieldLookupCache,
      enemyFields: internal.navigationEnemyFields,
      overrides: internal.runtimeTerrainOverrides,
      enemies: subject.enemies,
      enemyObjects: [...subject.enemies],
      enemyNavigation: subject.enemies.map((enemy) => enemy.navigation),
      installedFields: subject.enemies.map((enemy) => internal.navigationEnemyFields.get(enemy.id))
    };
    const resolverFactory = vi.spyOn(internal, "createNavigationResolver");
    let resolverFactoryCalls = 0;

    try {
      expect(subject.emitScriptSignal("safe")).toEqual({ ok: true });
    } finally {
      resolverFactoryCalls = resolverFactory.mock.calls.length;
      resolverFactory.mockRestore();
    }
    const afterStats = internal.navigationResolver.getStats();
    const after = subject.getSnapshot();

    expect(resolverFactoryCalls).toBe(0);
    expect(afterStats).toEqual(beforeStats);
    expect(subject.map).toBe(identities.map);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookupCache);
    expect(internal.navigationEnemyFields).toBe(identities.enemyFields);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(subject.enemies).toBe(identities.enemies);
    expect(subject.enemies.every((enemy, index) => (
      enemy === identities.enemyObjects[index]
      && enemy.navigation === identities.enemyNavigation[index]
      && internal.navigationEnemyFields.get(enemy.id) === identities.installedFields[index]
    ))).toBe(true);
    expect(terrainAt(subject, { q: 1, r: 0 })).toBe("floor");
    expect(terrainAt(subject, { q: 3, r: 0 })).toBe("floor");
    expect(after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length)).toEqual([
      expect.objectContaining({
        scriptId: "dynamic_terraform",
        event: "signal",
        code: "budget_exceeded",
        reasonKey: "terraform.solver_budget_exceeded"
      })
    ]);
    expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "terrainChanged"))
      .toEqual([]);
  });

  it("carries a dead-yet-unreaped enemy field into the adopted resolver without a query or navigation rebind", () => {
    const subject = game();
    const enemy = spawnOne(subject);
    const internal = internals(subject);
    const oldResolver = internal.navigationResolver;
    const deadNavigation = enemy.navigation;
    expect(deadNavigation).toBeDefined();
    expect(enemy.routeId).toBeDefined();
    enemy.hp = 0;

    expect(subject.emitScriptSignal("safe")).toEqual({ ok: true });

    const adoptedStats = internal.navigationResolver.getStats();
    const adoptedField = internal.navigationEnemyFields.get(enemy.id);
    expect(internal.navigationResolver).not.toBe(oldResolver);
    expect.soft(adoptedStats).toEqual({ fieldBuildCount: 1, fieldQueryCount: 1, generation: 0 });
    expect.soft(enemy.navigation).toBe(deadNavigation);
    expect(adoptedField).toBeDefined();
    expect(internal.navigationResolver.isFieldCurrent(
      adoptedField,
      enemy.navigation!.movementProfileId,
      enemy.routeId!
    )).toBe(true);
  });

  it("publishes resolver adoption and live enemy rebind before syncing temporary-water compatibility state", () => {
    const subject = game();
    const enemy = spawnOne(subject);
    const internal = internals(subject);
    const oldResolver = internal.navigationResolver;
    const oldLookupCache = internal.navigationFieldLookupCache;
    const oldEnemyFields = internal.navigationEnemyFields;
    const oldNavigation = enemy.navigation;
    expect(oldNavigation).toBeDefined();
    expect(enemy.routeId).toBeDefined();
    const observed: Array<{
      readonly resolverAdopted: boolean;
      readonly lookupCacheAdopted: boolean;
      readonly enemyFieldsAdopted: boolean;
      readonly liveRebound: boolean;
      readonly liveFieldCurrent: boolean;
    }> = [];
    const originalSyncTemporaryWaterTiles = internal.syncTemporaryWaterTiles.bind(subject);
    const syncSpy = vi.spyOn(internal, "syncTemporaryWaterTiles").mockImplementation(() => {
      const installedField = internal.navigationEnemyFields.get(enemy.id);
      observed.push({
        resolverAdopted: internal.navigationResolver !== oldResolver,
        lookupCacheAdopted: internal.navigationFieldLookupCache !== oldLookupCache,
        enemyFieldsAdopted: internal.navigationEnemyFields !== oldEnemyFields,
        liveRebound: enemy.navigation !== oldNavigation,
        liveFieldCurrent: installedField !== undefined && internal.navigationResolver.isFieldCurrent(
          installedField,
          enemy.navigation!.movementProfileId,
          enemy.routeId!
        )
      });
      originalSyncTemporaryWaterTiles();
    });

    try {
      expect(subject.emitScriptSignal("safe")).toEqual({ ok: true });
    } finally {
      syncSpy.mockRestore();
    }

    expect(observed).toEqual([{
      resolverAdopted: true,
      lookupCacheAdopted: true,
      enemyFieldsAdopted: true,
      liveRebound: true,
      liveFieldCurrent: true
    }]);
  });

  it("rejects a reachable-to-blocked candidate without mutating any live navigation identity or enemy", () => {
    const subject = game({ width: 5, height: 1, routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })] });
    const enemy = spawnOne(subject);
    const internal = internals(subject);
    const before = subject.getSnapshot();
    const beforeStats = internal.navigationResolver.getStats();
    const identities = {
      map: subject.map,
      resolver: internal.navigationResolver,
      lookupCache: internal.navigationFieldLookupCache,
      enemyFields: internal.navigationEnemyFields,
      overrides: internal.runtimeTerrainOverrides,
      enemies: subject.enemies,
      enemy,
      enemyNavigation: enemy.navigation
    };
    const enemyFieldsEntries = [...internal.navigationEnemyFields.entries()];

    const result = subject.emitScriptSignal("block", { q: 2, r: 0 });
    const afterStats = internal.navigationResolver.getStats();
    const after = subject.getSnapshot();

    expect(result).toEqual({ ok: true });
    expect(afterStats).toEqual(beforeStats);
    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expect(subject.map).toBe(identities.map);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookupCache);
    expect(internal.navigationEnemyFields).toBe(identities.enemyFields);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect([...internal.navigationEnemyFields.entries()]).toEqual(enemyFieldsEntries);
    expect(subject.enemies).toBe(identities.enemies);
    expect(subject.enemies[0]).toBe(identities.enemy);
    expect(subject.enemies[0]!.navigation).toBe(identities.enemyNavigation);
    expectOneReason(before, after, "terraform.last_path_blocked");
  });

  it("repairs an unavailable dynamic baseline and adopts the reachable candidate", () => {
    const subject = game({
      width: 5,
      height: 1,
      routes: [route(SQUARE, "main", { q: 0, r: 0 }, { q: 4, r: 0 })],
      terrainOverrides: [{ q: 2, r: 0, terrain: "wall" }]
    });
    const oldResolver = internals(subject).navigationResolver;

    expect(subject.emitScriptSignal("repair")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(after.scriptState.diagnostics).toEqual([]);
    expect(terrainAt(subject, { q: 2, r: 0 })).toBe("water");
    expect(after.terrainOverrides).toEqual([
      { q: 2, r: 0, terrain: "water", source: "script" }
    ]);
    expect(internals(subject).navigationResolver).not.toBe(oldResolver);
  });

  it("protects both a live current cell and an in-progress next cell even when the route can detour", () => {
    for (const liveSource of ["current", "next"] as const) {
      const subject = game({ width: 6, height: 3, enemySpeed: 6 });
      expect(subject.startNextWave()).toEqual({ ok: true });
      subject.tick(0.2);
      const enemy = subject.enemies[0]!;
      expect(enemy.navigation).toMatchObject({
        currentCoord: { q: 1, r: 1 },
        nextCoord: { q: 2, r: 1 },
        edgeProgress: expect.any(Number),
        stepsEntered: 1
      });
      expect(enemy.navigation!.edgeProgress).toBeGreaterThan(0);
      const target = liveSource === "current"
        ? enemy.navigation!.currentCoord
        : enemy.navigation!.nextCoord!;
      const internal = internals(subject);
      const before = subject.getSnapshot();
      const beforeStats = internal.navigationResolver.getStats();
      const resolverIdentity = internal.navigationResolver;
      const cacheIdentity = internal.navigationFieldLookupCache;
      const fieldsIdentity = internal.navigationEnemyFields;
      const enemyNavigationIdentity = enemy.navigation;

      expect(subject.emitScriptSignal("block", { q: target.q, r: target.r })).toEqual({ ok: true });
      const afterStats = internal.navigationResolver.getStats();
      const after = subject.getSnapshot();

      expect(afterStats, liveSource).toEqual(beforeStats);
      expect(gameplayProjection(after), liveSource).toEqual(gameplayProjection(before));
      expect(internal.navigationResolver, liveSource).toBe(resolverIdentity);
      expect(internal.navigationFieldLookupCache, liveSource).toBe(cacheIdentity);
      expect(internal.navigationEnemyFields, liveSource).toBe(fieldsIdentity);
      expect(enemy.navigation, liveSource).toBe(enemyNavigationIdentity);
      expectOneReason(before, after, "terraform.last_path_blocked");
    }
  });

  it("rejects a phase child field that cannot inherit its live parent's current cell on an explicit other goal", () => {
    const routes = [
      route(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 }),
      route(SQUARE, "side", { q: 0, r: 2 }, { q: 4, r: 2 })
    ];
    const subject = game({
      width: 5,
      height: 3,
      routes,
      spawnObligation: {
        kind: "phase",
        parentMovementProfile: AIR,
        childMovementProfile: GROUND,
        phaseRouteIds: ["side"]
      }
    });
    const parent = spawnOne(subject);
    expect(parent.typeId).toBe("parent");
    anchorEnemyAt(parent, { q: 2, r: 1 }, { q: 3, r: 1 });
    expect(terrainAt(subject, parent.navigation!.currentCoord)).toBe("floor");
    const internal = internals(subject);
    const before = subject.getSnapshot();
    const beforeStats = internal.navigationResolver.getStats();
    const identities = {
      map: subject.map,
      resolver: internal.navigationResolver,
      lookupCache: internal.navigationFieldLookupCache,
      enemyFields: internal.navigationEnemyFields,
      overrides: internal.runtimeTerrainOverrides,
      enemies: subject.enemies,
      parent,
      parentNavigation: parent.navigation,
      parentField: internal.navigationEnemyFields.get(parent.id)
    };

    expect(subject.emitScriptSignal("block", {
      q: parent.navigation!.currentCoord.q,
      r: parent.navigation!.currentCoord.r
    })).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(internal.navigationResolver.getStats()).toEqual(beforeStats);
    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expect(subject.map).toBe(identities.map);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookupCache);
    expect(internal.navigationEnemyFields).toBe(identities.enemyFields);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(subject.enemies).toBe(identities.enemies);
    expect(subject.enemies[0]).toBe(identities.parent);
    expect(parent.navigation).toBe(identities.parentNavigation);
    expect(internal.navigationEnemyFields.get(parent.id)).toBe(identities.parentField);
    expectOneReason(before, after, "terraform.last_path_blocked");
  });

  it("rejects a death child field that cannot inherit its dead-yet-unreaped parent's current cell", () => {
    const subject = game({
      width: 5,
      height: 3,
      routes: [route(SQUARE, "main", { q: 0, r: 1 }, { q: 4, r: 1 })],
      spawnObligation: {
        kind: "death",
        parentMovementProfile: AIR,
        childMovementProfile: GROUND
      }
    });
    const parent = spawnOne(subject);
    expect(parent.typeId).toBe("parent");
    anchorEnemyAt(parent, { q: 2, r: 1 }, { q: 3, r: 1 });
    parent.hp = 0;
    expect(terrainAt(subject, parent.navigation!.currentCoord)).toBe("floor");
    const internal = internals(subject);
    const before = subject.getSnapshot();
    const beforeStats = internal.navigationResolver.getStats();
    const identities = {
      map: subject.map,
      resolver: internal.navigationResolver,
      lookupCache: internal.navigationFieldLookupCache,
      enemyFields: internal.navigationEnemyFields,
      overrides: internal.runtimeTerrainOverrides,
      enemies: subject.enemies,
      parent,
      parentNavigation: parent.navigation,
      parentField: internal.navigationEnemyFields.get(parent.id)
    };

    expect(subject.emitScriptSignal("block", {
      q: parent.navigation!.currentCoord.q,
      r: parent.navigation!.currentCoord.r
    })).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(internal.navigationResolver.getStats()).toEqual(beforeStats);
    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expect(subject.map).toBe(identities.map);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookupCache);
    expect(internal.navigationEnemyFields).toBe(identities.enemyFields);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(subject.enemies).toBe(identities.enemies);
    expect(subject.enemies[0]).toBe(identities.parent);
    expect(parent.navigation).toBe(identities.parentNavigation);
    expect(internal.navigationEnemyFields.get(parent.id)).toBe(identities.parentField);
    expectOneReason(before, after, "terraform.last_path_blocked");
  });
});
