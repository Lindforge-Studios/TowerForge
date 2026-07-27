import { afterEach, describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import {
  computeCheckpointStateDigest,
  decodeGameCommandJournal,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1
} from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { DamageResolver } from "./damage.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type TreeMode = "active" | "null" | "absent";

function tree(): Record<string, unknown> {
  return {
    points: { starting: 2, perInterwave: 2 },
    nodes: {
      focus: {
        label: "Focus",
        description: "Double hero ability damage after learning Arc.",
        cost: 2,
        requires: ["arc"],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "multiplier", value: 2 }
        }]
      },
      arc: {
        label: "Arc",
        description: "Add five hero ability damage.",
        cost: 2,
        requires: [],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "flat", value: 5 }
        }]
      }
    }
  };
}

function runtimeInput(options: {
  mode?: TreeMode;
  enemies?: boolean;
  prepTimeUnits?: number;
} = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const enemies = options.enemies ?? false;
  const definition: Record<string, unknown> = {
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "ground", speed: 2 },
    durability: { maxHp: 100, shield: null },
    mana: { max: 100, starting: 100, regenerationPerUnit: 0 },
    activeAbility: {
      id: "arc_bolt",
      label: "Arc Bolt",
      target: "enemy",
      manaCost: 10,
      cooldown: 0,
      range: 8,
      damage: 10
    },
    ...(mode === "absent" ? {} : { skillTree: mode === "null" ? null : tree() })
  };
  return {
    balance: {
      defaultMissionId: "hero_skills",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: options.prepTimeUnits ?? 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 0, duration: 0, radius: 1,
          effects: [{ kind: "damage", amount: 10 }]
        }
      },
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        wall: {
          id: "wall", label: "Wall", cost: { coins: 1 }, footprintRadius: 0,
          range: 1,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        two: [0, 1].map((wave) => ({
          id: `wave_${wave}`,
          label: `Wave ${wave + 1}`,
          groups: enemies && wave === 0
            ? [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
            : []
        }))
      },
      missions: {
        hero_skills: {
          id: "hero_skills", label: "Hero skills", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: options.prepTimeUnits ?? 0,
          mapId: "lane", waveSetId: "two", buildTowerIds: ["wall"], abilityIds: ["strike"],
          mechanics: { profiles: { heroes: "commanders" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        heroes: {
          schemaVersion: (mode === "absent" ? 4 : 5) as 1,
          enabled: true,
          profiles: {
            commanders: {
              selectedHeroId: "commander",
              definitions: { commander: definition },
              movementProfiles: {
                ground: {
                  label: "Ground",
                  terrainMode: "respect_walkable",
                  towerOccupancy: "blocked",
                  defaultTerrainCost: 1_000
                }
              }
            }
          }
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_skills", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as GameContentInput;
}

function content(options: Parameters<typeof runtimeInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(options));
}

function game(options: Parameters<typeof runtimeInput>[0] = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    content: content(options),
    missionId: "hero_skills",
    seed: "hero-skill-tree"
  });
}

function unlock(skillId: string, heroId = "commander"): Record<string, unknown> {
  return { schemaVersion: 6, type: "unlockHeroSkill", heroId, skillId };
}

function skills(subject: TowerDefenseGame): Record<string, any> | undefined {
  return (subject.getSnapshot().heroes as unknown as {
    units?: Array<{ skills?: Record<string, any> }>;
  } | undefined)?.units?.[0]?.skills;
}

function clone<T>(value: T): T {
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

function atomicFailure(subject: TowerDefenseGame, command: unknown): string {
  const beforeDigest = subject.getStateDigest();
  const beforeSnapshot = clone(subject.getSnapshot());
  const beforeEvents = clone(subject.lastEvents);
  const result = dispatchGameCommand(subject, command);
  expect(result).toMatchObject({ ok: false, reasonKey: expect.any(String) });
  expect(subject.getStateDigest()).toBe(beforeDigest);
  expect(subject.getSnapshot()).toEqual(beforeSnapshot);
  expect(subject.lastEvents).toEqual(beforeEvents);
  return (result as { reasonKey: string }).reasonKey;
}

afterEach(() => vi.restoreAllMocks());

describe("R5.4A exact GameCommand/Journal v6 skill boundary (RED)", () => {
  it("accepts only the closed v6 unlock envelope and preserves older aliases", () => {
    expect((Engine as any).GAME_COMMAND_SCHEMA_VERSION).toBe(6);
    expect((Engine as any).GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2, 3, 4, 5, 6]);
    expect((Engine as any).GAME_COMMAND_JOURNAL_SCHEMA_VERSION).toBe(6);
    expect((Engine as any).GAME_COMMAND_JOURNAL_SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2, 3, 4, 5, 6]);

    const subject = game({ prepTimeUnits: 2 });
    expect(dispatchGameCommand(subject, { ...unlock("arc"), schemaVersion: 5 }))
      .toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(subject, { ...unlock("arc"), extra: true }))
      .toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });

    const legacy = game();
    expect(dispatchGameCommand(legacy, { schemaVersion: 6, type: "startWave" })).toEqual({ ok: true });
  });
});

