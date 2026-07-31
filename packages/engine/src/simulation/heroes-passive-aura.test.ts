import { afterEach, describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import {
  JournaledGameSession,
  replayGameCommandJournal,
  type DamagePacket,
  type EnemyState,
  type GameCheckpointV1
} from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { DamageResolver } from "./damage.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type AuraMode = "active" | "null" | "legacy" | "absent" | "disabled" | "unselected" | "future";

function skillTree(): Record<string, unknown> {
  return {
    points: { starting: 1, perInterwave: 1 },
    nodes: {
      focus: {
        label: "Focus",
        description: "Increase hero ability damage without affecting towers.",
        cost: 1,
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

function heroDefinition(mode: AuraMode, radius: number, treeActive: boolean): Record<string, unknown> {
  return {
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "ground", speed: 5 },
    durability: { maxHp: 100, shield: null },
    mana: { max: 100, starting: 100, regenerationPerUnit: 0 },
    activeAbility: {
      id: "arc_bolt",
      label: "Arc Bolt",
      target: "enemy",
      manaCost: 10,
      cooldown: 0,
      range: 20,
      damage: 10
    },
    skillTree: treeActive ? skillTree() : null,
    ...(mode === "legacy" ? {} : {
      passiveAura: mode === "null" ? null : {
        id: "command_link",
        label: "Command link",
        radius,
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1.5 }
        }]
      }
    })
  };
}

function runtimeInput(options: {
  readonly mode?: AuraMode;
  readonly radius?: number;
  readonly enemyTowerAttack?: boolean;
  readonly treeActive?: boolean;
  readonly grid?: "square" | "hex";
} = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const radius = options.radius ?? 2;
  const moduleVersion = mode === "legacy" ? 5 : mode === "future" ? 7 : 6;
  const modules = mode === "absent" ? {} : {
    heroes: {
      schemaVersion: moduleVersion,
      enabled: mode !== "disabled",
      profiles: {
        commanders: {
          selectedHeroId: "commander",
          definitions: { commander: heroDefinition(mode, radius, options.treeActive ?? true) },
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
  };
  return {
    balance: {
      defaultMissionId: "hero_aura",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 50,
        startingResources: { coins: 50 },
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
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 0, duration: 0, radius: 0,
          effects: [{ kind: "damage", amount: 10 }]
        }
      },
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 1_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1,
          ...(options.enemyTowerAttack ? { towerAttack: { interval: 0.05, damage: 100, range: 20 } } : {})
        }
      },
      towers: {
        subject: {
          id: "subject", label: "Subject", cost: { coins: 1 }, footprintRadius: 0,
          range: 20,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 10,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave_0", label: "Wave 1",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        hero_aura: {
          id: "hero_aura", label: "Hero aura", description: "",
          startingCoreHp: 20, startingResources: { coins: 50 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["subject"], abilityIds: ["strike"],
          ...(mode === "unselected" || mode === "absent"
            ? {}
            : { mechanics: { profiles: { heroes: "commanders" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3,
        grid: options.grid === "hex"
          ? { kind: "hex", layout: "odd-r" }
          : { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...(mode === "absent" ? {} : { mechanics: { schemaVersion: 1, modules } }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_aura", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: Parameters<typeof runtimeInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(options));
}

function game(options: Parameters<typeof runtimeInput>[0] = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    content: content(options),
    missionId: "hero_aura",
    seed: "hero-passive-aura"
  });
}

type TowerDamageBoundary = {
  applyResolvedTowerDamage(
    towerTypeId: string,
    enemy: EnemyState,
    rawDamage: number,
    options?: { readonly aoe?: boolean; readonly overTime?: boolean },
    towerId?: string
  ): unknown;
};

function damageBoundary(subject: TowerDefenseGame): TowerDamageBoundary {
  return subject as unknown as TowerDamageBoundary;
}

function auraModifiers(packet: DamagePacket) {
  return packet.modifiers?.filter((modifier) => modifier.id.startsWith("heroes:aura:")) ?? [];
}

function auraSnapshot(subject: Pick<TowerDefenseGame, "getSnapshot">): Record<string, any> | undefined {
  return (subject.getSnapshot().heroes as any)?.units?.[0]?.passiveAura;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

afterEach(() => vi.restoreAllMocks());

describe("R5.5A deterministic tower-only passive aura runtime (RED)", () => {
  it.each(["square", "hex"] as const)(
    "uses the inclusive %s topology radius, stable spatial ModifierSpec, and binary affected-tower order",
    (grid) => {
    const subject = game({ grid });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.placeTower("subject", { q: 3, r: 1 })).toEqual({ ok: true }); // distance 3: outside
    expect(subject.placeTower("subject", { q: 4, r: 1 })).toEqual({ ok: true }); // distance 2: boundary
    expect(subject.placeTower("subject", { q: 5, r: 1 })).toEqual({ ok: true }); // distance 1: inside

    expect(subject.getSnapshot().heroes).toMatchObject({
      schemaVersion: 6,
      units: [{
        id: "commander",
        passiveAura: {
          id: "command_link",
          label: "Command link",
          radius: 2,
          active: true,
          affectedTowerIds: ["tower_2", "tower_3"]
        }
      }]
    });

    const resolve = vi.spyOn(DamageResolver, "resolve");
    for (const towerId of ["tower_1", "tower_2", "tower_3"] as const) {
      damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 10, {}, towerId);
    }
    expect(resolve.mock.calls.map(([packet]) => auraModifiers(packet))).toEqual([
      [],
      [{
        id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:00",
        target: "damage",
        stage: "spatial",
        operation: "multiplier",
        value: 1.5
      }],
      [{
        id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:00",
        target: "damage",
        stage: "spatial",
        operation: "multiplier",
        value: 1.5
      }]
    ]);
    expect(subject.enemies[0]!.hp).toBe(960);
  });

  it("keeps authored effect indices stable while DamageResolver orders flat, ratio, then multiplier", () => {
    const raw = runtimeInput() as any;
    raw.mechanics.modules.heroes.profiles.commanders.definitions.commander.passiveAura.effects = [
      {
        kind: "modifier", scope: "tower_damage",
        modifier: { target: "damage", operation: "multiplier", value: 1.5 }
      },
      { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "flat", value: 2 } },
      {
        kind: "modifier", scope: "tower_damage",
        modifier: { target: "damage", operation: "additive_ratio", value: 0.1 }
      }
    ];
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(raw), missionId: "hero_aura", seed: "hero-aura-order"
    });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.placeTower("subject", { q: 5, r: 1 })).toEqual({ ok: true });
    const result = damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[0]!, 10, {}, "tower_1"
    ) as any;
    expect(result.resolution.modifierTrace.filter((step: any) => step.id.startsWith("heroes:aura:"))).toEqual([
      expect.objectContaining({ id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:01", operation: "flat" }),
      expect.objectContaining({ id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:02", operation: "additive_ratio" }),
      expect.objectContaining({ id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:00", operation: "multiplier" })
    ]);
    expect(result.resolution.finalAmount).toBeCloseTo(19.8, 10);
  });

  it("changes membership only after deterministic cell entry and applies the new position before later damage", () => {
    const subject = game({ radius: 1 });
    expect(subject.placeTower("subject", { q: 4, r: 1 })).toEqual({ ok: true });
    expect(auraSnapshot(subject)?.affectedTowerIds).toEqual([]);

    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "moveHero",
      heroId: "commander",
      target: { q: 5, r: 1 }
    })).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.getSnapshot().heroes).toMatchObject({
      units: [{ coord: { q: 6, r: 1 }, movement: { edgeProgress: 0.5 } }]
    });
    expect(auraSnapshot(subject)?.affectedTowerIds).toEqual([]);

    subject.tick(0.1);
    expect(subject.getSnapshot().heroes).toMatchObject({ units: [{ coord: { q: 5, r: 1 } }] });
    expect(auraSnapshot(subject)?.affectedTowerIds).toEqual(["tower_1"]);

    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "moveHero",
      heroId: "commander",
      target: { q: 6, r: 1 }
    })).toEqual({ ok: true });
    subject.tick(0.2);
    expect(auraSnapshot(subject)?.affectedTowerIds).toEqual([]);
  });

  it("isolates the aura to live placed tower packets and excludes DoT, unowned, hero, and mission ability damage", () => {
    const subject = game();
    expect(subject.placeTower("subject", { q: 5, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const resolve = vi.spyOn(DamageResolver, "resolve");

    damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 1, {}, "tower_1");
    damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 1, { overTime: true }, "tower_1");
    damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 1);
    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "useHeroAbility",
      heroId: "commander",
      abilityId: "arc_bolt",
      targetEnemyId: "enemy_1"
    })).toEqual({ ok: true });
    expect(dispatchGameCommand(subject, {
      schemaVersion: 6,
      type: "useAbility",
      abilityId: "strike",
      center: { q: 0, r: 1 }
    })).toEqual({ ok: true });

    const packets = resolve.mock.calls.map(([packet]) => packet);
    expect(auraModifiers(packets[0]!)).toHaveLength(1);
    expect(packets.slice(1).map((packet) => auraModifiers(packet))).toEqual([[], [], [], []]);
    expect(packets.slice(1).map((packet) => packet.source.kind)).toEqual(["tower", "tower", "ability", "ability"]);
  });

  it("deactivates the derived aura once the hero is defeated", () => {
    const subject = game({ enemyTowerAttack: true });
    expect(subject.placeTower("subject", { q: 5, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0.05);
    expect(subject.getSnapshot().heroes).toMatchObject({
      units: [{ durability: { defeated: true }, passiveAura: { active: false, affectedTowerIds: [] } }]
    });

    const resolve = vi.spyOn(DamageResolver, "resolve");
    damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 10, {}, "tower_1");
    expect(auraModifiers(resolve.mock.calls[0]![0])).toEqual([]);
  });
});

