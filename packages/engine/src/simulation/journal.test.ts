import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeGameCommandJournal,
  GAME_COMMAND_JOURNAL_LIMITS,
  JournaledGameSession,
  TOWER_SCRIPT_LIMITS,
  type GameCommandJournalV1
} from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { dispatchGameCommand, type GameCommandV1 } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type JournalSchemaVersionIsLiteralOne = Assert<Equal<GameCommandJournalV1["schemaVersion"], 1>>;
type JournalEngineVersionIsIndependentLiteral = Assert<
  Equal<GameCommandJournalV1["engineVersion"], "towerforge-sim-v2">
>;
type JournalResultV1 = GameCommandJournalV1["entries"][number]["result"];
type NoHumanReasonInJournal = Assert<Equal<Extract<keyof JournalResultV1, "reason">, never>>;
const journalSchemaVersionIsLiteralOne: JournalSchemaVersionIsLiteralOne = true;
const journalEngineVersionIsIndependentLiteral: JournalEngineVersionIsIndependentLiteral = true;
const noHumanReasonInJournal: NoHumanReasonInJournal = true;
void journalSchemaVersionIsLiteralOne;
void journalEngineVersionIsIndependentLiteral;
void noHumanReasonInJournal;

afterEach(() => {
  vi.restoreAllMocks();
});

const JOURNAL_FIXTURE: GameContentInput = {
  balance: {
    defaultMissionId: "journal",
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
    abilities: {
      strike: { id: "strike", label: "Strike", cooldown: 4, duration: 0, radius: 2, damage: 3 }
    },
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
      journal: {
        id: "journal",
        label: "Journal",
        description: "",
        startingCoreHp: 20,
        startingResources: { coins: 40 },
        prepTimeUnits: 2,
        mapId: "lane",
        waveSetId: "one",
        buildTowerIds: ["pelter"],
        abilityIds: ["strike"]
      }
    }
  },
  maps: {
    lane: {
      id: "lane",
      width: 7,
      height: 3,
      defaultTerrain: "buildable",
      spawnCoord: { q: 0, r: 1 },
      coreCoord: { q: 6, r: 1 },
      pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
      pathRoutes: [],
      terrainOverrides: []
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
      missionId: "journal",
      regionId: "region",
      x: 50,
      y: 50,
      difficulty: 1,
      unlockRequiresMissionIds: []
    }]
  }
};

function createContent(input: GameContentInput = JOURNAL_FIXTURE): GameContentRegistry {
  return createGameContentRegistry(input);
}

function createGame(content: GameContentRegistry = createContent()): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "journal",
    content,
    seed: "journal-seed"
  });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createOverkillContent(): GameContentRegistry {
  const input = jsonClone(JOURNAL_FIXTURE);
  input.balance.abilities.strike!.damage = 1_000;
  return createContent(input);
}

function arrangeSpawnedOverkillTarget(game: TowerDefenseGame): string {
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.2);
  expect(game.enemies).toHaveLength(1);
  return game.enemies[0]!.id;
}

interface DerivedMapTamperCase {
  readonly name: string;
  readonly arrange: (game: TowerDefenseGame, session?: JournaledGameSession) => void;
  readonly tamper: (game: TowerDefenseGame) => void;
}

