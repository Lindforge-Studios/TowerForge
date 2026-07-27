import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridCoord, GridDefinition, GridPathRoute } from "./types.js";

type ScriptAction = Record<string, unknown>;

interface ElevationPolicy {
  readonly minimum: number;
  readonly maximum: number;
  readonly maximumDeltaPerOperation: number;
}

interface FixtureOptions {
  readonly elevation?: "active" | "absent";
  readonly includeElevationPolicy?: boolean;
  readonly policy?: ElevationPolicy;
  readonly navigation?: "authored_routes" | "dynamic_flow";
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly routes?: readonly GridPathRoute[];
  readonly elevationOverrides?: readonly { q: number; r: number; elevation: number }[];
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
  readonly observeElevationEvents?: boolean;
}

interface NavigationStats {
  readonly fieldBuildCount: number;
  readonly fieldQueryCount: number;
  readonly generation: number;
}

interface RuntimeInternals {
  readonly navigationResolver?: { getStats(): NavigationStats };
  readonly navigationFieldLookupCache?: unknown;
  readonly navigationEnemyFields?: Map<string, unknown>;
  createNavigationResolver(
    occupiedCoords?: readonly GridCoord[],
    terrainByCoord?: Readonly<Record<string, string>>
  ): unknown;
  enemyInTowerAcquisitionRange(tower: unknown, enemy: unknown): boolean;
}

interface ElevationChangedEvent {
  readonly type: "elevationChanged";
  readonly coord: GridCoord;
  readonly fromElevation: number;
  readonly toElevation: number;
  readonly source: "script" | "restore";
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });
const DEFAULT_POLICY: ElevationPolicy = Object.freeze({
  minimum: -4,
  maximum: 4,
  maximumDeltaPerOperation: 4
});

function terraformTiles(operations: readonly Record<string, unknown>[]): ScriptAction {
  return { action: "terraformTiles", operations };
}

function setTerrain(transitionId: string, target: unknown): Record<string, unknown> {
  return { kind: "set_terrain", target, transitionId };
}

function setElevation(target: unknown, elevation: unknown): Record<string, unknown> {
  return { kind: "set_elevation", target, elevation };
}

function restoreElevation(target: unknown): Record<string, unknown> {
  return { kind: "restore_elevation", target };
}

function route(id: string, row: number, startQ: number, endQ: number): GridPathRoute {
  return {
    id,
    pathCenterline: Array.from({ length: endQ - startQ + 1 }, (_, index) => ({ q: startQ + index, r: row }))
  };
}

