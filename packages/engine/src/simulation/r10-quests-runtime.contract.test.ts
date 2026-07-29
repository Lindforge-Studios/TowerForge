import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type QuestStatus = "active" | "completed" | "failed";
type Activation = "active" | "disabled" | "unselected" | "absent";
type ProfileMode = "selection" | "kill_one" | "kill_two" | "preserve_one";

interface QuestSnapshotV1Contract {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly entries: readonly {
    readonly questId: string;
    readonly label: string;
    readonly kind: "kill_with_source" | "preserve_shield";
    readonly current: number;
    readonly target: number;
    readonly status: QuestStatus;
  }[];
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly profileMode?: ProfileMode;
  readonly enemyTowerAttack?: { readonly interval: number; readonly damage: number; readonly range: number };
  readonly enemyHp?: number;
  readonly towerDamage?: number;
}

function questDefinitions(mode: ProfileMode) {
  const lavaOne = {
    label: "Lava finisher",
    weight: 3,
    objective: {
      kind: "kill_with_source",
      count: 1,
      source: { kind: "ability", id: "lava_burst" }
    }
  } as const;
  if (mode === "kill_one") return { lava_one: lavaOne };
  if (mode === "kill_two") {
    return {
      lava_two: {
        ...lavaOne,
        label: "Two lava finishers",
        objective: { ...lavaOne.objective, count: 2 }
      }
    };
  }
  const preserve = {
    label: "Keep the bastion shield",
    weight: 2,
    objective: { kind: "preserve_shield", waves: 1, scope: "tower" }
  } as const;
  if (mode === "preserve_one") return { preserve_one: preserve };
  return {
    lava_one: lavaOne,
    wrong_one: {
      label: "Wrong burst finisher",
      weight: 2,
      objective: {
        kind: "kill_with_source",
        count: 1,
        source: { kind: "ability", id: "wrong_burst" }
      }
    },
    preserve_one: preserve
  } as const;
}

function runtimeInput(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const profileMode = options.profileMode ?? "kill_one";
  const waveCount = profileMode === "kill_two" ? 2 : 1;
  const path = Array.from({ length: 7 }, (_, q) => ({ q, r: 1 }));
  const questsModule = activation === "absent" ? {} : {
    quests: {
      schemaVersion: 1,
      enabled: activation !== "disabled",
      profiles: {
        runtime: {
          selectionCount: profileMode === "selection" ? 2 : 1,
          definitions: questDefinitions(profileMode)
        }
      }
    }
  };
  return {
    balance: {
      defaultMissionId: "quest_runtime",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 1,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {
        lava_burst: {
          id: "lava_burst",
          label: "Lava Burst",
          cooldown: 0.01,
          duration: 0,
          radius: 2,
          effects: [{ kind: "damage", amount: 1 }]
        },
        wrong_chip: {
          id: "wrong_chip",
          label: "Wrong Chip",
          cooldown: 0.01,
          duration: 0,
          radius: 2,
          effects: [{ kind: "damage", amount: 4 }]
        },
        wrong_burst: {
          id: "wrong_burst",
          label: "Wrong Burst",
          cooldown: 0.01,
          duration: 0,
          radius: 2,
          effects: [{ kind: "damage", amount: 100 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: options.enemyHp ?? 5,
          speed: 0.05,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x668866,
          ...(options.enemyTowerAttack === undefined ? {} : { towerAttack: options.enemyTowerAttack })
        }
      },
      towers: {
        bastion: {
          id: "bastion",
          label: "Bastion",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 6,
          maxHp: 50,
          attack: {
            kind: "single",
            fireRate: 20,
            damagePerStack: options.towerDamage ?? 100,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        runtime: Array.from({ length: waveCount }, (_, index) => ({
          id: `wave_${index + 1}`,
          label: `Wave ${index + 1}`,
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }]
        }))
      },
      missions: {
        quest_runtime: {
          id: "quest_runtime",
          label: "Quest Runtime",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "runtime",
          buildTowerIds: ["bastion"],
          abilityIds: ["lava_burst", "wrong_chip", "wrong_burst"],
          mechanics: {
            profiles: {
              combat: "shielded",
              ...(activation === "active" || activation === "disabled" ? { quests: "runtime" } : {})
            }
          }
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
        pathCenterline: path,
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            shielded: { shields: { towers: { bastion: { capacity: 5 } } } }
          }
        },
        ...questsModule
      }
    } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#668866",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "quest_runtime",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(options));
}

function game(options: FixtureOptions = {}, seed: string | number = "quest-runtime-seed"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "quest_runtime", seed });
}

