import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import {
  canonicalJsonMetrics,
  canonicalStringify,
  getSimulationContentDigest,
  stableDigest
} from "./stable-digest.js";

function createContentInput(): GameContentInput {
  return {
    balance: {
      defaultMissionId: "digest_mission",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100, gems: 2 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      currencies: [
        { id: "coins", label: "Coins", color: 0xf5c542 },
        { id: "gems", label: "Gems", color: 0x44ccff }
      ],
      defaultDifficultyId: "normal",
      difficulties: [{ id: "normal", label: "Normal", enemyHpMultiplier: 1 }],
      metaProgression: {
        currencies: [{ id: "stars", label: "Stars", color: 0xffffff }],
        upgrades: {
          power: {
            id: "power",
            label: "Power",
            maxLevel: 2,
            costs: [{ stars: 1 }, { stars: 2 }],
            effects: [{ kind: "towerDamage", multiplierPerLevel: 0.1 }]
          }
        },
        rewardsByMission: { digest_mission: { firstClear: { stars: 1 } } }
      },
      terrainTypes: {
        buildable: { groundSpeedMultiplier: 1, tags: ["ground"] }
      },
      abilities: {
        strike: {
          id: "strike",
          label: "Strike",
          cooldown: 4,
          duration: 0,
          radius: 2,
          damage: 3
        }
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 10,
          speed: 1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x889966
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 5, gems: 1 },
          footprintRadius: 0,
          range: 6,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 3,
            upgradeCost: 2
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        digest_mission: {
          id: "digest_mission",
          label: "Digest mission",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100, gems: 2 },
          prepTimeUnits: 5,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: ["strike"],
          economy: { perWaveStart: { coins: 2 }, sellRefundRatio: 0.7 },
          objectives: {
            victory: [{ id: "clear", kind: "clearWaves" }],
            failure: [{ id: "leaks", kind: "maxLeaks", maxLeaks: 3 }]
          },
          mechanics: { profiles: { combat: "default" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 4,
        height: 2,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 3, r: 1 },
        pathCenterline: [
          { q: 0, r: 1 },
          { q: 1, r: 1 },
          { q: 2, r: 1 },
          { q: 3, r: 1 }
        ],
        pathRoutes: [],
        terrainOverrides: [{ q: 1, r: 0, terrain: "path" }]
      }
    },
    scripts: {
      opening_bonus: {
        schemaVersion: 2,
        id: "opening_bonus",
        enabled: true,
        bindings: [{ scope: "mission", ids: ["digest_mission"] }],
        handlers: {
          gameStarted: [{ id: "grant", actions: [{ action: "grantResource", resourceId: "coins", amount: 1 }] }]
        }
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            default: { scalar: 1 },
            alternate: { scalar: 2 }
          }
        }
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        accent: "#889966",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "digest_mission",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    },
    visuals: { towers: { pelter: { spriteId: "pelter_a" } } },
    storyComics: {
      seenStoragePrefix: "digest_story_",
      comics: {
        intro: {
          missionId: "digest_mission",
          title: "Intro",
          panels: [{ text: "Welcome" }]
        }
      }
    },
    battleBackgrounds: {
      fallbackMissionId: "digest_mission",
      placeholderMissionIds: ["digest_mission"],
      definitions: {
        digest_mission: { missionId: "digest_mission", color: "#112233", opacity: 0.5 }
      }
    }
  };
}

function cloneInput(): GameContentInput {
  return structuredClone(createContentInput());
}

function reverseObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, item]) => [key, reverseObjectKeys(item)])
    ) as T;
  }
  return value;
}

