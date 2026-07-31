import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Topology = "square" | "hex";
type TowerKind = "single" | "pulse";

interface FixtureOptions {
  readonly topology?: Topology;
  readonly dynamic?: boolean;
  readonly blocksLineOfSight?: boolean;
  readonly legacyLineOfSight?: boolean;
}

interface Layout {
  readonly grid: Readonly<Record<string, unknown>>;
  readonly source: { readonly q: number; readonly r: number };
  readonly blocker: { readonly q: number; readonly r: number };
  readonly target: { readonly q: number; readonly r: number };
  readonly core: { readonly q: number; readonly r: number };
}

function layout(topology: Topology): Layout {
  return topology === "hex"
    ? {
        grid: { kind: "hex", layout: "odd-r" },
        source: { q: 0, r: 0 },
        blocker: { q: 0, r: 1 },
        target: { q: 2, r: 2 },
        core: { q: 4, r: 2 }
      }
    : {
        grid: { kind: "square", adjacency: "cardinal" },
        source: { q: 0, r: 1 },
        blocker: { q: 2, r: 1 },
        target: { q: 4, r: 1 },
        core: { q: 4, r: 2 }
      };
}

function input(options: FixtureOptions = {}): GameContentInput {
  const topology = options.topology ?? "square";
  const dynamic = options.dynamic ?? true;
  const legacyLineOfSight = options.legacyLineOfSight ?? false;
  const coords = layout(topology);
  return {
    balance: {
      defaultMissionId: "dynamic_destructible_los",
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
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["ground"]
        },
        spawn: {
          id: "spawn", label: "Spawn", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["ground"]
        },
        core: {
          id: "core", label: "Core", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["ground"]
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        single: {
          id: "single", label: "Single", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 20,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        pulse: {
          id: "pulse", label: "Pulse", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "pulse", pulseRate: 1, pulseDamage: 5,
            dotDamagePerUnit: 1, dotDuration: 1
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        dynamic_destructible_los: {
          id: "dynamic_destructible_los",
          label: "Dynamic destructible LoS",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "field",
          waveSetId: "wave",
          buildTowerIds: ["single", "pulse"],
          abilityIds: [],
          mechanics: {
            profiles: {
              ...(dynamic ? { ballistics: "destructibles" } : {}),
              ...(legacyLineOfSight ? { elevation: "legacy_los" } : {})
            }
          }
        }
      }
    },
    maps: {
      field: {
        id: "field",
        width: 5,
        height: 3,
        grid: coords.grid,
        defaultTerrain: "floor",
        spawnCoord: { ...coords.target },
        coreCoord: { ...coords.core },
        pathCenterline: [{ ...coords.target }, { ...coords.core }],
        pathRoutes: [{ id: "main", pathCenterline: [{ ...coords.target }, { ...coords.core }] }],
        terrainOverrides: [],
        ...(dynamic ? {
          destructibleObjects: [{ id: "gate_1", definitionId: "gate", coord: { ...coords.blocker } }]
        } : {})
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...(dynamic ? {
          ballistics: {
            schemaVersion: 1,
            enabled: true,
            profiles: {
              destructibles: {
                projectiles: {
                  towers: { single: { trajectory: "direct", travelTimeUnits: 0.4 } },
                  destructibles: {
                    definitions: {
                      gate: {
                        maxHp: 20,
                        hitRegion: {
                          kind: "tile",
                          blockerHeight: 2,
                          blocksLineOfSight: options.blocksLineOfSight ?? true
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } : {}),
        ...(legacyLineOfSight ? {
          elevation: {
            schemaVersion: 2,
            enabled: true,
            profiles: { legacy_los: { lineOfSight: { terrainBlockerTags: [] } } }
          }
        } : {})
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "dynamic_destructible_los", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: FixtureOptions = {}, registry = content(options)): TowerDefenseGame {
  return new TowerDefenseGame({
    content: registry,
    missionId: "dynamic_destructible_los",
    seed: "r13.4c4-dynamic-los"
  });
}

function startWithTower(subject: TowerDefenseGame, tower: TowerKind, topology: Topology = "square"): void {
  expect(subject.placeTower(tower, layout(topology).source)).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
}

function fired(subject: TowerDefenseGame, tower: TowerKind): boolean {
  return subject.lastEvents.some((event) => tower === "pulse"
    ? event.type === "areaPulse"
    : event.type === "towerFired");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function destroyedCheckpoint(registry: GameContentRegistry): GameCheckpointV1 {
  const checkpoint = clone(game({}, registry).createCheckpoint());
  const object = (checkpoint.state as unknown as {
    ballistics: { destructibles: { objects: Array<{ hp: number; destroyed: boolean }> } };
  }).ballistics.destructibles.objects[0]!;
  object.hp = 0;
  object.destroyed = true;
  resign(checkpoint);
  return checkpoint;
}

describe("R13.4c4 live dynamic destructible line of sight (RED)", () => {
  it("blocks a single tower on square and hex topology without enabling Elevation LoS", () => {
    for (const topology of ["square", "hex"] as const) {
      const subject = game({ topology });
      startWithTower(subject, "single", topology);
      expect(fired(subject, "single")).toBe(false);
      expect(subject.getSnapshot().enemies[0]).toMatchObject({ hp: 100 });
    }
  });

  it("routes single and pulse acquisition through the shared dynamic LoS gateway", () => {
    for (const tower of ["single", "pulse"] as const) {
      const subject = game();
      startWithTower(subject, tower);
      expect(fired(subject, tower)).toBe(false);
      expect(subject.getSnapshot().enemies[0]).toMatchObject({ hp: 100 });
    }
  });

  it("ignores a live destructible whose authored hit region does not block line of sight", () => {
    const subject = game({ blocksLineOfSight: false });
    startWithTower(subject, "single");
    expect(fired(subject, "single")).toBe(true);
  });

  it("removes a destroyed live object from targeting blockage", () => {
    const registry = content();
    const intact = game({}, registry);
    startWithTower(intact, "single");
    expect(fired(intact, "single")).toBe(false);

    const destroyed = TowerDefenseGame.fromCheckpoint({
      content: registry,
      checkpoint: destroyedCheckpoint(registry)
    });
    startWithTower(destroyed, "single");
    expect(fired(destroyed, "single")).toBe(true);
  });

  it("keeps legacy-only diagnostics exactly V1 and publishes active dynamic V2 blocker provenance", () => {
    const coords = layout("square");
    const legacy = game({ dynamic: false, legacyLineOfSight: true });
    expect(legacy.analyzeLineOfSight({ source: coords.source, targets: [coords.target] })).toEqual({
      schemaVersion: 1,
      profileId: "legacy_los",
      source: coords.source,
      rows: [{ target: coords.target, visible: true, reason: "clear" }],
      coverage: {
        requestedTargets: 1,
        analyzedTargets: 1,
        cellInspections: 3,
        budgetExceeded: false
      }
    });

    const dynamic = game();
    expect(dynamic.analyzeLineOfSight({ source: coords.source, targets: [coords.target] })).toEqual({
      schemaVersion: 2,
      profiles: { ballistics: "destructibles" },
      source: coords.source,
      rows: [{
        target: coords.target,
        visible: false,
        reason: "destructible",
        blocker: {
          coord: coords.blocker,
          terrainId: "floor",
          elevation: 0,
          objectId: "gate_1",
          definitionId: "gate",
          blockerHeight: 2
        }
      }],
      coverage: {
        requestedTargets: 1,
        analyzedTargets: 1,
        cellInspections: 2,
        budgetExceeded: false
      }
    });
  });

  it("keeps dynamic V2 diagnostics active after restore when every authored blocker is destroyed", () => {
    const registry = content();
    const coords = layout("square");
    const restored = TowerDefenseGame.fromCheckpoint({
      content: registry,
      checkpoint: destroyedCheckpoint(registry)
    });

    expect(restored.analyzeLineOfSight({ source: coords.source, targets: [coords.target] })).toEqual({
      schemaVersion: 2,
      profiles: { ballistics: "destructibles" },
      source: coords.source,
      rows: [{ target: coords.target, visible: true, reason: "clear" }],
      coverage: {
        requestedTargets: 1,
        analyzedTargets: 1,
        cellInspections: 3,
        budgetExceeded: false
      }
    });
    expect(restored.createCheckpoint().state).not.toHaveProperty("lineOfSight");
  });

  it("derives identical live blockage after checkpoint restore without persisting a LoS index", () => {
    const registry = content();
    const continuous = game({}, registry);
    const checkpoint = clone(continuous.createCheckpoint());
    expect(checkpoint.state).not.toHaveProperty("lineOfSight");
    const restored = TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint });

    startWithTower(continuous, "single");
    startWithTower(restored, "single");
    expect(fired(continuous, "single")).toBe(false);
    expect(restored.lastEvents).toEqual(continuous.lastEvents);
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
  });
});
