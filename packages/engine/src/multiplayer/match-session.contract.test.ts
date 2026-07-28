import { describe, expect, it } from "vitest";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";

const MATCH_INPUT: GameContentInput = {
  balance: {
    defaultMissionId: "coop",
    constants: {
      timeUnitSeconds: 1,
      startingCoreHp: 20,
      startingCoins: 40,
      startingResources: { coins: 40 },
      prepTimeUnits: 2,
      moveTowerCost: { coins: 1 },
      waterGroundSpeedFactor: 0.5,
      pathWaterCooldownUnits: 5,
      pathWaterDurationUnits: 3,
      pathWaterRadius: 1,
      pathWaterGroundSpeedFactor: 0.5
    },
    abilities: {},
    enemies: {
      grunt: {
        id: "grunt",
        label: "Grunt",
        maxHp: 10,
        speed: 0.5,
        reward: { coins: 1 },
        coinReward: 1,
        coreDamage: 1,
        color: 0x778899
      }
    },
    towers: {
      pelter: {
        id: "pelter",
        label: "Pelter",
        cost: { coins: 5 },
        footprintRadius: 0,
        range: 5,
        attack: {
          kind: "single",
          fireRate: 1,
          damagePerStack: 2,
          startingStacks: 1,
          maxStacks: 2,
          upgradeCost: 2
        }
      }
    },
    waveSets: {
      one: [{
        id: "wave_1",
        label: "Wave 1",
        groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
      }]
    },
    missions: {
      coop: {
        id: "coop",
        label: "Co-op",
        description: "",
        startingCoreHp: 20,
        startingResources: { coins: 40 },
        prepTimeUnits: 2,
        mapId: "lane",
        waveSetId: "one",
        buildTowerIds: ["pelter"],
        abilityIds: [],
        mechanics: { profiles: { multiplayer: "local_coop" } }
      }
    }
  },
  maps: {
    lane: {
      id: "lane",
      width: 7,
      height: 3,
      grid: { kind: "square", adjacency: "cardinal" },
      defaultTerrain: "buildable",
      spawnCoord: { q: 0, r: 1 },
      coreCoord: { q: 6, r: 1 },
      pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
      pathRoutes: [],
      terrainOverrides: []
    }
  },
  mechanics: {
    schemaVersion: 1,
    modules: {
      multiplayer: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          local_coop: {
            mode: "local_coop",
            fixedTickUnits: 0.25,
            maxPlayers: 2,
            ownership: {
              towerControl: "owner_only",
              resources: "shared",
              routes: "shared"
            }
          }
        }
      }
    }
  },
  worldMap: {
    width: 100,
    height: 100,
    regions: [{
      id: "region",
      label: "Region",
      description: "",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      accent: "#778899",
      biome: "test",
      connections: []
    }],
    missionNodes: [{
      missionId: "coop",
      regionId: "region",
      x: 50,
      y: 50,
      difficulty: 1,
      unlockRequiresMissionIds: []
    }]
  }
};

type MultiplayerApi = {
  readonly MULTIPLAYER_LIMITS: {
    readonly journalEntries: number;
  };
  readonly MatchSession: {
    create(options: Readonly<Record<string, unknown>>): MatchSessionFixture;
  };
  readonly replayMatchCommandJournal: (options: Readonly<Record<string, unknown>>) => {
    readonly session: MatchSessionFixture;
    readonly checksum: string;
  };
};

interface MatchSessionFixture {
  readonly game: { readonly getSnapshot: () => Readonly<Record<string, unknown>> };
  readonly currentTick: number;
  advanceTick(): Readonly<Record<string, unknown>>;
  dispatch(input: unknown): Readonly<Record<string, unknown>>;
  getSnapshot(): Readonly<Record<string, any>>;
  exportJournal(): Readonly<Record<string, unknown>>;
}

async function loadMultiplayer(): Promise<MultiplayerApi> {
  return await import("./index.js") as unknown as MultiplayerApi;
}

function content(): GameContentRegistry {
  return createGameContentRegistry(MATCH_INPUT);
}

function createSession(api: MultiplayerApi, matchContent = content()): MatchSessionFixture {
  return api.MatchSession.create({
    schemaVersion: 1,
    mode: "local_coop",
    matchId: "match_local_1",
    profileId: "local_coop",
    fixedTickUnits: 0.25,
    content: matchContent,
    missionId: "coop",
    seed: "local-coop-seed",
    players: [{ id: "alice" }, { id: "bob" }]
  });
}

