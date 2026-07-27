import { afterEach, describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";
import { DamageResolver } from "../simulation/damage.js";
import { JournaledGameSession } from "../simulation/journal.js";
import { replayGameCommandJournal } from "../simulation/replay.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";

interface DamageTypeFixture {
  label: string;
}

interface ArmorTypeFixture {
  label: string;
  defaultMultiplier?: number;
  multipliers: Record<string, number>;
}

interface CombatProfileV2Fixture {
  shields?: {
    enemies?: Record<string, { capacity: number }>;
  };
  damageTypes?: Record<string, DamageTypeFixture>;
  armorTypes?: Record<string, ArmorTypeFixture>;
  armorAssignments?: {
    enemies?: Record<string, string>;
  };
  [key: string]: unknown;
}

interface ArmorInputOptions {
  moduleVersion?: number;
  enabled?: boolean;
  selected?: boolean;
  authorMechanics?: boolean;
  profile?: CombatProfileV2Fixture;
  enemyHp?: number;
  enemyResistances?: Record<string, number>;
  towerDamage?: number;
  towerDamageType?: string;
}

const validArmorProfile = (): CombatProfileV2Fixture => ({
  damageTypes: {
    physical: { label: "Physical" },
    fire: { label: "Fire" }
  },
  armorTypes: {
    plated: {
      label: "Plated",
      defaultMultiplier: 0.75,
      multipliers: { physical: 0.5, fire: 0.25 }
    }
  },
  armorAssignments: { enemies: { grunt: "plated" } }
});

function armorInput(options: ArmorInputOptions = {}): GameContentInput {
  const profile = options.profile ?? validArmorProfile();
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "armor",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: options.enemyHp ?? 20,
          speed: 0.1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1,
          ...(options.enemyResistances === undefined ? {} : { resistances: options.enemyResistances })
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single",
            fireRate: 0.1,
            damagePerStack: options.towerDamage ?? 8,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1,
            ...(options.towerDamageType === undefined ? {} : { damageType: options.towerDamageType })
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        armor: {
          id: "armor",
          label: "Armor",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          ...((options.selected ?? true) ? { mechanics: { profiles: { combat: "armored" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 6,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "armor",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };

  if (options.authorMechanics ?? true) {
    input.mechanics = {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: options.moduleVersion ?? 2,
          enabled: options.enabled ?? true,
          profiles: { armored: profile }
        }
      }
    } as unknown as GameContentInput["mechanics"];
  }
  return input;
}

function validate(options: ArmorInputOptions = {}) {
  const content = createGameContentRegistry(armorInput(options));
  return { content, result: validateGameContentRegistry(content) };
}

function issueAt(
  result: ReturnType<typeof validateGameContentRegistry>,
  path: RegExp,
  message: RegExp = /./
): boolean {
  return result.issues.some((issue) => (
    issue.severity === "error" && path.test(issue.fieldPath) && message.test(issue.message)
  ));
}

afterEach(() => vi.restoreAllMocks());

function nonTowerBoundaryInput(assigned: boolean): GameContentInput {
  const input = armorInput({
    enemyHp: 200,
    enemyResistances: { physical: 0.5 },
    profile: {
      damageTypes: { physical: { label: "Physical" } },
      armorTypes: {
        plated: { label: "Plated", multipliers: { physical: 0.5 } }
      },
      ...(assigned ? { armorAssignments: { enemies: { grunt: "plated" } } } : {})
    }
  });
  input.balance.abilities.blast = {
    id: "blast",
    label: "Blast",
    cooldown: 1,
    duration: 0,
    radius: 5,
    effects: [
      { kind: "damage", amount: 40 },
      { kind: "status", status: { poison: { dps: 40, duration: 1 } } }
    ]
  };
  input.balance.missions.armor!.abilityIds = ["blast"];
  input.scripts = {
    armor_boundary: {
      schemaVersion: 1,
      id: "armor_boundary",
      bindings: [{ scope: "global" }],
      handlers: {
        signal: [{
          when: { $op: "eq", args: [{ $get: "event.signal" }, "armor_boundary"] },
          actions: [{ action: "damageEnemy", target: "allEnemies", amount: 40 }]
        }]
      }
    }
  };
  return input;
}

function exerciseNonTowerBoundary(assigned: boolean) {
  const content = createGameContentRegistry(nonTowerBoundaryInput(assigned));
  expect(validateGameContentRegistry(content)).toMatchObject({ ok: true, issues: [] });
  const game = new TowerDefenseGame({ missionId: "armor", content, seed: "armor-non-tower" });
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.01);
  const resolveSpy = vi.spyOn(DamageResolver, "resolve");

  expect(game.useAbility("blast", { q: 0, r: 1 }).ok).toBe(true);
  expect(game.emitScriptSignal("armor_boundary").ok).toBe(true);
  game.tick(0.1);

  const calls = resolveSpy.mock.calls.filter(([packet]) => (
    packet.target.kind === "enemy"
    && ["ability", "tower_script", "status"].includes(packet.source.kind)
  ));
  expect(calls).toHaveLength(3);
  return calls.map(([packet, context], index) => ({
    packet,
    context,
    result: resolveSpy.mock.results[index]?.value
  }));
}

describe("combat mechanics v2 armor catalog contract", () => {
  it("keeps combat v1 shield-only, rejects v1 armor fields, accepts v2 armor catalogs, and rejects future versions", () => {
    const shieldOnly = validate({
      moduleVersion: 1,
      profile: { shields: { enemies: { grunt: { capacity: 5 } } } }
    });
    expect(shieldOnly.result).toMatchObject({ ok: true, issues: [] });

    const v1Armor = validate({ moduleVersion: 1 });
    expect(v1Armor.result.ok).toBe(false);
    expect(issueAt(v1Armor.result, /damageTypes|armorTypes|armorAssignments/, /unknown|version/i)).toBe(true);

    const v2Armor = validate();
    expect(v2Armor.result).toMatchObject({ ok: true, issues: [] });

    const v3Armor = validate({ moduleVersion: 3 });
    expect(v3Armor.result).toMatchObject({ ok: true, issues: [] });

    const future = validate({ moduleVersion: 4 });
    expect(future.result.ok).toBe(false);
    expect(issueAt(future.result, /modules\.combat\.schemaVersion/, /1|2|3|future|supported/i)).toBe(true);
  });

  it("publishes and enforces bounded catalogs, assignments, matrix entries, labels, and multipliers", () => {
    expect((Engine as unknown as { ARMOR_MATRIX_LIMITS?: unknown }).ARMOR_MATRIX_LIMITS).toEqual({
      damageTypes: 256,
      armorTypes: 256,
      assignments: 4096,
      matrixEntries: 16384,
      multiplier: 1_000_000,
      labelLength: 128
    });

    const tooManyDamageTypes = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`damage_${index}`, { label: `Damage ${index}` }])
    );
    const damageLimit = validate({
      profile: { ...validArmorProfile(), damageTypes: tooManyDamageTypes }
    }).result;
    expect(issueAt(damageLimit, /damageTypes$/, /256|limit|maximum/i)).toBe(true);

    const tooManyArmorTypes = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `armor_${index}`,
        { label: `Armor ${index}`, multipliers: { physical: 1 } }
      ])
    );
    const armorLimit = validate({
      profile: { ...validArmorProfile(), armorTypes: tooManyArmorTypes }
    }).result;
    expect(issueAt(armorLimit, /armorTypes$/, /256|limit|maximum/i)).toBe(true);

    const tooManyAssignments = Object.fromEntries(
      Array.from({ length: 4097 }, (_, index) => [`enemy_${index}`, "plated"])
    );
    const assignmentLimit = validate({
      profile: {
        ...validArmorProfile(),
        armorAssignments: { enemies: tooManyAssignments }
      }
    }).result;
    expect(issueAt(assignmentLimit, /armorAssignments\.enemies$/, /4096|limit|maximum/i)).toBe(true);

    const matrixDamageTypes = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`damage_${index}`, { label: `Damage ${index}` }])
    );
    const row = Object.fromEntries(Object.keys(matrixDamageTypes).map((damageTypeId) => [damageTypeId, 1]));
    const oversizedMatrix = Object.fromEntries(
      Array.from({ length: 253 }, (_, index) => [
        `armor_${index}`,
        { label: `Armor ${index}`, multipliers: { ...row } }
      ])
    );
    const matrixLimit = validate({
      profile: {
        damageTypes: matrixDamageTypes,
        armorTypes: oversizedMatrix,
        armorAssignments: {}
      }
    }).result;
    expect(issueAt(matrixLimit, /armorTypes|multipliers/, /16384|entries|limit|maximum/i)).toBe(true);

    for (const [label, profile] of [
      ["long label", {
        ...validArmorProfile(),
        damageTypes: { physical: { label: "x".repeat(129) } }
      }],
      ["negative multiplier", {
        ...validArmorProfile(),
        armorTypes: { plated: { label: "Plated", multipliers: { physical: -0.01 } } }
      }],
      ["non-finite multiplier", {
        ...validArmorProfile(),
        armorTypes: { plated: { label: "Plated", multipliers: { physical: Number.NaN } } }
      }],
      ["above-cap multiplier", {
        ...validArmorProfile(),
        armorTypes: { plated: { label: "Plated", defaultMultiplier: 1_000_001, multipliers: {} } }
      }]
    ] as const) {
      const result = validate({ profile: profile as CombatProfileV2Fixture }).result;
      expect(result.ok, label).toBe(false);
      expect(issueAt(result, /label|Multiplier|multipliers/, /128|finite|range|1000000|supported/i), label).toBe(true);
    }

    expect(validate({
      profile: {
        ...validArmorProfile(),
        armorTypes: { plated: { label: "Immune", defaultMultiplier: 0, multipliers: { physical: 0 } } }
      }
    }).result).toMatchObject({ ok: true, issues: [] });
  });

  it("rejects broken damage-type, armor-type, and enemy cross-references", () => {
    const unknownDamageType = validate({
      profile: {
        ...validArmorProfile(),
        armorTypes: { plated: { label: "Plated", multipliers: { plasma: 0.5 } } }
      }
    }).result;
    expect(issueAt(unknownDamageType, /multipliers\.plasma/, /unknown damage/i)).toBe(true);

    const unknownArmorType = validate({
      profile: {
        ...validArmorProfile(),
        armorAssignments: { enemies: { grunt: "missing_armor" } }
      }
    }).result;
    expect(issueAt(unknownArmorType, /armorAssignments\.enemies\.grunt/, /missing_armor|unknown armor/i)).toBe(true);

    const unknownEnemy = validate({
      profile: {
        ...validArmorProfile(),
        armorAssignments: { enemies: { ghost: "plated" } }
      }
    }).result;
    expect(issueAt(unknownEnemy, /armorAssignments\.enemies\.ghost/, /ghost|unknown enemy/i)).toBe(true);
  });

  it("cross-checks an active v2 tower attack damage type", () => {
    const towerInput = armorInput({ towerDamageType: "fier" });
    const towerResult = validateGameContentRegistry(createGameContentRegistry(towerInput));
    expect(towerResult.ok).toBe(false);
    expect(issueAt(towerResult, /attack\.damageType/, /fier|unknown damage/i)).toBe(true);
  });

  it("cross-checks an active v2 pipeline damage effect type", () => {
    const pipelineInput = armorInput();
    pipelineInput.balance.towers.pelter!.attack = {
      kind: "pipeline",
      interval: 1,
      delivery: { kind: "single" },
      effects: [{ kind: "damage", amount: 5, damageType: "fier" }]
    };
    const pipelineResult = validateGameContentRegistry(createGameContentRegistry(pipelineInput));
    expect(pipelineResult.ok).toBe(false);
    expect(issueAt(
      pipelineResult,
      /attack\.effects\[0\]\.damageType/,
      /fier|unknown damage/i
    )).toBe(true);
  });

  it("cross-checks active v2 resistance keys for an assigned enemy", () => {
    const resistanceInput = armorInput({ enemyResistances: { fier: 0.5 } });
    const resistanceResult = validateGameContentRegistry(createGameContentRegistry(resistanceInput));
    expect(resistanceResult.ok).toBe(false);
    expect(issueAt(resistanceResult, /resistances\.fier/, /fier|unknown damage/i)).toBe(true);
  });

  it("does not impose v2 catalog cross-references on absent, disabled, or unselected mechanics", () => {
    const variants = [
      armorInput({ authorMechanics: false, selected: false, enemyResistances: { fier: 0.5 } }),
      armorInput({ enabled: false, enemyResistances: { fier: 0.5 } }),
      armorInput({ selected: false, enemyResistances: { fier: 0.5 } })
    ];
    for (const input of variants) {
      (input.balance.towers.pelter!.attack as { damageType?: string }).damageType = "fier";
      expect(validateGameContentRegistry(createGameContentRegistry(input))).toMatchObject({
        ok: true,
        issues: []
      });
    }
  });

  it("validates enemy resistances as own data without invoking accessors or accepting inherited fields", () => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_RESISTANCE_GETTER");
    });
    const accessorResistances: Record<string, number> = {};
    Object.defineProperty(accessorResistances, "fire", { enumerable: true, get: getter });
    const accessorInput = armorInput({ enemyResistances: accessorResistances });

    let accessorResult: ReturnType<typeof validateGameContentRegistry> | undefined;
    let accessorThrown: unknown;
    try {
      accessorResult = validateGameContentRegistry(createGameContentRegistry(accessorInput));
    } catch (error) {
      accessorThrown = error;
    }
    expect(accessorThrown).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(accessorResult?.ok).toBe(false);
    expect(accessorResult?.issues.some((issue) => (
      issue.fieldPath.includes("resistances") && /own data|data propert|inspect|unsafe/i.test(issue.message)
    ))).toBe(true);
    expect(accessorResult?.issues.some((issue) => issue.message.includes("SYNTHETIC_SECRET"))).toBe(false);

    const inheritedResistances = Object.create({ fire: 0.5 }) as Record<string, number>;
    const inheritedResult = validateGameContentRegistry(createGameContentRegistry(armorInput({
      enemyResistances: inheritedResistances
    })));
    expect(inheritedResult.ok).toBe(false);
    expect(inheritedResult.issues.some((issue) => (
      issue.fieldPath.includes("resistances") && /plain object|own data|prototype/i.test(issue.message)
    ))).toBe(true);

    const nullPrototypeResistances = Object.create(null) as Record<string, number>;
    nullPrototypeResistances.fire = 0.5;
    expect(validateGameContentRegistry(createGameContentRegistry(armorInput({
      enemyResistances: nullPrototypeResistances
    })))).toMatchObject({ ok: true, issues: [] });
  });

  it("inspects armor definitions as own data without invoking accessors or accepting inherited fields", () => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_ARMOR_GETTER");
    });
    const damageTypes: Record<string, unknown> = {};
    Object.defineProperty(damageTypes, "fire", { enumerable: true, get: getter });

    let accessorResult: ReturnType<typeof validateGameContentRegistry> | undefined;
    let caught: unknown;
    try {
      accessorResult = validate({
        profile: {
          ...validArmorProfile(),
          damageTypes: damageTypes as Record<string, DamageTypeFixture>
        }
      }).result;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(accessorResult?.ok).toBe(false);
    expect(accessorResult?.issues.some((issue) => issue.message.includes("SYNTHETIC_SECRET"))).toBe(false);

    const inheritedArmor = Object.create({
      label: "Inherited",
      multipliers: { physical: 0.5 }
    }) as ArmorTypeFixture;
    const inheritedResult = validate({
      profile: {
        ...validArmorProfile(),
        armorTypes: { inherited: inheritedArmor },
        armorAssignments: { enemies: { grunt: "inherited" } }
      }
    }).result;
    expect(inheritedResult.ok).toBe(false);
    expect(issueAt(inheritedResult, /armorTypes\.inherited/, /plain object|own data/i)).toBe(true);
  });
});

