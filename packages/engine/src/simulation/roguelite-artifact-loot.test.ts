import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  SeededRng,
  type GameCheckpointV1,
  type SeededRngStateV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type RuntimeMode = "absent" | "v1" | "active" | "disabled";

interface ArtifactCheckpointEntry {
  instanceId: string;
  artifactId: string;
}

interface ArtifactCheckpointStateV1Fixture {
  schemaVersion: 1;
  rng: {
    initial: SeededRngStateV1;
    current: SeededRngStateV1;
  };
  nextInstanceSequence: number;
  inventory: ArtifactCheckpointEntry[];
}

interface MutableArtifactCheckpoint extends Omit<GameCheckpointV1, "state" | "stateDigest"> {
  state: GameCheckpointV1["state"] & { artifacts?: ArtifactCheckpointStateV1Fixture };
  stateDigest: string;
}

function artifactProfile(options: {
  rolls?: number;
  reverseDefinitions?: boolean;
  includeOrphanDefinition?: boolean;
  orphanInGruntLoot?: boolean;
} = {}): Record<string, unknown> {
  const baseDefinitions = options.reverseDefinitions
    ? {
        crystal: { label: "Vampiric crystal", slotType: "crystal", modifiers: [] },
        scope: {
          label: "Calibrated scope",
          slotType: "scope",
          modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.3 }]
        }
      }
    : {
        scope: {
          label: "Calibrated scope",
          slotType: "scope",
          modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.3 }]
        },
        crystal: { label: "Vampiric crystal", slotType: "crystal", modifiers: [] }
      };
  const definitions = {
    ...baseDefinitions,
    ...(options.includeOrphanDefinition
      ? { orphan: { label: "Orphan relic", slotType: "scope", modifiers: [] } }
      : {})
  };
  return {
    synergies: {},
    artifacts: {
      definitions,
      towerSlots: {
        cannon: [
          { slotId: "optic", slotType: "scope" },
          { slotId: "core", slotType: "crystal" }
        ]
      },
      bossLootTables: {
        boss: {
          rolls: options.rolls ?? 1,
          entries: [
            { artifactId: "scope", weight: 3 },
            { artifactId: "crystal", weight: 1 }
          ]
        },
        ...(options.orphanInGruntLoot
          ? { grunt: { rolls: 1, entries: [{ artifactId: "orphan", weight: 1 }] } }
          : {})
      }
    }
  };
}

