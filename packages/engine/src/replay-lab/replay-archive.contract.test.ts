import { describe, expect, it, vi } from "vitest";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import {
  canonicalStringify,
  JournaledGameSession,
  SIMULATION_ENGINE_VERSION,
  TowerDefenseGame,
  type GameCommandJournal
} from "../index.js";
import {
  computeReplayCapabilityDigestV1,
  decodeReplayArchiveV1,
  encodeReplayArchiveV1,
  REPLAY_ARCHIVE_HEADER_BYTES,
  REPLAY_ARCHIVE_LIMITS,
  REPLAY_ARCHIVE_MAGIC,
  REPLAY_ARCHIVE_SCHEMA_VERSION
} from "./index.js";

const EXPECTED_MAGIC = Object.freeze([0x54, 0x46, 0x52, 0x50] as const); // TFRP
const EXPECTED_HEADER_BYTES = 20;
const EXPECTED_MAXIMUM_BYTES = 72 * 1_024 * 1_024;

function replayInput(): GameContentInput {
  return {
    balance: {
      defaultMissionId: "replay_lab",
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
          maxHp: 20,
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
        replay_lab: {
          id: "replay_lab",
          label: "Replay Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 40 },
          prepTimeUnits: 2,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: []
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
        missionId: "replay_lab",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(): GameContentRegistry {
  return createGameContentRegistry(replayInput());
}

function journal(subject = content()): GameCommandJournal {
  const game = new TowerDefenseGame({ content: subject, missionId: "replay_lab", seed: "r16-archive" });
  const session = new JournaledGameSession(game);
  expect(session.dispatch({
    schemaVersion: 1,
    type: "placeTower",
    towerTypeId: "pelter",
    coord: { q: 1, r: 0 }
  }).ok).toBe(true);
  expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);
  expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.25 }).ok).toBe(true);
  return session.exportJournal();
}

