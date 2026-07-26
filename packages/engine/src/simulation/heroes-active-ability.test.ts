import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCheckpointStateDigest,
  decodeGameCommandJournal,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1,
  type GameCommandJournalV5,
  type GameCommandV5
} from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { DamageResolver } from "./damage.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "absent" | "v3" | "v4" | "future";

interface AbilityFixture {
  readonly mana?: Readonly<{ max: number; starting: number; regenerationPerUnit: number }>;
  readonly ability?: Readonly<{
    id: string;
    label: string;
    target: "enemy";
    manaCost: number;
    cooldown: number;
    range: number;
    damage: number;
  }>;
  readonly heroMaxHp?: number;
  readonly enemyMaxHp?: number;
  readonly enemyAttack?: Readonly<{ interval: number; damage: number; range: number }>;
}

const DEFAULT_MANA = Object.freeze({ max: 100, starting: 40, regenerationPerUnit: 5 });
const DEFAULT_ABILITY = Object.freeze({
  id: "arc_bolt",
  label: "Arc Bolt",
  target: "enemy" as const,
  manaCost: 20,
  cooldown: 3,
  range: 8,
  damage: 30
});

function profile(activation: Exclude<Activation, "absent" | "future">, fixture: AbilityFixture): Record<string, unknown> {
  const moving = {
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "ground", speed: 2 },
    durability: { maxHp: fixture.heroMaxHp ?? 100, shield: null }
  };
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: activation === "v4"
        ? {
            ...moving,
            mana: fixture.mana ?? DEFAULT_MANA,
            activeAbility: fixture.ability ?? DEFAULT_ABILITY
          }
        : moving
    },
    movementProfiles: {
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1_000
      }
    }
  };
}

function abilityInput(activation: Activation = "v4", fixture: AbilityFixture = {}): GameContentInput {
  const active = activation === "future" ? "v4" : activation;
  return {
    balance: {
      defaultMissionId: "hero_ability",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 0,
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
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: fixture.enemyMaxHp ?? 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1,
          ...(fixture.enemyAttack === undefined ? {} : { towerAttack: fixture.enemyAttack })
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
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        hero_ability: {
          id: "hero_ability", label: "Hero ability", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["wall"], abilityIds: [],
          ...(activation === "absent" ? {} : { mechanics: { profiles: { heroes: "commanders" } } })
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
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: (activation === "future" ? 5 : active === "v4" ? 4 : 3) as 1,
            enabled: true,
            profiles: { commanders: profile(active as "v3" | "v4", fixture) }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_ability", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as GameContentInput;
}

function content(activation: Activation = "v4", fixture: AbilityFixture = {}): GameContentRegistry {
  return createGameContentRegistry(abilityInput(activation, fixture));
}

function game(activation: Activation = "v4", fixture: AbilityFixture = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    content: content(activation, fixture),
    missionId: "hero_ability",
    seed: "hero-active-ability"
  });
}

function useHeroAbility(
  heroId = "commander",
  abilityId = "arc_bolt",
  targetEnemyId = "enemy_1"
): GameCommandV5 {
  return { schemaVersion: 5, type: "useHeroAbility", heroId, abilityId, targetEnemyId };
}

function spawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies).toContainEqual(expect.objectContaining({ id: "enemy_1", typeId: "target" }));
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

function expectAtomicFailure(
  subject: TowerDefenseGame,
  command: GameCommandV5,
  reasonKey: string
): void {
  const beforeDigest = subject.getStateDigest();
  const beforeSnapshot = clone(subject.getSnapshot());
  const beforeHeroAbilityEvents = clone(
    subject.lastEvents.filter((event) => event.type === "heroAbilityUsed")
  );
  expect(dispatchGameCommand(subject, command)).toEqual({
    ok: false,
    reason: expect.any(String),
    reasonKey
  });
  expect(subject.getStateDigest()).toBe(beforeDigest);
  expect(subject.getSnapshot()).toEqual(beforeSnapshot);
  expect(subject.lastEvents.filter((event) => event.type === "heroAbilityUsed"))
    .toEqual(beforeHeroAbilityEvents);
}

afterEach(() => vi.restoreAllMocks());