describe("R5.4A battle-local skill points and atomic unlocks (RED)", () => {
  it("preserves authored automatic prep instead of turning a skill tree into a mandatory pause", () => {
    const subject = game({ prepTimeUnits: 2 });

    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.getSnapshot()).toMatchObject({
      waveState: "between",
      clearedWaveCount: 1,
      outcome: "playing"
    });
    expect(subject.getSnapshot().prepRemaining).toBeGreaterThan(0);

    for (let index = 0; index < 11; index += 1) subject.tick(0.2);
    expect(subject.getSnapshot().outcome).toBe("victory");
  });

  it("publishes the exact initial v5 projection and derives unlockability in the engine", () => {
    expect(game().getSnapshot().heroes).toEqual({
      schemaVersion: 5,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 5, r: 1 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: { hp: 100, maxHp: 100, shield: null, defeated: false },
        mana: { current: 100, max: 100, regenerationPerUnit: 0 },
        activeAbility: {
          id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 10,
          cooldown: 0, cooldownRemaining: 0, range: 8, damage: 10, ready: true
        },
        skills: {
          availablePoints: 2,
          startingPoints: 2,
          pointsPerInterwave: 2,
          maximumEarnablePoints: 4,
          managementAvailable: true,
          nodes: [{
            id: "arc", label: "Arc", description: "Add five hero ability damage.", cost: 2,
            requiresSkillIds: [], missingRequirementIds: [], unlocked: false, unlockable: true
          }, {
            id: "focus", label: "Focus", description: "Double hero ability damage after learning Arc.", cost: 2,
            requiresSkillIds: ["arc"], missingRequirementIds: ["arc"], unlocked: false, unlockable: false
          }]
        }
      }]
    });
  });

  it("spends points atomically, grants only after a non-final wave, and keeps event order exact", () => {
    const subject = game({ prepTimeUnits: 2 });
    const prerequisiteKey = atomicFailure(subject, unlock("focus"));
    expect(prerequisiteKey).toMatch(/hero.*skill.*(?:require|prereq)/i);

    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });
    expect(skills(subject)).toMatchObject({
      availablePoints: 0,
      nodes: [{ id: "arc", unlocked: true }, { id: "focus", missingRequirementIds: [], unlockable: false }]
    });
    expect(subject.lastEvents.filter((event) => event.type === "heroSkillUnlocked")).toEqual([{
      type: "heroSkillUnlocked",
      heroId: "commander",
      heroDefinitionId: "commander",
      skillId: "arc",
      cost: 2,
      previousPoints: 2,
      currentPoints: 0
    }]);
    const insufficientKey = atomicFailure(subject, unlock("focus"));
    expect(insufficientKey).toMatch(/hero.*skill.*point|insufficient/i);

    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.getSnapshot()).toMatchObject({ waveState: "between", clearedWaveCount: 1, outcome: "playing" });
    expect(skills(subject)).toMatchObject({ availablePoints: 2, managementAvailable: true });
    const eventTypes = subject.lastEvents.map((event) => event.type);
    expect(eventTypes.indexOf("waveCleared")).toBeLessThan(eventTypes.indexOf("heroSkillPointsGranted"));
    expect(subject.lastEvents.filter((event) => event.type === "heroSkillPointsGranted")).toEqual([{
      type: "heroSkillPointsGranted",
      heroId: "commander",
      heroDefinitionId: "commander",
      waveIndex: 0,
      previousPoints: 0,
      currentPoints: 2,
      amount: 2
    }]);

    expect(dispatchGameCommand(subject, unlock("focus"))).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.getSnapshot().outcome).toBe("victory");
    expect(skills(subject)?.availablePoints).toBe(0);
    expect(subject.lastEvents.some((event) => event.type === "heroSkillPointsGranted")).toBe(false);
  });

  it("uses distinct precondition failures and leaves digest, projection, points, unlocks, and events untouched", () => {
    const unavailable = atomicFailure(game({ mode: "null" }), unlock("arc"));
    const unknownHero = atomicFailure(game(), unlock("arc", "ghost"));
    const unknownSkill = atomicFailure(game(), unlock("ghost"));

    const duplicate = game();
    expect(dispatchGameCommand(duplicate, unlock("arc"))).toEqual({ ok: true });
    const already = atomicFailure(duplicate, unlock("arc"));

    const midwave = game();
    expect(midwave.startNextWave()).toEqual({ ok: true });
    const phase = atomicFailure(midwave, unlock("arc"));

    const defeated = game();
    (defeated as unknown as { heroStateV2: { hp: number } }).heroStateV2.hp = 0;
    const defeatedKey = atomicFailure(defeated, unlock("arc"));

    expect(unavailable).toMatch(/hero.*skill.*(?:tree|unavailable)/i);
    expect(unknownHero).toMatch(/hero.*unavailable/i);
    expect(unknownSkill).toMatch(/hero.*skill.*unavailable/i);
    expect(already).toMatch(/hero.*skill.*already/i);
    expect(phase).toMatch(/hero.*skill.*(?:phase|time|wave)/i);
    expect(defeatedKey).toMatch(/hero.*defeated/i);
    expect(new Set([unavailable, unknownHero, unknownSkill, already, phase, defeatedKey]).size).toBe(6);
  });

  it("gives an ended mission precedence over every skill-specific precondition", () => {
    const subject = game({ prepTimeUnits: 2 });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.getSnapshot().outcome).toBe("victory");

    expect(atomicFailure(subject, unlock("missing", "ghost"))).toBe("reason.missionEnded");
  });

  it("keeps phase, alive, duplicate, prerequisite, and points failures in the locked order", () => {
    const midwaveDuplicate = game();
    expect(dispatchGameCommand(midwaveDuplicate, unlock("arc"))).toEqual({ ok: true });
    expect(midwaveDuplicate.startNextWave()).toEqual({ ok: true });
    expect(atomicFailure(midwaveDuplicate, unlock("arc"))).toBe("reason.heroSkillBetweenWavesOnly");

    const defeatedDuplicate = game();
    expect(dispatchGameCommand(defeatedDuplicate, unlock("arc"))).toEqual({ ok: true });
    (defeatedDuplicate as unknown as { heroStateV2: { hp: number } }).heroStateV2.hp = 0;
    expect(atomicFailure(defeatedDuplicate, unlock("arc"))).toBe("reason.heroDefeated");

    expect(atomicFailure(game(), unlock("focus"))).toBe("reason.heroSkillPrerequisiteMissing");
  });

  it("keeps authoritative unlockability false for a defeated hero", () => {
    const subject = game();
    (subject as unknown as { heroStateV2: { hp: number } }).heroStateV2.hp = 0;

    expect(skills(subject)).toMatchObject({ managementAvailable: true });
    expect(skills(subject)?.nodes).toEqual([
      expect.objectContaining({ id: "arc", unlockable: false }),
      expect.objectContaining({ id: "focus", unlockable: false })
    ]);
    expect(atomicFailure(subject, unlock("arc"))).toBe("reason.heroDefeated");
  });

  it("keeps an explicit null tree on the literal v4 snapshot and nested checkpoint v3 paths", () => {
    const subject = game({ mode: "null" });
    expect(subject.getSnapshot().heroes).toMatchObject({ schemaVersion: 4 });
    expect((subject.getSnapshot().heroes as any).units[0]).not.toHaveProperty("skills");
    expect(subject.createCheckpoint().state.heroes).toMatchObject({ schemaVersion: 3 });
  });
});

