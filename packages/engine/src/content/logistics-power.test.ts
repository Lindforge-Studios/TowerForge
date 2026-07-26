import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const POWER_LIMITS_V1 = {
  entriesPerRole: 4_096,
  entriesTotal: 4_096,
  idUtf8Bytes: 128,
  output: 1_000_000_000_000,
  demand: 1_000_000_000_000,
  radius: 64,
  priority: 1_000_000,
  liveParticipants: 4_096,
  liveNodes: 1_024,
  undirectedEdges: 65_536
} as const;

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

function singleAttack(): Record<string, unknown> {
  return {
    kind: "single", fireRate: 1, damagePerStack: 1,
    startingStacks: 1, maxStacks: 1, upgradeCost: 1
  };
}

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
      return {
        kind, interval: 1, delivery: { kind: "single" },
        effects: [{ kind: "damage", amount: 1 }]
      };
    case "support":
      return { kind, auraRadius: 2, unlocksTowerIds: ["consumer"] };
    case "support_buff":
      return { kind, auraRadius: 2, fireRateMultiplierByLevel: [1, 1, 1], affectsTowerIds: ["consumer"] };
    default:
      return singleAttack();
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

function power(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generators: { generator: { output: 20, linkRadius: 4, coverageRadius: 3 } },
    relays: { relay: { linkRadius: 5, coverageRadius: 4 } },
    consumers: { consumer: { demand: 8, priority: 10 } },
    ...overrides
  };
}

