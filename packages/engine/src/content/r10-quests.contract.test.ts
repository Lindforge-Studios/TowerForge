import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const QUEST_LIMITS_V1 = Object.freeze({
  selectionCount: 3,
  definitions: 256,
  weight: 1_000_000,
  count: 1_000_000,
  waves: 10_000,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 256
});

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

interface QuestProfileV1Contract {
  readonly selectionCount: number;
  readonly definitions: Readonly<Record<string, {
    readonly label: string;
    readonly weight: number;
    readonly objective:
      | {
          readonly kind: "kill_with_source";
          readonly count: number;
          readonly source: {
            readonly kind: "tower" | "ability" | "tower_script" | "status" | "reaction";
            readonly id: string;
          };
        }
      | {
          readonly kind: "preserve_shield";
          readonly waves: number;
          readonly scope: "tower" | "hero" | "any";
        };
  }>>;
}

function validProfile(): QuestProfileV1Contract {
  return {
    selectionCount: 2,
    definitions: {
      lava_only: {
        label: "Lava only",
        weight: 3,
        objective: {
          kind: "kill_with_source",
          count: 2,
          source: { kind: "ability", id: "lava_burst" }
        }
      },
      shield_streak: {
        label: "Shield streak",
        weight: 1,
        objective: { kind: "preserve_shield", waves: 2, scope: "tower" }
      }
    }
  };
}