describe("R5.4A isolated hero-ability modifier pipeline (RED)", () => {
  it("compiles unlocked effects into one run-stage DamagePacket and does not modify mission ability damage", () => {
    const subject = game({ enemies: true });
    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies).toContainEqual(expect.objectContaining({ id: "enemy_1", hp: 100 }));
    const resolve = vi.spyOn(DamageResolver, "resolve");

    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "useHeroAbility",
      heroId: "commander",
      abilityId: "arc_bolt",
      targetEnemyId: "enemy_1"
    })).toEqual({ ok: true });
    expect(subject.enemies[0]).toMatchObject({ hp: 85 });
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      amount: 10,
      source: { kind: "ability", abilityId: "arc_bolt" },
      modifiers: [{
        id: expect.stringMatching(/^heroes:skill:3:arc:effect:/),
        target: "damage",
        stage: "run",
        operation: "flat",
        value: 5
      }]
    });

    expect(subject.useAbility("strike", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.enemies[0]).toMatchObject({ hp: 75 });
    expect(resolve.mock.calls[1]?.[0]).not.toHaveProperty("modifiers");
  });

  it("uses the authored skill id UTF-8 byte length in collision-safe modifier ids", () => {
    const raw = runtimeInput({ enemies: true }) as any;
    const nodes = raw.mechanics.modules.heroes.profiles.commanders.definitions.commander.skillTree.nodes;
    nodes["é"] = nodes.arc;
    delete nodes.arc;
    nodes.focus.requires = ["é"];
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(raw),
      missionId: "hero_skills",
      seed: "hero-skill-modifier-id"
    });
    expect(dispatchGameCommand(subject, unlock("é"))).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const resolve = vi.spyOn(DamageResolver, "resolve");

    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "useHeroAbility",
      heroId: "commander",
      abilityId: "arc_bolt",
      targetEnemyId: "enemy_1"
    })).toEqual({ ok: true });
    expect(resolve.mock.calls[0]?.[0].modifiers).toContainEqual(expect.objectContaining({
      id: "heroes:skill:2:é:effect:0"
    }));
  });
});