const DERIVED_MAP_TAMPER_CASES: readonly DerivedMapTamperCase[] = [
  {
    name: "untracked terrain",
    arrange(game, session) {
      const result = session
        ? session.dispatch({ schemaVersion: 1, type: "startWave" })
        : game.startNextWave();
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      expect(game.map.setTerrain(game.map.spawnCoord, "water")).toBe(true);
    }
  },
  {
    name: "cleared tower occupancy",
    arrange(game, session) {
      const command = {
        schemaVersion: 1 as const,
        type: "placeTower" as const,
        towerTypeId: "pelter",
        coord: { q: 1, r: 0 }
      };
      const result = session ? session.dispatch(command) : game.placeTower(command.towerTypeId, command.coord);
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      game.map.clearOccupied("tower_1");
    }
  },
  {
    name: "extra wrong occupancy",
    arrange(game, session) {
      const command = {
        schemaVersion: 1 as const,
        type: "placeTower" as const,
        towerTypeId: "pelter",
        coord: { q: 1, r: 0 }
      };
      const result = session ? session.dispatch(command) : game.placeTower(command.towerTypeId, command.coord);
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      game.map.setOccupied([{ q: 2, r: 0 }], "tower_1");
    }
  },
  {
    name: "mutable route path",
    arrange(game, session) {
      const result = session
        ? session.dispatch({ schemaVersion: 1, type: "startWave" })
        : game.startNextWave();
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      game.map.pathRoutes[0]!.pathCenterline.reverse();
    }
  },
  {
    name: "mutable primary path array",
    arrange(game, session) {
      const result = session
        ? session.dispatch({ schemaVersion: 1, type: "startWave" })
        : game.startNextWave();
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      game.map.pathCenterline.pop();
    }
  },
  {
    name: "mutable topology grid descriptor",
    arrange(game, session) {
      const result = session
        ? session.dispatch({ schemaVersion: 1, type: "startWave" })
        : game.startNextWave();
      expect(result.ok).toBe(true);
    },
    tamper(game) {
      (game.map.topology.grid as unknown as Record<string, unknown>).kind = "square";
    }
  }
];