describe("canonicalStringify", () => {
  it("reports exact UTF-8 byte and visited-node metrics from the same strict traversal", () => {
    const value = { message: "💥", nested: [true, null] };
    const serialized = canonicalStringify(value);
    expect(canonicalJsonMetrics(value)).toEqual({
      bytes: new TextEncoder().encode(serialized).byteLength,
      nodes: 5
    });
    expect(() => canonicalJsonMetrics(value, { maxNodes: 4 })).toThrow(/node/i);
  });

  it("sorts every object by binary UTF-16 key order, including integer-like keys", () => {
    const value = { a: 2, "2": "two", ä: 3, Z: 1, "10": "ten" };

    expect(canonicalStringify(value)).toBe("{\"10\":\"ten\",\"2\":\"two\",\"Z\":1,\"a\":2,\"ä\":3}");
    expect(canonicalStringify({ b: { z: 1, a: 2 }, a: 0 })).toBe("{\"a\":0,\"b\":{\"a\":2,\"z\":1}}");
  });

  it("preserves array order and JSON number formatting while normalizing negative zero to zero", () => {
    expect(canonicalStringify([3, 2, 1])).toBe("[3,2,1]");
    expect(canonicalStringify([-0, 0, 1e-7, 1e21])).toBe("[0,0,1e-7,1e+21]");
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["undefined", undefined],
    ["function", () => undefined],
    ["symbol", Symbol("value")],
    ["bigint", 1n]
  ])("rejects non-JSON primitive %s instead of coercing or dropping it", (_label, value) => {
    expect(() => canonicalStringify(value)).toThrow();
    expect(() => canonicalStringify({ value })).toThrow();
  });

  it("rejects sparse arrays, symbol keys, cycles, accessors, and non-plain objects", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = "present";

    const symbolKey = { visible: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("hidden")] = 1;

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "must-not-run";
      }
    });

    class CustomValue {
      value = 1;
    }

    class CustomArray extends Array<number> {}

    const hiddenData: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(hiddenData, "hidden", { value: 2, enumerable: false });

    expect(() => canonicalStringify(sparse)).toThrow(/sparse/i);
    expect(() => canonicalStringify(symbolKey)).toThrow(/symbol/i);
    expect(() => canonicalStringify(cycle)).toThrow(/cycl/i);
    expect(() => canonicalStringify(accessor)).toThrow(/accessor/i);
    expect(getterCalls).toBe(0);
    expect(() => canonicalStringify(hiddenData)).toThrow(/enumerable|hidden|property/i);
    expect(() => canonicalStringify(new Date(0))).toThrow(/plain/i);
    expect(() => canonicalStringify(new Map([["key", "value"]]))).toThrow(/plain/i);
    expect(() => canonicalStringify(new CustomValue())).toThrow(/plain/i);
    expect(() => canonicalStringify(new CustomArray(1, 2))).toThrow(/plain|array/i);
    expect(() => canonicalStringify(Object.assign(Object.create(null), { value: 1 }))).toThrow(/plain/i);
  });

  it("snapshots array length from data descriptors without reading Proxy fields", () => {
    let lengthReads = 0;
    const input = new Proxy([1, 2], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 0;
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(canonicalStringify(input)).toBe("[1,2]");
    expect(lengthReads).toBe(0);
  });

  it("enforces caller-selected depth, node, and canonical UTF-8 byte budgets", () => {
    expect(canonicalStringify({ value: 1 }, { maxDepth: 1 })).toBe("{\"value\":1}");
    expect(() => canonicalStringify({ child: { value: 1 } }, { maxDepth: 1 })).toThrow(/depth/i);

    expect(canonicalStringify({ a: 1, b: 2 }, { maxNodes: 3 })).toBe("{\"a\":1,\"b\":2}");
    expect(() => canonicalStringify({ a: 1, b: 2 }, { maxNodes: 2 })).toThrow(/node/i);

    expect(canonicalStringify("💥", { maxBytes: 6 })).toBe("\"💥\"");
    expect(() => canonicalStringify("💥", { maxBytes: 5 })).toThrow(/byte/i);
  });
});

describe("stableDigest", () => {
  it("uses synchronous browser-safe FNV-1a 64 over canonical UTF-8 bytes with fixed v1 vectors", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(stableDigest(null)).toBe("tf-state-v1:5b9bc4ba528108e4");
      expect(stableDigest({ b: 2, a: 1 })).toBe("tf-state-v1:a0ebc03bdc71de7b");
      expect(stableDigest([1, 2, 3])).toBe("tf-state-v1:28bbee4398699f19");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is insertion-order independent but changes for array order and numeric values", () => {
    expect(stableDigest({ a: 1, b: { c: 2 } })).toBe(stableDigest({ b: { c: 2 }, a: 1 }));
    expect(stableDigest([1, 2])).not.toBe(stableDigest([2, 1]));
    expect(stableDigest({ value: 1 })).not.toBe(stableDigest({ value: 1.0001 }));
  });
});

