import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const SUPPLY_LIMITS_V3 = Object.freeze({
  productionRecipes: 256,
  producers: 4_096,
  storages: 4_096,
  authoredSourcesTotal: 4_096,
  liveSources: 1_024,
  liveAmmunitionInventories: 4_096,
  directedTransferEdges: 65_536,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128,
  inventoryCapacity: 1_000_000_000,
  amount: 1_000_000_000,
  transferRadius: 64,
  minimumInterval: 0.2,
  maximumInterval: 1_000_000
});

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

function attack(kind = "single"): Record<string, unknown> {
  if (kind === "support") return { kind, auraRadius: 2, unlocksTowerIds: ["consumer"] };
  return {
    kind: "single", fireRate: 1, damagePerStack: 1,
    startingStacks: 1, maxStacks: 1, upgradeCost: 1
  };
}

function tower(id: string, kind = "single") {
  return {
    id, label: id, cost: { coins: 1 }, footprintRadius: 0, range: 4, attack: attack(kind)
  };
}

function power(): Record<string, unknown> {
  return {
    generators: { generator: { output: 20, linkRadius: 4, coverageRadius: 3 } },
    relays: { relay: { linkRadius: 5, coverageRadius: 4 } },
    consumers: { consumer: { demand: 8, priority: 10 } }
  };
}

function ammunition(): Record<string, unknown> {
  return {
    types: { shell: { label: "Shell" } },
    towerInventories: {
      consumer: {
        ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1
      }
    }
  };
}

function supply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productionRecipes: {
      forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 1 }
    },
    producers: {
      factory: {
        recipeId: "forge_shell", capacity: 120, startingAmount: 0,
        transferRadius: 4, transferAmount: 8, transferInterval: 0.4
      }
    },
    storages: {
      depot: {
        ammoTypeId: "shell", capacity: 240, startingAmount: 0,
        transferRadius: 5, transferAmount: 12, transferInterval: 0.4
      }
    },
    ...overrides
  };
}

function defaultTowers() {
  return {
    generator: tower("generator"),
    relay: tower("relay", "support"),
    consumer: tower("consumer"),
    factory: tower("factory", "support"),
    depot: tower("depot", "support")
  };
}