function runtimeInput(options: {
  mode?: RuntimeMode;
  rolls?: number;
  waves?: number;
  spawnOnDeath?: boolean;
  reverseDefinitions?: boolean;
  includeOrphanDefinition?: boolean;
  orphanInGruntLoot?: boolean;
} = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const waves = options.waves ?? 1;
  return {
    balance: {
      defaultMissionId: "loot",
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
      terrainTypes: {
        floor: {
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      },
      abilities: {
        strike: {
          id: "strike",
          label: "Strike",
          cooldown: 0,
          duration: 0,
          radius: 1,
          effects: [{ kind: "damage", amount: 10 }]
        }
      },
      enemies: {
        boss: {
          id: "boss",
          label: "Boss",
          maxHp: 10,
          speed: 0.01,
          reward: { coins: 5 },
          coinReward: 5,
          coreDamage: 1,
          color: 1,
          ...(options.spawnOnDeath
            ? { spawnOnDeath: { enemyId: "grunt", count: 1, forwardPathSteps: 0 } }
            : {})
        },
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 10,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 2
        }
      },
      towers: {
        cannon: {
          id: "cannon",
          label: "Cannon",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 1,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        run: Array.from({ length: waves }, (_, index) => ({
          id: `wave_${index + 1}`,
          label: `Wave ${index + 1}`,
          groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }]
        }))
      },
      missions: {
        loot: {
          id: "loot",
          label: "Loot",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 5,
          mapId: "lane",
          waveSetId: "run",
          buildTowerIds: ["cannon"],
          abilityIds: ["strike"],
          ...(mode !== "absent"
            ? { mechanics: { profiles: { roguelite: "run" } } }
            : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    ...(mode === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: mode === "v1" ? 1 : 2,
            enabled: mode !== "disabled",
            profiles: {
              run: mode === "v1"
                ? { synergies: {} }
                : artifactProfile({
                    rolls: options.rolls,
                    reverseDefinitions: options.reverseDefinitions,
                    includeOrphanDefinition: options.includeOrphanDefinition,
                    orphanInGruntLoot: options.orphanInGruntLoot
                  })
            }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "loot",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: Parameters<typeof runtimeInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(options));
}

function game(options: Parameters<typeof runtimeInput>[0] = {}, seed = "artifact-seed"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "loot", seed });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function artifactCheckpoint(checkpoint: GameCheckpointV1): ArtifactCheckpointStateV1Fixture | undefined {
  return (checkpoint.state as GameCheckpointV1["state"] & {
    artifacts?: ArtifactCheckpointStateV1Fixture;
  }).artifacts;
}

function artifactSnapshot(subject: TowerDefenseGame): unknown {
  return (subject.getSnapshot() as unknown as { roguelite?: unknown }).roguelite;
}

function startAndSpawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave().ok).toBe(true);
  subject.tick(0);
  expect(subject.getSnapshot().enemies).toHaveLength(1);
  expect(subject.getSnapshot().enemies[0]?.typeId).toBe("boss");
}

function killSpawnedBoss(subject: TowerDefenseGame): void {
  expect(subject.useAbility("strike", { q: 0, r: 1 }).ok).toBe(true);
  subject.tick(0);
}

function resign(checkpoint: MutableArtifactCheckpoint): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

describe("R4.2B deterministic battle-local artifact loot", () => {
  it("keeps absent, disabled, and v1 checkpoint bytes legacy while active v2 exposes empty conditional state", () => {
    for (const mode of ["absent", "disabled"] as const) {
      const subject = game({ mode });
      expect(artifactSnapshot(subject), mode).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(subject.createCheckpoint().state, "artifacts"), mode).toBe(false);
    }

    const v1 = game({ mode: "v1" });
    expect(artifactSnapshot(v1)).toEqual({ schemaVersion: 1, synergies: [] });
    expect(JSON.stringify(artifactSnapshot(v1))).toBe('{"schemaVersion":1,"synergies":[]}');
    expect(Object.prototype.hasOwnProperty.call(v1.createCheckpoint().state, "artifacts")).toBe(false);

    const active = game();
    const snapshot = artifactSnapshot(active) as Record<string, unknown>;
    expect(snapshot).toEqual({
      schemaVersion: 2,
      synergies: [],
      artifacts: { inventory: [] }
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.artifacts)).toBe(true);
    expect(Object.isFrozen((snapshot.artifacts as { inventory: unknown[] }).inventory)).toBe(true);

    const checkpoint = artifactCheckpoint(active.createCheckpoint());
    expect(checkpoint).toMatchObject({
      schemaVersion: 1,
      nextInstanceSequence: 1,
      inventory: []
    });
    expect(checkpoint?.rng.initial).toEqual(checkpoint?.rng.current);
  });

  it("settles reward, one deterministic draw per roll, loot events, and death-spawns exactly once in stable order", () => {
    const subject = game({ rolls: 2, spawnOnDeath: true });
    startAndSpawn(subject);
    const before = subject.createCheckpoint();
    const beforeArtifacts = artifactCheckpoint(before);
    expect(beforeArtifacts).toBeDefined();
    if (!beforeArtifacts) throw new Error("Active roguelite v2 checkpoint omitted artifact state.");
    const expectedRng = SeededRng.fromState(beforeArtifacts.rng.current);
    expectedRng.nextInt(4);
    expectedRng.nextInt(4);

    killSpawnedBoss(subject);

    const snapshot = subject.getSnapshot() as unknown as {
      resources: Record<string, number>;
      roguelite: {
        schemaVersion: 2;
        synergies: unknown[];
        artifacts: { inventory: Array<Record<string, unknown>> };
      };
      lastEvents: Array<Record<string, unknown>>;
      enemies: Array<{ typeId: string }>;
    };
    expect(snapshot.resources.coins).toBe(105);
    expect(snapshot.enemies.map((enemy) => enemy.typeId)).toEqual(["grunt"]);
    expect(snapshot.roguelite.artifacts.inventory).toHaveLength(2);
    expect(snapshot.roguelite.artifacts.inventory.map((entry) => entry.instanceId)).toEqual([
      "artifact_1",
      "artifact_2"
    ]);
    for (const entry of snapshot.roguelite.artifacts.inventory) {
      expect(entry).toEqual({
        instanceId: entry.instanceId,
        artifactId: entry.artifactId,
        label: expect.any(String),
        slotType: expect.stringMatching(/^(scope|crystal)$/),
        socket: null
      });
    }
    expect(snapshot.lastEvents.map((event) => event.type)).toEqual([
      "enemyKilled",
      "artifactDropped",
      "artifactDropped",
      "enemySpawnedOnDeath"
    ]);
    expect(snapshot.lastEvents.slice(1, 3)).toEqual([
      {
        type: "artifactDropped",
        enemyId: "enemy_1",
        enemyTypeId: "boss",
        artifactInstanceId: "artifact_1",
        artifactId: snapshot.roguelite.artifacts.inventory[0]!.artifactId,
        rollIndex: 0
      },
      {
        type: "artifactDropped",
        enemyId: "enemy_1",
        enemyTypeId: "boss",
        artifactInstanceId: "artifact_2",
        artifactId: snapshot.roguelite.artifacts.inventory[1]!.artifactId,
        rollIndex: 1
      }
    ]);

    const after = subject.createCheckpoint();
    const afterArtifacts = artifactCheckpoint(after)!;
    expect(afterArtifacts.rng.initial).toEqual(beforeArtifacts.rng.initial);
    expect(afterArtifacts.rng.current).toEqual(expectedRng.exportState());
    expect(after.rng).toEqual(before.rng);
    expect(afterArtifacts.nextInstanceSequence).toBe(3);
    expect(afterArtifacts.inventory).toEqual(
      snapshot.roguelite.artifacts.inventory.map(({ instanceId, artifactId }) => ({ instanceId, artifactId }))
    );

    const reordered = game({ rolls: 2, spawnOnDeath: true, reverseDefinitions: true });
    startAndSpawn(reordered);
    killSpawnedBoss(reordered);
    expect(artifactSnapshot(reordered)).toEqual(artifactSnapshot(subject));
    expect(artifactCheckpoint(reordered.createCheckpoint())).toEqual(afterArtifacts);
  });

  it("restores and replays loot exactly, and rejects missing, duplicate, unknown, or incoherent artifact state", () => {
    const subjectContent = content({ waves: 2 });
    const continuous = new TowerDefenseGame({ content: subjectContent, missionId: "loot", seed: "restore-seed" });
    startAndSpawn(continuous);
    killSpawnedBoss(continuous);
    const boundary = jsonClone(continuous.createCheckpoint());
    expect(artifactCheckpoint(boundary)?.inventory).toHaveLength(1);
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: boundary });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());

    startAndSpawn(continuous);
    startAndSpawn(restored);
    killSpawnedBoss(continuous);
    killSpawnedBoss(restored);
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(artifactCheckpoint(restored.createCheckpoint())?.inventory.map((entry) => entry.instanceId))
      .toEqual(["artifact_1", "artifact_2"]);

    const journalSession = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "loot",
      seed: "journal-seed"
    }));
    for (const command of [
      { schemaVersion: 1, type: "startWave" },
      { schemaVersion: 1, type: "tick", units: 0 },
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: 0, r: 1 } },
      { schemaVersion: 1, type: "tick", units: 0 },
      { schemaVersion: 1, type: "startWave" },
      { schemaVersion: 1, type: "tick", units: 0 },
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: 0, r: 1 } },
      { schemaVersion: 1, type: "tick", units: 0 }
    ] as const) {
      expect(journalSession.dispatch(command).ok).toBe(true);
    }
    const replay = replayGameCommandJournal({
      content: subjectContent,
      journal: jsonClone(journalSession.exportJournal())
    });
    expect(replay.stateDigest).toBe(journalSession.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(journalSession.game.getSnapshot());

    const checkpoint = jsonClone(boundary) as MutableArtifactCheckpoint;
    const malformed: Array<readonly [string, (candidate: MutableArtifactCheckpoint) => void]> = [
      ["missing active state", (candidate) => {
        delete candidate.state.artifacts;
      }],
      ["duplicate instance", (candidate) => {
        candidate.state.artifacts!.inventory.push({ ...candidate.state.artifacts!.inventory[0]! });
      }],
      ["unknown definition", (candidate) => {
        candidate.state.artifacts!.inventory[0]!.artifactId = "ghost_artifact";
      }],
      ["incoherent sequence", (candidate) => {
        candidate.state.artifacts!.nextInstanceSequence = 99;
      }]
    ];
    for (const [label, mutate] of malformed) {
      const candidate = jsonClone(checkpoint);
      mutate(candidate);
      resign(candidate);
      expect(
        () => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: candidate }),
        label
      ).toThrow(/artifact|inventory|instance|definition|sequence|required|checkpoint/i);
    }

    const inactiveContent = content({ mode: "absent" });
    const inactive = jsonClone(new TowerDefenseGame({
      content: inactiveContent,
      missionId: "loot",
      seed: "inactive-artifacts"
    }).createCheckpoint()) as MutableArtifactCheckpoint;
    inactive.state.artifacts = jsonClone(artifactCheckpoint(boundary)!);
    resign(inactive);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: inactiveContent, checkpoint: inactive }))
      .toThrow(/artifact|inactive|unsupported|checkpoint|field/i);
  });

  it("rejects digest-resigned inventory outside every loot table and events outside the killed enemy table", () => {
    const forgeArtifact = (subjectContent: GameContentRegistry): MutableArtifactCheckpoint => {
      const subject = new TowerDefenseGame({ content: subjectContent, missionId: "loot", seed: "forged-loot" });
      startAndSpawn(subject);
      killSpawnedBoss(subject);
      const candidate = jsonClone(subject.createCheckpoint()) as MutableArtifactCheckpoint;
      candidate.state.artifacts!.inventory[0]!.artifactId = "orphan";
      const event = (candidate.state.lastEvents as unknown as Array<Record<string, unknown>>)
        .find((entry) => entry.type === "artifactDropped");
      if (!event) throw new Error("Expected artifactDropped fixture event.");
      event.artifactId = "orphan";
      resign(candidate);
      return candidate;
    };

    const unreachableContent = content({ includeOrphanDefinition: true });
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: unreachableContent,
      checkpoint: forgeArtifact(unreachableContent)
    })).toThrow(/artifact|inventory|loot table|unreachable/i);

    const wrongEnemyTableContent = content({
      includeOrphanDefinition: true,
      orphanInGruntLoot: true
    });
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: wrongEnemyTableContent,
      checkpoint: forgeArtifact(wrongEnemyTableContent)
    })).toThrow(/artifact|event|loot table|enemy/i);
  });
});
