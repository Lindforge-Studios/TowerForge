import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";

interface DirectorReasonContract {
  readonly metric: "damage_share";
  readonly key: "fire";
  readonly operator: "gte";
  readonly threshold: 0.6;
  readonly observed: number;
}

interface DirectorDecisionContract {
  readonly waveIndex: 1;
  readonly counterId: "anti_fire";
  readonly threatCost: 8;
  readonly reason: DirectorReasonContract;
  readonly addedGroups: readonly [{
    readonly enemyId: "fire_guard";
    readonly count: 2;
    readonly spawnInterval: 0.5;
    readonly startDelay: 0;
    readonly routeId: "main";
  }];
}

interface DirectorSnapshotContract {
  readonly schemaVersion: 1;
  readonly profileId: "adaptive";
  readonly decisions: readonly DirectorDecisionContract[];
}

function input(activation: Activation = "active"): GameContentInput {
  const path = Array.from({ length: 7 }, (_, q) => ({ q, r: 1 }));
  const profile = {
    counterPool: {
      anti_fire: {
        label: "Fire Guard",
        priority: 10,
        conditions: [{
          metric: "damage_share",
          key: "fire",
          operator: "gte",
          threshold: 0.6
        }],
        groups: [{
          enemyId: "fire_guard",
          count: 2,
          spawnInterval: 0.5,
          startDelay: 0,
          routeId: "main"
        }],
        threatCost: 8
      }
    },
    threatBudget: { base: 10, perWave: 5 },
    fairness: {
      minimumWaveIndex: 1,
      maxConsecutiveUses: 1,
      maxAddedGroups: 2,
      maxAddedEnemies: 8
    }
  };
  return {
    balance: {
      defaultMissionId: "director",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 1, speed: 0.25,
          reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 1
        },
        fire_guard: {
          id: "fire_guard", label: "Fire Guard", maxHp: 100, speed: 0.25,
          reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 2,
          resistances: { fire: 0.25 }
        }
      },
      towers: {
        flame: {
          id: "flame", label: "Flame", cost: { coins: 1 }, footprintRadius: 0, range: 10,
          attack: {
            kind: "single", damageType: "fire", fireRate: 10, damagePerStack: 100,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        two: [
          {
            id: "first", label: "First",
            groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
          },
          {
            id: "second", label: "Second",
            groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
          }
        ]
      },
      missions: {
        director: {
          id: "director", label: "Director", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 5,
          mapId: "lane", waveSetId: "two", buildTowerIds: ["flame"], abilityIds: [],
          ...(activation === "absent" || activation === "unselected"
            ? {}
            : { mechanics: { profiles: { director: "adaptive" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: path,
        pathRoutes: [{ id: "main", pathCenterline: path }],
        terrainOverrides: []
      }
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          director: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: { adaptive: profile }
          }
        }
      } as unknown as GameContentInput["mechanics"]
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "director", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(activation: Activation = "active"): GameContentRegistry {
  return createGameContentRegistry(input(activation));
}

function movementLayerContent(): GameContentRegistry {
  const authored = input() as any;
  authored.balance.enemies.flyer = {
    id: "flyer", label: "Flyer", maxHp: 10, speed: 0.5,
    reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 3,
    movementKind: "direct_flying", targetClass: "flying"
  };
  authored.balance.towers.skyguard = {
    id: "skyguard", label: "Skyguard", cost: { coins: 1 }, footprintRadius: 0, range: 10,
    attack: {
      kind: "antiair", damageType: "electric", fireRate: 1, damage: 5,
      maxTargetsByLevel: [1, 1, 1, 1], upgradeCosts: [{ coins: 1 }, { coins: 1 }, { coins: 1 }]
    }
  };
  authored.balance.missions.director.buildTowerIds = ["flame", "skyguard"];
  authored.balance.missions.director.mechanics.profiles.navigation = "layers";
  authored.mechanics.modules.navigation = {
    schemaVersion: 1,
    enabled: true,
    profiles: {
      layers: {
        mode: "dynamic_flow",
        defaultMovementProfileId: "ground_layer",
        movementProfiles: {
          ground_layer: {
            label: "Ground", terrainMode: "respect_walkable", towerOccupancy: "blocked", defaultTerrainCost: 1
          },
          air_layer: {
            label: "Air", terrainMode: "ignore_walkable", towerOccupancy: "ignored", defaultTerrainCost: 1
          }
        },
        enemyMovementProfiles: { grunt: "ground_layer", fire_guard: "ground_layer", flyer: "air_layer" }
      }
    }
  };
  authored.mechanics.modules.director.profiles.adaptive = {
    counterPool: {
      anti_air_gap: {
        label: "Anti-air gap",
        priority: 10,
        conditions: [{ metric: "movement_layer_share", key: "air_layer", operator: "gte", threshold: 0.5 }],
        groups: [{ enemyId: "fire_guard", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }],
        threatCost: 1
      }
    },
    threatBudget: { base: 1, perWave: 0 },
    fairness: { minimumWaveIndex: 0, maxConsecutiveUses: 1, maxAddedGroups: 1, maxAddedEnemies: 1 }
  };
  return createGameContentRegistry(authored);
}

function game(subjectContent: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({
    content: subjectContent,
    missionId: "director",
    seed: "director-runtime-contract"
  });
}

function directorSnapshot(subject: Readonly<TowerDefenseGame>): DirectorSnapshotContract | undefined {
  return (subject.getSnapshot() as unknown as { director?: DirectorSnapshotContract }).director;
}

function directorCheckpoint(subject: Readonly<TowerDefenseGame>): DirectorSnapshotContract | undefined {
  return (subject.createCheckpoint().state as unknown as { director?: DirectorSnapshotContract }).director;
}

function hasDirectorDecisionEvent(subject: Readonly<TowerDefenseGame>): boolean {
  return (subject.lastEvents as unknown as readonly { type: string }[])
    .some((event) => event.type === "directorDecision");
}

function dispatchFirstWave(session: JournaledGameSession): void {
  expect(session.dispatch({
    schemaVersion: 1,
    type: "placeTower",
    towerTypeId: "flame",
    coord: { q: 2, r: 0 }
  })).toEqual({ ok: true });
  expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
  for (let guard = 0; guard < 50 && session.game.getSnapshot().waveState !== "between"; guard += 1) {
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
  }
  expect(session.game.getSnapshot().waveState).toBe("between");
  expect(session.game.getSnapshot().startedWaveCount).toBe(1);
}

function startSecondWave(session: JournaledGameSession): DirectorDecisionContract {
  expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
  const events = session.game.lastEvents as unknown as readonly ({ type: string } & Record<string, unknown>)[];
  const decisionIndex = events.findIndex((event) => event.type === "directorDecision");
  const waveStartedIndex = events.findIndex((event) => event.type === "waveStarted" && event.waveIndex === 1);
  expect(decisionIndex).toBeGreaterThanOrEqual(0);
  expect(waveStartedIndex).toBeGreaterThan(decisionIndex);
  return events[decisionIndex] as unknown as DirectorDecisionContract;
}

function runLegacyToSecondStart(activation: Exclude<Activation, "active">): Readonly<TowerDefenseGame> {
  const session = new JournaledGameSession(game(content(activation)));
  dispatchFirstWave(session);
  expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
  return session.game;
}

describe("R7.1 AI Wave Director runtime boundary (RED)", () => {
  it("plans only when the next authored wave starts, explains the choice, and never mutates authored wave input", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(game(subjectContent));
    const authoredNextWave = structuredClone(subjectContent.missions.director!.waves[1]);
    dispatchFirstWave(session);

    expect(directorSnapshot(session.game)).toEqual({
      schemaVersion: 1,
      profileId: "adaptive",
      decisions: []
    });
    expect(hasDirectorDecisionEvent(session.game)).toBe(false);
    expect(subjectContent.missions.director!.waves[1]).toEqual(authoredNextWave);

    const decision = startSecondWave(session);
    expect(decision).toMatchObject({
      type: "directorDecision",
      waveIndex: 1,
      counterId: "anti_fire",
      threatCost: 8,
      reason: {
        metric: "damage_share",
        key: "fire",
        operator: "gte",
        threshold: 0.6,
        observed: 1
      },
      addedGroups: [{ enemyId: "fire_guard", count: 2, routeId: "main" }]
    });
    expect(subjectContent.missions.director!.waves[1]).toEqual(authoredNextWave);
    expect(directorSnapshot(session.game)?.decisions).toEqual([
      expect.objectContaining({ waveIndex: 1, counterId: "anti_fire" })
    ]);

    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.game.enemies.map((enemy) => enemy.typeId)).toContain("fire_guard");
    expect(subjectContent.missions.director!.waves[1]).toEqual(authoredNextWave);
  });

  it("derives movement-layer coverage from actual ground/anti-air targeting and dynamic movement profiles", () => {
    const run = (towerTypeId: "flame" | "skyguard") => {
      const subject = movementLayerContent();
      const runtime = game(subject);
      expect(runtime.placeTower(towerTypeId, { q: 2, r: 0 })).toEqual({ ok: true });
      expect(runtime.startNextWave()).toEqual({ ok: true });
      return runtime.lastEvents.find((event) => event.type === "directorDecision");
    };

    expect(run("skyguard")).toMatchObject({
      type: "directorDecision",
      counterId: "anti_air_gap",
      reason: { metric: "movement_layer_share", key: "air_layer", observed: 1 }
    });
    expect(run("flame")).toBeUndefined();
  });

  it("round-trips decision history through checkpoint restore and command replay with the same digest", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(game(subjectContent));
    dispatchFirstWave(session);
    startSecondWave(session);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });

    const checkpoint = session.game.createCheckpoint();
    expect((checkpoint.state as unknown as { director?: DirectorSnapshotContract }).director).toEqual(
      directorSnapshot(session.game)
    );
    expect(directorCheckpoint(session.game)?.decisions).toHaveLength(1);
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(directorSnapshot(restored)).toEqual(directorSnapshot(session.game));
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());

    const journal = session.exportJournal();
    const replay = replayGameCommandJournal({ content: subjectContent, journal });
    expect(directorSnapshot(replay.game)).toEqual(directorSnapshot(session.game));
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("rejects a re-signed Director reason that is not an authored, satisfied condition", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(game(subjectContent));
    dispatchFirstWave(session);
    startSecondWave(session);
    const checkpoint = structuredClone(session.game.createCheckpoint()) as any;
    checkpoint.state.director.decisions[0].reason.threshold = 0.9;
    checkpoint.state.director.decisions[0].reason.observed = 0.1;
    const lastDecision = checkpoint.state.lastEvents.find((event: any) => event.type === "directorDecision");
    if (lastDecision) {
      lastDecision.reason.threshold = 0.9;
      lastDecision.reason.observed = 0.1;
    }
    checkpoint.stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest,
      checkpoint.identity,
      checkpoint.rng as GameCheckpointV1["rng"],
      checkpoint.state as GameCheckpointV1["state"]
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/director.*reason|authored.*condition|condition.*satisfied/i);
  });

  it("keeps absent, disabled, and unselected games on the exact legacy state shape without Director events", () => {
    const baseline = runLegacyToSecondStart("absent");
    const baselineSnapshot = baseline.getSnapshot();
    const baselineState = baseline.createCheckpoint().state;
    expect(baselineSnapshot).not.toHaveProperty("director");
    expect(baselineState).not.toHaveProperty("director");
    expect(hasDirectorDecisionEvent(baseline)).toBe(false);

    for (const activation of ["disabled", "unselected"] as const) {
      const subject = runLegacyToSecondStart(activation);
      expect(subject.getSnapshot()).toEqual(baselineSnapshot);
      expect(subject.createCheckpoint().state).toEqual(baselineState);
      expect(subject.createCheckpoint().stateDigest).toBe(subject.getStateDigest());
      expect(hasDirectorDecisionEvent(subject)).toBe(false);
      expect((subject.getSnapshot() as unknown as { director?: unknown }).director).toBeUndefined();
      expect((subject.createCheckpoint().state as unknown as { director?: unknown }).director).toBeUndefined();
    }
  });
});