describe("GameCommandJournalV1", () => {
  it("has independent exact v1 headers and starts from a detached game checkpoint", () => {
    const game = createGame();
    const expectedInitial = game.createCheckpoint();
    const session = new JournaledGameSession(game);
    const publicContract = session.exportJournal();
    if (publicContract.schemaVersion !== 1) throw new Error("Fresh journal must remain v1.");

    expect(Object.keys(publicContract)).toEqual([
      "schemaVersion",
      "engineVersion",
      "contentDigest",
      "initialCheckpoint",
      "entries"
    ]);
    expect(publicContract.schemaVersion).toBe(1);
    expect(publicContract.engineVersion).toBe("towerforge-sim-v2");
    expect(publicContract.contentDigest).toBe(expectedInitial.contentDigest);
    expect(publicContract.initialCheckpoint).toEqual(expectedInitial);
    expect(publicContract.initialCheckpoint).not.toBe(expectedInitial);
    expect(publicContract.entries).toEqual([]);

    (expectedInitial.state.resources as Record<string, number>).coins = 1;
    (publicContract.initialCheckpoint.state.resources as Record<string, number>).coins = 2;
    const secondExport = session.exportJournal();
    expect(secondExport.initialCheckpoint.state.resources.coins).toBe(40);
    expect(secondExport.initialCheckpoint).not.toBe(publicContract.initialCheckpoint);
  });

  it("uses the strict GameCommand decoder and never records malformed, future, extra, or accessor input", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    let accessorReads = 0;
    const accessorCommand = { type: "startWave" } as Record<string, unknown>;
    Object.defineProperty(accessorCommand, "schemaVersion", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 1;
      }
    });
    const invalidInputs: unknown[] = [
      null,
      {},
      { schemaVersion: 3, type: "startWave" },
      { schemaVersion: 1, type: "futureCommand" },
      { schemaVersion: 1, type: "startWave", timestamp: 123 },
      { schemaVersion: 1, type: "tick", units: Number.NaN },
      accessorCommand
    ];

    for (const input of invalidInputs) {
      const beforeDigest = game.getStateDigest();
      const reference = createGame();
      const expectedResult = dispatchGameCommand(reference, input);

      expect(session.dispatch(input)).toEqual(expectedResult);
      expect(game.getStateDigest()).toBe(beforeDigest);
      expect(session.exportJournal().entries).toEqual([]);
    }
    expect(accessorReads).toBe(0);
  });

  it("records a structurally valid command rejected by gameplay with a normalized result", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const beforeDigest = game.getStateDigest();
    const result = session.dispatch({ schemaVersion: 1, type: "upgradeTower", towerId: "missing" });

    expect(result).toEqual({
      ok: false,
      reason: "No tower selected.",
      reasonKey: "reason.noTowerSelected"
    });
    expect(game.getStateDigest()).toBe(beforeDigest);
    expect(session.exportJournal().entries).toEqual([{
      sequence: 0,
      command: { schemaVersion: 1, type: "upgradeTower", towerId: "missing" },
      result: { ok: false, reasonKey: "reason.noTowerSelected" },
      postStateDigest: beforeDigest
    }]);
    expect(session.exportJournal().entries[0]!.result).not.toHaveProperty("reason");

    const abilityGame = createGame();
    const abilitySession = new JournaledGameSession(abilityGame);
    expect(abilitySession.dispatch({
      schemaVersion: 1,
      type: "useAbility",
      abilityId: "strike",
      center: { q: 3, r: 1 }
    })).toEqual({ ok: true });
    expect(abilitySession.dispatch({
      schemaVersion: 1,
      type: "useAbility",
      abilityId: "strike",
      center: { q: 3, r: 1 }
    })).toEqual({
      ok: false,
      reason: "Ability is still recharging.",
      reasonKey: "reason.abilityCooldown",
      reasonParams: { seconds: 4 }
    });
    expect(abilitySession.exportJournal().entries[1]!.result).toEqual({
      ok: false,
      reasonKey: "reason.abilityCooldown",
      reasonParams: { seconds: 4 }
    });
  });

  it("appends successful mixed commands at sequence 0..N-1 with exact post-state digests", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const commands = [
      { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
      { schemaVersion: 1, type: "startWave" },
      { schemaVersion: 1, type: "tick", units: 0.25 },
      { schemaVersion: 1, type: "emitSignal", signal: "external.journal", payload: { value: [1, 2] } }
    ] satisfies GameCommandV1[];
    const expectedDigests: string[] = [];

    for (const command of commands) {
      expect(session.dispatch(command)).toEqual({ ok: true });
      expectedDigests.push(game.getStateDigest());
    }

    const journal = session.exportJournal();
    if (journal.schemaVersion !== 1) throw new Error("V1-only commands must keep journal v1.");
    const entries = journal.entries;
    expect(entries.map((entry) => entry.sequence)).toEqual([0, 1, 2, 3]);
    expect(entries.map((entry) => entry.command)).toEqual(commands);
    expect(entries.map((entry) => entry.result)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: true }
    ]);
    expect(entries.map((entry) => entry.postStateDigest)).toEqual(expectedDigests);
    for (const entry of entries as GameCommandJournalV1["entries"]) {
      expect(Object.keys(entry)).toEqual(["sequence", "command", "result", "postStateDigest"]);
      expect(entry.postStateDigest).toMatch(/^tf-state-v1:[0-9a-f]{16}$/);
    }
  });

  it("owns detached canonical commands and is unaffected by later caller mutations", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const mutableCommand = {
      schemaVersion: 1,
      type: "emitSignal",
      signal: "external.original",
      payload: { nested: [1, { stable: true }] }
    };

    expect(session.dispatch(mutableCommand)).toEqual({ ok: true });
    const digestAfterDispatch = game.getStateDigest();
    mutableCommand.signal = "external.mutated";
    mutableCommand.payload.nested[0] = 999;
    (mutableCommand.payload.nested[1] as { stable: boolean }).stable = false;

    expect(game.getStateDigest()).toBe(digestAfterDispatch);
    expect(session.exportJournal().entries[0]!.command).toEqual({
      schemaVersion: 1,
      type: "emitSignal",
      signal: "external.original",
      payload: { nested: [1, { stable: true }] }
    });
  });

  it("returns a fresh detached export every time and export mutations cannot affect the game or session", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    expect(session.dispatch({
      schemaVersion: 1,
      type: "placeTower",
      towerTypeId: "pelter",
      coord: { q: 1, r: 0 }
    }).ok).toBe(true);
    const baseline = session.exportJournal();
    const baselineJson = jsonClone(baseline);
    const digestBeforeMutation = game.getStateDigest();
    const exported = session.exportJournal() as unknown as {
      initialCheckpoint: { state: { resources: Record<string, number> } };
      entries: Array<{
        sequence: number;
        command: Record<string, unknown>;
        result: Record<string, unknown>;
        postStateDigest: string;
      }>;
    };

    expect(exported).not.toBe(baseline);
    expect(exported.initialCheckpoint).not.toBe(baseline.initialCheckpoint);
    expect(exported.entries).not.toBe(baseline.entries);
    exported.initialCheckpoint.state.resources.coins = 999_999;
    exported.entries[0]!.sequence = 999;
    exported.entries[0]!.command.type = "sellTower";
    exported.entries[0]!.result.ok = false;
    exported.entries[0]!.postStateDigest = "tf-state-v1:0000000000000000";
    exported.entries.push(exported.entries[0]!);

    expect(game.getStateDigest()).toBe(digestBeforeMutation);
    expect(session.exportJournal()).toEqual(baselineJson);
    expect(session.exportJournal()).not.toBe(session.exportJournal());
  });

  it("exposes its game as readonly and faults before dispatch after out-of-band state mutation", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const readonlyGame: Readonly<TowerDefenseGame> = session.game;
    void readonlyGame;
    const beforeJournal = session.exportJournal();

    game.resources.coins = (game.resources.coins ?? 0) - 1;

    expect(() => session.dispatch({ schemaVersion: 1, type: "startWave" })).toThrow(/fault|digest|out.of.band|mutation/i);
    expect(() => session.dispatch({ schemaVersion: 1, type: "tick", units: 0.1 })).toThrow(/fault/i);
    expect(() => session.exportJournal()).toThrow(/fault/i);
    expect(beforeJournal.entries).toEqual([]);
  });

  it("detects out-of-band state mutation before export", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    game.resources.coins = (game.resources.coins ?? 0) - 1;

    expect(() => session.exportJournal()).toThrow(/fault|digest|out.of.band|mutation/i);
    expect(() => session.exportJournal()).toThrow(/fault/i);
  });

  it("faults and rethrows the original engine exception without appending an ambiguous command", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const beforeJournal = session.exportJournal();
    const engineFailure = new Error("engine failed after mutation");
    vi.spyOn(game, "tick").mockImplementation(() => {
      game.resources.coins = (game.resources.coins ?? 0) - 1;
      throw engineFailure;
    });

    expect(() => session.dispatch({ schemaVersion: 1, type: "tick", units: 0.1 })).toThrow(engineFailure);
    expect(() => session.exportJournal()).toThrow(/fault/i);
    expect(beforeJournal.entries).toEqual([]);
  });

  it("keeps journal state outside game checkpoints and snapshots", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);

    const checkpoint = game.createCheckpoint() as unknown as Record<string, unknown>;
    const snapshot = game.getSnapshot() as unknown as Record<string, unknown>;
    expect(checkpoint).not.toHaveProperty("journal");
    expect(checkpoint).not.toHaveProperty("entries");
    expect(checkpoint.state).not.toHaveProperty("journal");
    expect(checkpoint.state).not.toHaveProperty("commandJournal");
    expect(snapshot).not.toHaveProperty("journal");
    expect(snapshot).not.toHaveProperty("commandJournal");
    expect(session.exportJournal().entries).toHaveLength(1);
  });
});

