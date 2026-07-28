import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest } from "../simulation/checkpoint.js";
import { stableDigest } from "../simulation/stable-digest.js";

function localInput(): GameContentInput {
  const input: any = {
    balance: {
      defaultMissionId: "coop",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 40, startingResources: { coins: 40 },
        prepTimeUnits: 2, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5, pathWaterDurationUnits: 3, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {}, enemies: {}, towers: {}, waveSets: { one: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: {
        coop: {
          id: "coop", label: "Co-op", description: "", startingCoreHp: 20, startingResources: { coins: 40 },
          prepTimeUnits: 2, mapId: "lane", waveSetId: "one", buildTowerIds: [], abilityIds: [],
          mechanics: { profiles: { multiplayer: "local" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 3, height: 1, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: { multiplayer: { schemaVersion: 1, enabled: true, profiles: { local: {
        mode: "local_coop", fixedTickUnits: 0.25, maxPlayers: 2,
        ownership: { towerControl: "owner_only", resources: "shared", routes: "shared" }
      } } } }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#fff", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [{ missionId: "coop", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  };
  return input;
}

async function sessionFixture() {
  const api = await import("./index.js");
  const content = createGameContentRegistry(localInput());
  const session = api.MatchSession.create({
    schemaVersion: 1, mode: "local_coop", matchId: "offline_1", profileId: "local",
    fixedTickUnits: 0.25, content, missionId: "coop", seed: "offline-seed",
    players: [{ id: "alice" }, { id: "bob" }]
  });
  session.advanceTick();
  session.advanceTick();
  return { api, content, session };
}

describe("R8.3 offline challenge and reconnect contract (RED)", () => {
  it("binds an offline challenge seed, journal and expected checksum", async () => {
    const { api, content, session } = await sessionFixture();
    const challenge = api.createOfflineChallengeV1({ challengeId: "daily_1", seed: "offline-seed", session });
    expect(challenge).toMatchObject({
      schemaVersion: 1, challengeId: "daily_1", seed: "offline-seed",
      expectedChecksum: session.getSnapshot().checksum,
      checksum: expect.stringMatching(/^tf-challenge-v1:[0-9a-f]{16}$/)
    });
    const replay = api.replayOfflineChallengeV1({ content, challenge });
    expect(replay.verified).toBe(true);
    expect(replay.checksum).toBe(challenge.expectedChecksum);
  });

  it("rejects a checksummed challenge whose initial state was changed independently of its seed", async () => {
    const { api, content, session } = await sessionFixture();
    const challenge: any = structuredClone(api.createOfflineChallengeV1({
      challengeId: "daily_tampered", seed: "offline-seed", session
    }));
    const checkpoint = challenge.journal.initialCheckpoint;
    checkpoint.state.resources = { ...checkpoint.state.resources, coins: 999 };
    checkpoint.stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    challenge.journal.entries = [];
    challenge.expectedChecksum = api.MatchSession.restore({ content, journal: challenge.journal })
      .getSnapshot().checksum;
    const { checksum: _oldChecksum, ...payload } = challenge;
    challenge.checksum = stableDigest(payload).replace(/^tf-state-v1:/, "tf-challenge-v1:");

    expect(() => api.replayOfflineChallengeV1({ content, challenge })).toThrow(/seed|initial checkpoint/i);
  });

  it("restores checkpoint plus accepted journal metadata and continues at the next player sequence", async () => {
    const { api, content, session } = await sessionFixture();
    const bundle = api.createMatchReconnectBundleV1(session);
    expect(bundle).toMatchObject({
      schemaVersion: 1, protocolVersion: 1, checkpoint: expect.any(Object),
      acceptedJournal: expect.any(Object), checksum: session.getSnapshot().checksum
    });
    const restored = api.restoreMatchReconnectBundleV1({ content, bundle });
    expect(restored.getSnapshot()).toEqual(session.getSnapshot());
    expect(restored.dispatch({
      schemaVersion: 1, matchId: "offline_1", playerId: "alice", sequence: 0, matchSequence: 0, applyTick: 2,
      command: { schemaVersion: 6, type: "startWave" }
    })).toMatchObject({ ok: true, acceptedSequence: 0 });
  });

  it("reports the first divergent tick from checksummed timelines", async () => {
    const first = await sessionFixture();
    const second = await sessionFixture();
    second.session.advanceTick();
    const diagnostic = first.api.diagnoseMatchDesyncV1(
      first.session.exportChecksumTimeline(),
      second.session.exportChecksumTimeline()
    );
    expect(diagnostic).toMatchObject({ schemaVersion: 1, divergent: true, firstDivergentTick: 3 });
  });
});
