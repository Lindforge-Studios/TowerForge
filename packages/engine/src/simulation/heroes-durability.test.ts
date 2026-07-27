import { afterEach, describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { DamageResolver } from "./damage.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type HeroVersion = "absent" | 1 | 2 | 3;

function heroProfile(version: Exclude<HeroVersion, "absent">, durability: unknown = {
  maxHp: 10,
  shield: { capacity: 5 }
}): Record<string, unknown> {
  if (version === 1) {
    return {
      selectedHeroId: "commander",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    };
  }
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: {
        label: "Commander",
        spawn: "core",
        movement: { movementProfileId: "ground", speed: 2 },
        ...(version === 3 ? { durability } : {})
      }
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

function durabilityInput(
  version: HeroVersion = 3,
  durability?: unknown,
  enabled = true
): GameContentInput {
  return {
    balance: {
      defaultMissionId: "durability",
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
        striker: {
          id: "striker", label: "Striker", maxHp: 1_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1,
          towerAttack: { interval: 0.05, damage: 8, range: 20 }
        }
      },
      towers: {
        wall: {
          id: "wall", label: "Wall", cost: { coins: 1 }, footprintRadius: 0,
          range: 1, maxHp: 10,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "striker", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        durability: {
          id: "durability", label: "Durability", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["wall"], abilityIds: [],
          ...(version === "absent" ? {} : { mechanics: { profiles: { heroes: "commanders" } } })
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
    ...(version === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: version,
            enabled,
            profiles: { commanders: heroProfile(version, durability) }
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
        missionId: "durability", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as GameContentInput;
}

function content(version: HeroVersion = 3, durability?: unknown, enabled = true): GameContentRegistry {
  return createGameContentRegistry(durabilityInput(version, durability, enabled));
}

function game(version: HeroVersion = 3): TowerDefenseGame {
  return new TowerDefenseGame({
    content: content(version),
    missionId: "durability",
    seed: "hero-durability"
  });
}

function heroes(subject: TowerDefenseGame): Record<string, unknown> | undefined {
  return subject.getSnapshot().heroes as unknown as Record<string, unknown> | undefined;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

afterEach(() => vi.restoreAllMocks());

describe("R5.2A heroes v3 durability authoring", () => {
  it("publishes a closed v3 schema and normalizes finite bounded HP and an optional capacity-only shield", () => {
    const schema = (Engine as unknown as { HEROES_MECHANICS_SCHEMA: Record<string, any> }).HEROES_MECHANICS_SCHEMA;
    expect(schema.supportedModuleSchemaVersions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(schema.versions[3]).toMatchObject({
      definition: {
        requiredFields: ["label", "spawn", "movement", "durability"],
        optionalFields: [],
        additionalProperties: false
      },
      durability: {
        requiredFields: ["maxHp", "shield"],
        optionalFields: [],
        additionalProperties: false,
        maxHp: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
      },
      shield: {
        nullable: true,
        requiredFields: ["capacity"],
        optionalFields: [],
        additionalProperties: false,
        capacity: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
      }
    });
    expect(schema.runtimeSnapshot).toMatchObject({
      schemaVersions: [1, 2, 3, 4, 5, 6, 7],
      versions: {
        3: {
          unitFields: ["id", "definitionId", "label", "coord", "movement", "durability"],
          durabilityFields: ["hp", "maxHp", "shield", "defeated"]
        }
      }
    });
    expect((Engine as unknown as {
      DAMAGE_PACKET_SCHEMA: { targetKinds: readonly string[] };
    }).DAMAGE_PACKET_SCHEMA.targetKinds).toEqual(["enemy", "tower", "hero", "core"]);

    const normalize = (Engine as unknown as {
      normalizeHeroesProfileV3?: (value: unknown) => unknown;
    }).normalizeHeroesProfileV3;
    expect(normalize).toBeTypeOf("function");
    expect(normalize!(heroProfile(3))).toEqual(heroProfile(3));

    for (const malformed of [
      { maxHp: 0, shield: null },
      { maxHp: Number.POSITIVE_INFINITY, shield: null },
      { maxHp: 1_000_000_000_001, shield: null },
      { maxHp: 10, shield: { capacity: 0 } },
      { maxHp: 10, shield: { capacity: 5, regeneration: { ratePerUnit: 1 } } },
      { maxHp: 10 },
      { maxHp: 10, shield: null, extra: true }
    ]) {
      expect(() => normalize!(heroProfile(3, malformed))).toThrow(/durability|shield|maxHp|capacity|unknown|required|range/i);
    }
  });

  it("structurally rejects malformed v3 durability even while the module is disabled", () => {
    expect(validateGameContentRegistry(content(3))).toMatchObject({ ok: true, issues: [] });

    const active = validateGameContentRegistry(content(3, { maxHp: 10, shield: { capacity: 0 } }));
    expect(active.ok).toBe(false);
    expect(active.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/heroes|durability|shield|capacity/i),
      message: expect.stringMatching(/positive|greater|range|capacity/i)
    }));

    const inactive = validateGameContentRegistry(content(3, { maxHp: 10, shield: { capacity: 0 } }, false));
    expect(inactive.ok).toBe(false);
    expect(inactive.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/heroes|durability|shield|capacity/i)
    }));
  });
});

describe("R5.2A hero durability runtime", () => {
  it("uses deterministic binary tower ids for equal-distance v3 attack targets before considering the hero", () => {
    const subject = game();
    expect(subject.placeTower("wall", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(subject.placeTower("wall", { q: 0, r: 2 })).toEqual({ ok: true });
    subject.towers.reverse();
    expect(subject.startNextWave()).toEqual({ ok: true });

    subject.tick(0.05);
    expect(subject.lastEvents.filter((event) => event.type === "towerAttacked")).toEqual([
      expect.objectContaining({ type: "towerAttacked", towerId: "tower_1" })
    ]);
    expect(subject.lastEvents.some((event) => event.type === "heroAttacked")).toBe(false);
  });

  it("routes enemy towerAttack through the shared resolver, consumes shield before HP, and defeats exactly once", () => {
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const subject = game();
    expect(subject.startNextWave()).toEqual({ ok: true });

    subject.tick(0.05);
    expect(resolve.mock.calls.filter(([packet]) => packet.target.kind === "hero")).toHaveLength(1);
    expect(resolve.mock.calls.at(-1)?.[0]).toMatchObject({
      amount: 8,
      source: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "striker" },
      target: { kind: "hero", heroId: "commander", heroDefinitionId: "commander" }
    });
    expect(heroes(subject)).toEqual({
      schemaVersion: 3,
      units: [{
        id: "commander", definitionId: "commander", label: "Commander",
        coord: { q: 5, r: 1 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: {
          hp: 7, maxHp: 10, shield: { current: 0, capacity: 5 }, defeated: false
        }
      }]
    });
    expect(subject.lastEvents).toContainEqual(expect.objectContaining({
      type: "heroShieldChanged", heroId: "commander", previous: 5, current: 0,
      capacity: 5, cause: "damage", amount: 5
    }));
    expect(subject.lastEvents).toContainEqual(expect.objectContaining({
      type: "heroAttacked", enemyId: "enemy_1", enemyTypeId: "striker",
      heroId: "commander", damage: 8, shieldAbsorbed: 5, hpDamage: 3
    }));

    resolve.mockClear();
    subject.tick(0.05);
    expect(resolve.mock.calls.filter(([packet]) => packet.target.kind === "hero")).toHaveLength(1);
    expect(heroes(subject)).toMatchObject({
      schemaVersion: 3,
      units: [{
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: { hp: 0, maxHp: 10, shield: { current: 0, capacity: 5 }, defeated: true }
      }]
    });
    expect(subject.lastEvents.filter((event) => event.type === "heroDefeated")).toEqual([
      expect.objectContaining({ type: "heroDefeated", heroId: "commander" })
    ]);
    expect(subject.moveHero("commander", { q: 4, r: 1 })).toMatchObject({
      ok: false, reasonKey: "reason.heroDefeated"
    });

    resolve.mockClear();
    subject.tick(0.05);
    expect(resolve.mock.calls.filter(([packet]) => packet.target.kind === "hero")).toHaveLength(0);
    expect(subject.lastEvents.filter((event) => (
      event.type === "heroAttacked" || event.type === "heroDefeated"
    ))).toEqual([]);
  });

  it("round-trips nested checkpoint v2 and journal replay without changing the outer version", () => {
    const durableContent = content();
    const subject = new TowerDefenseGame({
      content: durableContent, missionId: "durability", seed: "hero-checkpoint"
    });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.05);
    const checkpoint = subject.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.heroes).toEqual({
      schemaVersion: 2,
      unit: {
        definitionId: "commander",
        currentCoord: { q: 5, r: 1 },
        targetCoord: null,
        nextCoord: null,
        edgeProgress: 0,
        hp: 7,
        shieldCurrent: 0
      }
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
    restored.tick(0.05);
    expect(restored.getSnapshot().heroes).toMatchObject({
      schemaVersion: 3,
      units: [{ durability: { hp: 0, defeated: true } }]
    });

    const malformed = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
    const malformedHeroes = malformed.state.heroes;
    if (!malformedHeroes || malformedHeroes.schemaVersion !== 2) throw new Error("Expected durable hero checkpoint.");
    const mutableUnit = malformedHeroes.unit as {
      hp: number;
      targetCoord: { q: number; r: number } | null;
      nextCoord: { q: number; r: number } | null;
      edgeProgress: number;
    };
    mutableUnit.hp = 0;
    mutableUnit.targetCoord = { q: 4, r: 1 };
    mutableUnit.nextCoord = { q: 4, r: 1 };
    mutableUnit.edgeProgress = 0;
    resign(malformed);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: malformed }))
      .toThrow(/defeated|fallen|hero.*movement|idle/i);

    const session = new JournaledGameSession(new TowerDefenseGame({
      content: durableContent, missionId: "durability", seed: "hero-replay"
    }));
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.05 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.05 })).toEqual({ ok: true });
    const replay = replayGameCommandJournal({ content: durableContent, journal: session.exportJournal() });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("rejects impossible durability combinations and forged hero events in resigned checkpoints", () => {
    const durableContent = content();
    const subject = new TowerDefenseGame({ content: durableContent, missionId: "durability" });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.05);
    const checkpoint = subject.createCheckpoint();

    for (const [hp, shieldCurrent] of [[7, 5], [0, 5]] as const) {
      const impossible = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
      const state = impossible.state.heroes;
      if (!state || state.schemaVersion !== 2) throw new Error("Expected durable hero checkpoint.");
      (state.unit as { hp: number; shieldCurrent: number }).hp = hp;
      (state.unit as { hp: number; shieldCurrent: number }).shieldCurrent = shieldCurrent;
      resign(impossible);
      expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: impossible }))
        .toThrow(/hero.*shield|shield.*hp|durability.*state|impossible/i);
    }

    const absentContent = content("absent");
    const absent = new TowerDefenseGame({ content: absentContent, missionId: "durability" }).createCheckpoint();
    (absent.state.lastEvents as unknown as unknown[]).push({
      type: "heroDefeated", heroId: "ghost", heroDefinitionId: "ghost", enemyId: "ghost"
    });
    resign(absent);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: absentContent, checkpoint: absent }))
      .toThrow(/hero.*event.*active|requires.*heroes|durability/i);

    const futureCause = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
    const shieldEvent = (futureCause.state.lastEvents as unknown as Array<Record<string, unknown>>)
      .find((event) => event.type === "heroShieldChanged");
    if (!shieldEvent) throw new Error("Expected hero shield event.");
    shieldEvent.cause = "future";
    resign(futureCause);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: futureCause }))
      .toThrow(/hero.*shield.*cause|cause.*invalid/i);

    const impossibleAttack = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
    const attackEvent = (impossibleAttack.state.lastEvents as unknown as Array<Record<string, unknown>>)
      .find((event) => event.type === "heroAttacked");
    if (!attackEvent) throw new Error("Expected hero attack event.");
    attackEvent.hpDamage = 4;
    resign(impossibleAttack);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: impossibleAttack }))
      .toThrow(/hero.*attack|damage.*decomposition|shieldAbsorbed|hpDamage/i);

    const overCapacityAttack = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
    const overCapacityEvent = (overCapacityAttack.state.lastEvents as unknown as Array<Record<string, unknown>>)
      .find((event) => event.type === "heroAttacked");
    if (!overCapacityEvent) throw new Error("Expected hero attack event.");
    overCapacityEvent.damage = 6;
    overCapacityEvent.shieldAbsorbed = 6;
    overCapacityEvent.hpDamage = 0;
    resign(overCapacityAttack);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: overCapacityAttack }))
      .toThrow(/hero.*attack|shieldAbsorbed|shield.*capacity|authored shield/i);

    const forgedDefeat = JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1;
    const forgedDefeatState = forgedDefeat.state.heroes;
    if (!forgedDefeatState || forgedDefeatState.schemaVersion !== 2) {
      throw new Error("Expected durable hero checkpoint.");
    }
    expect((forgedDefeatState.unit as { hp: number }).hp).toBeGreaterThan(0);
    (forgedDefeat.state.lastEvents as unknown as Array<Record<string, unknown>>).push({
      type: "heroDefeated",
      heroId: "commander",
      heroDefinitionId: "commander",
      enemyId: "enemy_1"
    });
    resign(forgedDefeat);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: durableContent, checkpoint: forgedDefeat }))
      .toThrow(/hero.*defeat|defeat.*hp|positive.*hp|hp.*zero/i);

    const shieldlessContent = content(3, { maxHp: 10, shield: null });
    const shieldlessGame = new TowerDefenseGame({ content: shieldlessContent, missionId: "durability" });
    expect(shieldlessGame.startNextWave()).toEqual({ ok: true });
    shieldlessGame.tick(0.05);
    const shieldlessCheckpoint = shieldlessGame.createCheckpoint();
    const shieldlessAttack = (shieldlessCheckpoint.state.lastEvents as unknown as Array<Record<string, unknown>>)
      .find((event) => event.type === "heroAttacked");
    if (!shieldlessAttack) throw new Error("Expected shieldless hero attack event.");
    shieldlessAttack.shieldAbsorbed = 1;
    shieldlessAttack.hpDamage = 7;
    resign(shieldlessCheckpoint);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: shieldlessContent, checkpoint: shieldlessCheckpoint }))
      .toThrow(/hero.*attack|shieldAbsorbed|authored shield|shield.*capacity/i);
  });

  it("keeps absent and v1/v2 snapshot/checkpoint contracts byte-shape compatible", () => {
    const absent = game("absent");
    expect(absent.getSnapshot()).not.toHaveProperty("heroes");
    expect(absent.createCheckpoint().state).not.toHaveProperty("heroes");

    expect(heroes(game(1))).toEqual({
      schemaVersion: 1,
      units: [{
        id: "commander", definitionId: "commander", label: "Commander", coord: { q: 5, r: 1 }
      }]
    });
    expect(game(1).createCheckpoint().state).not.toHaveProperty("heroes");

    const v2 = game(2);
    expect(heroes(v2)).toEqual({
      schemaVersion: 2,
      units: [{
        id: "commander", definitionId: "commander", label: "Commander", coord: { q: 5, r: 1 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 }
      }]
    });
    expect(v2.createCheckpoint().state.heroes).toMatchObject({ schemaVersion: 1 });
  });
});