function input(options: {
  activation?: Activation;
  moduleVersion?: number;
  profile?: unknown;
  towers?: Record<string, ReturnType<typeof tower>>;
} = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const towers = options.towers ?? defaultTowers();
  const profile = options.profile === undefined
    ? { power: null, ammunition: ammunition(), supply: supply() }
    : options.profile;
  const modules = activation === "absent" ? {} : {
    logistics: {
      schemaVersion: activation === "future" ? 4 : (options.moduleVersion ?? 3),
      enabled: activation !== "disabled",
      profiles: { local: profile }
    }
  };
  return {
    balance: {
      defaultMissionId: "supply",
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
        supply: {
          id: "supply", label: "Supply", description: "",
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
        missionId: "supply", regionId: "region", x: 5, y: 5,
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
  fieldPath: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((issue) => (
    issue.severity === severity && fieldPath.test(issue.fieldPath) && message.test(issue.message)
  ));
}

describe("R5.8B Logistics v3 ammunition supply content contract (RED)", () => {
  it("exports the frozen v3 limits, exact version descriptors, snapshot, and nested checkpoint contract", () => {
    const subject = Engine as unknown as Record<string, any>;
    expect(subject.LOGISTICS_SUPPLY_LIMITS).toEqual(SUPPLY_LIMITS_V3);
    expect(Object.isFrozen(subject.LOGISTICS_SUPPLY_LIMITS)).toBe(true);
    expect(subject.normalizeLogisticsProfileV3).toBeTypeOf("function");
    expect(subject.LOGISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      moduleId: "logistics",
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: {
        requiredFields: ["power", "ammunition", "supply"],
        optionalFields: [], additionalProperties: false
      },
      profileVersions: {
        1: { requiredFields: ["power"], optionalFields: [], additionalProperties: false },
        2: { requiredFields: ["power", "ammunition"], optionalFields: [], additionalProperties: false },
        3: {
          requiredFields: ["power", "ammunition", "supply"],
          optionalFields: [], additionalProperties: false
        }
      },
      supply: {
        nullable: true,
        requiredFields: ["productionRecipes", "producers", "storages"],
        optionalFields: [], additionalProperties: false,
        productionRecipe: {
          requiredFields: ["label", "ammoTypeId", "outputAmount", "interval"],
          optionalFields: [], additionalProperties: false
        },
        producer: {
          requiredFields: [
            "recipeId", "capacity", "startingAmount", "transferRadius",
            "transferAmount", "transferInterval"
          ],
          optionalFields: [], additionalProperties: false
        },
        storage: {
          requiredFields: [
            "ammoTypeId", "capacity", "startingAmount", "transferRadius",
            "transferAmount", "transferInterval"
          ],
          optionalFields: [], additionalProperties: false
        },
        limits: SUPPLY_LIMITS_V3
      },
      runtimeSnapshot: {
        schemaVersion: 3,
        fields: ["schemaVersion", "power", "ammunition", "supply"],
        supplyFields: ["producers", "storages", "edges"]
      },
      checkpoint: {
        schemaVersion: 2,
        fields: ["schemaVersion", "ammunition", "supply"],
        supplyFields: ["producers", "storages"]
      }
    });
    expect(Object.isFrozen(subject.LOGISTICS_MECHANICS_SCHEMA)).toBe(true);
  });

  it("keeps v1 and v2 exact, detached, unmigrated, and closed against the v3 field", () => {
    const v1 = input({ moduleVersion: 1, profile: { power: power() } });
    const v2 = input({ moduleVersion: 2, profile: { power: null, ammunition: ammunition() } });
    const v1Before = JSON.stringify(v1);
    const v2Before = JSON.stringify(v2);
    const v1Registry = createGameContentRegistry(v1);
    const v2Registry = createGameContentRegistry(v2);
    expect(validateGameContentRegistry(v1Registry)).toEqual({ ok: true, issues: [] });
    expect(validateGameContentRegistry(v2Registry)).toEqual({ ok: true, issues: [] });
    expect((v1Registry.mechanics.modules.logistics!.profiles.local as any)).not.toHaveProperty("supply");
    expect((v2Registry.mechanics.modules.logistics!.profiles.local as any)).not.toHaveProperty("supply");
    expect(JSON.stringify(v1)).toBe(v1Before);
    expect(JSON.stringify(v2)).toBe(v2Before);
    expect((Engine as any).normalizeLogisticsProfileV2({ power: null, ammunition: null }))
      .toEqual({ power: null, ammunition: null });

    const v2WithSupply = validate({
      activation: "disabled", moduleVersion: 2,
      profile: { power: null, ammunition: ammunition(), supply: null }
    });
    expect(v2WithSupply.ok).toBe(false);
    expect(hasIssue(v2WithSupply, "error", /profiles\.local\.supply|profile\.supply/i, /unknown|closed/i)).toBe(true);
  });

  it("requires the explicit supply field in the exact v3 profile", () => {
    const v3MissingSupply = validate({
      activation: "disabled", moduleVersion: 3,
      profile: { power: null, ammunition: ammunition() }
    });
    expect(v3MissingSupply.ok).toBe(false);
    expect(hasIssue(v3MissingSupply, "error", /profiles\.local\.supply|profile\.supply/i, /missing|required/i)).toBe(true);
  });

  it.each([
    ["all null", { power: null, ammunition: null, supply: null }],
    ["power only", { power: power(), ammunition: null, supply: null }],
    ["ammunition without supply", { power: null, ammunition: ammunition(), supply: null }],
    ["ammunition and supply", { power: null, ammunition: ammunition(), supply: supply() }]
  ])("accepts the exact v3 nullable combination: %s", (_name, profile) => {
    expect(validate({ profile })).toEqual({ ok: true, issues: [] });
  });

  it("requires non-null ammunition whenever supply is non-null, even while disabled or unselected", () => {
    for (const activation of ["active", "disabled", "unselected"] as const) {
      const result = validate({ activation, profile: { power: null, ammunition: null, supply: supply() } });
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /supply|ammunition/i, /requires|non-null|ammunition/i)).toBe(true);
    }
  });

  it("normalizes all v3 records in binary order as detached deeply-frozen own data", () => {
    const normalize = (Engine as any).normalizeLogisticsProfileV3 as ((value: unknown) => any) | undefined;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;
    const authored = {
      power: null,
      ammunition: {
        types: { zeta: { label: "Zeta" }, alpha: { label: "Alpha" } },
        towerInventories: {}
      },
      supply: {
        productionRecipes: {
          zeta: { label: "Zeta", ammoTypeId: "zeta", outputAmount: 2, interval: 1 },
          alpha: { label: "Alpha", ammoTypeId: "alpha", outputAmount: 1, interval: 0.2 }
        },
        producers: {
          zeta: {
            recipeId: "zeta", capacity: 4, startingAmount: 1,
            transferRadius: 2, transferAmount: 2, transferInterval: 0.4
          },
          alpha: {
            recipeId: "alpha", capacity: 3, startingAmount: 0,
            transferRadius: 1, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {
          zeta_store: {
            ammoTypeId: "zeta", capacity: 5, startingAmount: 1,
            transferRadius: 3, transferAmount: 2, transferInterval: 1
          },
          alpha_store: {
            ammoTypeId: "alpha", capacity: 5, startingAmount: 0,
            transferRadius: 2, transferAmount: 1, transferInterval: 0.2
          }
        }
      }
    };
    const normalized = normalize(authored);
    expect(Object.keys(normalized.supply.productionRecipes)).toEqual(["alpha", "zeta"]);
    expect(Object.keys(normalized.supply.producers)).toEqual(["alpha", "zeta"]);
    expect(Object.keys(normalized.supply.storages)).toEqual(["alpha_store", "zeta_store"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.supply)).toBe(true);
    expect(Object.values(normalized.supply.productionRecipes).every(Object.isFrozen)).toBe(true);
    expect(Object.values(normalized.supply.producers).every(Object.isFrozen)).toBe(true);
    expect(Object.values(normalized.supply.storages).every(Object.isFrozen)).toBe(true);
    authored.supply.producers.zeta.startingAmount = 4;
    expect(normalized.supply.producers.zeta.startingAmount).toBe(1);
  });

  it.each([
    ["supply primitive", 1],
    ["missing recipes", { producers: {}, storages: {} }],
    ["missing producers", { productionRecipes: {}, storages: {} }],
    ["missing storages", { productionRecipes: {}, producers: {} }],
    ["extra supply field", { productionRecipes: {}, producers: {}, storages: {}, conveyors: {} }],
    ["recipe missing label", {
      productionRecipes: { forge_shell: { ammoTypeId: "shell", outputAmount: 1, interval: 1 } },
      producers: {}, storages: {}
    }],
    ["recipe extra field", {
      productionRecipes: {
        forge_shell: { label: "Forge", ammoTypeId: "shell", outputAmount: 1, interval: 1, input: "ore" }
      }, producers: {}, storages: {}
    }],
    ["producer missing recipe", {
      productionRecipes: {},
      producers: {
        factory: { capacity: 1, startingAmount: 0, transferRadius: 1, transferAmount: 1, transferInterval: 1 }
      }, storages: {}
    }],
    ["producer extra field", {
      productionRecipes: {},
      producers: {
        factory: {
          recipeId: "forge", capacity: 1, startingAmount: 0, transferRadius: 1,
          transferAmount: 1, transferInterval: 1, powered: true
        }
      }, storages: {}
    }],
    ["storage missing ammo id", {
      productionRecipes: {}, producers: {},
      storages: {
        depot: { capacity: 1, startingAmount: 0, transferRadius: 1, transferAmount: 1, transferInterval: 1 }
      }
    }],
    ["storage extra field", {
      productionRecipes: {}, producers: {},
      storages: {
        depot: {
          ammoTypeId: "shell", capacity: 1, startingAmount: 0, transferRadius: 1,
          transferAmount: 1, transferInterval: 1, accepts: []
        }
      }
    }]
  ])("rejects the exact closed v3 shape while disabled: %s", (_name, supplyValue) => {
    const result = validate({
      activation: "disabled",
      profile: { power: null, ammunition: ammunition(), supply: supplyValue }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(
      result,
      "error",
      /logistics|profiles\.local|supply|productionRecipes|producers|storages/i,
      /required|missing|unknown|closed|plain object|own data/i
    )).toBe(true);
  });

  it.each([
    ["zero capacity", "producer", { capacity: 0 }],
    ["fractional capacity", "storage", { capacity: 1.5 }],
    ["unsafe capacity", "producer", { capacity: Number.MAX_SAFE_INTEGER + 1 }],
    ["capacity overflow", "storage", { capacity: 1_000_000_001 }],
    ["negative starting amount", "producer", { startingAmount: -1 }],
    ["starting above capacity", "storage", { capacity: 4, startingAmount: 5 }],
    ["zero output", "recipe", { outputAmount: 0 }],
    ["fractional output", "recipe", { outputAmount: 1.5 }],
    ["recipe output above producer capacity", "recipe", { outputAmount: 121 }],
    ["zero transfer", "producer", { transferAmount: 0 }],
    ["transfer above capacity", "storage", { capacity: 4, transferAmount: 5 }],
    ["negative radius", "producer", { transferRadius: -1 }],
    ["fractional radius", "storage", { transferRadius: 1.5 }],
    ["radius overflow", "producer", { transferRadius: 65 }],
    ["production interval below minimum", "recipe", { interval: 0.199999 }],
    ["transfer interval below minimum", "producer", { transferInterval: 0.199999 }],
    ["interval overflow", "storage", { transferInterval: 1_000_001 }],
    ["infinite interval", "recipe", { interval: Number.POSITIVE_INFINITY }]
  ])("rejects the bounded supply number: %s", (_name, kind, patch) => {
    const value = supply();
    if (kind === "recipe") Object.assign((value.productionRecipes as any).forge_shell, patch);
    if (kind === "producer") Object.assign((value.producers as any).factory, patch);
    if (kind === "storage") Object.assign((value.storages as any).depot, patch);
    const result = validate({ activation: "disabled", profile: { power: null, ammunition: ammunition(), supply: value } });
    expect(result.ok).toBe(false);
    expect(hasIssue(
      result,
      "error",
      /supply|outputAmount|capacity|startingAmount|transferRadius|transferAmount|interval/i,
      /safe integer|integer|finite|capacity|0\.2|1000000|1\.\.1000000000|0\.\.64|maximum|minimum/i
    )).toBe(true);
  });

  it("accepts every exact numeric boundary", () => {
    expect(validate({
      profile: {
        power: null,
        ammunition: ammunition(),
        supply: {
          productionRecipes: {
            forge_shell: {
              label: "Forge", ammoTypeId: "shell",
              outputAmount: 1_000_000_000, interval: 0.2
            }
          },
          producers: {
            factory: {
              recipeId: "forge_shell", capacity: 1_000_000_000,
              startingAmount: 1_000_000_000, transferRadius: 64,
              transferAmount: 1_000_000_000, transferInterval: 1_000_000
            }
          },
          storages: {
            depot: {
              ammoTypeId: "shell", capacity: 1_000_000_000,
              startingAmount: 1_000_000_000, transferRadius: 0,
              transferAmount: 1_000_000_000, transferInterval: 0.2
            }
          }
        }
      }
    })).toEqual({ ok: true, issues: [] });
  });

  it("enforces UTF-8 byte limits for all IDs, labels, and references", () => {
    for (const profile of [
      {
        power: null, ammunition: ammunition(),
        supply: supply({
          productionRecipes: { ["🔥".repeat(33)]: { label: "Forge", ammoTypeId: "shell", outputAmount: 1, interval: 1 } },
          producers: {}, storages: {}
        })
      },
      {
        power: null, ammunition: ammunition(),
        supply: supply({
          productionRecipes: { forge_shell: { label: "🔥".repeat(33), ammoTypeId: "shell", outputAmount: 1, interval: 1 } },
          producers: {}, storages: {}
        })
      },
      {
        power: null, ammunition: ammunition(),
        supply: supply({
          productionRecipes: {},
          producers: {
            factory: {
              recipeId: "🔥".repeat(33), capacity: 1, startingAmount: 0,
              transferRadius: 1, transferAmount: 1, transferInterval: 1
            }
          }, storages: {}
        })
      }
    ]) {
      const result = validate({ activation: "disabled", profile });
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /supply|label|recipeId|productionRecipes/i, /1\.\.128|UTF-8|bytes/i)).toBe(true);
    }
  });

  it("enforces recipe and combined source budgets before reading an overflow accessor", () => {
    const recipes = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `recipe_${String(index).padStart(3, "0")}`,
      { label: `Recipe ${index}`, ammoTypeId: "shell", outputAmount: 1, interval: 1 }
    ]));
    const producers = Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => [
      `producer_${String(index).padStart(4, "0")}`,
      {
        recipeId: "recipe_000", capacity: 1, startingAmount: 0,
        transferRadius: 0, transferAmount: 1, transferInterval: 0.2
      }
    ]));
    let getterCalls = 0;
    const overRecipes = { ...recipes };
    Object.defineProperty(overRecipes, "overflow", {
      enumerable: true,
      get() { getterCalls += 1; throw new Error("SUPPLY_RECIPE_BUDGET_FIRST"); }
    });
    const overProducers = { ...producers };
    Object.defineProperty(overProducers, "overflow", {
      enumerable: true,
      get() { getterCalls += 1; throw new Error("SUPPLY_SOURCE_BUDGET_FIRST"); }
    });

    const recipesResult = validate({
      activation: "disabled",
      profile: {
        power: null, ammunition: ammunition(),
        supply: { productionRecipes: overRecipes, producers: {}, storages: {} }
      }
    });
    const sourcesResult = validate({
      activation: "disabled",
      profile: {
        power: null, ammunition: ammunition(),
        supply: { productionRecipes: { recipe_000: (recipes as any).recipe_000 }, producers: overProducers, storages: {} }
      }
    });
    expect(hasIssue(recipesResult, "error", /productionRecipes/i, /256|budget|limit|maximum/i)).toBe(true);
    expect(hasIssue(sourcesResult, "error", /producers|supply/i, /4.?096|budget|limit|maximum/i)).toBe(true);
    expect(getterCalls).toBe(0);

    const combinedResult = validate({
      activation: "disabled",
      profile: {
        power: null, ammunition: ammunition(),
        supply: {
          productionRecipes: { recipe_000: (recipes as any).recipe_000 },
          producers,
          storages: {
            one_more: {
              ammoTypeId: "shell", capacity: 1, startingAmount: 0,
              transferRadius: 0, transferAmount: 1, transferInterval: 0.2
            }
          }
        }
      }
    });
    expect(hasIssue(combinedResult, "error", /supply|producers|storages/i, /4.?096|total|combined|budget/i)).toBe(true);
  });

  it.each([
    ["missing recipe ammunition type", supply({
      productionRecipes: {
        forge_shell: { label: "Forge", ammoTypeId: "missing", outputAmount: 1, interval: 1 }
      }
    })],
    ["missing storage ammunition type", supply({
      storages: {
        depot: {
          ammoTypeId: "missing", capacity: 1, startingAmount: 0,
          transferRadius: 1, transferAmount: 1, transferInterval: 1
        }
      }
    })],
    ["missing production recipe", supply({
      producers: {
        factory: {
          recipeId: "missing", capacity: 1, startingAmount: 0,
          transferRadius: 1, transferAmount: 1, transferInterval: 1
        }
      }
    })],
    ["missing producer tower", supply({
      producers: {
        missing: {
          recipeId: "forge_shell", capacity: 4, startingAmount: 0,
          transferRadius: 1, transferAmount: 1, transferInterval: 1
        }
      }
    })],
    ["missing storage tower", supply({
      storages: {
        missing: {
          ammoTypeId: "shell", capacity: 1, startingAmount: 0,
          transferRadius: 1, transferAmount: 1, transferInterval: 1
        }
      }
    })]
  ])("reports active errors and inactive warnings for %s", (_name, value) => {
    const active = validate({ profile: { power: null, ammunition: ammunition(), supply: value } });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /supply|productionRecipes|producers|storages|ammoTypeId|recipeId/i, /unknown|missing|reference|tower|recipe|ammunition/i))
      .toBe(true);
    for (const activation of ["disabled", "unselected"] as const) {
      const inactive = validate({ activation, profile: { power: null, ammunition: ammunition(), supply: value } });
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((issue) => issue.severity === "error")).toBe(false);
      expect(hasIssue(inactive, "warning", /supply|productionRecipes|producers|storages|ammoTypeId|recipeId/i, /unknown|missing|inactive|unselected|tower|recipe|ammunition/i))
        .toBe(true);
    }
  });

  it("rejects producer/storage role overlap structurally but permits overlap with power and attack magazines", () => {
    const overlap = supply({
      storages: {
        factory: {
          ammoTypeId: "shell", capacity: 10, startingAmount: 0,
          transferRadius: 2, transferAmount: 1, transferInterval: 1
        }
      }
    });
    const invalid = validate({
      activation: "disabled",
      profile: { power: null, ammunition: ammunition(), supply: overlap }
    });
    expect(invalid.ok).toBe(false);
    expect(hasIssue(invalid, "error", /supply|producers|storages|factory/i, /both|overlap|exclusive|role/i)).toBe(true);

    const sharedTowers = defaultTowers();
    sharedTowers.factory = tower("factory");
    const validProfile = {
      power: {
        generators: { factory: { output: 20, linkRadius: 4, coverageRadius: 3 } },
        relays: { depot: { linkRadius: 4, coverageRadius: 3 } },
        consumers: {}
      },
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          factory: { ammoTypeId: "shell", capacity: 2, startingAmount: 1, consumptionPerActivation: 1 },
          consumer: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supply()
    };
    expect(validate({ towers: sharedTowers, profile: validProfile })).toEqual({ ok: true, issues: [] });
  });

  it.each(["constructor", "toString"])(
    "does not resolve inherited Object.prototype key %s as an authored ammo, recipe, or tower ID",
    (prototypeKey) => {
      const missingAmmo = validate({
        profile: {
          power: null, ammunition: ammunition(),
          supply: supply({
            productionRecipes: {
              forge_shell: { label: "Forge", ammoTypeId: prototypeKey, outputAmount: 1, interval: 1 }
            }
          })
        }
      });
      expect(hasIssue(missingAmmo, "error", /productionRecipes\.forge_shell\.ammoTypeId/i, /unknown|missing|ammunition/i))
        .toBe(true);

      const missingRecipe = validate({
        profile: {
          power: null, ammunition: ammunition(),
          supply: supply({
            producers: {
              factory: {
                recipeId: prototypeKey, capacity: 1, startingAmount: 0,
                transferRadius: 1, transferAmount: 1, transferInterval: 1
              }
            }
          })
        }
      });
      expect(hasIssue(missingRecipe, "error", /producers\.factory\.recipeId/i, /unknown|missing|recipe/i)).toBe(true);

      const producerRecord = Object.create(null) as Record<string, unknown>;
      producerRecord[prototypeKey] = {
        recipeId: "forge_shell", capacity: 4, startingAmount: 0,
        transferRadius: 1, transferAmount: 1, transferInterval: 1
      };
      const missingTower = validate({
        profile: {
          power: null, ammunition: ammunition(), supply: supply({ producers: producerRecord })
        }
      });
      expect(hasIssue(missingTower, "error", new RegExp(`producers\\.${prototypeKey}`, "i"), /unknown|missing|tower/i))
        .toBe(true);
    }
  );

  it("rejects hostile supply containers without executing accessors or leaking proxy errors", () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, "productionRecipes", {
      enumerable: true,
      get() { calls += 1; throw new Error("SECRET_SUPPLY_ACCESSOR"); }
    });
    Object.defineProperties(accessor, {
      producers: { enumerable: true, value: {} },
      storages: { enumerable: true, value: {} }
    });
    const inherited = Object.create({ productionRecipes: {} });
    inherited.producers = {};
    inherited.storages = {};
    const symbol = supply({ productionRecipes: {} });
    Object.defineProperty(symbol, Symbol("hostile"), { enumerable: true, value: true });
    const revoked = Proxy.revocable(supply({ productionRecipes: {} }), {});
    revoked.revoke();
    for (const hostile of [accessor, inherited, symbol, [], new Array(1), revoked.proxy]) {
      const result = validate({
        activation: "disabled",
        profile: { power: null, ammunition: ammunition(), supply: hostile }
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("SECRET_SUPPLY_ACCESSOR");
      expect(hasIssue(result, "error", /supply|productionRecipes|producers|storages/i, /own data|accessor|plain object|symbol|safe|dense|array|inspect|required/i))
        .toBe(true);
    }
    expect(calls).toBe(0);
  });

  it("rejects hostile recipe, producer, and storage definitions without reading accessors", () => {
    let calls = 0;
    const recipeAccessor = Object.defineProperty({}, "label", {
      enumerable: true,
      get() { calls += 1; throw new Error("SECRET_RECIPE_LABEL"); }
    });
    Object.defineProperties(recipeAccessor, {
      ammoTypeId: { enumerable: true, value: "shell" },
      outputAmount: { enumerable: true, value: 1 },
      interval: { enumerable: true, value: 1 }
    });
    const producerProxy = new Proxy({
      recipeId: "forge_shell", capacity: 1, startingAmount: 0,
      transferRadius: 1, transferAmount: 1, transferInterval: 1
    }, {
      getOwnPropertyDescriptor() { throw new Error("SECRET_PRODUCER_PROXY"); }
    });
    const storageAccessor = Object.defineProperty({}, "ammoTypeId", {
      enumerable: true,
      get() { calls += 1; throw new Error("SECRET_STORAGE_AMMO"); }
    });
    Object.defineProperties(storageAccessor, {
      capacity: { enumerable: true, value: 1 },
      startingAmount: { enumerable: true, value: 0 },
      transferRadius: { enumerable: true, value: 1 },
      transferAmount: { enumerable: true, value: 1 },
      transferInterval: { enumerable: true, value: 1 }
    });
    for (const value of [
      supply({ productionRecipes: { forge_shell: recipeAccessor }, producers: {}, storages: {} }),
      supply({ producers: { factory: producerProxy } }),
      supply({ storages: { depot: storageAccessor } })
    ]) {
      const result = validate({
        activation: "disabled",
        profile: { power: null, ammunition: ammunition(), supply: value }
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/SECRET_RECIPE_LABEL|SECRET_PRODUCER_PROXY|SECRET_STORAGE_AMMO/);
      expect(hasIssue(result, "error", /supply|productionRecipes|producers|storages/i, /own data|accessor|safe|inspect/i))
        .toBe(true);
    }
    expect(calls).toBe(0);
  });

  it("resolves a selected v3 profile exactly", () => {
    const active = registry();
    expect(active.missions.supply!.capabilities.logistics).toMatchObject({ active: true, reason: "active" });
    expect((Engine as any).resolveActiveLogisticsMechanics?.(active, "supply")).toEqual({
      schemaVersion: 3,
      profileId: "local",
      power: null,
      ammunition: ammunition(),
      supply: supply()
    });
  });

  it("keeps future v4 opaque, lossless, read-only, and runtime fail-closed", () => {
    let calls = 0;
    const futureProfile = Object.defineProperty({ futureOnly: { conveyors: true } }, "supply", {
      enumerable: true,
      get() { calls += 1; throw new Error("FUTURE_LOGISTICS_V4_MUST_STAY_OPAQUE"); }
    });
    const future = registry({ activation: "future", profile: futureProfile });
    expect(future.missions.supply!.capabilities.logistics).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported"
    });
    const result = validateGameContentRegistry(future);
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /logistics.*schemaVersion|schemaVersion/i, /future|unsupported|version|1|2|3/i))
      .toBe(true);
    expect(result.issues.some((issue) => /profiles\.local\.supply/i.test(issue.fieldPath))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("FUTURE_LOGISTICS_V4_MUST_STAY_OPAQUE");
    expect(calls).toBe(0);
    expect((future.mechanics.modules as any).logistics.profiles.local).toBe(futureProfile);
    expect((Engine as any).resolveActiveLogisticsMechanics?.(future, "supply")).toBeUndefined();
    expect(calls).toBe(0);
  });
});