describe("getSimulationContentDigest", () => {
  it("is independent of source identity, object insertion order, and derived mapFactory identity", () => {
    const canonical = createGameContentRegistry(cloneInput());
    const reordered = createGameContentRegistry(reverseObjectKeys(cloneInput()));

    expect(reordered).not.toBe(canonical);
    expect(reordered.missions.digest_mission!.mapFactory).not.toBe(canonical.missions.digest_mission!.mapFactory);
    expect(getSimulationContentDigest(reordered)).toBe(getSimulationContentDigest(canonical));
    expect(getSimulationContentDigest(canonical)).toMatch(/^tf-content-v1:[0-9a-f]{16}$/);
  });

  it("excludes presentation-only domains, nested metadata, world-map layout, and their getters", () => {
    const baseline = createGameContentRegistry(cloneInput());
    const presentationChanged = createGameContentRegistry(cloneInput());

    let visualsReads = 0;
    Object.defineProperty(presentationChanged, "visuals", {
      enumerable: true,
      get() {
        visualsReads += 1;
        throw new Error("Excluded visuals getter must not run.");
      }
    });
    presentationChanged.storyComics = {
      outro: { missionId: "digest_mission", panels: [{ text: "Different story" }] }
    };
    presentationChanged.storySeenStoragePrefix = "other_story_prefix_";
    presentationChanged.battleBackgrounds = {
      other: { missionId: "digest_mission", spriteId: "background_b", opacity: 1 }
    };
    presentationChanged.battleBackgroundPlaceholderMissionIds = [];
    presentationChanged.battleBackgroundFallbackMissionId = "other";
    presentationChanged.currencies[0] = { id: "coins", label: "Other coins", color: 0x010203 };
    presentationChanged.difficulties[0]!.label = "Other difficulty";
    presentationChanged.difficulties[0]!.description = "Presentation only";
    presentationChanged.metaProgression.currencies[0] = { id: "stars", label: "Other stars", color: 0x030201 };
    presentationChanged.metaProgression.upgrades.power!.label = "Other power";
    presentationChanged.metaProgression.upgrades.power!.description = "Presentation only";
    presentationChanged.terrainTypes.buildable!.label = "Other terrain";
    presentationChanged.abilities.strike!.label = "Other strike";
    presentationChanged.enemies.grunt!.label = "Other grunt";
    presentationChanged.enemies.grunt!.color = 0x010101;
    presentationChanged.towers.pelter!.label = "Other pelter";
    presentationChanged.waveSets.one![0]!.label = "Other wave";
    presentationChanged.missions.digest_mission!.label = "Other mission";
    presentationChanged.missions.digest_mission!.description = "Presentation only";
    presentationChanged.worldMap = {
      width: 1,
      height: 1,
      regions: [],
      missionNodes: []
    };
    presentationChanged.missions.digest_mission!.mapFactory = () => {
      throw new Error("Content digest must not invoke mapFactory.");
    };

    expect(getSimulationContentDigest(presentationChanged)).toBe(getSimulationContentDigest(baseline));
    expect(visualsReads).toBe(0);
  });

  it.each([
    ["balance constants", (input: GameContentInput) => { input.balance.constants.startingCoreHp = 21; }],
    ["difficulty rules", (input: GameContentInput) => { input.balance.difficulties![0]!.enemyHpMultiplier = 1.1; }],
    ["meta progression", (input: GameContentInput) => {
      input.balance.metaProgression!.upgrades.power!.effects = [{ kind: "towerDamage", multiplierPerLevel: 0.2 }];
    }],
    ["terrain rules", (input: GameContentInput) => { input.balance.terrainTypes!.buildable!.groundSpeedMultiplier = 0.8; }],
    ["abilities", (input: GameContentInput) => { input.balance.abilities.strike!.damage = 4; }],
    ["tower rules", (input: GameContentInput) => {
      const attack = input.balance.towers.pelter!.attack;
      if (attack.kind !== "single") throw new Error("Invalid test fixture.");
      attack.damagePerStack = 3;
    }],
    ["enemy rules", (input: GameContentInput) => { input.balance.enemies.grunt!.maxHp = 11; }],
    ["wave composition", (input: GameContentInput) => { input.balance.waveSets.one![0]!.groups[0]!.count = 2; }],
    ["mission economy", (input: GameContentInput) => { input.balance.missions.digest_mission!.economy!.sellRefundRatio = 0.6; }],
    ["mission objectives", (input: GameContentInput) => {
      const failure = input.balance.missions.digest_mission!.objectives!.failure![0]!;
      if (failure.kind !== "maxLeaks") throw new Error("Invalid test fixture.");
      failure.maxLeaks = 2;
    }],
    ["TowerScript", (input: GameContentInput) => {
      const action = input.scripts!.opening_bonus!.handlers.gameStarted![0]!.actions[0]!;
      if (action.action !== "grantResource") throw new Error("Invalid test fixture.");
      action.amount = 2;
    }],
    ["map topology", (input: GameContentInput) => { input.maps.lane!.pathCenterline[1] = { q: 1, r: 0 }; }],
    ["mechanics profile data", (input: GameContentInput) => {
      const mechanics = input.mechanics!;
      const combat = mechanics.modules.combat!;
      input.mechanics = {
        ...mechanics,
        modules: {
          ...mechanics.modules,
          combat: {
            ...combat,
            profiles: { ...combat.profiles, default: { scalar: 1.5 } }
          }
        }
      };
    }],
    ["resolved mission mechanics selection", (input: GameContentInput) => {
      input.balance.missions.digest_mission!.mechanics = { profiles: { combat: "alternate" } };
    }]
  ] as const)("changes when %s changes", (_label, mutate) => {
    const baseline = createGameContentRegistry(cloneInput());
    const changedInput = cloneInput();
    mutate(changedInput);
    const changed = createGameContentRegistry(changedInput);

    expect(getSimulationContentDigest(changed)).not.toBe(getSimulationContentDigest(baseline));
  });

  it("recomputes for mutable registries instead of returning an unsafe identity-only cache entry", () => {
    const content = createGameContentRegistry(cloneInput());
    const before = getSimulationContentDigest(content);
    const attack = content.towers.pelter!.attack;
    if (attack.kind !== "single") throw new Error("Invalid test fixture.");

    attack.damagePerStack += 1;

    expect(getSimulationContentDigest(content)).not.toBe(before);
  });

  it("preserves gameplay record keys that happen to match presentation field names", () => {
    const withColorCost = (amount: number) => {
      const input = cloneInput();
      input.balance.currencies!.push({ id: "color", label: "Paint" });
      input.balance.constants.startingResources!.color = 10;
      input.balance.missions.digest_mission!.startingResources!.color = 10;
      input.balance.towers.pelter!.cost = { ...input.balance.towers.pelter!.cost, color: amount };

      const tower = input.balance.towers.pelter!;
      delete input.balance.towers.pelter;
      Object.defineProperty(input.balance.towers, "label", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: { ...tower, id: "label" }
      });
      input.balance.missions.digest_mission!.buildTowerIds = ["label"];
      return createGameContentRegistry(input);
    };

    const baseline = withColorCost(1);
    const changedCost = withColorCost(2);
    const changedTower = withColorCost(1);
    const attack = changedTower.towers.label!.attack;
    if (attack.kind !== "single") throw new Error("Invalid test fixture.");
    attack.damagePerStack += 1;

    expect(getSimulationContentDigest(changedCost)).not.toBe(getSimulationContentDigest(baseline));
    expect(getSimulationContentDigest(changedTower)).not.toBe(getSimulationContentDigest(baseline));
  });

  it("preserves an own author id named __proto__ without changing the projection prototype", () => {
    const withPrototypeId = (damage: number) => {
      const content = createGameContentRegistry(cloneInput());
      const tower = structuredClone(content.towers.pelter!);
      if (tower.attack.kind !== "single") throw new Error("Invalid test fixture.");
      tower.id = "__proto__";
      tower.attack.damagePerStack = damage;
      Object.defineProperty(content.towers, "__proto__", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: tower
      });
      return content;
    };

    const baseline = withPrototypeId(2);
    const changed = withPrototypeId(3);

    expect(() => getSimulationContentDigest(baseline)).not.toThrow();
    expect(getSimulationContentDigest(changed)).not.toBe(getSimulationContentDigest(baseline));
  });
});
