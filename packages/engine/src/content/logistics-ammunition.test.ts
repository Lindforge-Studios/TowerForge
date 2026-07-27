import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const AMMUNITION_LIMITS_V2 = {
  types: 256,
  towerInventories: 4_096,
  liveInventories: 4_096,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128,
  capacity: 1_000_000_000
} as const;

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

function attack(kind: string): Record<string, unknown> {
  switch (kind) {
    case "pulse":
      return { kind, pulseRate: 1, pulseDamage: 1, dotDamagePerUnit: 0, dotDuration: 1 };
    case "sniper":
      return { kind, interval: 1, damage: 1, targetPriority: "first" };
    case "antiair":
      return { kind, fireRate: 1, damage: 1, maxTargetsByLevel: [1, 1, 1, 1], upgradeCosts: [] };
    case "splash":
      return {
        kind, interval: 1, damage: 1, splashDamage: 1, armoredChipDamage: 0,
        splashRadius: 1, slowFactor: 0.5, slowDuration: 1
      };
    case "pipeline":
      return { kind, interval: 1, delivery: { kind: "single" }, effects: [{ kind: "damage", amount: 1 }] };
    case "support":
      return { kind, auraRadius: 2, unlocksTowerIds: ["consumer"] };
    case "support_buff":
      return { kind, auraRadius: 2, fireRateMultiplierByLevel: [1, 1, 1], affectsTowerIds: ["consumer"] };
    default:
      return {
        kind: "single", fireRate: 1, damagePerStack: 1,
        startingStacks: 1, maxStacks: 1, upgradeCost: 1
      };
  }
}

function tower(id: string, kind = "single") {
  return {
    id,
    label: id,
    cost: { coins: 1 },
    footprintRadius: 0,
    range: 4,
    attack: attack(kind)
  };
}

function power(): Record<string, unknown> {
  return {
    generators: { generator: { output: 20, linkRadius: 4, coverageRadius: 3 } },
    relays: { relay: { linkRadius: 5, coverageRadius: 4 } },
    consumers: { consumer: { demand: 8, priority: 10 } }
  };
}

function ammunition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    types: { shell: { label: "Shell" } },
    towerInventories: {
      consumer: {
        ammoTypeId: "shell",
        capacity: 30,
        startingAmount: 12,
        consumptionPerActivation: 1
      }
    },
    ...overrides
  };
}

