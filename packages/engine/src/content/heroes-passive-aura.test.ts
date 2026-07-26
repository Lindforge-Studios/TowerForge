import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const PASSIVE_AURA_RADIUS_MAX = 65_536;
const PASSIVE_AURA_EFFECTS_MAX = 4;

function passiveAura(): Record<string, unknown> {
  return {
    id: "command_link",
    label: "Command link",
    radius: 2,
    effects: [{
      kind: "modifier",
      scope: "tower_damage",
      modifier: { target: "damage", operation: "multiplier", value: 1.5 }
    }]
  };
}

function skillTree(): Record<string, unknown> {
  return {
    points: { starting: 1, perInterwave: 1 },
    nodes: {
      focus: {
        label: "Focus",
        description: "Increase the selected hero ability damage.",
        cost: 1,
        requires: [],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "flat", value: 1 }
        }]
      }
    }
  };
}

function definition(aura: unknown = passiveAura()): Record<string, unknown> {
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
      range: 8,
      damage: 10
    },
    skillTree: skillTree(),
    passiveAura: aura
  };
}

function profile(aura: unknown = passiveAura()): Record<string, unknown> {
  return {
    selectedHeroId: "commander",
    definitions: { commander: definition(aura) },
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

function input(options: {
  readonly version?: number;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly aura?: unknown;
} = {}): GameContentInput {
  const version = options.version ?? 6;
  const heroProfile = profile(options.aura === undefined ? passiveAura() : options.aura);
  if (version === 5) {
    delete (heroProfile.definitions as Record<string, Record<string, unknown>>).commander!.passiveAura;
  }
  return {
    balance: {
      defaultMissionId: "hero_aura",
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
          id: "target", label: "Target", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        subject: {
          id: "subject", label: "Subject", cost: { coins: 1 }, footprintRadius: 0,
          range: 8,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 10,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: { one: [{ id: "wave_0", label: "Wave 1", groups: [] }] },
      missions: {
        hero_aura: {
          id: "hero_aura", label: "Hero aura", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["subject"], abilityIds: [],
          ...(options.selected === false ? {} : { mechanics: { profiles: { heroes: "commanders" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        heroes: {
          schemaVersion: version as 1,
          enabled: options.enabled ?? true,
          profiles: { commanders: heroProfile }
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
        missionId: "hero_aura", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function activeValidation(aura: unknown) {
  return validateGameContentRegistry(createGameContentRegistry(input({ aura })));
}

function fourEffectAura(): Record<string, unknown> {
  return {
    ...passiveAura(),
    effects: [
      { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "flat", value: 1 } },
      { kind: "modifier", scope: "tower_damage", modifier: { target: "damage", operation: "flat", value: 2 } },
      {
        kind: "modifier", scope: "tower_damage",
        modifier: { target: "damage", operation: "additive_ratio", value: 0.1 }
      },
      {
        kind: "modifier", scope: "tower_damage",
        modifier: { target: "damage", operation: "multiplier", value: 1.1 }
      }
    ]
  };
}

function withNearCapacityRoguelite(source: GameContentInput): GameContentInput {
  const raw = source as any;
  raw.balance.towers.subject.tags = [];
  raw.balance.missions.hero_aura.mechanics ??= { profiles: {} };
  raw.balance.missions.hero_aura.mechanics.profiles.roguelite = "run";
  const modifiers = (count: number) => Array.from({ length: count }, () => ({
    target: "damage", operation: "flat", value: 1
  }));
  raw.mechanics.modules.roguelite = {
    schemaVersion: 3,
    enabled: true,
    profiles: {
      run: {
        synergies: {},
        artifacts: {
          definitions: {
            full: { label: "Full", slotType: "full", modifiers: modifiers(8) },
            partial: { label: "Partial", slotType: "partial", modifiers: modifiers(3) }
          },
          towerSlots: {
            subject: [
              ...Array.from({ length: 7 }, (_, index) => ({ slotId: `full_${index}`, slotType: "full" })),
              { slotId: "partial", slotType: "partial" }
            ]
          },
          bossLootTables: {}
        }
      }
    }
  };
  return source;
}

describe("R5.5A Heroes v6 passive-aura authoring contract (RED)", () => {
  it("publishes one exact bounded v6 authoring and authoritative snapshot descriptor", () => {
    expect((Engine as any).HERO_PASSIVE_AURA_LIMITS).toEqual({
      radius: PASSIVE_AURA_RADIUS_MAX,
      effectsPerAura: PASSIVE_AURA_EFFECTS_MAX,
      flatAbsoluteValue: 1_000_000_000_000,
      additiveRatioMinimum: -1,
      additiveRatioMaximum: 1_000,
      multiplierMinimum: 0,
      multiplierMaximum: 1_000
    });
    expect((Engine as any).HEROES_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 6,
      supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6],
      versions: {
        6: {
          definition: {
            requiredFields: [
              "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree", "passiveAura"
            ],
            optionalFields: [],
            additionalProperties: false
          },
          passiveAura: {
            nullable: true,
            requiredFields: ["id", "label", "radius", "effects"],
            optionalFields: [],
            additionalProperties: false,
            radius: { integer: true, minimum: 0, maximum: PASSIVE_AURA_RADIUS_MAX },
            effects: { minimumItems: 1, maximumItems: PASSIVE_AURA_EFFECTS_MAX }
          },
          passiveAuraEffect: {
            requiredFields: ["kind", "scope", "modifier"],
            optionalFields: [],
            additionalProperties: false,
            kindValues: ["modifier"],
            scopeValues: ["tower_damage"]
          },
          passiveAuraModifier: {
            requiredFields: ["target", "operation", "value"],
            optionalFields: [],
            additionalProperties: false,
            targetValues: ["damage"],
            operationValues: ["flat", "additive_ratio", "multiplier"],
            valueByOperation: {
              flat: { minimum: -1_000_000_000_000, maximum: 1_000_000_000_000 },
              additive_ratio: { minimum: -1, maximum: 1_000 },
              multiplier: { minimum: 0, maximum: 1_000 }
            }
          }
        }
      },
      runtimeSnapshot: {
        schemaVersions: [1, 2, 3, 4, 5, 6],
        versions: {
          6: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility",
              "skills", "passiveAura"
            ],
            skillsNullable: true,
            passiveAuraFields: ["id", "label", "radius", "active", "affectedTowerIds"]
          }
        }
      }
    });
  });

  it("normalizes and deeply freezes the exact active form while preserving an explicit null literal", () => {
    const normalize = (Engine as any).normalizeHeroesProfileV6 as ((value: unknown) => Record<string, any>) | undefined;
    expect(normalize).toBeTypeOf("function");
    const normalized = normalize!(profile());
    expect(normalized.definitions.commander.passiveAura).toEqual(passiveAura());
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.definitions.commander.passiveAura)).toBe(true);
    expect(Object.isFrozen(normalized.definitions.commander.passiveAura.effects)).toBe(true);
    expect(Object.isFrozen(normalized.definitions.commander.passiveAura.effects[0].modifier)).toBe(true);
    const negativeZero = passiveAura() as any;
    negativeZero.effects[0].modifier.value = -0;
    expect(Object.is(normalize!(profile(negativeZero)).definitions.commander.passiveAura.effects[0].modifier.value, 0))
      .toBe(true);
    expect(normalize!(profile(null)).definitions.commander.passiveAura).toBeNull();
  });

  it("accepts and resolves active and explicit-null v6 profiles without enabling adjacent modules", () => {
    for (const aura of [passiveAura(), null]) {
      const registry = createGameContentRegistry(input({ aura }));
      expect(validateGameContentRegistry(registry)).toEqual({ ok: true, issues: [] });
      expect(registry.mechanics.modules).not.toHaveProperty("logistics");
      expect(registry.mechanics.modules).not.toHaveProperty("navigation");
      expect(Engine.resolveActiveHeroesMechanics(registry, "hero_aura")).toMatchObject({
        schemaVersion: 6,
        profileId: "commanders",
        definitions: { commander: { passiveAura: aura } }
      });
    }
  });

  it("keeps an unchanged v5 profile valid and makes future v7 fail closed", () => {
    const legacy = createGameContentRegistry(input({ version: 5 }));
    expect(validateGameContentRegistry(legacy)).toEqual({ ok: true, issues: [] });
    expect(Engine.resolveActiveHeroesMechanics(legacy, "hero_aura")).toMatchObject({ schemaVersion: 5 });

    const future = createGameContentRegistry(input({ version: 7 }));
    expect(Engine.resolveCapabilitySet(
      future.mechanics,
      future.missions.hero_aura!.mechanics
    ).heroes).toMatchObject({ active: false, reason: "module_version_unsupported" });
    expect(Engine.resolveActiveHeroesMechanics(future, "hero_aura")).toBeUndefined();
  });

  it.each([
    ["missing radius", { ...passiveAura(), radius: undefined }],
    ["empty id", { ...passiveAura(), id: "" }],
    ["oversized UTF-8 label", { ...passiveAura(), label: "🔥".repeat(33) }],
    ["unknown field", { ...passiveAura(), extra: true }],
    ["fractional radius", { ...passiveAura(), radius: 1.5 }],
    ["negative radius", { ...passiveAura(), radius: -1 }],
    ["radius overflow", { ...passiveAura(), radius: PASSIVE_AURA_RADIUS_MAX + 1 }],
    ["zero effects", { ...passiveAura(), effects: [] }],
    ["too many effects", { ...passiveAura(), effects: Array.from({ length: 5 }, () => (passiveAura() as any).effects[0]) }],
    ["wrong kind", {
      ...passiveAura(), effects: [{ ...(passiveAura() as any).effects[0], kind: "script" }]
    }],
    ["wrong scope", {
      ...passiveAura(), effects: [{ ...(passiveAura() as any).effects[0], scope: "hero_ability_damage" }]
    }],
    ["wrong target", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "range", operation: "multiplier", value: 1.5 }
      }]
    }],
    ["unsupported operation", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "damage", operation: "divide", value: 2 }
      }]
    }],
    ["flat overflow", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "damage", operation: "flat", value: 1_000_000_000_001 }
      }]
    }],
    ["additive ratio underflow", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "damage", operation: "additive_ratio", value: -1.01 }
      }]
    }],
    ["multiplier overflow", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "damage", operation: "multiplier", value: 1_000.01 }
      }]
    }],
    ["non-finite value", {
      ...passiveAura(), effects: [{
        ...(passiveAura() as any).effects[0],
        modifier: { target: "damage", operation: "multiplier", value: Number.POSITIVE_INFINITY }
      }]
    }]
  ])("rejects malformed or out-of-budget aura input: %s", (_name, aura) => {
    const result = activeValidation(aura);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/passiveAura/i),
      message: expect.stringMatching(/required|unknown|integer|radius|damage|multiplier|finite|greater|maximum|unsupported/i)
    }));
  });

  it("keeps malformed structure as an error even while disabled or unselected", () => {
    const malformed = {
      id: "command_link",
      label: "Command link",
      radius: PASSIVE_AURA_RADIUS_MAX + 1,
      effects: []
    };
    for (const options of [{ enabled: false }, { selected: false }]) {
      const result = validateGameContentRegistry(createGameContentRegistry(input({ ...options, aura: malformed })));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/passiveAura/i)
      }));
    }
  });

  it("rejects hostile accessors, revoked proxies, and sparse effect arrays without executing authored code", () => {
    let reads = 0;
    const accessorAura = passiveAura();
    Object.defineProperty(accessorAura, "effects", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      }
    });
    const revoked = Proxy.revocable(passiveAura(), {});
    revoked.revoke();
    const sparse = passiveAura();
    (sparse as any).effects = Array(1);

    for (const aura of [accessorAura, revoked.proxy, sparse]) {
      const result = validateGameContentRegistry(createGameContentRegistry(input({ enabled: false, aura })));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/passiveAura/i),
        message: expect.stringMatching(/own|data|inspect|dense|array|safe/i)
      }));
    }
    expect(reads).toBe(0);
  });

  it("reserves all aura effects in the shared 64-modifier budget only for active selection", () => {
    const active = validateGameContentRegistry(createGameContentRegistry(withNearCapacityRoguelite(
      input({ aura: fourEffectAura() })
    )));
    expect(active.ok).toBe(false);
    expect(active.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/passiveAura|heroes|roguelite/i),
      message: expect.stringMatching(/modifier|budget|64|exceed|overflow/i)
    }));

    for (const options of [{ enabled: false }, { selected: false }]) {
      const inactive = validateGameContentRegistry(createGameContentRegistry(withNearCapacityRoguelite(
        input({ ...options, aura: fourEffectAura() })
      )));
      expect(inactive.ok).toBe(true);
      expect(inactive.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        fieldPath: expect.stringMatching(/passiveAura|heroes|roguelite/i),
        message: expect.stringMatching(/modifier|budget|64|exceed|overflow/i)
      }));
    }
  });

  it("[verifier] rejects a finite authored tower/aura sequence that overflows DamageResolver", () => {
    const overflowing = input({
      aura: {
        ...passiveAura(),
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1_000 }
        }]
      }
    }) as any;
    overflowing.balance.towers.subject.attack.damagePerStack = Number.MAX_VALUE / 2;

    const result = validateGameContentRegistry(createGameContentRegistry(overflowing));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/passiveAura|tower|attack|damage/i),
      message: expect.stringMatching(/finite|overflow|damage/i)
    }));
  });

  it("rejects an overflowing aura multiplier prefix before a later zero multiplier", () => {
    const overflowingPrefix = input({
      aura: {
        ...passiveAura(),
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1_000 }
        }, {
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 0 }
        }]
      }
    }) as any;
    overflowingPrefix.balance.towers.subject.attack.damagePerStack = Number.MAX_VALUE / 2;

    const result = validateGameContentRegistry(createGameContentRegistry(overflowingPrefix));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/passiveAura|tower|attack|damage/i),
      message: expect.stringMatching(/finite|overflow|damage/i)
    }));
  });

  it("accepts the exact safe binary-ID order when zero precedes the large aura multiplier", () => {
    const safePrefix = input({
      aura: {
        ...passiveAura(),
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 0 }
        }, {
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1_000 }
        }]
      }
    }) as any;
    safePrefix.balance.towers.subject.attack.damagePerStack = Number.MAX_VALUE / 2;

    expect(validateGameContentRegistry(createGameContentRegistry(safePrefix))).toEqual({
      ok: true,
      issues: []
    });
  });

  it("rejects a run-stage artifact overflow before a later binary-sorted synergy zero", () => {
    const crossSource = input({
      aura: {
        ...passiveAura(),
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1 }
        }]
      }
    }) as any;
    crossSource.balance.towers.subject.attack.damagePerStack = Number.MAX_VALUE / 2;
    crossSource.balance.towers.subject.tags = ["tech"];
    crossSource.balance.missions.hero_aura.mechanics.profiles.roguelite = "run";
    crossSource.mechanics.modules.roguelite = {
      schemaVersion: 2,
      enabled: true,
      profiles: {
        run: {
          synergies: {
            zero_later: {
              label: "Zero later",
              tag: "tech",
              tierMode: "cumulative",
              tiers: [{
                requiredCount: 1,
                modifiers: [{ target: "damage", operation: "multiplier", value: 0 }]
              }]
            }
          },
          artifacts: {
            definitions: {
              overflow_first: {
                label: "Overflow first",
                slotType: "core",
                modifiers: [{ target: "damage", operation: "multiplier", value: 1_000 }]
              }
            },
            towerSlots: { subject: [{ slotId: "core", slotType: "core" }] },
            bossLootTables: {}
          }
        }
      }
    };

    const result = validateGameContentRegistry(createGameContentRegistry(crossSource));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/passiveAura|tower|attack|damage/i),
      message: expect.stringMatching(/finite|overflow|damage/i)
    }));
  });

  it("[verifier] does not apply the AOE-only sunlight bound to a single-target tower", () => {
    const finiteSingle = input({
      aura: {
        ...passiveAura(),
        effects: [{
          kind: "modifier",
          scope: "tower_damage",
          modifier: { target: "damage", operation: "multiplier", value: 1 }
        }]
      }
    }) as any;
    finiteSingle.balance.towers.subject.attack.damagePerStack = Number.MAX_VALUE / 2;
    finiteSingle.balance.missions.hero_aura.sunlight = {
      pathOrders: [],
      regenPerUnit: 0,
      aoeDamageMultiplier: 1_000
    };

    expect(validateGameContentRegistry(createGameContentRegistry(finiteSingle))).toEqual({ ok: true, issues: [] });
  });
});