describe("derived map integrity at deterministic boundaries", () => {
  const placeCommand = {
    schemaVersion: 1 as const,
    type: "placeTower" as const,
    towerTypeId: "pelter",
    coord: { q: 1, r: 0 }
  };

  it("fails closed before command execution and deterministic exports when own getTile data shadows the map method", () => {
    const baseline = createGame();
    expect(baseline.placeTower(placeCommand.towerTypeId, placeCommand.coord).ok).toBe(true);

    const dispatchGame = createGame();
    const dispatchSession = new JournaledGameSession(dispatchGame);
    const shadow = vi.fn(() => undefined);
    Object.defineProperty(dispatchGame.map, "getTile", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: shadow
    });
    expect(() => dispatchSession.dispatch(placeCommand)).toThrow(/fault|map|method|shadow|integrity|incoherent/i);
    expect(shadow).not.toHaveBeenCalled();
    expect(dispatchGame.towers).toEqual([]);

    const exportGame = createGame();
    const exportSession = new JournaledGameSession(exportGame);
    Object.defineProperty(exportGame.map, "getTile", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => undefined
    });
    expect(() => exportSession.exportJournal()).toThrow(/fault|map|method|shadow|integrity|incoherent/i);
    expect(() => exportGame.getStateDigest()).toThrow(/map|method|shadow|integrity|incoherent/i);
    expect(() => exportGame.createCheckpoint()).toThrow(/map|method|shadow|integrity|incoherent/i);
  });

  it("never invokes an own getTile accessor and fails closed at all deterministic boundaries", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    let accessorReads = 0;
    Object.defineProperty(game.map, "getTile", {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("untrusted getTile accessor must not run");
      }
    });

    expect(() => session.dispatch(placeCommand)).toThrow(/fault|map|accessor|method|integrity|incoherent/i);
    expect(accessorReads).toBe(0);
    expect(game.towers).toEqual([]);
    expect(() => game.getStateDigest()).toThrow(/map|accessor|method|integrity|incoherent/i);
    expect(() => game.createCheckpoint()).toThrow(/map|accessor|method|integrity|incoherent/i);
    expect(accessorReads).toBe(0);
  });

  it("fails closed before gameplay when Map.prototype.get is selectively tampered", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const originalDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "get");
    if (!originalDescriptor || typeof originalDescriptor.value !== "function") {
      throw new Error("Expected native Map.prototype.get data method.");
    }
    const originalGet = originalDescriptor.value as (this: Map<unknown, unknown>, key: unknown) => unknown;
    let selectiveCalls = 0;
    Object.defineProperty(Map.prototype, "get", {
      ...originalDescriptor,
      value(this: Map<unknown, unknown>, key: unknown) {
        if (this === game.map.tiles && key === "1,0") {
          selectiveCalls += 1;
          return undefined;
        }
        return Reflect.apply(originalGet, this, [key]);
      }
    });
    try {
      expect(() => session.dispatch(placeCommand)).toThrow(/fault|map|prototype|intrinsic|integrity|incoherent/i);
      expect(selectiveCalls).toBe(0);
      expect(game.towers).toEqual([]);
      expect(() => session.exportJournal()).toThrow(/fault/i);
    } finally {
      Object.defineProperty(Map.prototype, "get", originalDescriptor);
    }
  });

  it.each(["tiles", "runtime overrides"] as const)(
    "rejects inflated %s Map by native size before entries enumeration",
    (mapKind) => {
      const game = createGame();
      const target = mapKind === "tiles"
        ? game.map.tiles as Map<unknown, unknown>
        : (() => {
            const descriptor = Object.getOwnPropertyDescriptor(game, "runtimeTerrainOverrides");
            if (!descriptor || !(descriptor.value instanceof Map)) {
              throw new Error("Expected runtimeTerrainOverrides native Map.");
            }
            return descriptor.value as Map<unknown, unknown>;
          })();
      const nativeSet = Map.prototype.set;
      if (mapKind === "tiles") {
        Reflect.apply(nativeSet, target, ["999,999", { q: 999, r: 999, terrain: "buildable" }]);
      } else {
        for (let index = 0; index <= TOWER_SCRIPT_LIMITS.activeTerrainOverrides; index += 1) {
          Reflect.apply(nativeSet, target, [`${index},999`, null]);
        }
      }

      const originalDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "entries");
      if (!originalDescriptor || typeof originalDescriptor.value !== "function") {
        throw new Error("Expected native Map.prototype.entries data method.");
      }
      const originalEntries = originalDescriptor.value as (this: Map<unknown, unknown>) => IterableIterator<[unknown, unknown]>;
      let targetEnumerations = 0;
      Object.defineProperty(Map.prototype, "entries", {
        ...originalDescriptor,
        value(this: Map<unknown, unknown>) {
          if (this === target) {
            targetEnumerations += 1;
            throw new Error("inflated Map entries must not be enumerated");
          }
          return Reflect.apply(originalEntries, this, []);
        }
      });
      try {
        expect(() => game.getStateDigest()).toThrow(/map|size|budget|limit|integrity|incoherent/i);
        expect(targetEnumerations).toBe(0);
      } finally {
        Object.defineProperty(Map.prototype, "entries", originalDescriptor);
      }
    }
  );

  it("rejects private map definition tampering because it changes the public clone result", () => {
    const game = createGame();
    const definitionDescriptor = Object.getOwnPropertyDescriptor(game.map, "definition");
    if (!definitionDescriptor || typeof definitionDescriptor.value !== "object" || definitionDescriptor.value === null) {
      throw new Error("Expected GridMap private definition data field.");
    }
    const definition = definitionDescriptor.value as { width: number };
    const liveWidth = game.map.width;
    definition.width = liveWidth + 10;
    expect(game.map.clone().width).toBe(liveWidth + 10);

    expect(() => game.getStateDigest()).toThrow(/map|definition|clone|integrity|incoherent/i);
    expect(() => game.createCheckpoint()).toThrow(/map|definition|clone|integrity|incoherent/i);
  });

  it("faults before a journaled placement when ghost occupancy would change its replay result", () => {
    const game = createGame();
    const session = new JournaledGameSession(game);
    const target = { q: 1, r: 0 };
    game.map.setOccupied([target], "ghost");

    expect(() => session.dispatch({
      schemaVersion: 1,
      type: "placeTower",
      towerTypeId: "pelter",
      coord: target
    })).toThrow(/fault|map|occup|integrity|incoherent/i);
    expect(game.towers).toEqual([]);
    expect(() => session.exportJournal()).toThrow(/fault/i);
  });

  it.each(DERIVED_MAP_TAMPER_CASES)(
    "faults a journal session before export or dispatch after $name tampering",
    ({ arrange, tamper }) => {
      const exportGame = createGame();
      const exportSession = new JournaledGameSession(exportGame);
      arrange(exportGame, exportSession);
      const acceptedJournal = exportSession.exportJournal();
      tamper(exportGame);

      expect(() => exportSession.exportJournal()).toThrow(/fault|map|terrain|occup|path|topology|integrity|incoherent/i);
      expect(() => exportSession.exportJournal()).toThrow(/fault/i);
      expect(acceptedJournal.entries.length).toBeGreaterThan(0);

      const dispatchGame = createGame();
      const dispatchSession = new JournaledGameSession(dispatchGame);
      arrange(dispatchGame, dispatchSession);
      tamper(dispatchGame);

      expect(() => dispatchSession.dispatch({ schemaVersion: 1, type: "tick", units: 0.1 })).toThrow(
        /fault|map|terrain|occup|path|topology|integrity|incoherent/i
      );
      expect(() => dispatchSession.dispatch({ schemaVersion: 1, type: "tick", units: 0.1 })).toThrow(/fault/i);
    }
  );

  it.each(DERIVED_MAP_TAMPER_CASES)(
    "rejects $name tampering from direct state digest and checkpoint boundaries",
    ({ arrange, tamper }) => {
      const digestGame = createGame();
      arrange(digestGame);
      tamper(digestGame);
      expect(() => digestGame.getStateDigest()).toThrow(/map|terrain|occup|path|topology|integrity|incoherent/i);

      const checkpointGame = createGame();
      arrange(checkpointGame);
      tamper(checkpointGame);
      expect(() => checkpointGame.createCheckpoint()).toThrow(/map|terrain|occup|path|topology|integrity|incoherent/i);
    }
  );
});

