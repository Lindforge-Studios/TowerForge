import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest } from "../simulation/checkpoint.js";

function asymmetricInput(cost = 10): GameContentInput {
  return {
    balance: {
      defaultMissionId: "duel",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 40,
        startingResources: { coins: 40 }, prepTimeUnits: 2, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 5, pathWaterDurationUnits: 3,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 10, speed: 0.5,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x778899
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 5 }, footprintRadius: 0, range: 5,
          attack: { kind: "single", fireRate: 1, damagePerStack: 2, startingStacks: 1, maxStacks: 2, upgradeCost: 2 }
        }
      },
      waveSets: { one: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: {
        duel: {
          id: "duel", label: "Duel", description: "", startingCoreHp: 20,
          startingResources: { coins: 40 }, prepTimeUnits: 2, mapId: "lane", waveSetId: "one",
          buildTowerIds: ["pelter"], abilityIds: [], mechanics: { profiles: { multiplayer: "duel" } }
        },
        duel_alt: {
          id: "duel_alt", label: "Duel alternate", description: "", startingCoreHp: 20,
          startingResources: { coins: 40 }, prepTimeUnits: 2, mapId: "lane", waveSetId: "one",
          buildTowerIds: ["pelter"], abilityIds: [], mechanics: { profiles: { multiplayer: "duel" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        multiplayer: {
          schemaVersion: 2,
          enabled: true,
          profiles: {
            duel: {
              mode: "asymmetric_send_vs_build",
              fixedTickUnits: 0.25,
              maxPlayers: 2,
              ownership: { towerControl: "owner_only", resources: "partitioned", routes: "partitioned" },
              sendPool: {
                grunt_send: {
                  enemyTypeId: "grunt",
                  cost: { coins: cost },
                  income: { coins: 2 },
                  spawnDelayUnits: 0
                }
              }
            }
          }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#fff", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [
        { missionId: "duel", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] },
        { missionId: "duel_alt", regionId: "r", x: 6, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }
      ]
    }
  };
}

function sendEnvelope(sequence = 0, sendId = "grunt_send", matchSequence = 0) {
  return {
    schemaVersion: 1, matchId: "duel_1", playerId: "alice", sequence, matchSequence, applyTick: 0,
    command: { schemaVersion: 1, type: "sendEnemy", sendId }
  };
}

function gameEnvelope(playerId: string, sequence: number, command: Record<string, unknown>, matchSequence = 0) {
  return {
    schemaVersion: 1, matchId: "duel_1", playerId, sequence, matchSequence, applyTick: 0, command
  };
}

describe("R8.2 asymmetric send-vs-build contract (RED)", () => {
  it("atomically debits cost, grants authored income, and injects the enemy into the opponent lane", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput());
    const session = api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed: "duel-seed", players: [{ id: "alice" }, { id: "bob" }]
    });

    expect(session.dispatch(sendEnvelope())).toMatchObject({ ok: true, sendId: "grunt_send", targetPlayerId: "bob" });
    expect(session.getSnapshot().lanes.alice!.resources.coins).toBe(32);
    expect(session.getSnapshot().lanes.bob!.enemies).toHaveLength(0);
    session.advanceTick();
    expect(session.getSnapshot().lanes.bob!.enemies.map((enemy: any) => enemy.typeId)).toEqual(["grunt"]);
  });

  it("leaves both lanes byte-equivalent when funds are insufficient or the send id is unknown", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput(100));
    const session = api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed: "duel-seed", players: [{ id: "alice" }, { id: "bob" }]
    });
    const before = session.getSnapshot();
    expect(session.dispatch(sendEnvelope())).toMatchObject({ ok: false, code: "insufficient_resources" });
    expect(session.getSnapshot()).toEqual(before);
    expect(session.dispatch(sendEnvelope(0, "missing"))).toMatchObject({ ok: false, code: "send_not_authored" });
    expect(session.getSnapshot()).toEqual(before);
  });

  it("accepts ordinary build commands only in the sending player's own lane and keeps fixed ticks session-owned", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput());
    const session = api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed: "duel-seed", players: [{ id: "alice" }, { id: "bob" }]
    });

    expect(session.dispatch(gameEnvelope("alice", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 }
    }))).toMatchObject({ ok: true, acceptedSequence: 0, lanePlayerId: "alice" });
    expect(session.getSnapshot().lanes.alice!.towers).toHaveLength(1);
    expect(session.getSnapshot().lanes.bob!.towers).toHaveLength(0);
    expect(session.dispatch(gameEnvelope("bob", 0, {
      schemaVersion: 6, type: "tick", units: 0.25
    }, 1))).toEqual({ ok: false, code: "tick_owned_by_session" });
  });

  it("replays linked lane commands and sends to the identical match checksum", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput());
    const session = api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed: "duel-seed", players: [{ id: "alice" }, { id: "bob" }]
    });
    expect(session.dispatch(gameEnvelope("alice", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 }
    }))).toMatchObject({ ok: true });
    expect(session.dispatch(sendEnvelope(1, "grunt_send", 1))).toMatchObject({ ok: true });
    expect(session.dispatch(gameEnvelope("bob", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 2, r: 0 }
    }, 2))).toMatchObject({ ok: true });
    session.advanceTick();
    const replay = api.replayAsymmetricMatchJournal({ content, journal: session.exportJournal() });
    expect(replay.checksum).toBe(session.getSnapshot().checksum);
    expect(replay.session.getSnapshot()).toEqual(session.getSnapshot());

    const futureKind: any = structuredClone(session.exportJournal());
    futureKind.entries.at(-1).kind = "future_tick";
    expect(() => api.replayAsymmetricMatchJournal({ content, journal: futureKind }))
      .toThrow(/malformed|kind|entry/i);
    const nonArray: any = structuredClone(session.exportJournal());
    nonArray.entries = {};
    expect(() => api.replayAsymmetricMatchJournal({ content, journal: nonArray }))
      .toThrow(/malformed|entries|journal/i);

    const mismatchedLane: any = structuredClone(session.exportJournal());
    mismatchedLane.initialCheckpoints.bob.identity.missionId = "duel_alt";
    mismatchedLane.initialCheckpoints.bob.stateDigest = computeCheckpointStateDigest(
      mismatchedLane.initialCheckpoints.bob.contentDigest,
      mismatchedLane.initialCheckpoints.bob.identity,
      mismatchedLane.initialCheckpoints.bob.rng,
      mismatchedLane.initialCheckpoints.bob.state
    );
    expect(() => api.replayAsymmetricMatchJournal({ content, journal: mismatchedLane }))
      .toThrow(/lane.*identity|identity.*inconsistent/i);

    const accessorLane: any = structuredClone(session.exportJournal());
    let getterInvoked = false;
    const bobCheckpoint = accessorLane.initialCheckpoints.bob;
    Object.defineProperty(accessorLane.initialCheckpoints, "bob", {
      enumerable: true,
      get() { getterInvoked = true; return bobCheckpoint; }
    });
    expect(() => api.replayAsymmetricMatchJournal({ content, journal: accessorLane })).toThrow();
    expect(getterInvoked).toBe(false);
  });

  it("bounds accepted asymmetric work before either lane mutates", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput());
    const session: any = api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed: "duel-seed", players: [{ id: "alice" }, { id: "bob" }]
    });
    session.entries.length = api.MULTIPLAYER_LIMITS.journalEntries;
    const before = session.getSnapshot();
    expect(() => session.dispatch(sendEnvelope())).toThrow(/journal.*capacity|capacity.*journal/i);
    expect(() => session.advanceTick()).toThrow(/journal.*capacity|capacity.*journal/i);
    expect(session.getSnapshot()).toEqual(before);
  });

  it("keeps numeric and textual seeds in separate deterministic domains", async () => {
    const api = await import("./index.js");
    const content = createGameContentRegistry(asymmetricInput());
    const create = (seed: number | string) => api.AsymmetricMatchSession.create({
      schemaVersion: 1, matchId: "duel_1", profileId: "duel", content, missionId: "duel",
      fixedTickUnits: 0.25, seed, players: [{ id: "alice" }, { id: "bob" }]
    });
    expect(create(42).getSnapshot().checksum).not.toBe(create("42").getSnapshot().checksum);
  });
});