function logisticsInput(options: {
  readonly activation?: Activation;
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
    support_buff: tower("support_buff", "support_buff")
  };
  const profile = options.profile === undefined ? { power: power() } : options.profile;
  const modules = activation === "absent" ? {} : {
    logistics: {
      schemaVersion: activation === "future" ? 3 : 1,
      enabled: activation !== "disabled",
      profiles: { grid: profile }
    }
  };
  return {
    balance: {
      defaultMissionId: "power",
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
        power: {
          id: "power", label: "Power", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: Object.keys(towers), abilityIds: [],
          ...(activation === "unselected" || activation === "absent"
            ? {}
            : { mechanics: { profiles: { logistics: "grid" } } })
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
        missionId: "power", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function registry(options: Parameters<typeof logisticsInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(logisticsInput(options));
}

function validate(options: Parameters<typeof logisticsInput>[0] = {}): ValidationResult {
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

describe("R5.7A Logistics power authoring contract (RED)", () => {
  it("preserves the exact Logistics v1 power contract inside the versioned v2 descriptor", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes",
      "logistics"
    ]);
    const exported = Engine as unknown as {
      LOGISTICS_POWER_LIMITS?: unknown;
      LOGISTICS_MECHANICS_SCHEMA?: unknown;
    };
    expect(exported.LOGISTICS_POWER_LIMITS).toEqual(POWER_LIMITS_V1);
    expect(exported.LOGISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 2,
      moduleId: "logistics",
      supportedModuleSchemaVersions: [1, 2],
      profileVersions: {
        1: {
          requiredFields: ["power"], optionalFields: [], additionalProperties: false
        }
      },
      power: {
        nullable: true,
        requiredFields: ["generators", "relays", "consumers"],
        optionalFields: [], additionalProperties: false,
        generator: {
          requiredFields: ["output", "linkRadius", "coverageRadius"],
          optionalFields: [], additionalProperties: false
        },
        relay: {
          requiredFields: ["linkRadius", "coverageRadius"],
          optionalFields: [], additionalProperties: false
        },
        consumer: {
          requiredFields: ["demand", "priority"],
          optionalFields: [], additionalProperties: false
        }
      },
      limits: {
        power: POWER_LIMITS_V1
      },
      runtimeSnapshot: {
        schemaVersion: 2,
        fields: ["schemaVersion", "power", "ammunition"],
        powerFields: ["components", "nodes", "consumers"]
      }
    });
    expect(exported.LOGISTICS_MECHANICS_SCHEMA).not.toMatchObject({
      profileVersions: {
        1: {
          requiredFields: ["power", "ammunition"]
        }
      }
    });
  });

  it("resolves the capability transition from unavailable to active without changing other version domains", () => {
    const subject = registry();
    expect(subject.missions.power!.capabilities.logistics).toEqual({
      moduleId: "logistics",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "grid",
      reason: "active"
    });
    expect((Engine as any).GAME_COMMAND_SCHEMA_VERSION).toBe(6);
    expect((Engine as any).GAME_CHECKPOINT_SCHEMA_VERSION).toBe(1);
  });

  it("normalizes binary record order into detached deeply frozen own data", () => {
    const normalize = (Engine as any).normalizeLogisticsProfileV1 as ((value: unknown) => any) | undefined;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;
    const authored = {
      power: {
        generators: {
          zeta: { output: 3, linkRadius: 2, coverageRadius: 1 },
          Alpha: { output: 2, linkRadius: 1, coverageRadius: 0 },
          alpha: { output: 1, linkRadius: 0, coverageRadius: 2 }
        },
        relays: {
          relay_z: { linkRadius: 3, coverageRadius: 4 },
          relay_a: { linkRadius: 2, coverageRadius: 1 }
        },
        consumers: {
          tower_z: { demand: 4, priority: 2 },
          tower_a: { demand: 5, priority: 1 }
        }
      }
    };
    const normalized = normalize(authored);
    expect(Object.keys(normalized.power.generators)).toEqual(["Alpha", "alpha", "zeta"].sort());
    expect(Object.keys(normalized.power.relays)).toEqual(["relay_a", "relay_z"]);
    expect(Object.keys(normalized.power.consumers)).toEqual(["tower_a", "tower_z"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.power)).toBe(true);
    expect(Object.values(normalized.power.generators).every(Object.isFrozen)).toBe(true);
    authored.power.generators.zeta.output = 999;
    expect(normalized.power.generators.zeta.output).toBe(3);
  });

  it("accepts explicit null literally and never synthesizes or mutates absent Logistics", () => {
    const normalize = (Engine as any).normalizeLogisticsProfileV1 as ((value: unknown) => any) | undefined;
    expect(normalize).toBeTypeOf("function");
    expect(normalize?.({ power: null })).toEqual({ power: null });

    const authored = logisticsInput({ activation: "absent" });
    const before = JSON.stringify(authored);
    const subject = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(subject)).toEqual({ ok: true, issues: [] });
    expect(subject.mechanics.modules).not.toHaveProperty("logistics");
    expect(JSON.stringify(authored)).toBe(before);

    const nullSubject = registry({ profile: { power: null } });
    expect(validateGameContentRegistry(nullSubject)).toEqual({ ok: true, issues: [] });
    expect(nullSubject.missions.power!.capabilities.logistics).toMatchObject({ active: true, reason: "active" });
  });

  it("accepts and resolves a selected active v1 profile as a detached frozen value", () => {
    const subject = registry();
    expect(validateGameContentRegistry(subject)).toEqual({ ok: true, issues: [] });
    const resolve = (Engine as any).resolveActiveLogisticsMechanics as
      ((content: GameContentRegistry, missionId: string) => any) | undefined;
    expect(resolve).toBeTypeOf("function");
    if (!resolve) return;
    const resolved = resolve(subject, "power");
    expect(resolved).toEqual({
      schemaVersion: 1,
      profileId: "grid",
      power: power()
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.power)).toBe(true);
    expect(Object.values(resolved.power.generators).every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ["missing power", {}],
    ["extra profile field", { power: null, future: true }],
    ["power primitive", { power: 1 }],
    ["missing generators", { power: { relays: {}, consumers: {} } }],
    ["missing relays", { power: { generators: {}, consumers: {} } }],
    ["missing consumers", { power: { generators: {}, relays: {} } }],
    ["extra power field", { power: { ...power(), batteries: {} } }],
    ["generator missing output", { power: power({ generators: { generator: { linkRadius: 1, coverageRadius: 1 } } }) }],
    ["generator extra field", { power: power({ generators: { generator: { output: 1, linkRadius: 1, coverageRadius: 1, fuel: 1 } } }) }],
    ["relay missing coverage", { power: power({ relays: { relay: { linkRadius: 1 } } }) }],
    ["relay extra field", { power: power({ relays: { relay: { linkRadius: 1, coverageRadius: 1, output: 1 } } }) }],
    ["consumer missing priority", { power: power({ consumers: { consumer: { demand: 1 } } }) }],
    ["consumer extra field", { power: power({ consumers: { consumer: { demand: 1, priority: 1, battery: 1 } } }) }]
  ])("rejects the exact closed required nullable schema even while disabled: %s", (_name, profile) => {
    const result = validate({ activation: "disabled", profile });
    expect(result.ok).toBe(false);
    expect(hasIssue(
      result,
      "error",
      /logistics|profiles\.grid|power|generators|relays|consumers/i,
      /required|missing|unknown|closed|own data|plain object/i
    )).toBe(true);
  });

  it.each([
    ["zero output", { output: 0, linkRadius: 1, coverageRadius: 1 }],
    ["negative output", { output: -1, linkRadius: 1, coverageRadius: 1 }],
    ["infinite output", { output: Number.POSITIVE_INFINITY, linkRadius: 1, coverageRadius: 1 }],
    ["overflow output", { output: POWER_LIMITS_V1.output + 1, linkRadius: 1, coverageRadius: 1 }],
    ["fractional link radius", { output: 1, linkRadius: 1.5, coverageRadius: 1 }],
    ["negative link radius", { output: 1, linkRadius: -1, coverageRadius: 1 }],
    ["overflow coverage radius", { output: 1, linkRadius: 1, coverageRadius: 65 }]
  ])("rejects malformed generator numeric boundary: %s", (_name, definition) => {
    const result = validate({
      activation: "disabled",
      profile: { power: power({ generators: { generator: definition } }) }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /generators\.generator/i, /finite|positive|integer|0\.\.64|limit|maximum/i))
      .toBe(true);
  });

  it.each([
    ["zero demand", { demand: 0, priority: 1 }],
    ["negative demand", { demand: -1, priority: 1 }],
    ["infinite demand", { demand: Number.NaN, priority: 1 }],
    ["overflow demand", { demand: POWER_LIMITS_V1.demand + 1, priority: 1 }],
    ["negative priority", { demand: 1, priority: -1 }],
    ["fractional priority", { demand: 1, priority: 1.5 }],
    ["unsafe priority", { demand: 1, priority: Number.MAX_SAFE_INTEGER + 1 }],
    ["overflow priority", { demand: 1, priority: POWER_LIMITS_V1.priority + 1 }]
  ])("rejects malformed consumer numeric boundary: %s", (_name, definition) => {
    const result = validate({
      activation: "disabled",
      profile: { power: power({ consumers: { consumer: definition } }) }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /consumers\.consumer/i, /finite|positive|integer|safe|priority|limit|maximum/i))
      .toBe(true);
  });

  it("accepts every exact numeric boundary", () => {
    expect(validate({
      profile: {
        power: power({
          generators: {
            generator: { output: POWER_LIMITS_V1.output, linkRadius: 64, coverageRadius: 0 }
          },
          consumers: { consumer: { demand: POWER_LIMITS_V1.demand, priority: POWER_LIMITS_V1.priority } }
        })
      }
    })).toEqual({ ok: true, issues: [] });
  });

  it("enforces role and total record budgets before traversing hostile excess entries", () => {
    const exact = Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => [
      `tower_${String(index).padStart(4, "0")}`,
      { output: 1, linkRadius: 0, coverageRadius: 0 }
    ]));
    const exactResult = validate({
      activation: "unselected",
      profile: { power: { generators: exact, relays: {}, consumers: {} } }
    });
    expect(exactResult.ok).toBe(true);
    expect(exactResult.issues.every((candidate) => candidate.severity === "warning")).toBe(true);

    let excessGetterCalls = 0;
    const oversized = { ...exact };
    Object.defineProperty(oversized, "overflow", {
      enumerable: true,
      get() {
        excessGetterCalls += 1;
        throw new Error("POWER_ROLE_BUDGET_MUST_BE_CHECKED_FIRST");
      }
    });
    const roleOverflow = validate({
      activation: "disabled",
      profile: { power: { generators: oversized, relays: {}, consumers: {} } }
    });
    expect(roleOverflow.ok).toBe(false);
    expect(hasIssue(roleOverflow, "error", /generators/i, /4.?096|budget|limit|maximum|record/i)).toBe(true);
    expect(excessGetterCalls).toBe(0);

    const totalOverflow = validate({
      activation: "disabled",
      profile: {
        power: {
          generators: exact,
          relays: { overflow: { linkRadius: 0, coverageRadius: 0 } },
          consumers: {}
        }
      }
    });
    expect(totalOverflow.ok).toBe(false);
    expect(hasIssue(totalOverflow, "error", /power|generators|relays/i, /4.?096|total|budget|limit/i)).toBe(true);
  });

  it("rejects empty and oversized UTF-8 role IDs structurally", () => {
    for (const id of ["", "🔥".repeat(33)]) {
      const result = validate({
        activation: "disabled",
        profile: { power: { generators: { [id]: { output: 1, linkRadius: 0, coverageRadius: 0 } }, relays: {}, consumers: {} } }
      });
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /generators/i, /1\.\.128|UTF-8|id|non-empty/i)).toBe(true);
    }
  });

  it("rejects duplicate roles structurally even while disabled", () => {
    const result = validate({
      activation: "disabled",
      profile: {
        power: {
          generators: { duplicate: { output: 1, linkRadius: 0, coverageRadius: 0 } },
          relays: { duplicate: { linkRadius: 0, coverageRadius: 0 } },
          consumers: {}
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /power|duplicate|generators|relays/i, /role|more than one|duplicate/i))
      .toBe(true);
  });

  it("reports broken tower references as errors only for the active selected profile", () => {
    const broken = {
      power: {
        generators: {
          missing_generator: { output: 1, linkRadius: 0, coverageRadius: 0 }
        },
        relays: {},
        consumers: { missing_consumer: { demand: 1, priority: 0 } }
      }
    };
    const active = validate({ profile: broken });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /power|missing_/i, /unknown|tower/i)).toBe(true);

    for (const activation of ["disabled", "unselected"] as const) {
      const inactive = validate({ activation, profile: broken });
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);
      expect(hasIssue(inactive, "warning", /power|missing_/i, /unknown|tower|inactive|unselected/i))
        .toBe(true);
    }
  });

  it.each(["single", "pulse", "sniper", "antiair", "splash", "pipeline"])(
    "allows fire-capable %s consumers",
    (kind) => {
      const towers = {
        generator: tower("generator"),
        relay: tower("relay"),
        consumer: tower("consumer", kind)
      };
      expect(validate({ towers })).toEqual({ ok: true, issues: [] });
    }
  );

  it.each(["support", "support_buff"])("rejects active passive %s consumers but warns while inactive", (kind) => {
    const towers = {
      generator: tower("generator"),
      relay: tower("relay"),
      consumer: tower("consumer", kind)
    };
    const active = validate({ towers });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /consumers\.consumer|consumer/i, /fire.capable|attack|support/i)).toBe(true);

    const inactive = validate({ activation: "disabled", towers });
    expect(inactive.ok).toBe(true);
    expect(hasIssue(inactive, "warning", /consumers\.consumer|consumer/i, /fire.capable|attack|support/i)).toBe(true);
  });

  it("rejects accessors, inherited fields, symbols, arrays, sparse containers, and revoked Proxies without execution", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "generators", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_LOGISTICS_ACCESSOR");
      }
    });
    Object.defineProperties(accessor, {
      relays: { enumerable: true, value: {} },
      consumers: { enumerable: true, value: {} }
    });
    const inherited = Object.create({ generators: {} });
    inherited.relays = {};
    inherited.consumers = {};
    const symbol = power({ generators: {} });
    Object.defineProperty(symbol, Symbol("hostile"), { value: true, enumerable: true });
    const revoked = Proxy.revocable(power({ generators: {} }), {});
    revoked.revoke();
    const sparse = new Array(1);

    for (const hostile of [accessor, inherited, symbol, revoked.proxy, sparse]) {
      const result = validate({ activation: "disabled", profile: { power: hostile } });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("SECRET_LOGISTICS_ACCESSOR");
      expect(hasIssue(
        result,
        "error",
        /logistics|power|generators/i,
        /own data|accessor|plain object|symbol|safe|dense|array|inspect|required/i
      )).toBe(true);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects hostile nested definitions and never exposes Proxy error payloads", () => {
    let getterCalls = 0;
    const nestedAccessor = Object.defineProperty({}, "output", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_NESTED_POWER_GETTER");
      }
    });
    Object.defineProperties(nestedAccessor, {
      linkRadius: { enumerable: true, value: 0 },
      coverageRadius: { enumerable: true, value: 0 }
    });
    const hostileProxy = new Proxy({ output: 1, linkRadius: 0, coverageRadius: 0 }, {
      getOwnPropertyDescriptor() {
        throw new Error("SECRET_PROXY_DESCRIPTOR");
      }
    });

    for (const definition of [nestedAccessor, hostileProxy]) {
      const result = validate({
        activation: "disabled",
        profile: { power: power({ generators: { generator: definition } }) }
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/SECRET_NESTED_POWER_GETTER|SECRET_PROXY_DESCRIPTOR/);
      expect(hasIssue(result, "error", /generators\.generator|power/i, /own data|accessor|safe|inspect/i)).toBe(true);
    }
    expect(getterCalls).toBe(0);
  });

  it("keeps future v3 profile payload opaque, lossless, read-only, and runtime fail-closed", () => {
    let calls = 0;
    const futureProfile = Object.defineProperty({ futureOnly: { batteries: true } }, "power", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("FUTURE_LOGISTICS_MUST_STAY_OPAQUE");
      }
    });
    const subject = registry({ activation: "future", profile: futureProfile });
    expect(subject.missions.power!.capabilities.logistics).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported"
    });
    const result = validateGameContentRegistry(subject);
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /logistics.*schemaVersion|schemaVersion/i, /future|unsupported|version|1|2/i))
      .toBe(true);
    expect(result.issues.some((candidate) => /profiles\.grid\.power/i.test(candidate.fieldPath))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("FUTURE_LOGISTICS_MUST_STAY_OPAQUE");
    expect(calls).toBe(0);

    const resolve = (Engine as any).resolveActiveLogisticsMechanics as
      ((content: GameContentRegistry, missionId: string) => unknown) | undefined;
    expect(resolve).toBeTypeOf("function");
    expect(resolve?.(subject, "power")).toBeUndefined();
    expect(calls).toBe(0);
    expect((subject.mechanics.modules as any).logistics.profiles.grid).toBe(futureProfile);
  });
});