describe("overkill ability deterministic boundaries", () => {
  const useOverkill = {
    schemaVersion: 1 as const,
    type: "useAbility" as const,
    abilityId: "strike",
    center: { q: 0, r: 1 }
  };

  it("never leaves negative enemy HP while preserving either immediate or deferred death settlement", () => {
    const content = createOverkillContent();
    const game = createGame(content);
    const enemyId = arrangeSpawnedOverkillTarget(game);
    const coinsBefore = game.coins;

    expect(game.useAbility(useOverkill.abilityId, useOverkill.center)).toEqual({ ok: true });
    expect(game.enemies.every((enemy) => enemy.hp >= 0)).toBe(true);

    const killedEnemy = game.enemies.find((enemy) => enemy.id === enemyId);
    if (killedEnemy) {
      // Existing engine semantics may defer removal/reward until the next tick,
      // but the authoritative interim state must still be checkpoint-valid.
      expect(killedEnemy.hp).toBe(0);
      expect(game.coins).toBe(coinsBefore);
    } else {
      expect(game.coins).toBe(coinsBefore + 1);
      expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(1);
    }
  });

  it("round-trips the exact post-overkill digest through public checkpoint validation and restore", () => {
    const content = createOverkillContent();
    const game = createGame(content);
    arrangeSpawnedOverkillTarget(game);
    expect(game.useAbility(useOverkill.abilityId, useOverkill.center).ok).toBe(true);
    const checkpoint = game.createCheckpoint();
    let validated: typeof checkpoint | undefined;

    expect(() => {
      validated = TowerDefenseGame.validateCheckpoint({ content, checkpoint });
    }).not.toThrow();
    expect(validated).toEqual(checkpoint);

    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
  });

  it("decodes a session initialized from the spawned pre-cast checkpoint with an empty journal", () => {
    const content = createOverkillContent();
    const game = createGame(content);
    arrangeSpawnedOverkillTarget(game);
    const session = new JournaledGameSession(game);
    const emptyJournal = session.exportJournal();

    expect(emptyJournal.entries).toEqual([]);
    expect(decodeGameCommandJournal({ content, journal: emptyJournal })).toEqual(emptyJournal);
  });

  it("records and validates the journaled overkill command without retaining invalid authoritative HP", () => {
    const content = createOverkillContent();
    const game = createGame(content);
    arrangeSpawnedOverkillTarget(game);
    const session = new JournaledGameSession(game);

    expect(session.dispatch(useOverkill)).toEqual({ ok: true });
    const journal = session.exportJournal();
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({
      sequence: 0,
      command: useOverkill,
      result: { ok: true },
      postStateDigest: game.getStateDigest()
    });
    expect(decodeGameCommandJournal({ content, journal })).toEqual(journal);
    expect(game.enemies.every((enemy) => enemy.hp >= 0)).toBe(true);
  });
});

