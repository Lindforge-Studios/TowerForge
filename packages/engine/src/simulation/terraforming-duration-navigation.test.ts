import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridCoord } from "./types.js";

type ScriptAction = Record<string, unknown>;
type NavigationMode = "authored_routes" | "dynamic_flow";

interface ExpiryTargetSnapshot {
  readonly layer: "terrain" | "elevation";
  readonly q: number;
  readonly r: number;
}

interface ExpiryGroupSnapshot {
  readonly sequence: number;
  readonly remaining: number;
  readonly targets: readonly ExpiryTargetSnapshot[];
}

interface TerraformingSnapshotV1 {
  readonly schemaVersion: 1;
  readonly pendingExpiryGroups: readonly ExpiryGroupSnapshot[];
}

interface FixtureOptions {
  readonly activeTerraforming?: boolean;
  readonly navigationMode?: NavigationMode;
  readonly width?: number;
  readonly height?: number;
  readonly authoredWalls?: readonly GridCoord[];
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
  readonly enemySpeed?: number;
}

interface RuntimeInternals {
  readonly runtimeTerrainOverrides: Map<string, unknown>;
  readonly navigationResolver?: {
    getStats(): { fieldBuildCount: number; fieldQueryCount: number; generation: number };
  };
  readonly navigationFieldLookupCache?: unknown;
  readonly navigationEnemyFields: Map<string, unknown>;
  createNavigationResolver(
    occupiedCoords?: readonly GridCoord[],
    terrainByCoord?: Readonly<Record<string, string>>
  ): unknown;
}

function terraformTiles(
  operations: readonly Record<string, unknown>[],
  duration?: number
): ScriptAction {
  return {
    action: "terraformTiles",
    operations,
    ...(duration === undefined ? {} : { duration })
  };
}

function setTerrain(target: GridCoord, transitionId = "wet"): Record<string, unknown> {
  return { kind: "set_terrain", target, transitionId };
}

function restoreTerrain(target: GridCoord): Record<string, unknown> {
  return { kind: "restore_terrain", target };
}

function durationContent(options: FixtureOptions = {}) {
  const activeTerraforming = options.activeTerraforming ?? true;
  const navigationMode = options.navigationMode ?? "dynamic_flow";
  const width = options.width ?? 5;
  const height = options.height ?? 2;
  const pathCenterline = Array.from({ length: width }, (_, q) => ({ q, r: 0 }));
  const signalHandlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => ({
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  }));
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "duration_runtime",
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
        path: {
          id: "path", label: "Path", buildable: false, walkable: true,
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
      abilities: {
        path_water: {
          id: "path_water", label: "Path water", cooldown: 1, duration: 1, radius: 1
        }
      },
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: options.enemySpeed ?? 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
        }]
      },
      missions: {
        duration_runtime: {
          id: "duration_runtime", label: "Duration runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: [], abilityIds: ["path_water"],
          mechanics: {
            profiles: {
              navigation: navigationMode === "dynamic_flow" ? "flow" : "authored",
              ...(activeTerraforming ? { terraforming: "mutable" } : {})
            }
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width, height,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "path",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: width - 1, r: 0 },
        pathCenterline,
        pathRoutes: [{ id: "main", pathCenterline }],
        terrainOverrides: (options.authoredWalls ?? []).map(({ q, r }) => ({ q, r, terrain: "wall" }))
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: navigationMode === "dynamic_flow"
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
        ...(activeTerraforming ? {
          terraforming: {
            schemaVersion: 1,
            enabled: true,
            profiles: {
              mutable: {
                terrainTransitions: {
                  wet: { fromTerrainTags: ["mutable", "dry"], toTerrainId: "water" },
                  repair: { fromTerrainTags: ["blocked"], toTerrainId: "water" }
                }
              }
            }
          }
        } : {})
      }
    },
    scripts: {
      duration_runtime: {
        schemaVersion: 6,
        id: "duration_runtime",
        bindings: [{ scope: "global" }],
        handlers: { signal: signalHandlers }
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
        missionId: "duration_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "duration_runtime",
    content: durationContent(options),
    seed: "terraform-duration-c3b"
  });
}