describe("R5.3A exact GameCommandV5 boundary (RED)", () => {
  it("accepts only the exact v5 useHeroAbility envelope and keeps older envelopes closed", () => {
    const subject = game();
    spawn(subject);

    expect(dispatchGameCommand(subject, {
      schemaVersion: 4,
      type: "useHeroAbility",
      heroId: "commander",
      abilityId: "arc_bolt",
      targetEnemyId: "enemy_1"
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(subject, {
      ...useHeroAbility(),
      extra: true
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
  });

  it("allows legacy commands in a v5 envelope without changing the v1-v4 aliases", () => {
    const subject = game();
    expect(dispatchGameCommand(subject, {
      schemaVersion: 5,
      type: "startWave"
    } as GameCommandV5)).toEqual({ ok: true });
    expect(subject.startedWaveCount).toBe(1);
  });
});

describe("R5.3A targeted active ability runtime (RED)", () => {
  it("publishes the exact initial v4 snapshot and applies one shared damage packet atomically", () => {
    const subject = game();
    expect(subject.getSnapshot().heroes).toEqual({
      schemaVersion: 4,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 5, r: 1 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: { hp: 100, maxHp: 100, shield: null, defeated: false },
        mana: { current: 40, max: 100, regenerationPerUnit: 5 },
        activeAbility: {
          id: "arc_bolt", label: "Arc Bolt", target: "enemy",
          manaCost: 20, cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: true
        }
      }]
    });
    spawn(subject);
    const resolve = vi.spyOn(DamageResolver, "resolve");

    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    expect(resolve.mock.calls).toHaveLength(1);
    expect(resolve.mock.calls[0]?.[0]).toEqual({
      amount: 30,
      source: { kind: "ability", abilityId: "arc_bolt" },
      target: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "target" }
    });
    expect(subject.enemies[0]).toMatchObject({ id: "enemy_1", hp: 70 });
    expect(subject.getSnapshot().heroes).toMatchObject({
      schemaVersion: 4,
      units: [{
        mana: { current: 20, max: 100, regenerationPerUnit: 5 },
        activeAbility: { cooldownRemaining: 3, ready: false }
      }]
    });
    expect(subject.lastEvents.filter((event) => event.type === "heroAbilityUsed")).toEqual([{
      type: "heroAbilityUsed",
      heroId: "commander",
      heroDefinitionId: "commander",
      abilityId: "arc_bolt",
      targetEnemyId: "enemy_1",
      targetEnemyTypeId: "target",
      previousMana: 40,
      currentMana: 20,
      manaSpent: 20,
      cooldownApplied: 3,
      requestedDamage: 30,
      resolvedDamage: 30,
      shieldAbsorbed: 0,
      hpDamage: 30
    }]);
  });

  it("rejects inactive/future profiles and all runtime preconditions without any mutation", () => {
    for (const activation of ["absent", "v3", "future"] as const) {
      const subject = game(activation);
      spawn(subject);
      expectAtomicFailure(subject, useHeroAbility(), "reason.heroAbilityUnavailable");
    }

    const wrongHero = game();
    spawn(wrongHero);
    expectAtomicFailure(wrongHero, useHeroAbility("ghost"), "reason.heroUnavailable");

    const wrongAbility = game();
    spawn(wrongAbility);
    expectAtomicFailure(wrongAbility, useHeroAbility("commander", "ghost"), "reason.heroAbilityUnavailable");

    const missingTarget = game();
    spawn(missingTarget);
    expectAtomicFailure(missingTarget, useHeroAbility("commander", "arc_bolt", "ghost"), "reason.heroAbilityTargetUnavailable");

    const outOfRange = game("v4", { ability: { ...DEFAULT_ABILITY, range: 0 } });
    spawn(outOfRange);
    expectAtomicFailure(outOfRange, useHeroAbility(), "reason.heroAbilityOutOfRange");

    const insufficient = game("v4", { mana: { ...DEFAULT_MANA, starting: 19 } });
    spawn(insufficient);
    expectAtomicFailure(insufficient, useHeroAbility(), "reason.heroManaInsufficient");

    const cooling = game();
    spawn(cooling);
    expect(dispatchGameCommand(cooling, useHeroAbility())).toEqual({ ok: true });
    expectAtomicFailure(cooling, useHeroAbility(), "reason.heroAbilityCooldown");

    const defeated = game();
    spawn(defeated);
    const state = (defeated as unknown as { heroStateV2: { hp: number } }).heroStateV2;
    state.hp = 0;
    expectAtomicFailure(defeated, useHeroAbility(), "reason.heroDefeated");

    const deadTarget = game();
    spawn(deadTarget);
    deadTarget.enemies[0]!.hp = 0;
    expectAtomicFailure(deadTarget, useHeroAbility(), "reason.heroAbilityTargetUnavailable");

    for (const outcome of ["victory", "defeat"] as const) {
      const ended = game();
      spawn(ended);
      (ended as unknown as { outcome: typeof outcome }).outcome = outcome;
      expect(ended.getSnapshot().heroes).toMatchObject({
        units: [{ activeAbility: { ready: false } }]
      });
      expectAtomicFailure(ended, useHeroAbility(), "reason.missionEnded");
    }
  });

  it("regenerates mana and reduces cooldown deterministically only while playing and alive", () => {
    const subject = game("v4", {
      mana: { max: 100, starting: 100, regenerationPerUnit: 5 }
    });
    spawn(subject);
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    subject.tick(0.2);
    expect(subject.getSnapshot().heroes).toMatchObject({
      units: [{ mana: { current: 81 }, activeAbility: { cooldownRemaining: 2.8, ready: false } }]
    });
    for (let index = 0; index < 20; index += 1) subject.tick(0.2);
    expect(subject.getSnapshot().heroes).toMatchObject({
      units: [{ mana: { current: 100 }, activeAbility: { cooldownRemaining: 0, ready: true } }]
    });

    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    const beforePause = clone(subject.getSnapshot().heroes);
    (subject as unknown as { pendingDraftOffer: unknown }).pendingDraftOffer = {
      offerId: "draft_offer_1", afterWaveIndex: 0, poolId: "test", cardIds: ["a", "b", "c"]
    };
    subject.tick(0.2);
    expect(subject.getSnapshot().heroes).toEqual(beforePause);

    (subject as unknown as { pendingDraftOffer: unknown }).pendingDraftOffer = null;
    const runtime = (subject as unknown as { heroStateV2: { hp: number } }).heroStateV2;
    runtime.hp = 0;
    const beforeDefeatedTick = clone(subject.getSnapshot().heroes);
    subject.tick(0.2);
    expect(subject.getSnapshot().heroes).toEqual(beforeDefeatedTick);
  });
});

describe("R5.3A hero ability checkpoint and replay (RED)", () => {
  it("round-trips nested hero checkpoint v3 with exact mana and cooldown state", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "hero_ability", seed: "hero-ability-checkpoint"
    });
    spawn(subject);
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    const checkpoint = subject.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.heroes).toEqual({
      schemaVersion: 3,
      unit: {
        definitionId: "commander",
        currentCoord: { q: 5, r: 1 },
        targetCoord: null,
        nextCoord: null,
        edgeProgress: 0,
        hp: 100,
        shieldCurrent: 0,
        mana: 20,
        abilityCooldownRemaining: 3
      }
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());

    for (const [field, value] of [["mana", -1], ["mana", 101], ["abilityCooldownRemaining", -1], ["abilityCooldownRemaining", 4]] as const) {
      const malformed = clone(checkpoint);
      const state = malformed.state.heroes;
      if (!state || state.schemaVersion !== 3) throw new Error("Expected hero checkpoint v3.");
      (state.unit as unknown as Record<string, number>)[field] = value;
      resign(malformed);
      expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: malformed }))
        .toThrow(/hero.*mana|hero.*cooldown|ability.*cooldown|range|authored/i);
    }
  });

  it("rejects a retained ability event that disagrees with authoritative mana or cooldown state", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "hero_ability", seed: "hero-ability-hostile-checkpoint"
    });
    spawn(subject);
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    const checkpoint = subject.createCheckpoint();

    const inconsistentMana = clone(checkpoint) as unknown as {
      state: {
        lastEvents: Array<Record<string, unknown>>;
        heroes: { schemaVersion: number; unit: Record<string, unknown> };
      };
    };
    const manaEvent = inconsistentMana.state.lastEvents.find((event) => event.type === "heroAbilityUsed");
    if (!manaEvent) throw new Error("Expected retained heroAbilityUsed event.");
    manaEvent.previousMana = 60;
    manaEvent.currentMana = 40;
    resign(inconsistentMana as unknown as GameCheckpointV1);
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: inconsistentMana as unknown as GameCheckpointV1
    })).toThrow(/hero ability event.*(?:mana|state)|(?:mana|state).*hero ability event/i);

    const inconsistentCooldown = clone(checkpoint) as unknown as {
      state: {
        lastEvents: Array<Record<string, unknown>>;
        heroes: { schemaVersion: number; unit: Record<string, unknown> };
      };
    };
    inconsistentCooldown.state.heroes.unit.abilityCooldownRemaining = 2;
    resign(inconsistentCooldown as unknown as GameCheckpointV1);
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: inconsistentCooldown as unknown as GameCheckpointV1
    })).toThrow(/hero ability event.*(?:cooldown|state)|(?:cooldown|state).*hero ability event/i);
  });

  it("round-trips multiple retained zero-cooldown casts against only the final authoritative state", () => {
    const subjectContent = content("v4", {
      ability: { ...DEFAULT_ABILITY, cooldown: 0, damage: 10 }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "hero_ability", seed: "hero-ability-zero-cooldown"
    });
    spawn(subject);
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    expect(dispatchGameCommand(subject, useHeroAbility())).toEqual({ ok: true });
    expect(subject.lastEvents.filter((event) => event.type === "heroAbilityUsed")).toHaveLength(2);

    const checkpoint = subject.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
    expect(restored.lastEvents.filter((event) => event.type === "heroAbilityUsed"))
      .toEqual(subject.lastEvents.filter((event) => event.type === "heroAbilityUsed"));
  });

  it("promotes command journal v5 and replays the same exact digest and event", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent, missionId: "hero_ability", seed: "hero-ability-replay"
    }));
    expect(session.dispatch({ schemaVersion: 5, type: "startWave" } as GameCommandV5)).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 5, type: "tick", units: 0 } as GameCommandV5)).toEqual({ ok: true });
    expect(session.dispatch(useHeroAbility())).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 5, type: "tick", units: 0.2 } as GameCommandV5)).toEqual({ ok: true });

    const journal = session.exportJournal() as GameCommandJournalV5;
    expect(journal.schemaVersion).toBe(5);
    expect(journal.entries[2]?.command).toEqual(useHeroAbility());
    expect(decodeGameCommandJournal({ content: subjectContent, journal: clone(journal) })).toEqual(journal);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: clone(journal) });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.game.lastEvents.filter((event) => event.type === "heroAbilityUsed"))
      .toEqual(session.game.lastEvents.filter((event) => event.type === "heroAbilityUsed"));
  });
});
