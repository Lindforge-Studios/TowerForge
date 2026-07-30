import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { GameCheckpointV1 } from "./checkpoint.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState, GridCoord } from "./types.js";

type Activation = "active" | "disabled" | "unselected" | "absent" | "authored_routes" | "boss_only";

interface FormationRuntimeStatsV1Contract {
  readonly bucketBuildCount: number;
  readonly bucketEntryCount: number;
  readonly fieldReadCount: number;
  readonly plannerInvocationCount: number;
  readonly neighborEntriesInspected: number;
  readonly maximumNeighborCount: number;
}

interface FormationSnapshotV1Contract {
  readonly schemaVersion: 1;
  readonly enemies: Readonly<Record<string, {
    readonly cohortId: string;
    readonly role: "vanguard" | "body" | "support";
  }>>;
}

interface EnemyBehaviorsSnapshotContract {
  readonly schemaVersion: 1;
  readonly components?: Readonly<Record<string, unknown>>;
  readonly formations?: FormationSnapshotV1Contract;
}

function enemy(id: string) {
  return {
    id,
    label: id,
    maxHp: 100,
    speed: 0.1,
    reward: { coins: 1 },
    coinReward: 1,
    coreDamage: 1,
    color: 1
  };
}

function input(activation: Activation = "active", count = 3): GameContentInput {
  const navigationSelected = activation !== "absent" || activation === "absent";
  const dynamic = activation !== "authored_routes";
  const enemyBehaviorsSelected = activation === "active" || activation === "disabled" || activation === "boss_only";
  const enemyBehaviorsProfileId = activation === "boss_only" ? "bosses" : "formations";
  const mechanicsProfiles: Record<string, string> = {};
  if (navigationSelected) mechanicsProfiles.navigation = "navigation";
  if (enemyBehaviorsSelected) mechanicsProfiles.enemyBehaviors = enemyBehaviorsProfileId;

  return {
    balance: {
      defaultMissionId: "formation_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 100,
        startingCoins: 0,
        startingResources: { coins: 0 },
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
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: {
        guard: enemy("guard"),
        grunt: enemy("grunt"),
        medic: enemy("medic")
      },
      towers: {},
      waveSets: {
        formation_wave: [{
          id: "formation_wave_1",
          label: "Formation",
          groups: [
            { enemyId: "guard", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" },
            { enemyId: "grunt", count, spawnInterval: 0, startDelay: 0, routeId: "main" },
            { enemyId: "medic", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }
          ]
        }]
      },
      missions: {
        formation_lab: {
          id: "formation_lab",
          label: "Formation Lab",
          description: "",
          startingCoreHp: 100,
          startingResources: { coins: 0 },
          prepTimeUnits: 0,
          mapId: "fork",
          waveSetId: "formation_wave",
          buildTowerIds: [],
          abilityIds: [],
          mechanics: { profiles: mechanicsProfiles }
        }
      }
    },
    maps: {
      fork: {
        id: "fork",
        width: 7,
        height: 5,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 1, r: 1 },
        coreCoord: { q: 5, r: 2 },
        pathCenterline: [{ q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }, { q: 5, r: 1 }, { q: 5, r: 2 }],
        pathRoutes: [{
          id: "main",
          pathCenterline: [{ q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }, { q: 5, r: 1 }, { q: 5, r: 2 }]
        }],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            navigation: dynamic ? {
              mode: "dynamic_flow",
              defaultMovementProfileId: "ground",
              movementProfiles: {
                ground: {
                  label: "Ground",
                  terrainMode: "respect_walkable",
                  towerOccupancy: "blocked",
                  defaultTerrainCost: 1_000
                }
              }
            } : { mode: "authored_routes" }
          }
        },
        ...(activation === "absent" ? {} : {
          enemyBehaviors: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: {
              formations: {
                formations: {
                  cohorts: {
                    alpha: {
                      members: { guard: "vanguard", grunt: "body", medic: "support" },
                      steering: {
                        neighborRadius: 2,
                        cohesionWeight: 10,
                        separationWeight: 100,
                        roleWeight: 20
                      }
                    }
                  }
                }
              },
              bosses: {
                bosses: {
                  guard: {
                    components: {
                      shield: {
                        maxHp: 10,
                        hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.2 },
                        tags: ["shield"]
                      }
                    }
                  }
                }
              }
            }
          }
        })
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
        missionId: "formation_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function subject(activation: Activation = "active", count = 3): {
  content: ReturnType<typeof createGameContentRegistry>;
  game: TowerDefenseGame;
} {
  const content = createGameContentRegistry(input(activation, count));
  return {
    content,
    game: new TowerDefenseGame({ content, missionId: "formation_lab", seed: "r12-formations" })
  };
}

function spawn(game: TowerDefenseGame): void {
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0);
  expect(game.enemies.length).toBeGreaterThan(0);
}