describe("active armor matrix runtime path", () => {
  it("applies armor then resistance then shield then HP and settles death/reward exactly once", () => {
    const profile: CombatProfileV2Fixture = {
      ...validArmorProfile(),
      shields: { enemies: { grunt: { capacity: 2 } } },
      armorTypes: {
        plated: { label: "Plated", multipliers: { fire: 0.5 } }
      }
    };
    const { content, result } = validate({
      profile,
      enemyHp: 4,
      enemyResistances: { fire: 0.5 },
      towerDamage: 24,
      towerDamageType: "fire"
    });
    expect(result).toMatchObject({ ok: true, issues: [] });

    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const game = new TowerDefenseGame({ missionId: "armor", content, seed: "armor-v2-runtime" });
    expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
    expect(game.startNextWave().ok).toBe(true);
    resolveSpy.mockClear();
    game.tick(0.05);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    const [packet, context] = resolveSpy.mock.calls[0]!;
    expect(packet.damageType).toBe("fire");
    expect(context).toMatchObject({
      armorMatrix: {
        armorTypeId: "plated",
        multipliers: { fire: 0.5 }
      },
      resistances: { fire: 0.5 }
    });
    expect(resolveSpy.mock.results[0]?.value).toMatchObject({
      afterModifiers: 24,
      armorTypeId: "plated",
      armorMultiplier: 0.5,
      afterArmor: 12,
      resistanceMultiplier: 0.5,
      afterResistance: 6,
      finalAmount: 6
    });
    expect(game.getSnapshot().enemies).toEqual([]);
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyShieldChanged",
      enemyId: "enemy_1",
      previous: 2,
      current: 0,
      amount: 2,
      overflowDamage: 4
    }));
    expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(1);
    expect(game.coins).toBe(100); // 100 - 1 placement + 1 reward

    game.tick(0.05);
    expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(0);
    expect(game.coins).toBe(100);
  });

  it("applies an active enemy armor assignment and resistance to ability, TowerScript, and poison damage", () => {
    const calls = exerciseNonTowerBoundary(true);

    expect(calls.map(({ packet }) => packet.source.kind)).toEqual([
      "ability",
      "tower_script",
      "status"
    ]);
    expect(calls.map(({ packet }) => packet.amount)).toEqual([40, 40, 4]);
    for (const { context } of calls) {
      expect(context).toMatchObject({
        armorMatrix: {
          armorTypeId: "plated",
          multipliers: { physical: 0.5 }
        },
        resistances: { physical: 0.5 }
      });
    }
    expect(calls.map(({ result }) => result)).toEqual([
      expect.objectContaining({ afterArmor: 20, afterResistance: 10, finalAmount: 10 }),
      expect.objectContaining({ afterArmor: 20, afterResistance: 10, finalAmount: 10 }),
      expect.objectContaining({ afterArmor: 2, afterResistance: 1, finalAmount: 1 })
    ]);
  });

  it("keeps ability, TowerScript, and poison damage legacy-equivalent without an active armor assignment", () => {
    const calls = exerciseNonTowerBoundary(false);

    expect(calls.map(({ packet }) => packet.source.kind)).toEqual([
      "ability",
      "tower_script",
      "status"
    ]);
    expect(calls.map(({ result }) => result)).toEqual([
      expect.objectContaining({ afterResistance: 40, finalAmount: 40 }),
      expect.objectContaining({ afterResistance: 40, finalAmount: 40 }),
      expect.objectContaining({ afterResistance: 4, finalAmount: 4 })
    ]);
    for (const { context, result } of calls) {
      expect(context).toBeUndefined();
      expect(result).not.toHaveProperty("armorTypeId");
      expect(result).not.toHaveProperty("armorMultiplier");
      expect(result).not.toHaveProperty("afterArmor");
    }
  });

  it("keeps armor-only state out of snapshots/checkpoints and preserves restore/replay digests", () => {
    const content = createGameContentRegistry(armorInput({
      profile: validArmorProfile(),
      enemyHp: 200
    }));
    expect(validateGameContentRegistry(content)).toMatchObject({ ok: true, issues: [] });

    const source = new TowerDefenseGame({ missionId: "armor", content, seed: "armor-state-less" });
    expect(source.getSnapshot()).not.toHaveProperty("combat");
    const pristineCheckpoint = source.createCheckpoint();
    expect(pristineCheckpoint.state).not.toHaveProperty("combat");
    const restored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: JSON.parse(JSON.stringify(pristineCheckpoint))
    });
    expect(restored.getSnapshot()).not.toHaveProperty("combat");
    expect(restored.getStateDigest()).toBe(source.getStateDigest());

    const session = new JournaledGameSession(source);
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 }).ok).toBe(true);
    expect(session.dispatch({
      schemaVersion: 1,
      type: "placeTower",
      towerTypeId: "pelter",
      coord: { q: 1, r: 0 }
    }).ok).toBe(true);
    expect(source.getSnapshot()).not.toHaveProperty("combat");
    expect(source.getSnapshot().enemies).toEqual([
      expect.objectContaining({ id: "enemy_1", typeId: "grunt", hp: 200 })
    ]);
    const liveAssignedEnemyCheckpoint = source.createCheckpoint();
    expect(liveAssignedEnemyCheckpoint.state).not.toHaveProperty("combat");
    const liveRestored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: JSON.parse(JSON.stringify(liveAssignedEnemyCheckpoint))
    });
    expect(liveRestored.getSnapshot()).toEqual(source.getSnapshot());
    expect(liveRestored.getStateDigest()).toBe(source.getStateDigest());

    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.05 }).ok).toBe(true);
    liveRestored.tick(0.05);
    expect(source.getSnapshot().enemies).toEqual([
      expect.objectContaining({ id: "enemy_1", typeId: "grunt", hp: 196 })
    ]);
    expect(liveRestored.getSnapshot()).toEqual(source.getSnapshot());
    expect(liveRestored.getStateDigest()).toBe(source.getStateDigest());

    const journal = session.exportJournal();
    expect(journal.initialCheckpoint.state).not.toHaveProperty("combat");

    const replay = replayGameCommandJournal({
      content,
      journal: JSON.parse(JSON.stringify(journal))
    });
    expect(replay.entriesReplayed).toBe(4);
    expect(replay.game.getSnapshot().enemies).toEqual([
      expect.objectContaining({ id: "enemy_1", typeId: "grunt", hp: 196 })
    ]);
    expect(replay.game.getSnapshot()).not.toHaveProperty("combat");
    expect(replay.game.createCheckpoint().state).not.toHaveProperty("combat");
    expect(replay.stateDigest).toBe(source.getStateDigest());
    expect(replay.game.getStateDigest()).toBe(source.getStateDigest());

    for (const changedProfile of [
      {
        ...validArmorProfile(),
        armorTypes: {
          plated: {
            label: "Plated",
            defaultMultiplier: 0.75,
            multipliers: { physical: 0.25, fire: 0.25 }
          }
        }
      },
      {
        ...validArmorProfile(),
        armorAssignments: { enemies: {} }
      }
    ] satisfies CombatProfileV2Fixture[]) {
      const changedContent = createGameContentRegistry(armorInput({
        profile: changedProfile,
        enemyHp: 200
      }));
      expect(validateGameContentRegistry(changedContent).ok).toBe(true);
      const changedCheckpoint = new TowerDefenseGame({
        missionId: "armor",
        content: changedContent,
        seed: "armor-state-less"
      }).createCheckpoint();
      expect(changedCheckpoint.contentDigest).not.toBe(liveAssignedEnemyCheckpoint.contentDigest);
      expect(() => TowerDefenseGame.fromCheckpoint({
        content: changedContent,
        checkpoint: liveAssignedEnemyCheckpoint
      })).toThrow(/content digest|mismatch/i);
    }
  });

  it("fails closed when an active assignment can receive implicit physical damage but physical is undeclared", () => {
    const input = armorInput({
      profile: {
        damageTypes: { fire: { label: "Fire" } },
        armorTypes: {
          plated: { label: "Plated", defaultMultiplier: 0.5, multipliers: { fire: 0.25 } }
        },
        armorAssignments: { enemies: { grunt: "plated" } }
      }
    });
    input.balance.abilities.impact = {
      id: "impact",
      label: "Impact",
      cooldown: 1,
      duration: 0,
      radius: 5,
      effects: [{ kind: "damage", amount: 5 }]
    };
    input.balance.missions.armor!.abilityIds = ["impact"];
    const content = createGameContentRegistry(input);
    const result = validateGameContentRegistry(content);

    expect(result.ok).toBe(false);
    expect(issueAt(
      result,
      /damageTypes|armorAssignments|physical/,
      /physical|implicit|undeclared/i
    )).toBe(true);
    expect(() => new TowerDefenseGame({ missionId: "armor", content })).toThrow(/physical|damage type/i);
  });

  it("keeps absent, disabled, unselected, and active-empty v2 gameplay legacy-equivalent", () => {
    const variants = [
      armorInput({ authorMechanics: false, selected: false }),
      armorInput({ enabled: false }),
      armorInput({ selected: false }),
      armorInput({ profile: {} })
    ].map((input) => {
      const content = createGameContentRegistry(input);
      expect(validateGameContentRegistry(content).ok).toBe(true);
      const game = new TowerDefenseGame({ missionId: "armor", content, seed: "armor-v2-legacy" });
      expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
      expect(game.startNextWave().ok).toBe(true);
      game.tick(0.05);
      return game.getSnapshot();
    });

    for (const snapshot of variants.slice(1)) {
      expect(snapshot).toEqual(variants[0]);
      expect(snapshot).not.toHaveProperty("combat");
    }
  });
});