describe("R5.4A nested heroes checkpoint v4 and journal replay v6 (RED)", () => {
  it("round-trips exact points/unlocks and replays the same digest", () => {
    const subjectContent = content({ prepTimeUnits: 2 });
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_skills",
      seed: "hero-skill-replay"
    }));
    expect(session.dispatch(unlock("arc"))).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "tick", units: 0.1 })).toEqual({ ok: true });
    expect(session.dispatch(unlock("focus"))).toEqual({ ok: true });

    const checkpoint = session.game.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.heroes).toEqual({
      schemaVersion: 4,
      unit: {
        definitionId: "commander",
        currentCoord: { q: 5, r: 1 },
        targetCoord: null,
        nextCoord: null,
        edgeProgress: 0,
        hp: 100,
        shieldCurrent: 0,
        mana: 100,
        abilityCooldownRemaining: 0,
        skillPoints: 0,
        unlockedSkillIds: ["arc", "focus"]
      }
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());
    expect(restored.getSnapshot()).toEqual(session.game.getSnapshot());

    const journal = session.exportJournal() as unknown as { schemaVersion: number; entries: any[] };
    expect(journal.schemaVersion).toBe(6);
    expect(journal.entries[0]?.command).toEqual(unlock("arc"));
    expect(journal.entries[3]?.command).toEqual(unlock("focus"));
    expect(decodeGameCommandJournal({ content: subjectContent, journal: clone(journal) as never }))
      .toEqual(journal);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: clone(journal) as never });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it.each([
    ["duplicate unlock", (checkpoint: any) => checkpoint.state.heroes.unit.unlockedSkillIds.push("arc")],
    ["forged points", (checkpoint: any) => { checkpoint.state.heroes.unit.skillPoints = 1; }],
    ["missing prerequisite", (checkpoint: any) => {
      checkpoint.state.heroes.unit.unlockedSkillIds = ["focus"];
      checkpoint.state.heroes.unit.skillPoints = 2;
    }]
  ])("rejects malformed nested v4 state: %s", (_label, mutate) => {
    const subjectContent = content({ prepTimeUnits: 2 });
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_skills",
      seed: "hero-skill-checkpoint-invalid"
    });
    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(dispatchGameCommand(subject, unlock("focus"))).toEqual({ ok: true });
    const checkpoint = clone(subject.createCheckpoint());
    mutate(checkpoint);
    resign(checkpoint);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/hero.*skill|skill.*hero|point|prerequisite|duplicate/i);
  });

  it.each([
    ["disconnected retained point chain", (events: any[]) => {
      const grant = events.find((event) => event.type === "heroSkillPointsGranted");
      grant.previousPoints = 1;
      grant.currentPoints = 3;
    }],
    ["retained chain disconnected from authoritative points", (events: any[]) => {
      const grant = events.find((event) => event.type === "heroSkillPointsGranted");
      const unlockEvent = events.find((event) => event.type === "heroSkillUnlocked");
      grant.previousPoints = 100;
      grant.currentPoints = 102;
      unlockEvent.previousPoints = 102;
      unlockEvent.currentPoints = 100;
    }]
  ])("rejects a hostile %s", (_label, mutateEvents) => {
    const subjectContent = content({ prepTimeUnits: 2 });
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_skills",
      seed: "hero-skill-checkpoint-event-chain"
    });
    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.1);
    expect(dispatchGameCommand(subject, unlock("focus"))).toEqual({ ok: true });
    const checkpoint = clone(subject.createCheckpoint()) as any;
    mutateEvents(checkpoint.state.lastEvents);
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/hero.*skill|skill.*hero|point|chain|authoritative/i);
  });

  it("rejects a retained unlock chain that violates authored prerequisite order", () => {
    const raw = runtimeInput() as any;
    const authoredTree = raw.mechanics.modules.heroes.profiles.commanders.definitions.commander.skillTree;
    authoredTree.points.starting = 4;
    authoredTree.points.perInterwave = 0;
    const subjectContent = createGameContentRegistry(raw);
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_skills",
      seed: "hero-skill-checkpoint-prerequisite-order"
    });
    expect(dispatchGameCommand(subject, unlock("arc"))).toEqual({ ok: true });
    expect(dispatchGameCommand(subject, unlock("focus"))).toEqual({ ok: true });
    const checkpoint = clone(subject.createCheckpoint()) as any;
    const events = checkpoint.state.lastEvents;
    const arcEvent = events.find((event: any) => event.type === "heroSkillUnlocked" && event.skillId === "arc");
    const focusEvent = events.find((event: any) => event.type === "heroSkillUnlocked" && event.skillId === "focus");
    focusEvent.previousPoints = 4;
    focusEvent.currentPoints = 2;
    arcEvent.previousPoints = 2;
    arcEvent.currentPoints = 0;
    checkpoint.state.lastEvents = [focusEvent, arcEvent];
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/hero.*skill|skill.*hero|prerequisite|order|chain/i);
  });
});