function runtimeContent(options: FixtureOptions = {}) {
  const elevation = options.elevation ?? "active";
  const navigation = options.navigation ?? "authored_routes";
  const width = options.width ?? 5;
  const height = options.height ?? 3;
  const routes = options.routes ?? [route("main", 1, 0, width - 1)];
  const includePolicy = options.includeElevationPolicy ?? true;
  const signalHandlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => ({
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  }));
  const selectedProfiles = {
    terraforming: "mutable",
    navigation: navigation === "dynamic_flow" ? "flow" : "authored",
    ...(elevation === "active" ? { elevation: "plateau" } : {})
  };
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "elevation_runtime",
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
          groundSpeedMultiplier: 1, tags: ["mutable"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["wet"]
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        probe: {
          id: "probe", label: "Probe", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{
            enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0,
            routeId: routes[0]!.id
          }]
        }]
      },
      missions: {
        elevation_runtime: {
          id: "elevation_runtime", label: "Elevation runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "one", buildTowerIds: ["probe"], abilityIds: [],
          mechanics: { profiles: selectedProfiles }
        }
      }
    },
    maps: {
      field: {
        id: "field", width, height, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor",
        spawnCoord: { ...routes[0]!.pathCenterline[0]! },
        coreCoord: { ...routes[0]!.pathCenterline.at(-1)! },
        pathCenterline: routes[0]!.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes.map((candidate) => ({
          id: candidate.id,
          pathCenterline: candidate.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: [],
        elevationOverrides: [...(options.elevationOverrides ?? [])]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        terraforming: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            mutable: {
              terrainTransitions: {
                flood: { fromTerrainTags: ["mutable"], toTerrainId: "water" }
              },
              ...(includePolicy ? { elevation: options.policy ?? DEFAULT_POLICY } : {})
            }
          }
        },
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: navigation === "dynamic_flow"
            ? {
                flow: {
                  mode: "dynamic_flow",
                  defaultMovementProfileId: "ground",
                  movementProfiles: {
                    ground: {
                      label: "Ground", terrainMode: "respect_walkable",
                      towerOccupancy: "ignored", defaultTerrainCost: 1_000
                    }
                  }
                }
              }
            : { authored: { mode: "authored_routes" } }
        },
        ...(elevation === "active" ? {
          elevation: {
            schemaVersion: 3,
            enabled: true,
            profiles: {
              plateau: {
                lineOfSight: { terrainBlockerTags: [] },
                highGround: {
                  maximumEffectiveElevationDelta: 4,
                  rangeBonusPerElevation: 1,
                  damageBonusBasisPointsPerElevation: 1_000
                }
              }
            }
          }
        } : {})
      }
    },
    scripts: {
      elevation_runtime: {
        schemaVersion: 6,
        id: "elevation_runtime",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: signalHandlers,
          ...(options.observeElevationEvents ? {
            elevationChanged: [{
              actions: [
                { action: "incrementState", key: "elevationEvents" },
                { action: "setState", key: "source", value: { $get: "event.source" } },
                { action: "setState", key: "from", value: { $get: "event.fromElevation" } },
                { action: "setState", key: "to", value: { $get: "event.toElevation" } },
                { action: "setState", key: "q", value: { $get: "event.coord.q" } },
                { action: "setState", key: "r", value: { $get: "event.coord.r" } }
              ]
            }]
          } : {})
        }
      }
    } as never,
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "elevation_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "elevation_runtime",
    content: runtimeContent(options),
    seed: "terraform-elevation-c3a"
  });
}

function expectDiagnostic(
  before: GameSnapshot,
  after: GameSnapshot,
  reasonKey: string,
  code: "invalid_action" | "budget_exceeded" = "invalid_action"
): void {
  expect(after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length)).toEqual([
    expect.objectContaining({
      scriptId: "elevation_runtime",
      event: "signal",
      code,
      reasonKey
    })
  ]);
}

function elevationEvents(subject: TowerDefenseGame, start = 0): ElevationChangedEvent[] {
  return subject.lastEvents
    .slice(start)
    .filter((event) => (event as unknown as { type: string }).type === "elevationChanged") as unknown as ElevationChangedEvent[];
}

function elevationProjection(subject: TowerDefenseGame) {
  const snapshot = subject.getSnapshot();
  return {
    elevation: snapshot.elevation,
    terrainOverrides: snapshot.terrainOverrides,
    tiles: snapshot.tiles
  };
}