function quests(subject: Readonly<TowerDefenseGame>): QuestSnapshotV1Contract | undefined {
  return (subject.getSnapshot() as unknown as { quests?: QuestSnapshotV1Contract }).quests;
}

function quest(subject: Readonly<TowerDefenseGame>, questId?: string) {
  const entries = quests(subject)?.entries ?? [];
  return questId === undefined ? entries[0] : entries.find((entry) => entry.questId === questId);
}

function questEvents(subject: Readonly<TowerDefenseGame>, type: "questCompleted" | "questFailed") {
  return (subject.lastEvents as unknown as readonly { readonly type: string; readonly questId?: string }[])
    .filter((event) => event.type === type);
}

function startAndSpawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0.01);
  expect(subject.getSnapshot().enemies).toHaveLength(1);
}

function settleAbilityKill(subject: TowerDefenseGame, abilityId: string): void {
  expect(subject.useAbility(abilityId, { q: 0, r: 1 })).toEqual({ ok: true });
  subject.tick(0);
}

function runUntil(subject: TowerDefenseGame, predicate: () => boolean, max = 100): void {
  for (let guard = 0; guard < max && !predicate(); guard += 1) subject.tick(0.05);
  expect(predicate()).toBe(true);
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function dispatchKillWave(session: JournaledGameSession): void {
  expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
  expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 })).toEqual({ ok: true });
  expect(session.dispatch({
    schemaVersion: 1,
    type: "useAbility",
    abilityId: "lava_burst",
    center: { q: 0, r: 1 }
  })).toEqual({ ok: true });
  expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
}