function envelope(
  playerId: string,
  sequence: number,
  command: Readonly<Record<string, unknown>>,
  applyTick = 0,
  matchSequence = 0
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    matchId: "match_local_1",
    playerId,
    sequence,
    matchSequence,
    applyTick,
    command
  };
}

describe("R8.1 MatchSession local_coop contract (RED)", () => {
  it("keeps partitioned co-op resource wallets independent inside one simulation", async () => {
    const api = await loadMultiplayer();
    const input = structuredClone(MATCH_INPUT) as any;
    input.mechanics.modules.multiplayer.profiles.local_coop.ownership = {
      towerControl: "owner_only", resources: "partitioned", routes: "partitioned"
    };
    input.maps.lane.pathRoutes = [
      { id: "north", pathCenterline: input.maps.lane.pathCenterline },
      { id: "south", pathCenterline: input.maps.lane.pathCenterline }
    ];
    const session = createSession(api, createGameContentRegistry(input));
    expect(session.getSnapshot().players).toEqual([
      { id: "alice", nextSequence: 0, resources: { coins: 40 } },
      { id: "bob", nextSequence: 0, resources: { coins: 40 } }
    ]);
    expect(session.getSnapshot().routeOwnership).toEqual([
      { routeId: "north", playerId: "alice" },
      { routeId: "south", playerId: "bob" }
    ]);
    expect(session.dispatch(envelope("alice", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 }
    }))).toMatchObject({ ok: true });
    expect(session.dispatch(envelope("bob", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 2, r: 0 }
    }, 0, 1))).toMatchObject({ ok: true });
    expect(session.getSnapshot().players.map((player: any) => player.resources.coins)).toEqual([35, 35]);
    const replay = api.replayMatchCommandJournal({ content: createGameContentRegistry(input), journal: session.exportJournal() });
    expect(replay.session.getSnapshot()).toEqual(session.getSnapshot());
  });

  it("owns one fixed tick clock and refuses client-authored tick commands", async () => {
    const api = await loadMultiplayer();
    const session = createSession(api);
    const before = session.getSnapshot();

    expect(session.currentTick).toBe(0);
    expect(session.dispatch(envelope("alice", 0, {
      schemaVersion: 6,
      type: "tick",
      units: 99
    }))).toMatchObject({ ok: false, code: "tick_owned_by_session" });
    expect(session.getSnapshot()).toEqual(before);

    expect(session.advanceTick()).toMatchObject({ tick: 1, units: 0.25 });
    expect(session.currentTick).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      schemaVersion: 1,
      mode: "local_coop",
      tick: 1,
      fixedTickUnits: 0.25
    });
  });

  it("accepts only the next contiguous player sequence and rejects duplicates/out-of-order before mutation", async () => {
    const api = await loadMultiplayer();
    const session = createSession(api);
    const startWave = { schemaVersion: 6, type: "startWave" };

    expect(session.dispatch(envelope("alice", 1, startWave))).toMatchObject({
      ok: false,
      code: "sequence_out_of_order",
      expectedSequence: 0
    });
    expect(session.dispatch(envelope("alice", 0, startWave))).toMatchObject({ ok: true, acceptedSequence: 0 });
    const accepted = session.getSnapshot();
    expect(session.dispatch(envelope("alice", 0, startWave))).toMatchObject({
      ok: false,
      code: "sequence_duplicate"
    });
    expect(session.getSnapshot()).toEqual(accepted);
  });

  it("rejects unknown players and enforces owner-only tower mutation on the shared simulation", async () => {
    const api = await loadMultiplayer();
    const session = createSession(api);
    const place = { schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } };

    expect(session.dispatch(envelope("mallory", 0, place))).toMatchObject({ ok: false, code: "player_unknown" });
    expect(session.dispatch(envelope("alice", 0, place))).toMatchObject({ ok: true });
    const towerId = session.getSnapshot().game.towers[0].id as string;
    const afterPlace = session.getSnapshot();

    expect(session.dispatch(envelope("bob", 0, {
      schemaVersion: 6,
      type: "sellTower",
      towerId
    }, 0, 1))).toMatchObject({ ok: false, code: "entity_not_owned", ownerPlayerId: "alice" });
    expect(session.getSnapshot()).toEqual(afterPlace);
    expect(session.dispatch(envelope("alice", 1, {
      schemaVersion: 6,
      type: "sellTower",
      towerId
    }, 0, 1))).toMatchObject({ ok: true });
  });

  it("publishes a stable checksum after every accepted envelope and fixed tick", async () => {
    const api = await loadMultiplayer();
    const first = createSession(api);
    const second = createSession(api);
    const commands = [
      envelope("alice", 0, { schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } }),
      envelope("bob", 0, { schemaVersion: 6, type: "startWave" }, 0, 1)
    ];

    for (const command of commands) {
      expect(first.dispatch(command)).toMatchObject({ ok: true, checksum: expect.stringMatching(/^tf-match-v1:[0-9a-f]{16}$/) });
      expect(second.dispatch(command)).toMatchObject({ ok: true, checksum: expect.stringMatching(/^tf-match-v1:[0-9a-f]{16}$/) });
    }
    first.advanceTick();
    second.advanceTick();

    expect(first.getSnapshot().checksum).toMatch(/^tf-match-v1:[0-9a-f]{16}$/);
    expect(first.getSnapshot().checksum).toBe(second.getSnapshot().checksum);
    expect(first.getSnapshot().game).toEqual(second.getSnapshot().game);
  });

  it("replays the ordered match journal to the identical checksum and game snapshot", async () => {
    const api = await loadMultiplayer();
    const matchContent = content();
    const session = createSession(api, matchContent);
    expect(session.dispatch(envelope("alice", 0, {
      schemaVersion: 6,
      type: "placeTower",
      towerTypeId: "pelter",
      coord: { q: 1, r: 0 }
    }))).toMatchObject({ ok: true });
    expect(session.dispatch(envelope("bob", 0, { schemaVersion: 6, type: "startWave" }, 0, 1))).toMatchObject({ ok: true });
    session.advanceTick();
    session.advanceTick();

    const journal = session.exportJournal();
    expect(journal).toMatchObject({
      schemaVersion: 1,
      protocolVersion: 1,
      matchId: "match_local_1",
      mode: "local_coop",
      entries: expect.any(Array)
    });
    const replay = api.replayMatchCommandJournal({ content: matchContent, journal });
    expect(replay.checksum).toBe(session.getSnapshot().checksum);
    expect(replay.session.getSnapshot()).toEqual(session.getSnapshot());
  });

  it("rejects a detached journal whose ownership no longer matches the active authored profile", async () => {
    const api = await loadMultiplayer();
    const matchContent = content();
    const journal = structuredClone(createSession(api, matchContent).exportJournal()) as any;
    journal.ownership = { towerControl: "shared", resources: "partitioned", routes: "partitioned" };

    expect(() => api.replayMatchCommandJournal({ content: matchContent, journal })).toThrow(/authored|ownership|profile/i);

    const tooManyPlayers = structuredClone(createSession(api, matchContent).exportJournal()) as any;
    tooManyPlayers.players.push({ id: "mallory" });
    expect(() => api.replayMatchCommandJournal({ content: matchContent, journal: tooManyPlayers })).toThrow(/players|entries|profile/i);

    const tickSession = createSession(api, matchContent);
    tickSession.advanceTick();
    const tickJournal = structuredClone(tickSession.exportJournal()) as any;
    tickJournal.entries[0].kind = "future_tick";
    expect(() => api.replayMatchCommandJournal({ content: matchContent, journal: tickJournal }))
      .toThrow(/malformed|kind|entry/i);
  });

  it("uses one authoritative match sequence so opposite transport arrival order converges after retry", async () => {
    const api = await loadMultiplayer();
    const canonical = createSession(api);
    const reordered = createSession(api);
    const alice = envelope("alice", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 }
    }, 0, 0);
    const bob = envelope("bob", 0, {
      schemaVersion: 6, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 }
    }, 0, 1);

    expect(canonical.dispatch(alice)).toMatchObject({ acceptedMatchSequence: 0 });
    expect(canonical.dispatch(bob)).toMatchObject({ acceptedMatchSequence: 1 });
    expect(reordered.dispatch(bob)).toMatchObject({ ok: false, code: "match_sequence_out_of_order", expectedMatchSequence: 0 });
    expect(reordered.dispatch(alice)).toMatchObject({ acceptedMatchSequence: 0 });
    expect(reordered.dispatch(bob)).toMatchObject({ acceptedMatchSequence: 1 });
    expect(reordered.getSnapshot()).toEqual(canonical.getSnapshot());
  });

  it("rejects accepted work before mutation once the bounded journal is full", async () => {
    const api = await loadMultiplayer();
    const session = createSession(api) as any;
    session.entries.length = api.MULTIPLAYER_LIMITS.journalEntries;
    const before = session.getSnapshot();
    expect(() => session.dispatch(envelope("alice", 0, { schemaVersion: 6, type: "startWave" })))
      .toThrow(/journal.*capacity|capacity.*journal/i);
    expect(() => session.advanceTick()).toThrow(/journal.*capacity|capacity.*journal/i);
    expect(session.getSnapshot()).toEqual(before);
  });
});