function questInput(options: {
  readonly activation?: Activation;
  readonly profile?: unknown;
} = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const path = Array.from({ length: 7 }, (_, q) => ({ q, r: 1 }));
  const questModule = activation === "absent" ? {} : {
    quests: {
      schemaVersion: activation === "future" ? 2 : 1,
      enabled: activation !== "disabled",
      profiles: { daily: options.profile ?? validProfile() }
    }
  };
  return {
    balance: {
      defaultMissionId: "quest_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {
        lava_burst: {
          id: "lava_burst",
          label: "Lava Burst",
          cooldown: 1,
          duration: 0,
          radius: 2,
          effects: [{ kind: "damage", amount: 100 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 5,
          speed: 0.5,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x668866
        }
      },
      towers: {
        bastion: {
          id: "bastion",
          label: "Bastion",
          cost: { coins: 5 },
          footprintRadius: 0,
          range: 5,
          maxHp: 50,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 5,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 5
          }
        }
      },
      waveSets: {
        quest_waves: [0, 1].map((index) => ({
          id: `wave_${index + 1}`,
          label: `Wave ${index + 1}`,
          groups: [{ enemyId: "grunt", count: 2, spawnInterval: 0.5, startDelay: 0 }]
        }))
      },
      missions: {
        quest_lab: {
          id: "quest_lab",
          label: "Quest Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 2,
          mapId: "lane",
          waveSetId: "quest_waves",
          buildTowerIds: ["bastion"],
          abilityIds: ["lava_burst"],
          ...(activation === "absent" || activation === "unselected"
            ? { mechanics: { profiles: { combat: "shielded" } } }
            : { mechanics: { profiles: { combat: "shielded", quests: "daily" } } })
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
            shielded: { shields: { towers: { bastion: { capacity: 20 } } } }
          }
        },
        ...questModule
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
        missionId: "quest_lab",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function registry(options: Parameters<typeof questInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(questInput(options));
}

function validate(options: Parameters<typeof questInput>[0] = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
}

function issue(
  result: ValidationResult,
  severity: "error" | "warning",
  fieldPath: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((entry) => (
    entry.severity === severity
    && fieldPath.test(entry.fieldPath)
    && message.test(entry.message)
  ));
}

function normalizeQuestProfileV1(value: unknown): QuestProfileV1Contract {
  const normalize = (Engine as unknown as {
    normalizeQuestProfileV1?: (input: unknown) => QuestProfileV1Contract;
  }).normalizeQuestProfileV1;
  expect(normalize, "R10 must export the closed QuestProfileV1 normalizer").toBeTypeOf("function");
  return normalize!(value);
}

describe("R10 opt-in procedural quests content contract (RED)", () => {
  it("publishes quests v1 as an implemented capability with exact closed descriptors and budgets", () => {
    expect(Engine.MECHANICS_MODULE_IDS).toContain("quests");
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("quests");
    expect((Engine as unknown as { QUEST_LIMITS?: unknown }).QUEST_LIMITS).toEqual(QUEST_LIMITS_V1);
    expect((Engine as unknown as { QUEST_MECHANICS_SCHEMA?: unknown }).QUEST_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "quests",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: ["selectionCount", "definitions"],
        optionalFields: [],
        additionalProperties: false
      },
      definition: {
        requiredFields: ["label", "weight", "objective"],
        optionalFields: [],
        additionalProperties: false
      },
      objectiveKinds: ["kill_with_source", "preserve_shield"],
      sourceKinds: ["tower", "ability", "tower_script", "status", "reaction"],
      shieldScopes: ["tower", "hero", "any"],
      limits: QUEST_LIMITS_V1
    });
  });

  it("resolves active, disabled, unselected, absent, and future module states without implicit activation", () => {
    expect(validate()).toEqual({ ok: true, issues: [] });
    expect((registry().missions.quest_lab!.capabilities as any).quests).toEqual({
      moduleId: "quests",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "daily",
      reason: "active"
    });
    expect((registry({ activation: "disabled" }).missions.quest_lab!.capabilities as any).quests)
      .toMatchObject({ available: true, active: false, reason: "module_disabled" });
    expect((registry({ activation: "unselected" }).missions.quest_lab!.capabilities as any).quests)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect((registry({ activation: "absent" }).missions.quest_lab!.capabilities as any).quests)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });
    expect((registry({ activation: "future" }).missions.quest_lab!.capabilities as any).quests)
      .toMatchObject({ available: true, active: false, reason: "module_version_unsupported" });
    expect(issue(validate({ activation: "future" }), "error", /modules\.quests\.schemaVersion/, /future|supported|version/i))
      .toBe(true);
  });

  it("normalizes detached binary-ordered deeply frozen own data", () => {
    const authored = structuredClone(validProfile()) as any;
    authored.definitions.zeta = { ...authored.definitions.lava_only, label: "Zeta" };
    authored.definitions.Alpha = { ...authored.definitions.lava_only, label: "Alpha" };
    const normalized = normalizeQuestProfileV1(authored);

    expect(Object.keys(normalized.definitions)).toEqual(["Alpha", "lava_only", "shield_streak", "zeta"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.definitions)).toBe(true);
    expect(Object.values(normalized.definitions).every(Object.isFrozen)).toBe(true);
    expect(Object.values(normalized.definitions).every((definition) => Object.isFrozen(definition.objective))).toBe(true);
    authored.definitions.lava_only.objective.count = 999;
    expect((normalized.definitions.lava_only!.objective as { count: number }).count).toBe(2);
  });

  it("rejects closed, accessor, symbol, sparse, cyclic, and prototype-hostile input without invoking code", () => {
    expect(() => normalizeQuestProfileV1({ ...validProfile(), hostHook: "forbidden" }))
      .toThrow(/hostHook|closed|unknown/i);

    const accessor = validProfile() as any;
    let reads = 0;
    Object.defineProperty(accessor.definitions.lava_only, "objective", {
      enumerable: true,
      get() { reads += 1; return validProfile().definitions.lava_only!.objective; }
    });
    expect(() => normalizeQuestProfileV1(accessor)).toThrow(/objective|data|accessor/i);
    expect(reads).toBe(0);

    const symbol = validProfile() as any;
    symbol.definitions.lava_only[Symbol("hidden")] = true;
    expect(() => normalizeQuestProfileV1(symbol)).toThrow(/symbol/i);

    const sparseObjective = [] as unknown[];
    sparseObjective.length = 2;
    const sparse = { ...validProfile(), definitions: sparseObjective };
    expect(() => normalizeQuestProfileV1(sparse)).toThrow(/definitions|record|array|plain/i);

    const cyclic = structuredClone(validProfile()) as any;
    cyclic.definitions.lava_only.objective.source = cyclic;
    expect(() => normalizeQuestProfileV1(cyclic)).toThrow(/source|closed|object|kind|id/i);

    const inherited = Object.create({ selectionCount: 2 });
    inherited.definitions = validProfile().definitions;
    expect(() => normalizeQuestProfileV1(inherited)).toThrow(/plain|selectionCount|prototype/i);
  });

  it("enforces selection, definition, UTF-8, weight, count, and wave budgets", () => {
    expect(() => normalizeQuestProfileV1({ ...validProfile(), selectionCount: 4 }))
      .toThrow(/selectionCount|1\.\.3|limit/i);
    expect(() => normalizeQuestProfileV1({
      selectionCount: 1,
      definitions: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
        `quest_${index}`,
        validProfile().definitions.lava_only
      ]))
    })).toThrow(/definitions|256|limit/i);
    expect(() => normalizeQuestProfileV1({
      ...validProfile(),
      definitions: { bad: { ...validProfile().definitions.lava_only, weight: 1_000_001 } }
    })).toThrow(/weight|1000000|limit/i);
    expect(() => normalizeQuestProfileV1({
      ...validProfile(),
      definitions: {
        bad: {
          ...validProfile().definitions.lava_only,
          objective: { kind: "kill_with_source", count: 1_000_001, source: { kind: "ability", id: "lava_burst" } }
        }
      }
    })).toThrow(/count|1000000|limit/i);
    expect(() => normalizeQuestProfileV1({
      ...validProfile(),
      definitions: {
        bad: {
          ...validProfile().definitions.shield_streak,
          objective: { kind: "preserve_shield", waves: 10_001, scope: "tower" }
        }
      }
    })).toThrow(/waves|10000|limit/i);
    expect(() => normalizeQuestProfileV1({
      ...validProfile(),
      definitions: { ["\u754c".repeat(43)]: validProfile().definitions.lava_only }
    })).toThrow(/id|UTF-8|128|byte/i);
  });

  it("treats impossible cross-references as active errors and inactive warnings", () => {
    const missingAbility = structuredClone(validProfile()) as any;
    missingAbility.definitions.lava_only.objective.source.id = "missing_ability";
    const active = validate({ profile: missingAbility });
    expect(issue(
      active,
      "error",
      /modules\.quests\.profiles\.daily\.definitions\.lava_only\.objective\.source\.id/,
      /missing_ability|unknown ability/i
    )).toBe(true);

    const disabled = validate({ activation: "disabled", profile: missingAbility });
    expect(disabled.ok).toBe(true);
    expect(issue(
      disabled,
      "warning",
      /modules\.quests\.profiles\.daily\.definitions\.lava_only\.objective\.source\.id/,
      /missing_ability|unknown ability/i
    )).toBe(true);

    const tooManyWaves = structuredClone(validProfile()) as any;
    tooManyWaves.definitions.shield_streak.objective.waves = 3;
    expect(issue(
      validate({ profile: tooManyWaves }),
      "error",
      /definitions\.shield_streak\.objective\.waves/,
      /wave|impossible|available/i
    )).toBe(true);
  });

  it("rejects verifier-proven impossible status sources", () => {
    const impossibleStatus = structuredClone(validProfile()) as any;
    impossibleStatus.definitions.lava_only.objective.source = { kind: "status", id: "single" };
    expect(issue(
      validate({ profile: impossibleStatus }),
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /single|unknown|unavailable|status/i
    )).toBe(true);

  });

  it("rejects verifier-proven disabled shield dependencies", () => {
    const disabledCombat = questInput();
    (disabledCombat.mechanics!.modules.combat as any).enabled = false;
    const disabledShieldResult = validateGameContentRegistry(createGameContentRegistry(disabledCombat));
    expect(issue(
      disabledShieldResult,
      "error",
      /definitions\.shield_streak\.objective\.scope/,
      /shield|active|scope|unavailable/i
    )).toBe(true);
  });

  it("rejects authored quest sources that exist but cannot emit lethal damage", () => {
    const cases = [
      {
        source: { kind: "tower", id: "bastion" },
        mutate: (subject: GameContentInput) => {
          (subject.balance.towers.bastion as any).attack = {
            kind: "pipeline",
            interval: 1,
            delivery: { kind: "single" },
            effects: [{ kind: "resource", resources: { coins: 1 } }]
          };
        }
      },
      {
        source: { kind: "ability", id: "lava_burst" },
        mutate: (subject: GameContentInput) => {
          (subject.balance.abilities.lava_burst as any).effects = [{
            kind: "status",
            status: { slow: { factor: 0.5, duration: 1 } }
          }];
        }
      }
    ] as const;

    for (const entry of cases) {
      const subject = questInput();
      entry.mutate(subject);
      const profile = structuredClone(validProfile()) as any;
      profile.definitions.lava_only.objective.source = entry.source;
      (subject.mechanics!.modules.quests as any).profiles.daily = profile;
      expect(issue(
        validateGameContentRegistry(createGameContentRegistry(subject)),
        "error",
        /definitions\.lava_only\.objective\.source\.id/,
        /damage|unavailable|source/i
      )).toBe(true);
    }
  });

  it("accepts the legacy strike compatibility preset as a lethal ability source", () => {
    const subject = questInput();
    delete (subject.balance.abilities as any).lava_burst;
    (subject.balance.abilities as any).strike = {
      id: "strike",
      label: "Strike",
      cooldown: 1,
      duration: 0,
      radius: 2,
      damage: 100
    };
    (subject.balance.missions.quest_lab as any).abilityIds = ["strike"];
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "ability", id: "strike" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;

    const result = validateGameContentRegistry(createGameContentRegistry(subject));
    expect(issue(
      result,
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /damage|unavailable|source|strike/i
    )).toBe(false);
  });

  it("requires TowerScript and reaction quest sources to contain a damage producer", () => {
    const subject = questInput();
    subject.scripts = {
      harmless: {
        schemaVersion: 6,
        id: "harmless",
        enabled: true,
        scope: "global",
        handlers: { signal: [{ actions: [{ action: "grantResource", resourceId: "coins", amount: 1 }] }] }
      }
    } as any;
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "tower_script", id: "harmless" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;
    expect(issue(
      validateGameContentRegistry(createGameContentRegistry(subject)),
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /damage|unavailable|source/i
    )).toBe(true);
  });

  it("rejects a damaging TowerScript source whose bindings cannot exist in the selected mission", () => {
    const subject = questInput();
    (subject.balance.towers as any).remote_tower = {
      ...(subject.balance.towers.bastion as any),
      id: "remote_tower",
      label: "Remote tower"
    };
    subject.scripts = {
      remote_damage: {
        schemaVersion: 1,
        id: "remote_damage",
        enabled: true,
        bindings: [{ scope: "tower", ids: ["remote_tower"] }],
        handlers: {
          tick: [{ every: 1, actions: [{ action: "damageEnemy", target: "allEnemies", amount: 1 }] }]
        }
      }
    } as any;
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "tower_script", id: "remote_damage" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;

    expect(issue(
      validateGameContentRegistry(createGameContentRegistry(subject)),
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /unavailable|binding|mission|source/i
    )).toBe(true);
  });

  it("accepts a damaging enemy-bound TowerScript source made reachable by a typed script spawn", () => {
    const subject = questInput();
    (subject.balance.enemies as any).summoned = {
      ...(subject.balance.enemies.grunt as any),
      id: "summoned",
      label: "Summoned"
    };
    subject.scripts = {
      summon: {
        schemaVersion: 1,
        id: "summon",
        enabled: true,
        bindings: [{ scope: "global" }],
        handlers: {
          gameStarted: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "summoned", count: 1 }] }]
        }
      },
      summoned_damage: {
        schemaVersion: 1,
        id: "summoned_damage",
        enabled: true,
        bindings: [{ scope: "enemy", ids: ["summoned"] }],
        handlers: {
          tick: [{ every: 1, actions: [{ action: "damageEnemy", target: "allEnemies", amount: 1 }] }]
        }
      }
    } as any;
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "tower_script", id: "summoned_damage" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;

    expect(issue(
      validateGameContentRegistry(createGameContentRegistry(subject)),
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /unavailable|binding|mission|source/i
    )).toBe(false);
  });

  it("does not count poison from a TowerScript binding unavailable to the selected mission", () => {
    const subject = questInput();
    (subject.balance.towers as any).remote_tower = {
      ...(subject.balance.towers.bastion as any),
      id: "remote_tower",
      label: "Remote tower"
    };
    subject.scripts = {
      remote_poison: {
        schemaVersion: 1,
        id: "remote_poison",
        enabled: true,
        bindings: [{ scope: "tower", ids: ["remote_tower"] }],
        handlers: {
          tick: [{
            every: 1,
            actions: [{
              action: "applyStatus",
              target: "allEnemies",
              status: { poison: { dps: 1, duration: 1 } }
            }]
          }]
        }
      }
    } as any;
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "status", id: "poison" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;

    expect(issue(
      validateGameContentRegistry(createGameContentRegistry(subject)),
      "error",
      /definitions\.lava_only\.objective\.source\.id/,
      /unavailable|binding|mission|source|poison/i
    )).toBe(true);
  });

  it("does not invoke accessor-backed TowerScript data while checking quest source semantics", () => {
    let reads = 0;
    const attachHostileScript = (subject: GameContentInput) => {
      const hostileScript: Record<string, unknown> = {
        schemaVersion: 1,
        id: "hostile",
        enabled: true,
        bindings: [{ scope: "global" }]
      };
      Object.defineProperty(hostileScript, "handlers", {
        enumerable: true,
        get() {
          reads += 1;
          return { tick: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 1 }] }] };
        }
      });
      subject.scripts = { hostile: hostileScript } as any;
    };

    const legacy = questInput({ activation: "absent" });
    attachHostileScript(legacy);
    validateGameContentRegistry(createGameContentRegistry(legacy));
    const legacyReads = reads;

    reads = 0;
    const subject = questInput();
    attachHostileScript(subject);
    const profile = structuredClone(validProfile()) as any;
    profile.definitions.lava_only.objective.source = { kind: "tower_script", id: "hostile" };
    (subject.mechanics!.modules.quests as any).profiles.daily = profile;

    const result = validateGameContentRegistry(createGameContentRegistry(subject));
    expect(reads).toBe(legacyReads);
    expect(result.ok).toBe(false);
    expect(result.issues.some((entry) => /script|handler|data|accessor/i.test(entry.message))).toBe(true);
  });
});