describe("R5.5A passive-aura compatibility and deterministic persistence (RED)", () => {
  it("keeps passiveAura:null byte-for-shape equivalent to v5 and leaves inactive paths legacy", () => {
    const legacy = game({ mode: "legacy" });
    const nullOptOut = game({ mode: "null" });
    expect(nullOptOut.getSnapshot()).toEqual(legacy.getSnapshot());
    expect(nullOptOut.getSnapshot().heroes).toMatchObject({ schemaVersion: 5 });

    for (const mode of ["absent", "disabled", "unselected", "future"] as const) {
      const subject = game({ mode });
      expect(subject.getSnapshot().heroes).toBeUndefined();
      expect(subject.placeTower("subject", { q: 5, r: 1 })).toEqual({ ok: true });
      expect(subject.startNextWave()).toEqual({ ok: true });
      subject.tick(0);
      const resolve = vi.spyOn(DamageResolver, "resolve");
      damageBoundary(subject).applyResolvedTowerDamage("subject", subject.enemies[0]!, 10, {}, "tower_1");
      expect(auraModifiers(resolve.mock.calls[0]![0])).toEqual([]);
      resolve.mockRestore();
    }
  });

  it("reuses one frozen empty modifier result for every inactive legacy/null aura path", () => {
    const emptyResults = (["legacy", "null", "absent", "disabled", "unselected", "future"] as const)
      .map((mode) => {
        const subject = game({ mode }) as any;
        const tower = { id: "tower_probe", typeId: "subject", coord: { q: 6, r: 1 } };
        const first = subject.heroPassiveAuraModifiersForTower(tower);
        const second = subject.heroPassiveAuraModifiersForTower(tower);
        expect(first).toBe(second);
        expect(first).toEqual([]);
        expect(Object.isFrozen(first)).toBe(true);
        return first;
      });
    for (const result of emptyResults) expect(result).toBe(emptyResults[0]);
  });

  it("precompiles and reuses the active aura ModifierSpec list", () => {
    const subject = game() as any;
    const tower = { id: "tower_probe", typeId: "subject", coord: { q: 6, r: 1 } };
    const first = subject.heroPassiveAuraModifiersForTower(tower);
    const second = subject.heroPassiveAuraModifiersForTower(tower);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toEqual([expect.objectContaining({
      id: "heroes:aura:hero:9:commander:aura:12:command_link:effect:00",
      stage: "spatial",
      operation: "multiplier",
      value: 1.5
    })]);
  });

  it.each([
    ["tree null, aura null", { mode: "null" as const, treeActive: false }, 4, 3, undefined],
    ["tree active, aura null", { mode: "null" as const, treeActive: true }, 5, 4, undefined],
    ["tree null, aura active", { mode: "active" as const, treeActive: false }, 6, 3, null],
    ["tree active, aura active", { mode: "active" as const, treeActive: true }, 6, 4, "state"]
  ])("preserves the exact snapshot/checkpoint matrix for %s", (_label, options, snapshotVersion, checkpointVersion, skillsMode) => {
    const subject = game(options);
    expect(subject.getSnapshot().heroes).toMatchObject({ schemaVersion: snapshotVersion });
    expect(subject.createCheckpoint().state.heroes).toMatchObject({ schemaVersion: checkpointVersion });
    if (snapshotVersion === 6) {
      const skills = (subject.getSnapshot().heroes as any).units[0].skills;
      if (skillsMode === null) expect(skills).toBeNull();
      else expect(skills).toMatchObject({ availablePoints: 1 });
    }
  });

  it("derives aura membership from existing v4 hero checkpoint state and replays without a new command domain", () => {
    expect((Engine as any).GAME_COMMAND_SCHEMA_VERSION).toBe(7);
    expect((Engine as any).GAME_COMMAND_JOURNAL_SCHEMA_VERSION).toBe(7);
    const subjectContent = content({ radius: 1 });
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_aura",
      seed: "hero-aura-replay"
    }));
    expect(session.dispatch({
      schemaVersion: 6, type: "placeTower", towerTypeId: "subject", coord: { q: 4, r: 1 }
    })).toEqual({ ok: true });
    expect(session.dispatch({
      schemaVersion: 6, type: "moveHero", heroId: "commander", target: { q: 5, r: 1 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "tick", units: 0.1 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "tick", units: 0.1 })).toEqual({ ok: true });
    expect(auraSnapshot(session.game)?.affectedTowerIds).toEqual(["tower_1"]);

    const checkpoint = session.game.createCheckpoint() as GameCheckpointV1;
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.heroes).toMatchObject({
      schemaVersion: 4,
      unit: { currentCoord: { q: 5, r: 1 } }
    });
    expect(checkpoint.state.heroes).not.toHaveProperty("passiveAura");
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: clone(checkpoint) });
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());
    expect(restored.getSnapshot()).toEqual(session.game.getSnapshot());

    const journal = session.exportJournal();
    expect(journal.schemaVersion).toBe(6);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: clone(journal) });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("never calls Math.random on active, null, absent, disabled, unselected, or future paths", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is forbidden");
    });
    for (const mode of ["active", "null", "legacy", "absent", "disabled", "unselected", "future"] as const) {
      const subject = game({ mode });
      subject.getSnapshot();
      subject.tick(0.2);
      subject.getStateDigest();
    }
    expect(random).not.toHaveBeenCalled();
  });
});
