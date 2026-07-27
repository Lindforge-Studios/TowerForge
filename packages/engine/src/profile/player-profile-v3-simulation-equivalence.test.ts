import { describe, expect, it } from "vitest";
import {
  JournaledGameSession,
  TowerDefenseGame,
  createGameContentRegistry,
  decodePlayerProfile,
  getPlayerProfileLaunchOptions,
  replayGameCommandJournal,
  type GameCommandV1,
  type GameContentInput,
  type PlayerProfileV2,
  type PlayerProfileV3
} from "../index.js";

function createContent() {
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "profile_equivalence",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 30,
        startingResources: { coins: 30 },
        prepTimeUnits: 1,
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
          range: 4,
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
        profile_equivalence: {
          id: "profile_equivalence",
          label: "Profile equivalence",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 30 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: []
        }
      },
      defaultDifficultyId: "normal",
      difficulties: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard", enemyHpMultiplier: 1.25 }
      ],
      metaProgression: {
        currencies: [{ id: "crystals", label: "Crystals" }],
        upgrades: {
          focus: {
            id: "focus",
            label: "Focus",
            maxLevel: 2,
            costs: [{ crystals: 1 }, { crystals: 2 }],
            effects: [{ kind: "towerDamage", multiplierPerLevel: 0.1 }]
          }
        },
        rewardsByMission: {}
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 5,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
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
        missionId: "profile_equivalence",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

const PROFILE_FIELDS = Object.freeze({
  clearedMissionIds: ["profile_equivalence"],
  starsByMission: { profile_equivalence: 0 },
  metaResources: { crystals: 7 },
  upgradeLevels: { focus: 2 },
  selectedDifficultyId: "hard"
});

const PROFILE_V2: PlayerProfileV2 = { version: 2, ...PROFILE_FIELDS };
const PROFILE_V3: PlayerProfileV3 = { version: 3, ...PROFILE_FIELDS };

const COMMANDS: readonly GameCommandV1[] = Object.freeze([
  { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
  { schemaVersion: 1, type: "startWave" },
  { schemaVersion: 1, type: "tick", units: 0.25 },
  { schemaVersion: 1, type: "tick", units: 0.25 },
  { schemaVersion: 1, type: "tick", units: 0.5 }
]);

describe("PlayerProfile v2 to v3 simulation boundary", () => {
  it("keeps migration metadata outside identical launch, checkpoint, journal, and replay state", () => {
    const content = createContent();
    const migrated = decodePlayerProfile(PROFILE_V2, content);
    const native = decodePlayerProfile(PROFILE_V3, content);

    expect(migrated).toMatchObject({ source: "v2", profile: PROFILE_V3 });
    expect(migrated.migrations.map(({ id }) => id)).toEqual(["player-profile-v2-to-v3"]);
    expect(native).toMatchObject({ source: "v3", profile: PROFILE_V3, migrations: [] });

    const migratedLaunch = getPlayerProfileLaunchOptions(migrated.profile);
    const nativeLaunch = getPlayerProfileLaunchOptions(native.profile);
    expect(migratedLaunch).toEqual(nativeLaunch);
    expect(Object.keys(migratedLaunch)).toEqual(["difficultyId", "metaUpgradeLevels"]);
    expect(migratedLaunch).not.toHaveProperty("version");
    expect(migratedLaunch).not.toHaveProperty("profile");

    const migratedGame = new TowerDefenseGame({
      missionId: "profile_equivalence",
      content,
      seed: "player-profile-v3-equivalence",
      ...migratedLaunch
    });
    const nativeGame = new TowerDefenseGame({
      missionId: "profile_equivalence",
      content,
      seed: "player-profile-v3-equivalence",
      ...nativeLaunch
    });

    expect(migratedGame.getSnapshot()).toEqual(nativeGame.getSnapshot());
    expect(migratedGame.getStateDigest()).toBe(nativeGame.getStateDigest());
    expect(migratedGame.createCheckpoint()).toEqual(nativeGame.createCheckpoint());
    expect(Object.keys(migratedGame.createCheckpoint().identity).sort()).toEqual([
      "missionId",
      "difficultyId",
      "metaUpgradeLevels"
    ].sort());
    expect(migratedGame.getSnapshot()).not.toHaveProperty("profile");

    const migratedSession = new JournaledGameSession(migratedGame);
    const nativeSession = new JournaledGameSession(nativeGame);
    for (const command of COMMANDS) {
      expect(migratedSession.dispatch(command)).toEqual(nativeSession.dispatch(command));
    }

    expect(migratedSession.game.getSnapshot()).toEqual(nativeSession.game.getSnapshot());
    expect(migratedSession.game.getStateDigest()).toBe(nativeSession.game.getStateDigest());
    expect(migratedSession.game.createCheckpoint()).toEqual(nativeSession.game.createCheckpoint());
    expect(migratedSession.exportJournal()).toEqual(nativeSession.exportJournal());

    const migratedReplay = replayGameCommandJournal({ content, journal: migratedSession.exportJournal() });
    const nativeReplay = replayGameCommandJournal({ content, journal: nativeSession.exportJournal() });
    expect(migratedReplay.stateDigest).toBe(migratedSession.game.getStateDigest());
    expect(nativeReplay.stateDigest).toBe(nativeSession.game.getStateDigest());
    expect(migratedReplay.stateDigest).toBe(nativeReplay.stateDigest);
    expect(migratedReplay.game.getSnapshot()).toEqual(nativeReplay.game.getSnapshot());
  });
});