function emptyJournalAtVersion(subject: GameContentRegistry, schemaVersion: number): GameCommandJournal {
  const game = new TowerDefenseGame({ content: subject, missionId: "replay_lab", seed: "r16-version" });
  const base = new JournaledGameSession(game).exportJournal();
  return { ...base, schemaVersion } as unknown as GameCommandJournal;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function mutate(bytes: Uint8Array, index: number, value: number): Uint8Array {
  const copy = cloneBytes(bytes);
  copy[index] = value;
  return copy;
}

describe("R16.1 ReplayArchiveV1 binary contract (RED)", () => {
  it("fixes the public magic, version, header length, big-endian payload length and 72 MiB ceiling", () => {
    const subject = content();
    const bytes = encodeReplayArchiveV1({ content: subject, journal: journal(subject) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(REPLAY_ARCHIVE_MAGIC).toEqual(EXPECTED_MAGIC);
    expect(REPLAY_ARCHIVE_SCHEMA_VERSION).toBe(1);
    expect(REPLAY_ARCHIVE_HEADER_BYTES).toBe(EXPECTED_HEADER_BYTES);
    expect(REPLAY_ARCHIVE_LIMITS).toEqual(expect.objectContaining({ maximumBytes: EXPECTED_MAXIMUM_BYTES }));
    expect([...bytes.subarray(0, 4)]).toEqual(EXPECTED_MAGIC);
    expect(bytes[4]).toBe(1);
    expect(bytes[5]).toBe(0); // v1 flags are closed and must be zero.
    expect(view.getUint16(6, false)).toBe(EXPECTED_HEADER_BYTES);
    expect(view.getUint32(8, false)).toBe(bytes.byteLength - EXPECTED_HEADER_BYTES);
    expect([...bytes.subarray(12, EXPECTED_HEADER_BYTES)]).not.toEqual(new Array(8).fill(0));
    expect(bytes.byteLength).toBeLessThanOrEqual(EXPECTED_MAXIMUM_BYTES);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "round-trips a canonical GameCommandJournal v%s and exposes detached archive identity",
    (schemaVersion) => {
      const subject = content();
      const source = emptyJournalAtVersion(subject, schemaVersion);
      const before = canonicalStringify(source);
      const bytes = encodeReplayArchiveV1({ content: subject, journal: source });
      const decoded = decodeReplayArchiveV1({ content: subject, bytes });

      expect(decoded).toMatchObject({
        schemaVersion: 1,
        engineVersion: SIMULATION_ENGINE_VERSION,
        payloadKind: "game_command_journal",
        contentDigest: source.contentDigest,
        capabilityDigest: expect.stringMatching(/^tf-capabilities-v1:[0-9a-f]{16}$/),
        archiveDigest: expect.stringMatching(/^tf-replay-v1:[0-9a-f]{16}$/),
        journal: { schemaVersion }
      });
      expect(decoded.journal).toEqual(source);
      expect(decoded.journal).not.toBe(source);
      expect(canonicalStringify(source)).toBe(before);
    }
  );

  it("encodes canonical deterministic bytes independent of detached key insertion order", () => {
    const subject = content();
    const source = journal(subject) as unknown as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as GameCommandJournal;
    const first = encodeReplayArchiveV1({ content: subject, journal: source as unknown as GameCommandJournal });
    const second = encodeReplayArchiveV1({ content: subject, journal: reordered });

    expect([...second]).toEqual([...first]);
    expect(decodeReplayArchiveV1({ content: subject, bytes: first }).archiveDigest)
      .toBe(decodeReplayArchiveV1({ content: subject, bytes: second }).archiveDigest);
  });

  it("computes one engine-owned mission capability digest without consulting Studio or renderers", () => {
    const subject = content();
    const first = computeReplayCapabilityDigestV1({ content: subject, missionId: "replay_lab" });
    const second = computeReplayCapabilityDigestV1({ content: subject, missionId: "replay_lab" });
    expect(first).toMatch(/^tf-capabilities-v1:[0-9a-f]{16}$/);
    expect(second).toBe(first);
    expect(() => computeReplayCapabilityDigestV1({ content: subject, missionId: "missing" }))
      .toThrow(/mission|capabilit/i);
  });

  it("rejects content/capability identity mismatch before accepting the payload", () => {
    const sourceContent = content();
    const bytes = encodeReplayArchiveV1({ content: sourceContent, journal: journal(sourceContent) });
    const changedInput = replayInput();
    changedInput.balance.missions.replay_lab!.startingCoreHp = 21;
    const changedContent = createGameContentRegistry(changedInput);
    expect(() => decodeReplayArchiveV1({ content: changedContent, bytes }))
      .toThrow(/content|capabilit|digest/i);
  });

  it("returns an owned byte copy and never aliases mutable archive input", () => {
    const subject = content();
    const source = journal(subject);
    const first = encodeReplayArchiveV1({ content: subject, journal: source });
    const preserved = cloneBytes(first);
    const decoded = decodeReplayArchiveV1({ content: subject, bytes: first });
    first.fill(0);

    expect(decoded.journal).toEqual(source);
    expect(encodeReplayArchiveV1({ content: subject, journal: decoded.journal })).toEqual(preserved);
  });

  it("rejects closed header, length, checksum and payload corruption", () => {
    const subject = content();
    const bytes = encodeReplayArchiveV1({ content: subject, journal: journal(subject) });
    const payloadLength = bytes.byteLength - EXPECTED_HEADER_BYTES;
    const badLength = cloneBytes(bytes);
    new DataView(badLength.buffer).setUint32(8, payloadLength - 1, false);
    const cases = [
      mutate(bytes, 0, 0),
      mutate(bytes, 4, 2),
      mutate(bytes, 5, 1),
      mutate(bytes, 7, EXPECTED_HEADER_BYTES - 1),
      badLength,
      mutate(bytes, 12, (bytes[12] ?? 0) ^ 0xff),
      mutate(bytes, EXPECTED_HEADER_BYTES, (bytes[EXPECTED_HEADER_BYTES] ?? 0) ^ 0xff),
      bytes.subarray(0, bytes.byteLength - 1),
      Uint8Array.from([...bytes, 0])
    ];
    for (const candidate of cases) {
      expect(() => decodeReplayArchiveV1({ content: subject, bytes: candidate }))
        .toThrow(/archive|magic|version|flag|header|length|checksum|payload|truncat|trailing/i);
    }
  });

  it("validates the checksum and declared bounds before constructing a mission map", () => {
    const subject = content();
    const bytes = encodeReplayArchiveV1({ content: subject, journal: journal(subject) });
    const mission = subject.missions.replay_lab!;
    const originalFactory = mission.mapFactory;
    const factory = vi.fn(() => originalFactory());
    Object.defineProperty(mission, "mapFactory", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: factory
    });

    expect(() => decodeReplayArchiveV1({
      content: subject,
      bytes: mutate(bytes, 12, (bytes[12] ?? 0) ^ 0xff)
    })).toThrow(/checksum|archive/i);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects future journal versions before inspecting their entries", () => {
    const subject = content();
    const source = emptyJournalAtVersion(subject, 1) as unknown as Record<string, unknown>;
    let reads = 0;
    const future: Record<string, unknown> = {
      ...source,
      schemaVersion: 9
    };
    Object.defineProperty(future, "entries", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("future entries must not be read");
      }
    });

    expect(() => encodeReplayArchiveV1({
      content: subject,
      journal: future as unknown as GameCommandJournal
    })).toThrow(/journal|version/i);
    expect(reads).toBe(0);
  });
});