describe("decodeGameCommandJournal", () => {
  function validJournal(): { content: GameContentRegistry; journal: GameCommandJournalV1 } {
    const content = createContent();
    const game = createGame(content);
    const session = new JournaledGameSession(game);
    expect(session.dispatch({
      schemaVersion: 1,
      type: "placeTower",
      towerTypeId: "pelter",
      coord: { q: 1, r: 0 }
    }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.25 }).ok).toBe(true);
    const journal = session.exportJournal();
    if (journal.schemaVersion !== 1) throw new Error("V1-only commands must keep journal v1.");
    return { content, journal };
  }

  it("validates and returns a detached journal without executing any command", () => {
    const { content, journal } = validJournal();
    const tickSpy = vi.spyOn(TowerDefenseGame.prototype, "tick");
    const mapFactory = vi.fn(() => {
      throw new Error("validation-only journal decode must not create a simulation map");
    });
    Object.defineProperty(content.missions.journal!, "mapFactory", {
      configurable: true,
      enumerable: true,
      value: mapFactory
    });

    const decoded = decodeGameCommandJournal({ content, journal });

    expect(decoded).toEqual(journal);
    expect(decoded).not.toBe(journal);
    expect(decoded.initialCheckpoint).not.toBe(journal.initialCheckpoint);
    expect(decoded.entries).not.toBe(journal.entries);
    expect(tickSpy).not.toHaveBeenCalled();
    expect(mapFactory).not.toHaveBeenCalled();

    const mutableDecoded = decoded as unknown as { entries: Array<{ sequence: number }> };
    mutableDecoded.entries[0]!.sequence = 999;
    expect(journal.entries[0]!.sequence).toBe(0);
  });

  it("rejects a future journal header before reading entries or executing commands", () => {
    const { content, journal } = validJournal();
    let entryReads = 0;
    const future = { ...journal, schemaVersion: 3 } as Record<string, unknown>;
    Object.defineProperty(future, "entries", {
      enumerable: true,
      get() {
        entryReads += 1;
        throw new Error("future entries must not be inspected");
      }
    });
    const tickSpy = vi.spyOn(TowerDefenseGame.prototype, "tick");

    expect(() => decodeGameCommandJournal({
      content,
      journal: future as unknown as GameCommandJournalV1
    })).toThrow(/journal.*version|version.*journal/i);
    expect(entryReads).toBe(0);
    expect(tickSpy).not.toHaveBeenCalled();
  });

  it("rejects content mismatch, non-contiguous sequence, noncanonical result, and extra fields", () => {
    const { journal } = validJournal();
    const changedInput = jsonClone(JOURNAL_FIXTURE);
    changedInput.balance.enemies.grunt!.maxHp += 1;
    const changedContent = createContent(changedInput);
    expect(() => decodeGameCommandJournal({ content: changedContent, journal })).toThrow(/content.*digest|digest.*content/i);

    const oldEngine = {
      ...journal,
      engineVersion: "towerforge-sim-v1"
    } as unknown as GameCommandJournalV1;
    expect(() => decodeGameCommandJournal({ content: createContent(), journal: oldEngine })).toThrow(/engine.*version|version.*engine/i);

    const cases: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        entries[1]!.sequence = 9;
      },
      (value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        (entries[0]!.result as Record<string, unknown>).reason = "localized text is not canonical";
      },
      (value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        entries[0]!.transportTimestamp = 123;
      },
      (value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        (entries[0]!.command as Record<string, unknown>).transportTimestamp = 123;
      },
      (value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        entries[0]!.postStateDigest = "not-a-state-digest";
      },
      (value) => { value.contentDigest = "tf-content-v1:0000000000000000"; },
      (value) => { value.extra = true; }
    ];
    for (const mutate of cases) {
      const candidate = jsonClone(journal) as unknown as Record<string, unknown>;
      mutate(candidate);
      expect(() => decodeGameCommandJournal({
        content: createContent(),
        journal: candidate as unknown as GameCommandJournalV1
      })).toThrow(/journal|sequence|command|result|digest|field|unsupported|missing/i);
    }
  });

  it("publishes and enforces bounded journal/result/reason-parameter limits", () => {
    expect(GAME_COMMAND_JOURNAL_LIMITS).toEqual({
      entries: 100_000,
      totalBytes: 64 * 1_024 * 1_024,
      resultBytes: 64 * 1_024,
      reasonParams: 256
    });
    const { content, journal } = validJournal();
    const baseEntry = jsonClone(journal.entries[0]!);

    const tooManyEntries = jsonClone(journal) as unknown as Record<string, unknown>;
    tooManyEntries.entries = Array.from(
      { length: GAME_COMMAND_JOURNAL_LIMITS.entries + 1 },
      (_, sequence) => ({ ...baseEntry, sequence })
    );
    expect(() => decodeGameCommandJournal({
      content,
      journal: tooManyEntries as unknown as GameCommandJournalV1
    })).toThrow(/entries|budget|limit|large/i);

    const tooManyParams = jsonClone(journal) as unknown as Record<string, unknown>;
    const paramsEntry = (tooManyParams.entries as Array<Record<string, unknown>>)[0]!;
    paramsEntry.result = {
      ok: false,
      reasonKey: "reason.test",
      reasonParams: Object.fromEntries(Array.from(
        { length: GAME_COMMAND_JOURNAL_LIMITS.reasonParams + 1 },
        (_, index) => [`param_${index}`, index]
      ))
    };
    expect(() => decodeGameCommandJournal({
      content,
      journal: tooManyParams as unknown as GameCommandJournalV1
    })).toThrow(/params|budget|limit|large/i);

    const oversizedResult = jsonClone(journal) as unknown as Record<string, unknown>;
    const resultEntry = (oversizedResult.entries as Array<Record<string, unknown>>)[0]!;
    resultEntry.result = {
      ok: false,
      reasonKey: "reason.test",
      reasonParams: { detail: "x".repeat(GAME_COMMAND_JOURNAL_LIMITS.resultBytes) }
    };
    expect(() => decodeGameCommandJournal({
      content,
      journal: oversizedResult as unknown as GameCommandJournalV1
    })).toThrow(/result|budget|limit|large/i);

    const oversizedTotal = jsonClone(journal) as unknown as Record<string, unknown>;
    const largeCommand: GameCommandV1 = {
      schemaVersion: 1,
      type: "emitSignal",
      signal: "external.large",
      payload: "x".repeat(65_534)
    };
    const entryBytes = JSON.stringify({ ...baseEntry, command: largeCommand, sequence: 0 }).length;
    const count = Math.ceil(GAME_COMMAND_JOURNAL_LIMITS.totalBytes / entryBytes) + 1;
    oversizedTotal.entries = Array.from({ length: count }, (_, sequence) => ({
      ...baseEntry,
      sequence,
      command: largeCommand
    }));
    expect(() => decodeGameCommandJournal({
      content,
      journal: oversizedTotal as unknown as GameCommandJournalV1
    })).toThrow(/journal|bytes|budget|limit|large/i);
  });
});