function input(options: {
  readonly activation?: Activation;
  readonly moduleVersion?: number;
  readonly profile?: unknown;
  readonly towers?: Record<string, ReturnType<typeof tower>>;
} = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const towers = options.towers ?? {
    generator: tower("generator"),
    relay: tower("relay", "support"),
    consumer: tower("consumer"),
    pulse: tower("pulse", "pulse"),
    sniper: tower("sniper", "sniper"),
    antiair: tower("antiair", "antiair"),
    splash: tower("splash", "splash"),
    pipeline: tower("pipeline", "pipeline"),
    support: tower("support", "support"),
    support_buff: tower("support_buff", "support_buff")
  };
  const profile = options.profile === undefined
    ? { power: null, ammunition: ammunition() }
    : options.profile;
  const modules = activation === "absent" ? {} : {
    logistics: {
      schemaVersion: activation === "future" ? 4 : (options.moduleVersion ?? 2),
      enabled: activation !== "disabled",
      profiles: { local: profile }
    }
  };
  return {
    balance: {
      defaultMissionId: "ammo",
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
          id: "grunt", label: "Grunt", maxHp: 20, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: towers as unknown as GameContentInput["balance"]["towers"],
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        ammo: {
          id: "ammo", label: "Ammo", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: Object.keys(towers), abilityIds: [],
          ...(activation === "unselected" || activation === "absent"
            ? {}
            : { mechanics: { profiles: { logistics: "local" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [{ id: "main", pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })) }],
        terrainOverrides: []
      }
    },
    mechanics: { schemaVersion: 1, modules } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "ammo", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function registry(options: Parameters<typeof input>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function validate(options: Parameters<typeof input>[0] = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((candidate) => (
    candidate.severity === severity
    && path.test(candidate.fieldPath)
    && message.test(candidate.message)
  ));
}

describe("R5.8A Logistics v2 ammunition content contract (RED)", () => {
  it("publishes explicit v1/v2 support, exact ammunition limits, and capability-aware descriptors", () => {
    const exports = Engine as unknown as {
      LOGISTICS_AMMUNITION_LIMITS?: unknown;
      LOGISTICS_MECHANICS_SCHEMA?: Record<string, any>;
    };
    expect(exports.LOGISTICS_AMMUNITION_LIMITS).toEqual(AMMUNITION_LIMITS_V2);
    expect(Object.isFrozen(exports.LOGISTICS_AMMUNITION_LIMITS)).toBe(true);
    expect(exports.LOGISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      moduleId: "logistics",
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: {
        requiredFields: ["power", "ammunition", "supply"], optionalFields: [], additionalProperties: false
      },
      profileVersions: {
        1: { requiredFields: ["power"], optionalFields: [], additionalProperties: false },
        2: {
          requiredFields: ["power", "ammunition"], optionalFields: [], additionalProperties: false
        }
      },
      ammunition: {
        nullable: true,
        requiredFields: ["types", "towerInventories"],
        optionalFields: [],
        additionalProperties: false,
        type: { requiredFields: ["label"], optionalFields: [], additionalProperties: false },
        towerInventory: {
          requiredFields: ["ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"],
          optionalFields: [], additionalProperties: false
        },
        fireCapableAttackKinds: ["single", "pulse", "sniper", "antiair", "splash", "pipeline"]
      },
      runtimeSnapshot: {
        schemaVersion: 3,
        fields: ["schemaVersion", "power", "ammunition", "supply"],
        ammunitionFields: ["inventories"]
      }
    });
    expect(Object.isFrozen(exports.LOGISTICS_MECHANICS_SCHEMA)).toBe(true);
  });

  it("keeps a v1 power profile exact and never reads, adds, or migrates ammunition", () => {
    const authored = input({ moduleVersion: 1, profile: { power: power() } });
    const before = JSON.stringify(authored);
    const subject = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(subject)).toEqual({ ok: true, issues: [] });
    expect(subject.missions.ammo!.capabilities.logistics).toMatchObject({ active: true, reason: "active" });
    expect((subject.mechanics.modules.logistics!.profiles.local as Record<string, unknown>))
      .not.toHaveProperty("ammunition");
    expect(JSON.stringify(authored)).toBe(before);

    const resolve = (Engine as any).resolveActiveLogisticsMechanics as
      ((content: GameContentRegistry, missionId: string) => any) | undefined;
    expect(resolve?.(subject, "ammo")).toEqual({ schemaVersion: 1, profileId: "local", power: power() });

    const v1WithV2Field = validate({
      moduleVersion: 1,
      activation: "disabled",
      profile: { power: null, ammunition: null }
    });
    expect(v1WithV2Field.ok).toBe(false);
    expect(hasIssue(v1WithV2Field, "error", /profiles\.local\.ammunition/i, /unknown|closed/i)).toBe(true);
  });

  it.each([
    ["both null", { power: null, ammunition: null }],
    ["power only", { power: power(), ammunition: null }],
    ["ammunition only", { power: null, ammunition: ammunition() }]
  ])("accepts the literal v2 nullable combination: %s", (_name, profile) => {
    expect(validate({ profile })).toEqual({ ok: true, issues: [] });
  });

  it("activates supported v2 but keeps both-null behavior literal and allocation-free", () => {
    const subject = registry({ profile: { power: null, ammunition: null } });
    expect(subject.missions.ammo!.capabilities.logistics).toEqual({
      moduleId: "logistics", available: true, moduleEnabled: true, active: true,
      profileId: "local", reason: "active"
    });
    const resolve = (Engine as any).resolveActiveLogisticsMechanics as
      ((content: GameContentRegistry, missionId: string) => any) | undefined;
    expect(resolve?.(subject, "ammo")).toEqual({
      schemaVersion: 2, profileId: "local", power: null, ammunition: null
    });
  });

  it("normalizes both records in binary order as detached deeply-frozen own data", () => {
    const normalize = (Engine as any).normalizeLogisticsProfileV2 as ((value: unknown) => any) | undefined;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;
    const authored = {
      power: null,
      ammunition: {
        types: {
          zeta: { label: "Zeta" }, Alpha: { label: "Alpha" }, alpha: { label: "alpha" }
        },
        towerInventories: {
          zeta: { ammoTypeId: "zeta", capacity: 8, startingAmount: 5, consumptionPerActivation: 2 },
          Alpha: { ammoTypeId: "Alpha", capacity: 9, startingAmount: 4, consumptionPerActivation: 1 }
        }
      }
    };
    const normalized = normalize(authored);
    expect(Object.keys(normalized.ammunition.types)).toEqual(["Alpha", "alpha", "zeta"].sort());
    expect(Object.keys(normalized.ammunition.towerInventories)).toEqual(["Alpha", "zeta"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.ammunition)).toBe(true);
    expect(Object.values(normalized.ammunition.types).every(Object.isFrozen)).toBe(true);
    expect(Object.values(normalized.ammunition.towerInventories).every(Object.isFrozen)).toBe(true);
    authored.ammunition.types.zeta.label = "mutated";
    authored.ammunition.towerInventories.zeta.startingAmount = 0;
    expect(normalized.ammunition.types.zeta.label).toBe("Zeta");
    expect(normalized.ammunition.towerInventories.zeta.startingAmount).toBe(5);
  });

  it.each([
    ["missing power", { ammunition: null }],
    ["missing ammunition", { power: null }],
    ["extra profile field", { power: null, ammunition: null, future: true }],
    ["ammunition primitive", { power: null, ammunition: 1 }],
    ["missing types", { power: null, ammunition: { towerInventories: {} } }],
    ["missing inventories", { power: null, ammunition: { types: {} } }],
    ["extra ammunition field", { power: null, ammunition: { types: {}, towerInventories: {}, refill: {} } }],
    ["type missing label", { power: null, ammunition: ammunition({ types: { shell: {} } }) }],
    ["type extra field", { power: null, ammunition: ammunition({ types: { shell: { label: "Shell", color: 1 } } }) }],
    ["inventory missing ammo id", {
      power: null,
      ammunition: ammunition({
        towerInventories: { consumer: { capacity: 3, startingAmount: 2, consumptionPerActivation: 1 } }
      })
    }],
    ["inventory extra field", {
      power: null,
      ammunition: ammunition({
        towerInventories: {
          consumer: {
            ammoTypeId: "shell", capacity: 3, startingAmount: 2, consumptionPerActivation: 1, refill: true
          }
        }
      })
    }]
  ])("rejects the exact v2 closed shape even while disabled: %s", (_name, profile) => {
    const result = validate({ activation: "disabled", profile });
    expect(result.ok).toBe(false);
    expect(hasIssue(
      result,
      "error",
      /logistics|profiles\.local|ammunition|types|towerInventories/i,
      /required|missing|unknown|closed|plain object|own data/i
    )).toBe(true);
  });

  it.each([
    ["zero capacity", { capacity: 0, startingAmount: 0, consumptionPerActivation: 1 }],
    ["negative capacity", { capacity: -1, startingAmount: 0, consumptionPerActivation: 1 }],
    ["fractional capacity", { capacity: 1.5, startingAmount: 1, consumptionPerActivation: 1 }],
    ["unsafe capacity", { capacity: Number.MAX_SAFE_INTEGER + 1, startingAmount: 1, consumptionPerActivation: 1 }],
    ["overflow capacity", { capacity: 1_000_000_001, startingAmount: 1, consumptionPerActivation: 1 }],
    ["negative start", { capacity: 4, startingAmount: -1, consumptionPerActivation: 1 }],
    ["fractional start", { capacity: 4, startingAmount: 1.5, consumptionPerActivation: 1 }],
    ["start above capacity", { capacity: 4, startingAmount: 5, consumptionPerActivation: 1 }],
    ["zero consumption", { capacity: 4, startingAmount: 1, consumptionPerActivation: 0 }],
    ["fractional consumption", { capacity: 4, startingAmount: 1, consumptionPerActivation: 1.5 }],
    ["consumption above capacity", { capacity: 4, startingAmount: 1, consumptionPerActivation: 5 }],
    ["infinite consumption", { capacity: 4, startingAmount: 1, consumptionPerActivation: Number.POSITIVE_INFINITY }]
  ])("rejects integer and authored-capacity boundary: %s", (_name, numbers) => {
    const result = validate({
      activation: "disabled",
      profile: {
        power: null,
        ammunition: ammunition({
          towerInventories: { consumer: { ammoTypeId: "shell", ...numbers } }
        })
      }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(
      result,
      "error",
      /towerInventories\.consumer|capacity|startingAmount|consumptionPerActivation/i,
      /safe integer|integer|1\.\.1000000000|0\.\.capacity|capacity|finite|maximum/i
    )).toBe(true);
  });

  it("accepts every exact numeric boundary", () => {
    expect(validate({
      profile: {
        power: null,
        ammunition: ammunition({
          towerInventories: {
            consumer: {
              ammoTypeId: "shell",
              capacity: AMMUNITION_LIMITS_V2.capacity,
              startingAmount: AMMUNITION_LIMITS_V2.capacity,
              consumptionPerActivation: AMMUNITION_LIMITS_V2.capacity
            }
          }
        })
      }
    })).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["empty ammo type id", "", "types"],
    ["oversized ammo type id", "🔥".repeat(33), "types"],
    ["empty type label", "", "label"],
    ["oversized type label", "🔥".repeat(33), "label"],
    ["empty tower id", "", "towerInventories"],
    ["oversized tower id", "🔥".repeat(33), "towerInventories"],
    ["empty ammo reference", "", "ammoTypeId"],
    ["oversized ammo reference", "🔥".repeat(33), "ammoTypeId"]
  ])("enforces 1..128 UTF-8 bytes for %s", (name, value, field) => {
    const types = name.includes("ammo type id")
      ? { [value]: { label: "Shell" } }
      : { shell: { label: name.includes("label") ? value : "Shell" } };
    const towerId = name.includes("tower id") ? value : "consumer";
    const ammoTypeId = name.includes("reference") ? value : "shell";
    const result = validate({
      activation: "disabled",
      profile: {
        power: null,
        ammunition: ammunition({
          types,
          towerInventories: {
            [towerId]: { ammoTypeId, capacity: 2, startingAmount: 1, consumptionPerActivation: 1 }
          }
        })
      }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", new RegExp(String(field), "i"), /1\.\.128|UTF-8|non-empty|bytes/i)).toBe(true);
  });

  it("enforces the exact type and inventory budgets before traversing hostile overflow entries", () => {
    const exactTypes = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `ammo_${String(index).padStart(3, "0")}`, { label: `Ammo ${index}` }
    ]));
    const exactInventories = Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => [
      `tower_${String(index).padStart(4, "0")}`,
      { ammoTypeId: "ammo_000", capacity: 1, startingAmount: 0, consumptionPerActivation: 1 }
    ]));
    const towers = Object.fromEntries(Object.keys(exactInventories).map((id) => [id, tower(id)]));
    expect(validate({
      activation: "unselected",
      towers,
      profile: { power: null, ammunition: { types: exactTypes, towerInventories: exactInventories } }
    }).ok).toBe(true);

    let calls = 0;
    const overTypes = { ...exactTypes };
    Object.defineProperty(overTypes, "overflow", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("AMMO_TYPE_BUDGET_FIRST");
      }
    });
    const overInventories = { ...exactInventories };
    Object.defineProperty(overInventories, "overflow", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("AMMO_INVENTORY_BUDGET_FIRST");
      }
    });
    const typeResult = validate({
      activation: "disabled",
      profile: { power: null, ammunition: { types: overTypes, towerInventories: {} } }
    });
    const inventoryResult = validate({
      activation: "disabled",
      profile: { power: null, ammunition: { types: { shell: { label: "Shell" } }, towerInventories: overInventories } }
    });
    expect(hasIssue(typeResult, "error", /types/i, /256|budget|limit|maximum/i)).toBe(true);
    expect(hasIssue(inventoryResult, "error", /towerInventories/i, /4.?096|budget|limit|maximum/i)).toBe(true);
    expect(calls).toBe(0);
  });

  it.each([
    ["missing ammunition type", ammunition({
      towerInventories: {
        consumer: { ammoTypeId: "missing", capacity: 2, startingAmount: 1, consumptionPerActivation: 1 }
      }
    })],
    ["missing tower", ammunition({
      towerInventories: {
        missing: { ammoTypeId: "shell", capacity: 2, startingAmount: 1, consumptionPerActivation: 1 }
      }
    })]
  ])("reports active cross-reference errors and inactive warnings: %s", (_name, value) => {
    const active = validate({ profile: { power: null, ammunition: value } });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /ammunition|towerInventories|ammoTypeId/i, /unknown|missing|reference|tower|ammunition type/i))
      .toBe(true);

    for (const activation of ["disabled", "unselected"] as const) {
      const inactive = validate({ activation, profile: { power: null, ammunition: value } });
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);
      expect(hasIssue(inactive, "warning", /ammunition|towerInventories|ammoTypeId/i, /unknown|missing|inactive|unselected|tower|type/i))
        .toBe(true);
    }
  });

  it.each(["constructor", "toString"])(
    "does not resolve the inherited Object.prototype key %s as an authored ammunition type or tower",
    (prototypeKey) => {
      const missingType = validate({
        profile: {
          power: null,
          ammunition: ammunition({
            towerInventories: {
              consumer: {
                ammoTypeId: prototypeKey,
                capacity: 2,
                startingAmount: 1,
                consumptionPerActivation: 1
              }
            }
          })
        }
      });
      expect(hasIssue(
        missingType,
        "error",
        /towerInventories\.consumer\.ammoTypeId/i,
        /unknown|missing|ammunition type/i
      )).toBe(true);

      const prototypeInventory = Object.create(null) as Record<string, unknown>;
      prototypeInventory[prototypeKey] = {
        ammoTypeId: "shell",
        capacity: 2,
        startingAmount: 1,
        consumptionPerActivation: 1
      };
      let missingTower: ValidationResult | undefined;
      expect(() => {
        missingTower = validate({
          profile: {
            power: null,
            ammunition: ammunition({ towerInventories: prototypeInventory })
          }
        });
      }).not.toThrow();
      expect(missingTower).toBeDefined();
      expect(hasIssue(
        missingTower!,
        "error",
        new RegExp(`towerInventories\\.${prototypeKey}`, "i"),
        /unknown|missing|tower/i
      )).toBe(true);
    }
  );

  it.each(["single", "pulse", "sniper", "antiair", "splash", "pipeline"])(
    "accepts a fire-capable %s tower inventory",
    (kind) => {
      const towers = { consumer: tower("consumer", kind) };
      expect(validate({ towers })).toEqual({ ok: true, issues: [] });
    }
  );

  it.each(["support", "support_buff"])(
    "rejects active passive %s inventories but warns while inactive",
    (kind) => {
      const towers = { consumer: tower("consumer", kind) };
      const active = validate({ towers });
      expect(active.ok).toBe(false);
      expect(hasIssue(active, "error", /towerInventories\.consumer|consumer/i, /fire.capable|attack|support/i)).toBe(true);

      const inactive = validate({ activation: "disabled", towers });
      expect(inactive.ok).toBe(true);
      expect(hasIssue(inactive, "warning", /towerInventories\.consumer|consumer/i, /fire.capable|attack|support/i)).toBe(true);
    }
  );

  it.each(["generator", "relay", "consumer"])(
    "allows one tower type to consume ammunition while holding the independent %s power role",
    (role) => {
      const powerDefinition = {
        generators: role === "generator" ? { consumer: { output: 20, linkRadius: 4, coverageRadius: 3 } } : {},
        relays: role === "relay" ? { consumer: { linkRadius: 4, coverageRadius: 3 } } : {},
        consumers: role === "consumer" ? { consumer: { demand: 8, priority: 10 } } : {}
      };
      expect(validate({ profile: { power: powerDefinition, ammunition: ammunition() } }))
        .toEqual({ ok: true, issues: [] });
    }
  );

  it("rejects accessors, inherited data, symbols, arrays, sparse arrays, and revoked proxies without execution", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "types", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_AMMUNITION_ACCESSOR");
      }
    });
    Object.defineProperty(accessor, "towerInventories", { enumerable: true, value: {} });
    const inherited = Object.create({ types: {} });
    inherited.towerInventories = {};
    const symbol = ammunition({ types: {} });
    Object.defineProperty(symbol, Symbol("hostile"), { enumerable: true, value: true });
    const revoked = Proxy.revocable(ammunition({ types: {} }), {});
    revoked.revoke();

    for (const hostile of [accessor, inherited, symbol, [], new Array(1), revoked.proxy]) {
      const result = validate({ activation: "disabled", profile: { power: null, ammunition: hostile } });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("SECRET_AMMUNITION_ACCESSOR");
      expect(hasIssue(
        result,
        "error",
        /logistics|ammunition|types|towerInventories/i,
        /own data|accessor|plain object|symbol|safe|dense|array|inspect|required/i
      )).toBe(true);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects hostile type and inventory definitions without reading accessors or leaking proxy errors", () => {
    let getterCalls = 0;
    const typeAccessor = Object.defineProperty({}, "label", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_AMMO_LABEL");
      }
    });
    const inventoryAccessor = Object.defineProperty({}, "ammoTypeId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_AMMO_TYPE_ID");
      }
    });
    Object.defineProperties(inventoryAccessor, {
      capacity: { enumerable: true, value: 1 },
      startingAmount: { enumerable: true, value: 1 },
      consumptionPerActivation: { enumerable: true, value: 1 }
    });
    const hostileProxy = new Proxy({ label: "Shell" }, {
      getOwnPropertyDescriptor() {
        throw new Error("SECRET_AMMO_PROXY_DESCRIPTOR");
      }
    });

    for (const value of [
      ammunition({ types: { shell: typeAccessor } }),
      ammunition({ types: { shell: hostileProxy } }),
      ammunition({ towerInventories: { consumer: inventoryAccessor } })
    ]) {
      const result = validate({ activation: "disabled", profile: { power: null, ammunition: value } });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/SECRET_AMMO_LABEL|SECRET_AMMO_TYPE_ID|SECRET_AMMO_PROXY_DESCRIPTOR/);
      expect(hasIssue(result, "error", /ammunition|types\.shell|towerInventories\.consumer/i, /own data|accessor|safe|inspect/i))
        .toBe(true);
    }
    expect(getterCalls).toBe(0);
  });

  it("keeps future v4 payload opaque, lossless, read-only, and runtime fail-closed", () => {
    let calls = 0;
    const futureProfile = Object.defineProperty({ futureOnly: { factories: true } }, "ammunition", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("FUTURE_LOGISTICS_V4_MUST_STAY_OPAQUE");
      }
    });
    const subject = registry({ activation: "future", profile: futureProfile });
    expect(subject.missions.ammo!.capabilities.logistics).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported"
    });
    const result = validateGameContentRegistry(subject);
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /logistics.*schemaVersion|schemaVersion/i, /future|unsupported|version|1|2|3/i))
      .toBe(true);
    expect(result.issues.some((candidate) => /profiles\.local\.ammunition/i.test(candidate.fieldPath))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("FUTURE_LOGISTICS_V4_MUST_STAY_OPAQUE");
    expect(calls).toBe(0);
    expect((subject.mechanics.modules as any).logistics.profiles.local).toBe(futureProfile);
    expect((Engine as any).resolveActiveLogisticsMechanics?.(subject, "ammo")).toBeUndefined();
    expect(calls).toBe(0);
  });
});