describe("R10 procedural quests runtime contract (RED)", () => {
  it("selects active quests deterministically from the game seed and publishes the exact active-only snapshot", () => {
    const first = game({ profileMode: "selection" }, "selection-seed");
    const repeated = game({ profileMode: "selection" }, "selection-seed");
    expect(quests(first)).toEqual(quests(repeated));
    expect(quests(first)).toMatchObject({ schemaVersion: 1, profileId: "runtime" });
    expect(quests(first)?.entries).toHaveLength(2);
    expect(quests(first)?.entries.map((entry) => entry.questId))
      .toEqual(quests(first)?.entries.map((entry) => entry.questId).sort());
    for (const entry of quests(first)?.entries ?? []) {
      expect(entry).toEqual({
        questId: entry.questId,
        label: expect.any(String),
        kind: expect.stringMatching(/^(kill_with_source|preserve_shield)$/),
        current: 0,
        target: expect.any(Number),
        status: "active"
      });
    }

    const selections = new Set<string>();
    for (let index = 0; index < 24; index += 1) {
      selections.add((quests(game({ profileMode: "selection" }, `selection-${index}`))?.entries ?? [])
        .map((entry) => entry.questId).join("|"));
    }
    expect(selections.size).toBeGreaterThan(1);
  });

  it("credits kill_with_source only to the exact lethal DamagePacket source", () => {
    const exact = game({ profileMode: "kill_one" });
    startAndSpawn(exact);
    expect(exact.useAbility("wrong_chip", { q: 0, r: 1 })).toEqual({ ok: true });
    exact.tick(0);
    expect(quest(exact, "lava_one")).toMatchObject({ current: 0, target: 1, status: "active" });

    expect(exact.useAbility("lava_burst", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(quest(exact, "lava_one")).toMatchObject({ current: 1, target: 1, status: "completed" });
    expect(questEvents(exact, "questCompleted")).toEqual([
      expect.objectContaining({ type: "questCompleted", questId: "lava_one" })
    ]);
    exact.tick(0);
    expect(questEvents(exact, "questCompleted")).toEqual([]);

    const wrong = game({ profileMode: "kill_one" });
    startAndSpawn(wrong);
    settleAbilityKill(wrong, "wrong_burst");
    expect(quest(wrong, "lava_one")?.status).not.toBe("completed");
    expect(quest(wrong, "lava_one")?.current).toBe(0);
    expect(wrong.getSnapshot().outcome).toBe("victory");
  });

  it("advances preserve_shield on waveCleared and completes without affecting primary victory", () => {
    const subject = game({ profileMode: "preserve_one", enemyHp: 1, towerDamage: 10 });
    startAndSpawn(subject);
    expect(subject.placeTower("bastion", { q: 1, r: 0 })).toEqual({ ok: true });
    runUntil(subject, () => subject.getSnapshot().outcome === "victory");

    expect(quest(subject, "preserve_one")).toMatchObject({
      kind: "preserve_shield",
      current: 1,
      target: 1,
      status: "completed"
    });
    expect(subject.getSnapshot().outcome).toBe("victory");
    expect(questEvents(subject, "questCompleted")).toEqual([
      expect.objectContaining({ type: "questCompleted", questId: "preserve_one" })
    ]);
  });

  it("fails preserve_shield exactly once only when an eligible live shield crosses positive to zero", () => {
    const subject = game({
      profileMode: "preserve_one",
      enemyHp: 100,
      towerDamage: 0,
      enemyTowerAttack: { interval: 0.05, damage: 3, range: 6 }
    });
    expect(subject.placeTower("bastion", { q: 1, r: 0 })).toEqual({ ok: true });
    startAndSpawn(subject);

    subject.tick(0.05);
    expect(quest(subject, "preserve_one")).toMatchObject({ current: 0, status: "active" });
    expect(questEvents(subject, "questFailed")).toEqual([]);
    subject.tick(0.05);
    expect(quest(subject, "preserve_one")).toMatchObject({ current: 0, status: "failed" });
    expect(questEvents(subject, "questFailed")).toEqual([
      expect.objectContaining({ type: "questFailed", questId: "preserve_one" })
    ]);
    subject.tick(0.2);
    expect(questEvents(subject, "questFailed")).toEqual([]);
  });

  it("omits quests for absent, disabled, and unselected capabilities and leaves their legacy state stable", () => {
    for (const activation of ["absent", "disabled", "unselected"] as const) {
      const subject = game({ activation, profileMode: "kill_one" }, "legacy-seed");
      const before = subject.getStateDigest();
      expect(quests(subject)).toBeUndefined();
      expect(subject.getSnapshot()).not.toHaveProperty("quests");
      expect(subject.createCheckpoint().state).not.toHaveProperty("quests");
      expect(subject.getStateDigest()).toBe(before);
    }
  });

  it("round-trips progress through checkpoint continuation and v6 journal replay to the continuous digest", () => {
    const subjectContent = content({ profileMode: "kill_two", enemyHp: 1 });
    const continuous = new TowerDefenseGame({ content: subjectContent, missionId: "quest_runtime", seed: "resume-seed" });
    startAndSpawn(continuous);
    settleAbilityKill(continuous, "lava_burst");
    expect(quest(continuous, "lava_two")).toMatchObject({ current: 1, target: 2, status: "active" });

    const checkpoint = jsonRoundTrip(continuous.createCheckpoint());
    expect((checkpoint.state as unknown as { quests?: unknown }).quests).toMatchObject({
      schemaVersion: 1,
      profileId: "runtime",
      entries: [expect.objectContaining({ questId: "lava_two", current: 1, status: "active" })]
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    startAndSpawn(continuous);
    settleAbilityKill(continuous, "lava_burst");
    startAndSpawn(restored);
    settleAbilityKill(restored, "lava_burst");
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "quest_runtime",
      seed: "journal-seed"
    }));
    dispatchKillWave(session);
    dispatchKillWave(session);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: jsonRoundTrip(session.exportJournal()) });
    expect(replay.entriesReplayed).toBe(8);
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(quest(replay.game, "lava_two")).toMatchObject({ current: 2, status: "completed" });
  });

  it("rejects future, unknown, duplicate, impossible, and accessor-backed quest checkpoint state", () => {
    const subjectContent = content({ profileMode: "kill_two", enemyHp: 1 });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "quest_runtime", seed: "hostile-seed" });
    startAndSpawn(subject);
    settleAbilityKill(subject, "lava_burst");
    const pristine = jsonRoundTrip(subject.createCheckpoint()) as unknown as Omit<GameCheckpointV1, "state"> & {
      state: Omit<GameCheckpointV1["state"], "quests"> & {
        quests: { schemaVersion: number; profileId: string; entries: Array<Record<string, unknown>> };
      };
    };
    expect(pristine.state.quests).toMatchObject({
      schemaVersion: 1,
      profileId: "runtime",
      entries: [expect.objectContaining({ questId: "lava_two", current: 1, target: 2, status: "active" })]
    });

    const hostile = [
      (checkpoint: typeof pristine) => { checkpoint.state.quests.schemaVersion = 2; },
      (checkpoint: typeof pristine) => { checkpoint.state.quests.entries[0]!.questId = "unknown_quest"; },
      (checkpoint: typeof pristine) => { checkpoint.state.quests.entries.push({ ...checkpoint.state.quests.entries[0]! }); },
      (checkpoint: typeof pristine) => { checkpoint.state.quests.entries[0]!.current = 3; }
    ];
    for (const mutate of hostile) {
      const checkpoint = jsonRoundTrip(pristine);
      mutate(checkpoint);
      resign(checkpoint as unknown as GameCheckpointV1);
      expect(() => TowerDefenseGame.fromCheckpoint({
        content: subjectContent,
        checkpoint: checkpoint as unknown as GameCheckpointV1
      }))
        .toThrow(/quest|schema|unknown|duplicate|current|target|state/i);
    }

    const accessor = jsonRoundTrip(pristine);
    let reads = 0;
    Object.defineProperty(accessor.state.quests.entries[0], "current", {
      enumerable: true,
      get() { reads += 1; return 1; }
    });
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: accessor as unknown as GameCheckpointV1
    }))
      .toThrow(/checkpoint|quest|data|accessor|digest/i);
    expect(reads).toBe(0);
  });

  it("rejects retained quest events that do not match active selected quest state", () => {
    const subjectContent = content({ profileMode: "kill_one", enemyHp: 1 });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "quest_runtime", seed: "event-seed" });
    startAndSpawn(subject);
    expect(subject.useAbility("lava_burst", { q: 0, r: 1 })).toEqual({ ok: true });
    const checkpoint = jsonRoundTrip(subject.createCheckpoint()) as any;
    const event = checkpoint.state.lastEvents.find((candidate: any) => candidate.type === "questCompleted");
    expect(event).toBeDefined();
    event.questId = "forged_quest";
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/quest|event|unknown|selected|state/i);
  });

  it("rejects a forged failed shield quest that has already reached its completion target", () => {
    const subjectContent = content({ profileMode: "preserve_one" });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "quest_runtime", seed: "failed-target" });
    const checkpoint = jsonRoundTrip(subject.createCheckpoint()) as any;
    checkpoint.state.quests.entries[0].current = checkpoint.state.quests.entries[0].target;
    checkpoint.state.quests.entries[0].status = "failed";
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/quest|progress|impossible|status|target/i);
  });
});