function terrainAt(subject: TowerDefenseGame, coord: GridCoord): string | undefined {
  return subject.getSnapshot().tiles.find((tile) => tile.q === coord.q && tile.r === coord.r)?.terrain;
}

function terraforming(snapshot: GameSnapshot): TerraformingSnapshotV1 | undefined {
  return (snapshot as unknown as { readonly terraforming?: TerraformingSnapshotV1 }).terraforming;
}

function internals(subject: TowerDefenseGame): RuntimeInternals {
  return subject as unknown as RuntimeInternals;
}

function diagnosticsSince(snapshot: GameSnapshot, count: number) {
  return snapshot.scriptState.diagnostics.slice(count);
}

describe("R3.4b C3B timed terraforming navigation and legacy ownership", () => {
  it.each([
    ["authored", "authored_routes"],
    ["dynamic", "dynamic_flow"]
  ] as const)("retains an unsafe due group at zero on %s navigation without publishing partial state", (
    _label,
    navigationMode
  ) => {
    const target = { q: 2, r: 0 };
    const subject = game({
      navigationMode,
      height: 1,
      authoredWalls: [target],
      handlers: {
        repair: [terraformTiles([setTerrain(target, "repair")], 0.1)]
      }
    });
    expect(subject.emitScriptSignal("repair")).toEqual({ ok: true });
    const armed = subject.getSnapshot();
    const internal = internals(subject);
    const identities = {
      map: subject.map,
      overrides: internal.runtimeTerrainOverrides,
      resolver: internal.navigationResolver,
      lookup: internal.navigationFieldLookupCache,
      fields: internal.navigationEnemyFields,
      stats: internal.navigationResolver?.getStats()
    };
    expect(terraforming(armed)).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 0.1,
        targets: [{ layer: "terrain", q: 2, r: 0 }]
      }]
    });

    subject.tick(0.1);
    const due = subject.getSnapshot();

    expect(terrainAt(subject, target)).toBe("water");
    expect(terraforming(due)).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 0,
        targets: [{ layer: "terrain", q: 2, r: 0 }]
      }]
    });
    expect(due.lastEvents.filter((event) => event.type === "terrainChanged" || event.type === "elevationChanged"))
      .toEqual([]);
    expect(subject.map).toBe(identities.map);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookup);
    expect(internal.navigationEnemyFields).toBe(identities.fields);
    expect(internal.navigationResolver?.getStats()).toEqual(identities.stats);
  });

  it("retries a retained dynamic due group silently and atomically on the first zero tick after unblocking", () => {
    const dueTarget = { q: 2, r: 0 };
    const bypassTarget = { q: 2, r: 1 };
    const subject = game({
      authoredWalls: [dueTarget, bypassTarget],
      handlers: {
        timed_repair: [terraformTiles([setTerrain(dueTarget, "repair")], 0.1)],
        unblock: [terraformTiles([setTerrain(bypassTarget, "repair")])]
      }
    });
    expect(subject.emitScriptSignal("timed_repair")).toEqual({ ok: true });
    subject.tick(0.1);
    const due = subject.getSnapshot();
    expect(terraforming(due)?.pendingExpiryGroups[0]?.remaining).toBe(0);
    expect(terrainAt(subject, dueTarget)).toBe("water");

    expect(subject.emitScriptSignal("unblock")).toEqual({ ok: true });
    const diagnosticCount = subject.getSnapshot().scriptState.diagnostics.length;
    subject.tick(0);
    const restored = subject.getSnapshot();

    expect(terrainAt(subject, dueTarget)).toBe("wall");
    expect(terrainAt(subject, bypassTarget)).toBe("water");
    expect(terraforming(restored)).toEqual({ schemaVersion: 1, pendingExpiryGroups: [] });
    expect(diagnosticsSince(restored, diagnosticCount)).toEqual([]);
    expect(restored.lastEvents.filter((event) => event.type === "terrainChanged")).toEqual([
      expect.objectContaining({
        coord: dueTarget,
        fromTerrain: "water",
        toTerrain: "wall",
        source: "restore"
      })
    ]);
  });

  it("combines simultaneous due groups into one navigation proof and preserves sequence then operation order", () => {
    const subject = game({
      handlers: {
        first: [terraformTiles([
          setTerrain({ q: 3, r: 1 }),
          setTerrain({ q: 1, r: 1 })
        ], 0.1)],
        second: [terraformTiles([
          setTerrain({ q: 4, r: 1 }),
          setTerrain({ q: 0, r: 1 })
        ], 0.1)],
        later: [terraformTiles([setTerrain({ q: 2, r: 1 })], 0.2)]
      }
    });
    expect(subject.emitScriptSignal("first")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("second")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("later")).toEqual({ ok: true });
    const internal = internals(subject);
    const resolverFactory = vi.spyOn(internal, "createNavigationResolver");

    try {
      subject.tick(0.1);
    } finally {
      expect(resolverFactory).toHaveBeenCalledTimes(2);
      resolverFactory.mockRestore();
    }
    const snapshot = subject.getSnapshot();

    expect(snapshot.lastEvents.filter((event) => event.type === "terrainChanged").map((event) => event.coord))
      .toEqual([
        { q: 3, r: 1 }, { q: 1, r: 1 },
        { q: 4, r: 1 }, { q: 0, r: 1 }
      ]);
    expect(terraforming(snapshot)?.pendingExpiryGroups).toEqual([{
      sequence: 3,
      remaining: expect.closeTo(0.1),
      targets: [{ layer: "terrain", q: 2, r: 1 }]
    }]);
    expect(terrainAt(subject, { q: 2, r: 1 })).toBe("water");
  });

  it("publishes a due restore before enemy movement in the same tick", () => {
    const timed = game({
      navigationMode: "authored_routes",
      enemySpeed: 1,
      handlers: {
        wet: [terraformTiles([setTerrain({ q: 1, r: 0 })], 0.1)]
      }
    });
    const control = game({ navigationMode: "authored_routes", enemySpeed: 1 });
    expect(timed.startNextWave()).toEqual({ ok: true });
    expect(control.startNextWave()).toEqual({ ok: true });
    timed.tick(0);
    control.tick(0);
    expect(timed.emitScriptSignal("wet")).toEqual({ ok: true });
    expect(terrainAt(timed, { q: 1, r: 0 })).toBe("water");
    expect(terraforming(timed.getSnapshot())?.pendingExpiryGroups).toEqual([{
      sequence: 1,
      remaining: 0.1,
      targets: [{ layer: "terrain", q: 1, r: 0 }]
    }]);

    timed.tick(0.1);
    control.tick(0.1);

    expect(terrainAt(timed, { q: 1, r: 0 })).toBe("path");
    expect(timed.enemies[0]?.pathProgress).toBe(control.enemies[0]?.pathProgress);
    expect(timed.enemies[0]?.navigation).toEqual(control.enemies[0]?.navigation);
  });

  it("rejects cross-owner legacy/native writes atomically without expiry drift or path-water cooldown", () => {
    const legacyTarget = { q: 3, r: 1 };
    const nativeTarget = { q: 1, r: 0 };
    const subject = game({
      handlers: {
        native_hits_legacy: [terraformTiles([restoreTerrain(legacyTarget)])],
        native: [terraformTiles([setTerrain(nativeTarget)], 1)],
        legacy_set: [{
          action: "setTileTerrain", target: nativeTarget, terrainId: "water", duration: 0.5
        }],
        legacy_restore: [{ action: "restoreTileTerrain", target: nativeTarget }]
      }
    });
    internals(subject).runtimeTerrainOverrides.set("3,1", {
      ...legacyTarget, terrain: "water", source: "script", expiresIn: 1
    });
    subject.map.setTerrain(legacyTarget, "water");
    const beforeNativeCollision = subject.getSnapshot();
    expect(subject.emitScriptSignal("native_hits_legacy")).toEqual({ ok: true });
    const afterNativeCollision = subject.getSnapshot();
    expect(afterNativeCollision.terrainOverrides.find((entry) => (
      entry.q === legacyTarget.q && entry.r === legacyTarget.r
    ))).toEqual({ ...legacyTarget, terrain: "water", source: "script", expiresIn: 1 });
    expect(diagnosticsSince(afterNativeCollision, beforeNativeCollision.scriptState.diagnostics.length)).toEqual([
      expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.target_owned" })
    ]);

    expect(subject.emitScriptSignal("native")).toEqual({ ok: true });
    const nativeState = terraforming(subject.getSnapshot());
    for (const signal of ["legacy_set", "legacy_restore"] as const) {
      const before = subject.getSnapshot();
      expect(subject.emitScriptSignal(signal)).toEqual({ ok: true });
      const after = subject.getSnapshot();
      expect(terraforming(after)).toEqual(nativeState);
      expect(terrainAt(subject, nativeTarget)).toBe("water");
      expect(diagnosticsSince(after, before.scriptState.diagnostics.length)).toEqual([
        expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.target_owned" })
      ]);
    }

    const beforeAbility = subject.getSnapshot();
    expect(subject.useAbility("path_water", nativeTarget)).toEqual(expect.objectContaining({ ok: false }));
    const afterAbility = subject.getSnapshot();
    expect(afterAbility.tiles).toEqual(beforeAbility.tiles);
    expect(afterAbility.terrainOverrides).toEqual(beforeAbility.terrainOverrides);
    expect(terraforming(afterAbility)).toEqual(terraforming(beforeAbility));
    expect(afterAbility.abilities.path_water?.cooldownRemaining).toBe(0);
    expect(afterAbility.lastEvents.filter((event) => event.type === "waterAbilityUsed")).toEqual([]);
  });

  it("expires disjoint legacy state before native state while preserving the inactive legacy golden path", () => {
    const handlers = {
      native: [terraformTiles([setTerrain({ q: 1, r: 1 })], 0.2)],
      legacy: [{
        action: "setTileTerrain", target: { q: 3, r: 1 }, terrainId: "water", duration: 0.1
      }]
    } as const;
    const subject = game({ handlers });
    expect(subject.emitScriptSignal("native")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("legacy")).toEqual({ ok: true });

    subject.tick(0.1);
    const midway = subject.getSnapshot();
    expect(terrainAt(subject, { q: 3, r: 1 })).toBe("path");
    expect(terrainAt(subject, { q: 1, r: 1 })).toBe("water");
    expect(terraforming(midway)?.pendingExpiryGroups).toEqual([{
      sequence: 1,
      remaining: expect.closeTo(0.1),
      targets: [{ layer: "terrain", q: 1, r: 1 }]
    }]);

    subject.tick(0.1);
    expect(terrainAt(subject, { q: 1, r: 1 })).toBe("path");
    expect(terraforming(subject.getSnapshot())).toEqual({ schemaVersion: 1, pendingExpiryGroups: [] });

    const inactive = game({ activeTerraforming: false, handlers: { legacy: handlers.legacy } });
    expect(inactive.emitScriptSignal("legacy")).toEqual({ ok: true });
    expect(terraforming(inactive.getSnapshot())).toBeUndefined();
    expect(inactive.getSnapshot().terrainOverrides).toEqual([
      { q: 3, r: 1, terrain: "water", source: "script", expiresIn: 0.1 }
    ]);
    inactive.tick(0.1);
    const expired = inactive.getSnapshot();
    expect(terraforming(expired)).toBeUndefined();
    expect(expired.terrainOverrides).toEqual([]);
    expect(terrainAt(inactive, { q: 3, r: 1 })).toBe("path");
    expect(expired.lastEvents).toContainEqual(expect.objectContaining({
      type: "terrainChanged",
      coord: { q: 3, r: 1 },
      fromTerrain: "water",
      toTerrain: "path",
      source: "restore"
    }));
  });
});
