import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

interface RuntimeStats {
  readonly bucketBuildCount: number;
  readonly bucketEntryCount: number;
  readonly fieldReadCount: number;
  readonly plannerInvocationCount: number;
  readonly neighborEntriesInspected: number;
  readonly maximumNeighborCount: number;
}

interface FixtureOptions {
  readonly count?: number;
  readonly partitioned?: boolean;
  readonly reverseContent?: boolean;
}

function enemy(id: string) {
  return {
    id, label: id, maxHp: 100, speed: 0.05, reward: { coins: 1 }, coinReward: 1,
    coreDamage: 1, color: 1
  };
}

function registry(options: FixtureOptions = {}) {
  const types = options.reverseContent
    ? { medic: enemy("medic"), grunt: enemy("grunt"), guard: enemy("guard") }
    : { guard: enemy("guard"), grunt: enemy("grunt"), medic: enemy("medic") };
  const groups = options.partitioned ? [
    { enemyId: "grunt", count: 6, spawnInterval: 0, startDelay: 0, routeId: "main" },
    { enemyId: "guard", count: 6, spawnInterval: 0, startDelay: 0, routeId: "other" },
    { enemyId: "medic", count: 6, spawnInterval: 0, startDelay: 0, routeId: "main" }
  ] : [
    { enemyId: "grunt", count: options.count ?? 6, spawnInterval: 0, startDelay: 0, routeId: "main" }
  ];
  const input = {
    balance: {
      defaultMissionId: "formation_scale",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 10_000, startingCoins: 0,
        startingResources: { coins: 0 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: types,
      towers: {},
      waveSets: {
        scale: [{ id: "scale_1", label: "Scale", groups }]
      },
      missions: {
        formation_scale: {
          id: "formation_scale", label: "Formation Scale", description: "",
          startingCoreHp: 10_000, startingResources: { coins: 0 }, prepTimeUnits: 0,
          mapId: "fork", waveSetId: "scale", buildTowerIds: [], abilityIds: [],
          mechanics: { profiles: { navigation: "flow", enemyBehaviors: "formations" } }
        }
      }
    },
    maps: {
      fork: {
        id: "fork", width: 9, height: 5, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { q: 1, r: 2 }, coreCoord: { q: 7, r: 2 },
        pathCenterline: Array.from({ length: 7 }, (_, index) => ({ q: index + 1, r: 2 })),
        pathRoutes: [
          { id: "main", pathCenterline: Array.from({ length: 7 }, (_, index) => ({ q: index + 1, r: 2 })) },
          { id: "other", pathCenterline: [
            { q: 1, r: 2 }, { q: 2, r: 2 }, { q: 3, r: 2 }, { q: 4, r: 2 },
            { q: 5, r: 2 }, { q: 6, r: 2 }, { q: 7, r: 2 }, { q: 7, r: 3 }
          ] }
        ],
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
            flow: {
              mode: "dynamic_flow",
              defaultMovementProfileId: "ground",
              movementProfiles: {
                ground: {
                  label: "Ground", terrainMode: "respect_walkable", towerOccupancy: "blocked",
                  defaultTerrainCost: 1_000
                },
                support: {
                  label: "Support", terrainMode: "respect_walkable", towerOccupancy: "blocked",
                  defaultTerrainCost: 1_000
                }
              },
              enemyMovementProfiles: { medic: "support" }
            }
          }
        },
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            formations: {
              formations: {
                cohorts: {
                  alpha: {
                    members: options.reverseContent
                      ? { medic: "support", grunt: "body", guard: "vanguard" }
                      : { guard: "vanguard", grunt: "body", medic: "support" },
                    steering: {
                      neighborRadius: 2, cohesionWeight: 10, separationWeight: 100, roleWeight: 20
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "formation_scale", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}, seed = "r12-formation-scale") {
  const content = registry(options);
  return { content, game: new TowerDefenseGame({ content, missionId: "formation_scale", seed }) };
}

function spawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
}

function stats(subject: TowerDefenseGame): RuntimeStats {
  const method = (subject as unknown as { getFormationSteeringStats(): RuntimeStats })
    .getFormationSteeringStats;
  expect(method).toBeTypeOf("function");
  return method.call(subject);
}

function formations(subject: TowerDefenseGame): Record<string, { cohortId: string; role: string }> {
  return (subject.getSnapshot() as any).enemyBehaviors.formations.enemies;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rehash(checkpoint: GameCheckpointV1): void {
  (checkpoint as any).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
  );
}

describe("R12.3 group 3B formation runtime state, determinism, and scale contract (RED)", () => {
  it("cleans dead membership and rejects missing, stale, or malformed checkpoint formation state", () => {
    const { content, game: subject } = game();
    spawn(subject);
    subject.enemies[0]!.hp = 0;
    subject.tick(0);
    expect(formations(subject)).not.toHaveProperty("enemy_1");

    const missing = jsonClone(subject.createCheckpoint());
    delete (missing.state as any).enemyBehaviors.formations;
    rehash(missing);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: missing }))
      .toThrow(/enemyBehaviors|formation|required/i);

    const stale = jsonClone(subject.createCheckpoint());
    (stale.state as any).enemyBehaviors.formations.enemies.enemy_1 = { cohortId: "alpha", role: "body" };
    rehash(stale);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: stale }))
      .toThrow(/formation|enemy_1|stale|canonical/i);

    const wrongRole = jsonClone(subject.createCheckpoint());
    const liveId = Object.keys((wrongRole.state as any).enemyBehaviors.formations.enemies)[0]!;
    (wrongRole.state as any).enemyBehaviors.formations.enemies[liveId].role = "leader";
    rehash(wrongRole);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: wrongRole }))
      .toThrow(/formation|role|vanguard|body|support/i);
  });

  it("matches continuous, checkpoint restore, and unchanged journal replay digests", () => {
    const { content, game: continuous } = game({}, "resume");
    spawn(continuous);
    const restored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: jsonClone(continuous.createCheckpoint())
    });
    continuous.tick(0.2);
    restored.tick(0.2);
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    const session = new JournaledGameSession(new TowerDefenseGame({
      content, missionId: "formation_scale", seed: "journal"
    }));
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const replay = replayGameCommandJournal({ content, journal: jsonClone(session.exportJournal()) });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("partitions immutable once-per-tick buckets by cohort, movement profile, and goal", () => {
    const { game: subject } = game({ partitioned: true });
    spawn(subject);
    const counters = stats(subject);
    expect(counters).toMatchObject({
      bucketBuildCount: 3,
      bucketEntryCount: 18,
      fieldReadCount: 18,
      plannerInvocationCount: 18
    });
    expect(counters.maximumNeighborCount).toBeLessThanOrEqual(5);
    expect(Object.isFrozen(counters)).toBe(true);
  });

  it("is invariant to content and live enemy iteration order", () => {
    const normal = game({}, "permutation").game;
    const reversed = game({ reverseContent: true }, "permutation").game;
    spawn(normal);
    spawn(reversed);
    reversed.enemies.reverse();
    normal.tick(0.1);
    reversed.tick(0.1);
    expect(reversed.getStateDigest()).toBe(normal.getStateDigest());
    expect(reversed.getSnapshot()).toEqual(normal.getSnapshot());
  });

  it("does not re-plan an enemy already inside an edge", () => {
    const { game: subject } = game();
    spawn(subject);
    const before = stats(subject).plannerInvocationCount;
    expect(before).toBeGreaterThan(0);
    for (const enemyState of subject.enemies) (enemyState as any).navigation.edgeProgress = 0.5;
    subject.tick(0);
    expect(stats(subject).plannerInvocationCount).toBe(before);
  });

  it.each([500, 1_000])("serves %i enemies with one shared field and bounded linear bucket work", (count) => {
    const { game: subject } = game({ count });
    spawn(subject);
    const formation = stats(subject);
    const navigation = (subject as any).navigationResolver.getStats();
    expect(navigation.fieldBuildCount).toBe(1);
    expect(formation).toMatchObject({
      bucketBuildCount: 1,
      bucketEntryCount: count,
      fieldReadCount: count,
      plannerInvocationCount: count
    });
    expect(formation.maximumNeighborCount).toBeLessThanOrEqual(16);
    expect(formation.neighborEntriesInspected).toBeLessThanOrEqual(count * 32);
  });
});