function enemyBehaviors(game: TowerDefenseGame): EnemyBehaviorsSnapshotContract | undefined {
  return (game.getSnapshot() as unknown as { enemyBehaviors?: EnemyBehaviorsSnapshotContract }).enemyBehaviors;
}

function stats(game: TowerDefenseGame): FormationRuntimeStatsV1Contract {
  const method = (game as unknown as {
    getFormationSteeringStats?: () => FormationRuntimeStatsV1Contract;
  }).getFormationSteeringStats;
  expect(method, "R12.3 runtime must expose read-only getFormationSteeringStats() counters")
    .toBeTypeOf("function");
  return method!.call(game);
}

function navigation(enemyState: EnemyState): {
  currentCoord: GridCoord;
  nextCoord?: GridCoord;
  edgeProgress: number;
  movementProfileId: string;
} {
  return (enemyState as EnemyState & { navigation: ReturnType<typeof navigation> }).navigation;
}

describe("R12.3 group 3A TowerDefenseGame formation runtime contract (RED)", () => {
  it("publishes an active empty formation section, then binary-ordered membership", () => {
    const { game } = subject("active", 10);
    expect(enemyBehaviors(game)).toEqual({
      schemaVersion: 1,
      components: {},
      formations: { schemaVersion: 1, enemies: {} }
    });

    spawn(game);
    const formations = enemyBehaviors(game)?.formations;
    expect(formations?.schemaVersion).toBe(1);
    expect(Object.keys(formations?.enemies ?? {})).toEqual(
      Object.keys(formations?.enemies ?? {}).sort()
    );
    expect(formations?.enemies).toMatchObject({
      enemy_1: { cohortId: "alpha", role: "vanguard" },
      enemy_2: { cohortId: "alpha", role: "body" },
      enemy_12: { cohortId: "alpha", role: "support" }
    });
  });

  it("writes the exact active formation section to checkpoint and restores it", () => {
    const { content, game } = subject();
    spawn(game);
    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1;
    const checkpointSection = (
      checkpoint.state as unknown as { enemyBehaviors?: EnemyBehaviorsSnapshotContract }
    ).enemyBehaviors;
    expect(checkpointSection).toEqual({
      schemaVersion: 1,
      components: {},
      formations: {
        schemaVersion: 1,
        enemies: {
          enemy_1: { cohortId: "alpha", role: "vanguard" },
          enemy_2: { cohortId: "alpha", role: "body" },
          enemy_3: { cohortId: "alpha", role: "body" },
          enemy_4: { cohortId: "alpha", role: "body" },
          enemy_5: { cohortId: "alpha", role: "support" }
        }
      }
    });

    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(enemyBehaviors(restored)).toEqual(enemyBehaviors(game));
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
  });

  it("selects only an equal-optimal shared-field neighbour at edgeProgress zero", () => {
    const { game } = subject();
    spawn(game);
    const internal = game as unknown as {
      navigationResolver: {
        getField(profileId: string, routeId: string): {
          cells: readonly { coord: GridCoord; distance: number }[];
        };
      };
    };
    for (const enemyState of game.enemies) {
      const movement = navigation(enemyState);
      expect(movement.edgeProgress).toBe(0);
      expect(movement.nextCoord).toBeDefined();
      const field = internal.navigationResolver.getField(movement.movementProfileId, enemyState.routeId!);
      const current = field.cells.find((cell) => cell.coord.q === movement.currentCoord.q && cell.coord.r === movement.currentCoord.r)!;
      const next = field.cells.find((cell) => cell.coord.q === movement.nextCoord!.q && cell.coord.r === movement.nextCoord!.r)!;
      expect(next.distance).toBe(current.distance - 1_000);
    }
    expect(stats(game)).toMatchObject({
      bucketBuildCount: 1,
      bucketEntryCount: game.enemies.length,
      fieldReadCount: game.enemies.length,
      plannerInvocationCount: game.enemies.length
    });
  });

  it("keeps absent/disabled/unselected/authored-routes and boss-only paths free of formation work", () => {
    for (const activation of ["absent", "disabled", "unselected", "authored_routes", "boss_only"] as const) {
      const { game } = subject(activation);
      spawn(game);
      expect(enemyBehaviors(game)?.formations).toBeUndefined();
      expect(((game.createCheckpoint().state as unknown as { enemyBehaviors?: EnemyBehaviorsSnapshotContract })
        .enemyBehaviors)?.formations).toBeUndefined();
      const counters = stats(game);
      expect(counters).toEqual({
        bucketBuildCount: 0,
        bucketEntryCount: 0,
        fieldReadCount: 0,
        plannerInvocationCount: 0,
        neighborEntriesInspected: 0,
        maximumNeighborCount: 0
      });
      expect(Object.isFrozen(counters)).toBe(true);
    }
  });
});