describe("R3.4b C3A transactional elevation terraforming runtime", () => {
  it("distinguishes a missing active elevation dependency from a missing terraforming elevation policy", () => {
    const operation = terraformTiles([setElevation({ q: 1, r: 0 }, 1)]);
    const missingDependency = game({
      elevation: "absent",
      handlers: { mutate: [operation] }
    });
    const dependencyBefore = missingDependency.getSnapshot();
    expect(missingDependency.emitScriptSignal("mutate")).toEqual({ ok: true });
    expectDiagnostic(
      dependencyBefore,
      missingDependency.getSnapshot(),
      "terraform.elevation_dependency_missing"
    );

    const missingPolicy = game({
      elevation: "active",
      includeElevationPolicy: false,
      handlers: { mutate: [operation] }
    });
    const policyBefore = missingPolicy.getSnapshot();
    expect(missingPolicy.emitScriptSignal("mutate")).toEqual({ ok: true });
    expectDiagnostic(policyBefore, missingPolicy.getSnapshot(), "terraform.elevation_policy_missing");
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("sets and restores canonical authored elevations on %s with real ordered events", (_label, grid) => {
    const subject = game({
      grid,
      elevationOverrides: [{ q: 2, r: 0, elevation: 2 }],
      handlers: {
        set: [terraformTiles([
          setElevation({ q: 2, r: 0 }, 3),
          setElevation({ q: 1, r: 0 }, 1)
        ])],
        restore: [terraformTiles([
          restoreElevation({ q: 1, r: 0 }),
          restoreElevation({ q: 2, r: 0 })
        ])]
      }
    });

    const setEventStart = subject.lastEvents.length;
    expect(subject.emitScriptSignal("set")).toEqual({ ok: true });
    expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(1);
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(3);
    expect(subject.getSnapshot().elevation).toEqual({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [
        { q: 1, r: 0, elevation: 1 },
        { q: 2, r: 0, elevation: 3 }
      ]
    });
    expect(elevationEvents(subject, setEventStart)).toEqual([
      {
        type: "elevationChanged", coord: { q: 2, r: 0 },
        fromElevation: 2, toElevation: 3, source: "script"
      },
      {
        type: "elevationChanged", coord: { q: 1, r: 0 },
        fromElevation: 0, toElevation: 1, source: "script"
      }
    ]);

    const restoreEventStart = subject.lastEvents.length;
    expect(subject.emitScriptSignal("restore")).toEqual({ ok: true });
    expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(0);
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(2);
    expect(subject.getSnapshot().elevation?.overrides).toEqual([
      { q: 2, r: 0, elevation: 2 }
    ]);
    expect(elevationEvents(subject, restoreEventStart)).toEqual([
      {
        type: "elevationChanged", coord: { q: 1, r: 0 },
        fromElevation: 1, toElevation: 0, source: "restore"
      },
      {
        type: "elevationChanged", coord: { q: 2, r: 0 },
        fromElevation: 3, toElevation: 2, source: "restore"
      }
    ]);
  });

  it("dispatches real elevationChanged fields to TowerScript after set/restore but not after a no-op", () => {
    const subject = game({
      observeElevationEvents: true,
      handlers: {
        set: [terraformTiles([setElevation({ q: 1, r: 0 }, 1)])],
        noop: [terraformTiles([setElevation({ q: 1, r: 0 }, 1)])],
        restore: [terraformTiles([restoreElevation({ q: 1, r: 0 })])]
      }
    });
    const state = () => subject.getSnapshot().scriptState.values.elevation_runtime?.["global:global"];

    expect(subject.emitScriptSignal("set")).toEqual({ ok: true });
    expect(elevationEvents(subject)).toHaveLength(1);
    expect(state()).toEqual({
      elevationEvents: 1,
      source: "script",
      from: 0,
      to: 1,
      q: 1,
      r: 0
    });

    const noOpEventStart = subject.lastEvents.length;
    expect(subject.emitScriptSignal("noop")).toEqual({ ok: true });
    expect(elevationEvents(subject, noOpEventStart)).toEqual([]);
    expect(state()).toEqual({
      elevationEvents: 1,
      source: "script",
      from: 0,
      to: 1,
      q: 1,
      r: 0
    });

    const restoreEventStart = subject.lastEvents.length;
    expect(subject.emitScriptSignal("restore")).toEqual({ ok: true });
    expect(elevationEvents(subject, restoreEventStart)).toEqual([{
      type: "elevationChanged",
      coord: { q: 1, r: 0 },
      fromElevation: 1,
      toElevation: 0,
      source: "restore"
    }]);
    expect(state()).toEqual({
      elevationEvents: 2,
      source: "restore",
      from: 1,
      to: 0,
      q: 1,
      r: 0
    });
  });

  it("accepts exact safe-integer policy and delta boundaries, then rejects late invalid values atomically", () => {
    const policy = {
      minimum: -1_000_000,
      maximum: 1_000_000,
      maximumDeltaPerOperation: 64
    };
    const accepted = game({
      policy,
      elevationOverrides: [
        { q: 1, r: 0, elevation: -999_936 },
        { q: 2, r: 0, elevation: 999_936 }
      ],
      handlers: {
        boundary: [terraformTiles([
          setElevation({ q: 1, r: 0 }, -1_000_000),
          setElevation({ q: 2, r: 0 }, 1_000_000)
        ])]
      }
    });
    expect(accepted.emitScriptSignal("boundary")).toEqual({ ok: true });
    expect(accepted.map.elevationAt({ q: 1, r: 0 })).toBe(-1_000_000);
    expect(accepted.map.elevationAt({ q: 2, r: 0 })).toBe(1_000_000);

    for (const [label, value, reasonKey] of [
      ["fractional", 1.5, "terraform.elevation_out_of_range"],
      ["non-finite", Number.POSITIVE_INFINITY, "terraform.elevation_out_of_range"],
      ["policy maximum", 1_000_001, "terraform.elevation_out_of_range"],
      ["delta", 65, "terraform.elevation_delta_exceeded"]
    ] as const) {
      const subject = game({
        policy,
        handlers: {
          invalid: [terraformTiles([
            setElevation({ q: 1, r: 0 }, 1),
            setElevation({ q: 2, r: 0 }, value)
          ])]
        }
      });
      const before = subject.getSnapshot();
      const beforeProjection = elevationProjection(subject);
      expect(subject.emitScriptSignal("invalid"), label).toEqual({ ok: true });
      expect(elevationProjection(subject), label).toEqual(beforeProjection);
      expect(subject.map.elevationAt({ q: 1, r: 0 }), label).toBe(0);
      expect(subject.map.elevationAt({ q: 2, r: 0 }), label).toBe(0);
      expectDiagnostic(before, subject.getSnapshot(), reasonKey);
    }
  });

  it("rejects a same-elevation-layer duplicate but permits terrain and elevation on one cell in declared event order", () => {
    const duplicate = game({
      handlers: {
        duplicate: [terraformTiles([
          setElevation({ q: 1, r: 0 }, 1),
          restoreElevation({ q: 1, r: 0 })
        ])]
      }
    });
    const duplicateBefore = duplicate.getSnapshot();
    const duplicateProjection = elevationProjection(duplicate);
    expect(duplicate.emitScriptSignal("duplicate")).toEqual({ ok: true });
    expect(elevationProjection(duplicate)).toEqual(duplicateProjection);
    expectDiagnostic(duplicateBefore, duplicate.getSnapshot(), "terraform.duplicate_target");

    const mixed = game({
      handlers: {
        mixed: [terraformTiles([
          setTerrain("flood", { q: 1, r: 0 }),
          setElevation({ q: 1, r: 0 }, 1)
        ])]
      }
    });
    const eventStart = mixed.lastEvents.length;
    expect(mixed.emitScriptSignal("mixed")).toEqual({ ok: true });
    expect(mixed.map.getTile({ q: 1, r: 0 })?.terrain).toBe("water");
    expect(mixed.map.elevationAt({ q: 1, r: 0 })).toBe(1);
    expect(mixed.getSnapshot().terrainOverrides).toEqual([
      { q: 1, r: 0, terrain: "water", source: "script" }
    ]);
    expect(mixed.getSnapshot().elevation?.overrides).toEqual([
      { q: 1, r: 0, elevation: 1 }
    ]);
    expect(mixed.lastEvents.slice(eventStart)
      .filter((event) => {
        const type = (event as unknown as { type: string }).type;
        return type === "terrainChanged" || type === "elevationChanged";
      })
      .map((event) => ({
        type: event.type,
        coord: (event as unknown as { coord: GridCoord }).coord,
        source: (event as unknown as { source: string }).source
      }))).toEqual([
      { type: "terrainChanged", coord: { q: 1, r: 0 }, source: "script" },
      { type: "elevationChanged", coord: { q: 1, r: 0 }, source: "script" }
    ]);
  });

  it("keeps pure elevation outside dynamic navigation while LoS and high-ground observe it immediately", () => {
    const subject = game({
      navigation: "dynamic_flow",
      width: 6,
      height: 3,
      routes: [route("main", 1, 4, 5)],
      handlers: {
        raise: [terraformTiles([
          setElevation({ q: 0, r: 1 }, 3),
          setElevation({ q: 2, r: 1 }, 4)
        ])]
      }
    });
    expect(subject.placeTower("probe", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const tower = subject.towers[0]!;
    const enemy = subject.enemies[0]!;
    const internal = subject as unknown as RuntimeInternals;
    expect(internal.navigationResolver).toBeDefined();
    expect(internal.navigationFieldLookupCache).toBeDefined();
    expect(internal.navigationEnemyFields).toBeDefined();
    const resolver = internal.navigationResolver!;
    const lookupCache = internal.navigationFieldLookupCache;
    const enemyFields = internal.navigationEnemyFields;
    const navigation = enemy.navigation;
    const stats = resolver.getStats();
    const beforeLoS = subject.analyzeLineOfSight({
      source: { q: 0, r: 1 },
      targets: [{ q: 4, r: 1 }]
    });
    expect(beforeLoS?.rows[0]?.visible).toBe(true);
    expect(internal.enemyInTowerAcquisitionRange(tower, enemy)).toBe(false);
    const resolverFactory = vi.spyOn(internal, "createNavigationResolver");
    let resolverFactoryCalls = 0;

    try {
      expect(subject.emitScriptSignal("raise")).toEqual({ ok: true });
    } finally {
      resolverFactoryCalls = resolverFactory.mock.calls.length;
      resolverFactory.mockRestore();
    }

    expect(resolverFactoryCalls).toBe(0);
    expect(internal.navigationResolver).toBe(resolver);
    expect(internal.navigationFieldLookupCache).toBe(lookupCache);
    expect(internal.navigationEnemyFields).toBe(enemyFields);
    expect(enemy.navigation).toBe(navigation);
    expect(resolver.getStats()).toEqual(stats);
    expect(internal.enemyInTowerAcquisitionRange(tower, enemy)).toBe(true);
    expect(subject.analyzeLineOfSight({
      source: { q: 0, r: 1 },
      targets: [{ q: 4, r: 1 }]
    })?.rows[0]).toEqual(expect.objectContaining({
      visible: false,
      reason: "elevation",
      blocker: expect.objectContaining({ coord: { q: 2, r: 1 }, elevation: 4 })
    }));
  });

  it("accepts 512 elevation and 1,024 combined overrides, then rejects the 513th and 1,025th atomically", () => {
    const handlers: Record<string, readonly ScriptAction[]> = {};
    for (let chunk = 0; chunk < 8; chunk += 1) {
      handlers[`terrain_${chunk}`] = [terraformTiles(
        Array.from({ length: 64 }, (_, index) => (
          setTerrain("flood", { q: chunk * 64 + index, r: 0 })
        ))
      )];
      handlers[`elevation_${chunk}`] = [terraformTiles(
        Array.from({ length: 64 }, (_, index) => (
          setElevation({ q: 512 + chunk * 64 + index, r: 0 }, 1)
        ))
      )];
    }
    handlers.overflow = [terraformTiles([setElevation({ q: 1_024, r: 0 }, 1)])];
    const subject = game({
      width: 1_025,
      height: 2,
      routes: [route("main", 1, 0, 1_024)],
      handlers
    });
    for (let chunk = 0; chunk < 8; chunk += 1) {
      expect(subject.emitScriptSignal(`terrain_${chunk}`)).toEqual({ ok: true });
      expect(subject.emitScriptSignal(`elevation_${chunk}`)).toEqual({ ok: true });
    }
    const boundary = subject.getSnapshot();
    expect(boundary.terrainOverrides).toHaveLength(512);
    expect(boundary.elevation?.overrides).toHaveLength(512);
    expect(boundary.terrainOverrides.length + boundary.elevation!.overrides.length).toBe(1_024);
    const boundaryProjection = elevationProjection(subject);

    expect(subject.emitScriptSignal("overflow")).toEqual({ ok: true });
    expect(elevationProjection(subject)).toEqual(boundaryProjection);
    expect(subject.map.elevationAt({ q: 1_024, r: 0 })).toBe(0);
    expectDiagnostic(boundary, subject.getSnapshot(), "terraform.override_budget_exceeded");
  });
});
